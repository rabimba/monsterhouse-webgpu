import {
  AutoModelForCausalLM,
  AutoModelForImageTextToText,
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  TextStreamer,
  env,
} from '@huggingface/transformers';
import { createSmoothProgressTracker } from '../progressTracker';
import { probeOptimalWebGpuDevice, resolveWorkerDtype } from '../webgpuCapabilities';

env.allowLocalModels = false;

export type BrainFamily = 'lfm3-vl' | 'gemma4' | 'nemotron-bolt-gemma4';

export type BrainWorkerInMessage =
  | {
      type: 'LOAD_BRAIN';
      repoId: string;
      family: BrainFamily;
      dtype: 'q4f16' | 'q4' | 'fp16';
    }
  | {
      type: 'GENERATE_REPLY';
      requestId: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      maxNewTokens?: number;
      temperature?: number;
    }
  | {
      type: 'ANALYZE_COSTUME_CROP';
      requestId: string;
      trackId: number;
      dataUrl: string;
    }
  | {
      type: 'TRANSCRIBE_AUDIO_16K';
      requestId: string;
      audio16k: Float32Array;
    }
  | {
      type: 'RUN_BENCHMARK';
      requestId: string;
    }
  | {
      type: 'ABORT_GENERATION';
    };

export type BrainWorkerOutMessage =
  | {
      type: 'BRAIN_STATUS';
      status: 'idle' | 'loading' | 'ready' | 'error';
      detail: string;
      progressPct?: number;
      repoId?: string;
    }
  | { type: 'BRAIN_BUSY'; busy: boolean }
  | { type: 'TOKEN_DELTA'; requestId: string; delta: string }
  | {
      type: 'GENERATION_DONE';
      requestId: string;
      fullText: string;
      tokPerSec: number;
      firstTokenMs: number;
    }
  | {
      type: 'GENERATION_ERROR';
      requestId: string;
      error: string;
    }
  | {
      type: 'COSTUME_RESULT';
      requestId: string;
      trackId: number;
      costume: string;
      detail: string;
    }
  | {
      type: 'AUDIO_TRANSCRIPT_RESULT';
      requestId: string;
      text: string;
    }
  | {
      type: 'BENCHMARK_RESULT';
      requestId: string;
      ttftMs: number;
      tokPerSec: number;
    };

let loadedRepoId = '';
let loadedFamily: BrainFamily = 'lfm3-vl';
let modelInstance: any = null;
let processorOrTokenizer: any = null;
let inFlightBrainRepo = '';
let inFlightBrainPromise: Promise<void> | null = null;
let loadRequestToken = 0;
let abortRequested = false;
let activeGpuInference = false;
let gpuTaskChain: Promise<void> = Promise.resolve();

function enqueueGpuTask(fn: () => Promise<void>): Promise<void> {
  const run = gpuTaskChain.then(async () => {
    activeGpuInference = true;
    try {
      await fn();
    } finally {
      activeGpuInference = false;
    }
  });
  gpuTaskChain = run.catch(() => {});
  return run;
}

function post(msg: BrainWorkerOutMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

async function encodeTextOnlyInputs(promptText: string): Promise<any> {
  if (loadedFamily === 'lfm3-vl') {
    // Lfm3VlProcessor._call(images, text, kwargs)
    return await processorOrTokenizer(null, promptText);
  }
  if (loadedFamily === 'gemma4' && processorOrTokenizer.tokenizer) {
    // Gemma4Processor._call(text, images, audio, options)
    return await processorOrTokenizer(promptText);
  }
  const tokenizer = processorOrTokenizer.tokenizer ?? processorOrTokenizer;
  return await tokenizer(promptText, { return_tensors: 'pt' });
}

async function warmupWgslPipelines(): Promise<void> {
  if (!modelInstance || !processorOrTokenizer) return;
  try {
    const tokenizer = processorOrTokenizer.tokenizer ?? processorOrTokenizer;
    const warmPrompt = tokenizer.apply_chat_template(
      [{ role: 'user', content: 'Ahoy!' }],
      { tokenize: false, add_generation_prompt: true, enable_thinking: false },
    );
    const inputs = await encodeTextOnlyInputs(warmPrompt);
    await modelInstance.generate({
      ...inputs,
      max_new_tokens: 1,
      do_sample: false,
    });
  } catch {
    // Non-fatal if shader warmup is skipped
  }
}

async function loadBrainModel(
  repoId: string,
  family: BrainFamily,
  dtype: 'q4f16' | 'q4' | 'fp16',
): Promise<void> {
  if (modelInstance && loadedRepoId === repoId) {
    post({
      type: 'BRAIN_STATUS',
      status: 'ready',
      detail: `${repoId} ready (warm)`,
      progressPct: 100,
      repoId,
    });
    return;
  }

  // Deduplicate repeated LOAD_BRAIN calls (e.g. clicking Warm then Connect while already streaming)
  if (inFlightBrainPromise && inFlightBrainRepo === repoId) {
    return inFlightBrainPromise;
  }

  const myToken = ++loadRequestToken;
  inFlightBrainRepo = repoId;

  const task = (async () => {
    try {
      const caps = await probeOptimalWebGpuDevice();
      const effectiveDtype = resolveWorkerDtype(dtype, caps);
      const runtimeLabel = caps.device === 'webgpu' ? 'WebGPU' : 'SIMD WASM';
      const shortName = repoId.split('/').pop() ?? repoId;

      post({
        type: 'BRAIN_STATUS',
        status: 'loading',
        detail: `Connecting to HuggingFace Hub for ${shortName} (${effectiveDtype})...`,
        progressPct: 0.5,
        repoId,
      });

      const expectedMb =
        family === 'lfm3-vl' ? 1236 : family === 'gemma4' ? 3224 : 4678;

      const progressCallback = createSmoothProgressTracker(
        shortName,
        (snap) => {
          if (myToken !== loadRequestToken) return;
          post({
            type: 'BRAIN_STATUS',
            status: 'loading',
            detail: snap.detail,
            progressPct: snap.progressPct,
            repoId,
          });
        },
        { throttleMs: 200, expectedTotalMb: expectedMb },
      );

      let nextProc: any;
      let nextModel: any;
      if (family === 'lfm3-vl' || family === 'gemma4') {
        [nextProc, nextModel] = await Promise.all([
          AutoProcessor.from_pretrained(repoId),
          AutoModelForImageTextToText.from_pretrained(repoId, {
            device: caps.device,
            dtype: effectiveDtype,
            progress_callback: progressCallback,
          }),
        ]);
      } else {
        // Profile A: RASMUS/NVIDIA-Nemotron-3.5-Bolt-E4B-ONNX (Gemma4ForCausalLM textOnly sessions)
        [nextProc, nextModel] = await Promise.all([
          AutoTokenizer.from_pretrained(repoId),
          AutoModelForCausalLM.from_pretrained(repoId, {
            device: caps.device,
            dtype: effectiveDtype,
            progress_callback: progressCallback,
          }),
        ]);
      }

      if (myToken !== loadRequestToken) return;

      loadedRepoId = repoId;
      loadedFamily = family;
      processorOrTokenizer = nextProc;
      modelInstance = nextModel;

      post({
        type: 'BRAIN_STATUS',
        status: 'loading',
        detail: `Pre-warming ${runtimeLabel} compute shaders for ${shortName}...`,
        progressPct: 99,
        repoId,
      });
      await warmupWgslPipelines();

      if (myToken !== loadRequestToken) return;
      post({
        type: 'BRAIN_STATUS',
        status: 'ready',
        detail: `${shortName} active on ${runtimeLabel} (${effectiveDtype}, warm)`,
        progressPct: 100,
        repoId,
      });
    } catch (err) {
      if (myToken !== loadRequestToken) return;
      modelInstance = null;
      post({
        type: 'BRAIN_STATUS',
        status: 'error',
        detail: `Load error: ${err instanceof Error ? err.message : String(err)}`,
        repoId,
      });
    } finally {
      if (inFlightBrainRepo === repoId) {
        inFlightBrainPromise = null;
        inFlightBrainRepo = '';
      }
    }
  })();

  inFlightBrainPromise = task;
  return task;
}

async function generateReply(
  requestId: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  maxNewTokens = 84,
  temperature = 0.65,
): Promise<void> {
  if (!modelInstance || !processorOrTokenizer) {
    post({
      type: 'GENERATION_ERROR',
      requestId,
      error: 'MODEL_NOT_LOADED',
    });
    return;
  }

  abortRequested = false;
  post({ type: 'BRAIN_BUSY', busy: true });
  const t0 = performance.now();
  let firstTokenMs = 0;
  let generatedTokens = 0;
  let fullText = '';

  try {
    const tokenizer = processorOrTokenizer.tokenizer ?? processorOrTokenizer;
    const promptText = tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
      enable_thinking: false,
    });

    const inputs = await encodeTextOnlyInputs(promptText);

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (delta: string) => {
        if (abortRequested || !delta) return;
        if (firstTokenMs === 0) {
          firstTokenMs = Math.round(performance.now() - t0);
        }
        generatedTokens += 1;
        fullText += delta;
        post({ type: 'TOKEN_DELTA', requestId, delta });
      },
    });

    await modelInstance.generate({
      ...inputs,
      max_new_tokens: maxNewTokens,
      do_sample: temperature > 0.05,
      temperature,
      repetition_penalty: 1.06,
      streamer,
    });

    const elapsedSec = Math.max(0.05, (performance.now() - t0) / 1000);
    post({
      type: 'GENERATION_DONE',
      requestId,
      fullText: fullText.trim(),
      tokPerSec: Math.round((generatedTokens / elapsedSec) * 10) / 10,
      firstTokenMs: firstTokenMs || Math.round(elapsedSec * 1000),
    });
  } catch (err) {
    post({
      type: 'GENERATION_ERROR',
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    post({ type: 'BRAIN_BUSY', busy: false });
  }
}

async function analyzeCostumeCrop(
  requestId: string,
  trackId: number,
  dataUrl: string,
): Promise<void> {
  if (
    !modelInstance ||
    !processorOrTokenizer ||
    (loadedFamily !== 'lfm3-vl' && loadedFamily !== 'gemma4')
  ) {
    return;
  }

  post({ type: 'BRAIN_BUSY', busy: true });
  try {
    const rawImg = await RawImage.fromURL(dataUrl);
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image' },
          {
            type: 'text',
            text: 'Identify the Halloween costume or clothing of this visitor in JSON only: {"costume": "<1-2 word label>", "detail": "<short visual phrase>"}',
          },
        ],
      },
    ];
    const prompt = processorOrTokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
      enable_thinking: false,
    });
    const inputs =
      loadedFamily === 'lfm3-vl'
        ? await processorOrTokenizer([rawImg], prompt)
        : await processorOrTokenizer(prompt, [rawImg]);

    const out = await modelInstance.generate({
      ...inputs,
      max_new_tokens: 36,
      do_sample: false,
    });
    const promptLen = (inputs.input_ids?.dims?.[1] as number) ?? 0;
    const genTokens = promptLen > 0 ? out.slice(null, [promptLen, null]) : out;
    const decoded: string = processorOrTokenizer.batch_decode(genTokens, {
      skip_special_tokens: true,
    })[0] ?? '';

    const jsonMatches = decoded.match(/\{[^{}]*\}/g);
    const candidateJson = jsonMatches ? jsonMatches[jsonMatches.length - 1] : null;
    if (candidateJson) {
      const parsed = JSON.parse(candidateJson);
      const costumeLabel = String(parsed.costume || '').trim();
      const detailLabel = String(parsed.detail || '').trim();
      if (costumeLabel && !costumeLabel.includes('<')) {
        post({
          type: 'COSTUME_RESULT',
          requestId,
          trackId,
          costume: costumeLabel,
          detail: detailLabel.includes('<') ? '' : detailLabel,
        });
      }
    }
  } catch {
    // Keep existing costume label if VLM parse fails
  } finally {
    post({ type: 'BRAIN_BUSY', busy: false });
  }
}

async function transcribeAudioWithGemma4(
  requestId: string,
  audio16k: Float32Array,
): Promise<void> {
  if (!modelInstance || !processorOrTokenizer || loadedFamily !== 'gemma4') {
    post({ type: 'AUDIO_TRANSCRIPT_RESULT', requestId, text: '' });
    return;
  }

  post({ type: 'BRAIN_BUSY', busy: true });
  try {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'audio' },
          {
            type: 'text',
            text: 'Transcribe the spoken English words verbatim with no extra commentary.',
          },
        ],
      },
    ];
    const prompt = processorOrTokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
      enable_thinking: false,
    });
    const inputs = await processorOrTokenizer(prompt, null, audio16k);
    const out = await modelInstance.generate({
      ...inputs,
      max_new_tokens: 48,
      do_sample: false,
    });
    const promptLen = (inputs.input_ids?.dims?.[1] as number) ?? 0;
    const genTokens = promptLen > 0 ? out.slice(null, [promptLen, null]) : out;
    const decoded: string = processorOrTokenizer.batch_decode(genTokens, {
      skip_special_tokens: true,
    })[0] ?? '';
    const cleaned = decoded
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();
    post({ type: 'AUDIO_TRANSCRIPT_RESULT', requestId, text: cleaned });
  } catch {
    post({ type: 'AUDIO_TRANSCRIPT_RESULT', requestId, text: '' });
  } finally {
    post({ type: 'BRAIN_BUSY', busy: false });
  }
}

async function runBenchmark(requestId: string): Promise<void> {
  if (!modelInstance || !processorOrTokenizer) {
    post({ type: 'BENCHMARK_RESULT', requestId, ttftMs: 0, tokPerSec: 0 });
    return;
  }

  post({ type: 'BRAIN_BUSY', busy: true });
  try {
    const tokenizer = processorOrTokenizer.tokenizer ?? processorOrTokenizer;
    const promptText = tokenizer.apply_chat_template(
      [
        {
          role: 'system',
          content:
            'You are MonsterHouse, a grumpy sunken pirate ship garage door. Reply in 1 short sentence starting with [grumpy].',
        },
        { role: 'user', content: 'Trick or treat! Give us candy!' },
      ],
      { tokenize: false, add_generation_prompt: true, enable_thinking: false },
    );

    const inputs = await encodeTextOnlyInputs(promptText);
    const t0 = performance.now();
    let ttftMs = 0;
    let tokens = 0;

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (delta: string) => {
        if (!delta) return;
        if (ttftMs === 0) {
          ttftMs = Math.round(performance.now() - t0);
        }
        tokens += 1;
      },
    });

    await modelInstance.generate({
      ...inputs,
      max_new_tokens: 28,
      do_sample: false,
      streamer,
    });

    const elapsedSec = Math.max(0.02, (performance.now() - t0) / 1000);
    post({
      type: 'BENCHMARK_RESULT',
      requestId,
      ttftMs: ttftMs || Math.round(elapsedSec * 1000),
      tokPerSec: Math.round((Math.max(1, tokens) / elapsedSec) * 10) / 10,
    });
  } catch {
    post({ type: 'BENCHMARK_RESULT', requestId, ttftMs: 0, tokPerSec: 0 });
  } finally {
    post({ type: 'BRAIN_BUSY', busy: false });
  }
}

self.onmessage = (ev: MessageEvent<BrainWorkerInMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'LOAD_BRAIN':
      void loadBrainModel(msg.repoId, msg.family, msg.dtype);
      break;
    case 'GENERATE_REPLY':
      void enqueueGpuTask(() =>
        generateReply(msg.requestId, msg.messages, msg.maxNewTokens, msg.temperature),
      );
      break;
    case 'ANALYZE_COSTUME_CROP':
      // Never block or collide with active conversation/benchmark GPU sessions
      if (!activeGpuInference) {
        void enqueueGpuTask(() => analyzeCostumeCrop(msg.requestId, msg.trackId, msg.dataUrl));
      }
      break;
    case 'TRANSCRIBE_AUDIO_16K':
      void enqueueGpuTask(() => transcribeAudioWithGemma4(msg.requestId, msg.audio16k));
      break;
    case 'RUN_BENCHMARK':
      void enqueueGpuTask(() => runBenchmark(msg.requestId));
      break;
    case 'ABORT_GENERATION':
      abortRequested = true;
      break;
  }
};
