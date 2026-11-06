import { env, pipeline } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { createSmoothProgressTracker } from '../progressTracker';
import { probeOptimalWebGpuDevice } from '../webgpuCapabilities';

env.allowLocalModels = false;

const FAST_LOCAL_ASR_REPO = 'onnx-community/moonshine-tiny-ONNX';

export type SpeechWorkerInMessage =
  | {
      type: 'LOAD_ASR';
      repoId: string;
      mode?: 'parakeet-webgpu' | 'omni-audio' | 'vad-only';
      silenceEouMs?: number;
    }
  | { type: 'PUSH_AUDIO_16K'; samples: Float32Array }
  | { type: 'SET_SILENCE_EOU_MS'; ms: number }
  | { type: 'RESET_UTTERANCE' };

export type SpeechWorkerOutMessage =
  | {
      type: 'ASR_STATUS';
      status: 'idle' | 'loading' | 'ready' | 'fallback';
      detail: string;
      progressPct?: number;
    }
  | { type: 'VAD_SPEECH_START' }
  | { type: 'VAD_TRANSCRIBING' }
  | { type: 'VAD_LEVEL'; rms: number; speaking: boolean }
  | { type: 'PARTIAL_TRANSCRIPT'; text: string }
  | {
      type: 'FINAL_TRANSCRIPT';
      text: string;
      durationMs: number;
      peakRms: number;
      audio16k: Float32Array;
    };

let vadSession: ort.InferenceSession | null = null;
let vadState: ort.Tensor | null = null;
let fastAsrTranscriber: any = null;
let fastAsrPromise: Promise<void> | null = null;
let asrTranscriber: any = null;
let loadedAsrRepo = '';
let inFlightAsrKey = '';
let inFlightAsrPromise: Promise<void> | null = null;
let asrMode: 'parakeet-webgpu' | 'omni-audio' | 'vad-only' = 'parakeet-webgpu';
let silenceEouMs = 300; // Matches blog: "speech-end detection currently waits for 300 ms of silence"

let isSpeaking = false;
let silenceAccumMs = 0;
let speechAccumChunks: Float32Array[] = [];
let speechAccumSamples = 0;
let utterancePeakRms = 0;
let speechStartPerfMs = 0;
let ambientNoiseRms = 0.008;
let audioQueuePromise: Promise<void> = Promise.resolve();

function post(msg: SpeechWorkerOutMessage, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    (self as unknown as Worker).postMessage(msg, transfer);
  } else {
    (self as unknown as Worker).postMessage(msg);
  }
}

async function fetchWithProgress(url: string, label: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || total <= 0) {
    return await res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      post({
        type: 'ASR_STATUS',
        status: 'loading',
        detail:
          asrMode === 'vad-only'
            ? `Downloading ${label}... (Parakeet 0.6B queued after Brain)`
            : `Downloading ${label}...`,
        progressPct: Math.max(0.5, Math.round((loaded / total) * 15)),
      });
    }
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

async function ensureFastLocalAsr(): Promise<void> {
  if (fastAsrTranscriber) return;
  if (fastAsrPromise) return fastAsrPromise;

  fastAsrPromise = (async () => {
    try {
      const progressCallback = createSmoothProgressTracker(
        'Moonshine-Tiny STT',
        (snap) => {
          // Only update ASR_STATUS if heavier Parakeet isn't already ready
          if (!asrTranscriber) {
            post({
              type: 'ASR_STATUS',
              status: 'loading',
              detail:
                asrMode === 'vad-only'
                  ? `${snap.detail} (Parakeet 0.6B queued after Brain)`
                  : snap.detail,
              progressPct: snap.progressPct,
            });
          }
        },
        { throttleMs: 200, expectedTotalMb: 27 },
      );

      fastAsrTranscriber = await pipeline(
        'automatic-speech-recognition',
        FAST_LOCAL_ASR_REPO,
        {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: progressCallback,
        },
      );
    } catch (e) {
      console.warn('[speech.worker] fastAsrTranscriber load warning:', e);
      fastAsrTranscriber = null;
    } finally {
      fastAsrPromise = null;
    }
  })();

  return fastAsrPromise;
}

async function loadModels(
  repoId: string,
  mode: 'parakeet-webgpu' | 'omni-audio' | 'vad-only',
): Promise<void> {
  const reqKey = `${mode}:${repoId}`;
  if (inFlightAsrPromise && inFlightAsrKey === reqKey) {
    return inFlightAsrPromise;
  }
  asrMode = mode;

  const task = (async () => {
    try {
      if (!vadSession) {
        post({
          type: 'ASR_STATUS',
          status: 'loading',
          detail:
            asrMode === 'vad-only'
              ? 'Loading Silero VAD (300ms EOU · Parakeet 0.6B queued after Brain)...'
              : 'Loading Silero VAD (300ms EOU)...',
          progressPct: 0.5,
        });
        const vadUrl =
          'https://huggingface.co/onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4/resolve/main/silero_vad.onnx';
        const vadBuf = await fetchWithProgress(vadUrl, 'Silero VAD');
        vadSession = await ort.InferenceSession.create(vadBuf, {
          executionProviders: ['wasm'],
        });
        vadState = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
      }

      if (mode === 'omni-audio') {
        // Also warm 27 MB Moonshine-Tiny on WASM (0 VRAM) so voice works immediately even while Gemma 4 streams!
        await ensureFastLocalAsr();
        post({
          type: 'ASR_STATUS',
          status: 'ready',
          detail: 'Silero VAD (300ms EOU) + Gemma 4 16kHz Audio & Instant Local STT active',
          progressPct: 100,
        });
        return;
      }

      if (mode === 'vad-only') {
        if (asrTranscriber && loadedAsrRepo === repoId) {
          asrMode = 'parakeet-webgpu';
          post({
            type: 'ASR_STATUS',
            status: 'ready',
            detail: `Silero VAD + ${repoId} ready`,
            progressPct: 100,
          });
          return;
        }
        await ensureFastLocalAsr();
        post({
          type: 'ASR_STATUS',
          status: 'ready',
          detail: fastAsrTranscriber
            ? 'Silero VAD (300ms EOU) + Moonshine-Tiny Local STT ready (Parakeet 0.6B queued after Brain)'
            : 'Silero VAD (300ms EOU) + Browser Speech active (Parakeet 0.6B queued after Brain)',
          progressPct: 100,
        });
        return;
      }

      if (asrTranscriber && loadedAsrRepo === repoId) {
        post({
          type: 'ASR_STATUS',
          status: 'ready',
          detail: `Silero VAD + ${repoId} ready`,
          progressPct: 100,
        });
        return;
      }

      // Ensure fast 27 MB local STT is available first so speaking works uninterrupted while 433 MB Parakeet streams
      if (!fastAsrTranscriber) {
        await ensureFastLocalAsr();
      }

      const caps = await probeOptimalWebGpuDevice();
      const runtimeLabel = caps.device === 'webgpu' ? 'WebGPU' : 'SIMD WASM';
      const shortName = repoId.split('/').pop() ?? repoId;

      post({
        type: 'ASR_STATUS',
        status: 'loading',
        detail: `Upgrading to ${shortName} (${caps.dtype}) — Moonshine-Tiny STT live meanwhile...`,
        progressPct: 0.5,
      });

      const progressCallback = createSmoothProgressTracker(
        shortName,
        (snap) => {
          post({
            type: 'ASR_STATUS',
            status: 'loading',
            detail: snap.detail,
            progressPct: snap.progressPct,
          });
        },
        { throttleMs: 200, expectedTotalMb: 434 },
      );

      asrTranscriber = await pipeline('automatic-speech-recognition', repoId, {
        device: caps.device,
        dtype: caps.dtype,
        progress_callback: progressCallback,
      });
      loadedAsrRepo = repoId;

      post({
        type: 'ASR_STATUS',
        status: 'ready',
        detail: `Silero VAD (300ms EOU) + NVIDIA Parakeet 0.6B CTC ${runtimeLabel} ready`,
        progressPct: 100,
      });
    } catch (err) {
      post({
        type: 'ASR_STATUS',
        status: fastAsrTranscriber ? 'ready' : 'fallback',
        detail: fastAsrTranscriber
          ? 'Silero VAD (300ms EOU) + Moonshine-Tiny Local STT active'
          : `Silero VAD + Streaming STT active (${err instanceof Error ? err.message : 'offline'})`,
        progressPct: 100,
      });
    } finally {
      if (inFlightAsrKey === reqKey) {
        inFlightAsrPromise = null;
        inFlightAsrKey = '';
      }
    }
  })();

  inFlightAsrKey = reqKey;
  inFlightAsrPromise = task;
  return task;
}

async function computeSpeechProbability(
  chunk512: Float32Array,
  rms: number,
): Promise<{ prob: number; usedNeuralVad: boolean }> {
  if (vadSession && vadState) {
    try {
      const inputTensor = new ort.Tensor('float32', chunk512, [1, chunk512.length]);
      const srTensor = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
      const feeds: Record<string, ort.Tensor> = {};
      const inNames = vadSession.inputNames;
      if (inNames.includes('input')) feeds.input = inputTensor;
      if (inNames.includes('sr')) feeds.sr = srTensor;
      if (inNames.includes('state')) feeds.state = vadState;

      const results = await vadSession.run(feeds);
      const outName = vadSession.outputNames[0];
      const stateOutName = vadSession.outputNames.find((n) => n.includes('state'));
      if (stateOutName && results[stateOutName]) {
        vadState = results[stateOutName];
      }
      const prob = Number((results[outName]?.data as Float32Array)?.[0] ?? 0);
      if (!Number.isNaN(prob)) {
        return { prob, usedNeuralVad: true };
      }
    } catch {
      // Fall back to adaptive RMS energy threshold
    }
  }

  const threshold = Math.max(0.024, ambientNoiseRms * 2.8);
  return {
    prob: rms >= threshold ? 0.75 : 0.05,
    usedNeuralVad: false,
  };
}

async function finalizeCurrentUtterance(): Promise<void> {
  const totalLen = speechAccumSamples;
  const chunks = speechAccumChunks;
  const dur = performance.now() - speechStartPerfMs;
  const peakRms = utterancePeakRms;

  isSpeaking = false;
  silenceAccumMs = 0;
  speechAccumChunks = [];
  speechAccumSamples = 0;
  utterancePeakRms = 0;

  // Ignore <220ms transient mic clicks
  if (totalLen < 16000 * 0.22) {
    return;
  }

  const merged = new Float32Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.length;
  }

  post({ type: 'VAD_TRANSCRIBING' });

  // If fast 27 MB Moonshine-Tiny is mid-download right as user spoke their first phrase, await it
  if (!asrTranscriber && !fastAsrTranscriber && fastAsrPromise) {
    await Promise.race([
      fastAsrPromise,
      new Promise<void>((r) => setTimeout(r, 15000)),
    ]);
  }

  let transcribedText = '';
  const activePipeline =
    asrMode === 'parakeet-webgpu' && asrTranscriber ? asrTranscriber : fastAsrTranscriber;
  if (activePipeline) {
    try {
      const out = await activePipeline(merged);
      transcribedText = String(out?.text ?? '').trim();
    } catch {
      transcribedText = '';
    }
  }

  post(
    {
      type: 'FINAL_TRANSCRIPT',
      text: transcribedText,
      durationMs: Math.round(dur),
      peakRms,
      audio16k: merged,
    },
    [merged.buffer],
  );
}

async function processAudioSamples(samples: Float32Array): Promise<void> {
  const frameLen = 512; // 32 ms @ 16 kHz
  const maxUtteranceSamples = 16000 * 8; // 8s safety cap so ambient noise can never hang EOU

  for (let offset = 0; offset + frameLen <= samples.length; offset += frameLen) {
    const slice = samples.slice(offset, offset + frameLen);
    let sq = 0;
    for (let i = 0; i < slice.length; i++) sq += slice[i] * slice[i];
    const rms = Math.sqrt(sq / slice.length);

    const { prob, usedNeuralVad } = await computeSpeechProbability(slice, rms);
    const frameMs = (frameLen / 16000) * 1000;

    // Hysteresis: 0.40 to trigger speech start, 0.26 to sustain speech; never let steady ambient RMS override neural Silero VAD!
    const voiceActive = usedNeuralVad
      ? isSpeaking
        ? prob >= 0.26
        : prob >= 0.40 && rms >= 0.004
      : prob >= 0.5;

    if (!voiceActive && !isSpeaking) {
      ambientNoiseRms = ambientNoiseRms * 0.96 + rms * 0.04;
    }

    post({ type: 'VAD_LEVEL', rms, speaking: isSpeaking || voiceActive });

    if (voiceActive) {
      silenceAccumMs = 0;
      if (!isSpeaking) {
        isSpeaking = true;
        speechStartPerfMs = performance.now();
        speechAccumChunks = [];
        speechAccumSamples = 0;
        utterancePeakRms = rms;
        post({ type: 'VAD_SPEECH_START' });
      }
      speechAccumChunks.push(slice);
      speechAccumSamples += slice.length;
      if (rms > utterancePeakRms) utterancePeakRms = rms;

      if (speechAccumSamples >= maxUtteranceSamples) {
        await finalizeCurrentUtterance();
      }
    } else if (isSpeaking) {
      speechAccumChunks.push(slice);
      speechAccumSamples += slice.length;
      silenceAccumMs += frameMs;

      if (silenceAccumMs >= silenceEouMs) {
        await finalizeCurrentUtterance();
      }
    }
  }
}

self.onmessage = (ev: MessageEvent<SpeechWorkerInMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'LOAD_ASR':
      if (msg.silenceEouMs !== undefined) silenceEouMs = msg.silenceEouMs;
      void loadModels(msg.repoId, msg.mode ?? 'parakeet-webgpu');
      break;
    case 'SET_SILENCE_EOU_MS':
      silenceEouMs = Math.max(120, Math.min(1500, msg.ms));
      break;
    case 'RESET_UTTERANCE':
      isSpeaking = false;
      silenceAccumMs = 0;
      speechAccumChunks = [];
      speechAccumSamples = 0;
      utterancePeakRms = 0;
      if (vadState) {
        vadState = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
      }
      break;
    case 'PUSH_AUDIO_16K':
      audioQueuePromise = audioQueuePromise
        .then(() => processAudioSamples(msg.samples))
        .catch(() => {});
      break;
  }
};
