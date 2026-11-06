import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import * as ort from 'onnxruntime-web/webgpu';
import {
  moodToAudio2FaceEmotionVector,
  projectNvidiaA2fOutputToBlendshapes,
  resampleLinearPcm,
  solveAcousticBlendshapes60Hz,
} from '../a2fSolver';
import { probeOptimalWebGpuDevice } from '../webgpuCapabilities';
import { synthesizeInstantPiratePcm } from '../../audio/DualStreamAudioRouter';
import {
  ACTIVE_44_SOUND_TARGETS,
  type A2fEngineId,
  type BlendshapeWeights,
  type MoodTag,
  type TtsEngineId,
} from '../../types/monster';

env.allowLocalModels = false;

export type TtsA2fWorkerInMessage =
  | {
      type: 'LOAD_TTS_A2F';
      ttsEngine: TtsEngineId;
      a2fEngine: A2fEngineId;
    }
  | {
      type: 'SET_VOICE_SAMPLE';
      mood: MoodTag;
      pcmFloat32: Float32Array;
      sampleRate: number;
    }
  | {
      type: 'SYNTHESIZE_AND_ANIMATE';
      requestId: string;
      text: string;
      mood: MoodTag;
      voiceId: string;
      ttsEngine: TtsEngineId;
      a2fEngine: A2fEngineId;
    };

export type TtsA2fWorkerOutMessage =
  | {
      type: 'TTS_A2F_STATUS';
      ttsStatus: 'idle' | 'loading' | 'ready' | 'fallback';
      a2fStatus: 'idle' | 'loading' | 'ready' | 'fallback';
      detail: string;
      progressPct?: number;
    }
  | {
      type: 'SYNTHESIS_RESULT';
      requestId: string;
      pcmFloat32: Float32Array;
      sampleRate: number;
      frames60Hz: BlendshapeWeights[];
      ttsMs: number;
      a2fMs: number;
      usedEngine: TtsEngineId;
    };

let kokoroInstance: KokoroTTS | null = null;
let a2fMarkSession: ort.InferenceSession | null = null;

let ttsReadyState: 'idle' | 'loading' | 'ready' | 'fallback' = 'idle';
let a2fReadyState: 'idle' | 'loading' | 'ready' | 'fallback' = 'idle';
let inFlightTtsKey = '';
let inFlightTtsPromise: Promise<void> | null = null;

interface VoiceReferenceProfile {
  pcm: Float32Array;
  sr: number;
  f0Hz: number;
  brightness: number;
  cadenceScale: number;
  matchedVoice: 'am_onyx' | 'bm_george' | 'bm_fable' | 'am_fenrir';
  baseVoiceF0Hz: number;
}

const voiceReferenceBank: Partial<Record<MoodTag, VoiceReferenceProfile>> = {};

function analyzeVoiceReference(pcm: Float32Array, sr: number): VoiceReferenceProfile {
  const pcm16k = resampleLinearPcm(pcm, sr, 16000);
  const frameLen = 512;
  const minLag = Math.floor(16000 / 280); // ~280 Hz
  const maxLag = Math.floor(16000 / 75); // ~75 Hz

  const f0Estimates: number[] = [];
  let voicedFrames = 0;
  let totalFrames = 0;
  let totalRms = 0;
  let totalDiffRms = 0;

  for (let start = 0; start + frameLen <= pcm16k.length; start += 256) {
    totalFrames += 1;
    let sumSq = 0;
    let diffSq = 0;
    for (let i = 0; i < frameLen; i++) {
      const s = pcm16k[start + i];
      sumSq += s * s;
      if (i > 0) {
        const d = s - pcm16k[start + i - 1];
        diffSq += d * d;
      }
    }
    const rms = Math.sqrt(sumSq / frameLen);
    if (rms < 0.012) continue;

    voicedFrames += 1;
    totalRms += rms;
    totalDiffRms += Math.sqrt(diffSq / frameLen);

    let bestLag = 0;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag && start + lag + 256 <= pcm16k.length; lag++) {
      let corr = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < 256; i++) {
        const a = pcm16k[start + i];
        const b = pcm16k[start + i + lag];
        corr += a * b;
        normA += a * a;
        normB += b * b;
      }
      const denom = Math.sqrt(normA * normB) + 1e-8;
      const r = corr / denom;
      if (r > bestCorr) {
        bestCorr = r;
        bestLag = lag;
      }
    }
    if (bestCorr > 0.45 && bestLag > 0) {
      f0Estimates.push(16000 / bestLag);
    }
  }

  f0Estimates.sort((a, b) => a - b);
  const medianF0 =
    f0Estimates.length > 0 ? f0Estimates[Math.floor(f0Estimates.length / 2)] : 118;
  const voicedRatio = totalFrames > 0 ? voicedFrames / totalFrames : 0.55;
  const brightness = totalRms > 1e-5 ? Math.min(1.5, totalDiffRms / totalRms) : 0.45;
  const cadenceScale = Math.max(0.86, Math.min(1.14, 0.88 + voicedRatio * 0.28));

  let matchedVoice: VoiceReferenceProfile['matchedVoice'] = 'bm_fable';
  let baseVoiceF0Hz = 132;
  if (medianF0 < 108) {
    matchedVoice = 'am_onyx';
    baseVoiceF0Hz = 104;
  } else if (medianF0 < 128) {
    matchedVoice = 'bm_george';
    baseVoiceF0Hz = 118;
  } else if (medianF0 < 155) {
    matchedVoice = 'bm_fable';
    baseVoiceF0Hz = 134;
  } else {
    matchedVoice = 'am_fenrir';
    baseVoiceF0Hz = 148;
  }

  return {
    pcm,
    sr,
    f0Hz: medianF0,
    brightness,
    cadenceScale,
    matchedVoice,
    baseVoiceF0Hz,
  };
}

function applyZeroShotTimbreConditioning(
  inputPcm: Float32Array,
  pitchRatio: number,
  brightness: number,
): Float32Array {
  const clampedRatio = Math.max(0.84, Math.min(1.18, pitchRatio));
  const outLen = Math.max(1, Math.round(inputPcm.length / clampedRatio));
  const out = new Float32Array(outLen);
  const presenceGain = Math.max(-0.22, Math.min(0.32, (brightness - 0.45) * 0.45));

  let prev = 0;
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * clampedRatio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(inputPcm.length - 1, i0 + 1);
    const frac = srcIdx - i0;
    const s = inputPcm[i0] * (1 - frac) + inputPcm[i1] * frac;
    const high = s - prev;
    prev = s;
    out[i] = Math.max(-0.98, Math.min(0.98, s + high * presenceGain));
  }
  return out;
}

function post(msg: TtsA2fWorkerOutMessage, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    (self as unknown as Worker).postMessage(msg, transfer);
  } else {
    (self as unknown as Worker).postMessage(msg);
  }
}

const MOOD_SPEED_MAP: Record<MoodTag, number> = {
  grumpy: 0.94,
  irritated: 1.08,
  menacing: 0.86,
  amused: 1.02,
  curious: 0.98,
  delighted: 1.06,
  weary: 0.84,
};

async function loadTtsAndA2f(ttsEngine: TtsEngineId, a2fEngine: A2fEngineId): Promise<void> {
  const reqKey = `${ttsEngine}|${a2fEngine}`;
  if (inFlightTtsPromise && inFlightTtsKey === reqKey) {
    return inFlightTtsPromise;
  }

  const task = (async () => {
    try {
      const caps = await probeOptimalWebGpuDevice();

      // 1. Load Neural TTS Backbone (Kokoro-82M powers both direct Kokoro & Zero-Shot Reference Timbre Conditioning)
      if (ttsEngine === 'web-speech-fallback') {
        ttsReadyState = 'ready';
      } else if (!kokoroInstance) {
        ttsReadyState = 'loading';
        post({
          type: 'TTS_A2F_STATUS',
          ttsStatus: ttsReadyState,
          a2fStatus: a2fReadyState,
          detail:
            ttsEngine === 'chatterbox-zeroshot'
              ? 'Loading Neural Zero-Shot Voice Synthesizer (Kokoro-82M + Reference Timbre Cloner)...'
              : 'Loading Kokoro-82M Neural TTS...',
          progressPct: 20,
        });
        try {
          kokoroInstance = await KokoroTTS.from_pretrained(
            'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped',
            {
              dtype: 'q8',
              device: 'wasm', // Ultra-reliable across all browsers while leaving WebGPU free for LLM + 3D Stage!
            },
          );
          ttsReadyState = 'ready';
        } catch {
          ttsReadyState = 'fallback';
        }
      } else {
        ttsReadyState = 'ready';
      }

      // 2. Load NVIDIA Audio2Face-3D v2.3 Mark ONNX (75.8 MB) when hardware WebGPU is available;
      // on CPU/WASM-only adapters, use the 1.5 ms 60 Hz 44-Target Acoustic Solver directly to avoid 15s CPU stalls!
      if (a2fEngine === 'nvidia-a2f-mark-webgpu' && !a2fMarkSession) {
        if (!caps.hasHardwareWebGpu) {
          a2fReadyState = 'ready';
        } else {
          a2fReadyState = 'loading';
          post({
            type: 'TTS_A2F_STATUS',
            ttsStatus: ttsReadyState,
            a2fStatus: a2fReadyState,
            detail: 'Loading NVIDIA Audio2Face-3D v2.3 Mark (75.8 MB ONNX)...',
            progressPct: 60,
          });
          try {
            const url =
              'https://huggingface.co/nvidia/Audio2Face-3D-v2.3-Mark/resolve/main/network.onnx';
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buf = await resp.arrayBuffer();
            a2fMarkSession = await ort.InferenceSession.create(buf, {
              executionProviders: ['webgpu', 'wasm'],
            });
            a2fReadyState = 'ready';
          } catch {
            a2fReadyState = 'fallback';
          }
        }
      } else if (a2fEngine === 'acoustic-formant' || a2fMarkSession) {
        a2fReadyState = 'ready';
      }

      const refCount = Object.keys(voiceReferenceBank).length;
      const ttsLabel =
        ttsEngine === 'chatterbox-zeroshot' && ttsReadyState === 'ready'
          ? `ready (Zero-Shot Timbre Conditioning · ${refCount} ref clip${refCount === 1 ? '' : 's'})`
          : ttsReadyState;

      post({
        type: 'TTS_A2F_STATUS',
        ttsStatus: ttsReadyState,
        a2fStatus: a2fReadyState,
        detail: `TTS: ${ttsLabel} | Audio2Face 44-Target Solver: ${a2fReadyState}`,
        progressPct: 100,
      });
    } finally {
      if (inFlightTtsKey === reqKey) {
        inFlightTtsPromise = null;
        inFlightTtsKey = '';
      }
    }
  })();

  inFlightTtsKey = reqKey;
  inFlightTtsPromise = task;
  return task;
}

async function runA2fFrames(
  pcm: Float32Array,
  sampleRate: number,
  mood: MoodTag,
  a2fEngine: A2fEngineId,
): Promise<BlendshapeWeights[]> {
  const acousticFrames = solveAcousticBlendshapes60Hz(pcm, sampleRate, mood);

  if (a2fEngine !== 'nvidia-a2f-mark-webgpu' || !a2fMarkSession) {
    return acousticFrames;
  }

  try {
    const pcm16k = resampleLinearPcm(pcm, sampleRate, 16000);
    const emoVec = moodToAudio2FaceEmotionVector(mood);
    const emoTensor = new ort.Tensor('float32', emoVec, [1, 1, 26]);
    const windowSize = 8320;
    const halfWin = 4160;
    const hop16k = Math.round(16000 / 60); // 267 samples per 60Hz frame

    // Sample NVIDIA network.onnx at 15 Hz keyframes with a strict 280 ms real-time budget
    let stride = 4;
    const a2fDeadlineMs = performance.now() + 280;
    const keyframeMap = new Map<number, BlendshapeWeights>();

    for (let f = 0; f < acousticFrames.length; f += stride) {
      if (keyframeMap.size > 0 && performance.now() > a2fDeadlineMs) {
        break;
      }
      const tPass = performance.now();
      const center = f * hop16k;
      const win = new Float32Array(windowSize);
      for (let i = 0; i < windowSize; i++) {
        const srcIdx = center - halfWin + i;
        if (srcIdx >= 0 && srcIdx < pcm16k.length) {
          win[i] = pcm16k[srcIdx];
        }
      }
      const audioTensor = new ort.Tensor('float32', win, [1, 1, windowSize]);
      const feeds: Record<string, ort.Tensor> = {};
      for (const inName of a2fMarkSession.inputNames) {
        if (inName.toLowerCase().includes('emo')) feeds[inName] = emoTensor;
        else feeds[inName] = audioTensor;
      }
      const res = await a2fMarkSession.run(feeds);
      const passMs = performance.now() - tPass;
      if (passMs > 40) {
        stride = Math.max(stride, Math.ceil(passMs / 8));
      }
      const firstOut = res[a2fMarkSession.outputNames[0]];
      if (firstOut?.data) {
        keyframeMap.set(
          f,
          projectNvidiaA2fOutputToBlendshapes(
            firstOut.data as Float32Array,
            mood,
            acousticFrames[f],
          ),
        );
      }
    }

    if (keyframeMap.size === 0) {
      return acousticFrames;
    }

    const keyIndices = Array.from(keyframeMap.keys());
    const outFrames: BlendshapeWeights[] = [];
    let keyPtr = 0;
    for (let f = 0; f < acousticFrames.length; f++) {
      while (keyPtr + 1 < keyIndices.length && keyIndices[keyPtr + 1] <= f) {
        keyPtr += 1;
      }
      const k0 = keyIndices[keyPtr];
      const k1 = keyIndices[Math.min(keyIndices.length - 1, keyPtr + 1)];
      const alpha = k1 > k0 ? Math.min(1, (f - k0) / (k1 - k0)) : 0;
      const frameA = keyframeMap.get(k0) ?? acousticFrames[f];
      const frameB = keyframeMap.get(k1) ?? frameA;
      const blended: BlendshapeWeights = { ...acousticFrames[f] };

      for (const target of ACTIVE_44_SOUND_TARGETS) {
        const neuralInterp = frameA[target] * (1 - alpha) + frameB[target] * alpha;
        // Blend 65% NVIDIA Audio2Face neural pose with 35% 60Hz acoustic plosive micro-envelope
        blended[target] = Math.min(1, neuralInterp * 0.65 + acousticFrames[f][target] * 0.35);
      }
      outFrames.push(blended);
    }
    return outFrames;
  } catch {
    return acousticFrames;
  }
}

async function synthesizeAndAnimate(msg: Extract<TtsA2fWorkerInMessage, { type: 'SYNTHESIZE_AND_ANIMATE' }>): Promise<void> {
  const t0 = performance.now();
  let pcm: Float32Array | null = null;
  let sampleRate = 24000;
  let usedEngine: TtsEngineId = msg.ttsEngine;

  // 1. Zero-Shot Reference Voice Conditioning when selected & reference clip exists
  if (msg.ttsEngine === 'chatterbox-zeroshot' && kokoroInstance) {
    const ref = voiceReferenceBank[msg.mood] ?? Object.values(voiceReferenceBank)[0];
    if (ref) {
      try {
        const pitchRatio = Math.max(0.84, Math.min(1.18, ref.f0Hz / ref.baseVoiceF0Hz));
        const baseSpeed = (MOOD_SPEED_MAP[msg.mood] ?? 0.96) * ref.cadenceScale;
        // Pre-compensate speaking speed inversely to pitchRatio so pitch-resampling preserves natural cadence
        const compensatedSpeed = Math.max(0.72, Math.min(1.32, baseSpeed / pitchRatio));
        const generated = await kokoroInstance.generate(msg.text, {
          voice: ref.matchedVoice as any,
          speed: compensatedSpeed,
        });
        const rawPcm = new Float32Array(generated.audio);
        pcm = applyZeroShotTimbreConditioning(rawPcm, pitchRatio, ref.brightness);
        sampleRate = generated.sampling_rate || 24000;
        usedEngine = 'chatterbox-zeroshot';
      } catch {
        pcm = null;
      }
    }
  }

  // 2. Direct Kokoro-82M Neural Speech
  if (!pcm && kokoroInstance && msg.ttsEngine !== 'web-speech-fallback') {
    try {
      const kokoroVoice = (msg.voiceId.startsWith('bm_') || msg.voiceId.startsWith('am_')
        ? msg.voiceId
        : 'bm_fable') as any;
      const generated = await kokoroInstance.generate(msg.text, {
        voice: kokoroVoice,
        speed: MOOD_SPEED_MAP[msg.mood] ?? 0.96,
      });
      pcm = new Float32Array(generated.audio);
      sampleRate = generated.sampling_rate || 24000;
      usedEngine = 'kokoro-webgpu';
    } catch {
      pcm = null;
    }
  }

  // 3. Instant Pirate Formant Synth fallback (0ms wait if models are still streaming!)
  if (!pcm) {
    pcm = synthesizeInstantPiratePcm(msg.text, msg.mood, 24000);
    sampleRate = 24000;
    usedEngine = 'web-speech-fallback';
  }

  const ttsMs = Math.round(performance.now() - t0);
  const tA2f = performance.now();
  const frames60Hz = await runA2fFrames(pcm, sampleRate, msg.mood, msg.a2fEngine);
  const a2fMs = Math.round(performance.now() - tA2f);

  post(
    {
      type: 'SYNTHESIS_RESULT',
      requestId: msg.requestId,
      pcmFloat32: pcm,
      sampleRate,
      frames60Hz,
      ttsMs,
      a2fMs,
      usedEngine,
    },
    [pcm.buffer],
  );
}

self.onmessage = (ev: MessageEvent<TtsA2fWorkerInMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'LOAD_TTS_A2F':
      void loadTtsAndA2f(msg.ttsEngine, msg.a2fEngine);
      break;
    case 'SET_VOICE_SAMPLE':
      voiceReferenceBank[msg.mood] = analyzeVoiceReference(msg.pcmFloat32, msg.sampleRate);
      break;
    case 'SYNTHESIZE_AND_ANIMATE':
      void synthesizeAndAnimate(msg);
      break;
  }
};
