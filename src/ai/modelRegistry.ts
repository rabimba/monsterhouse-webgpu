import type {
  A2fEngineId,
  ModelProfileId,
  ProfileTier,
  TtsEngineId,
} from '../types/monster';

export interface ModelProfileSpec {
  id: ModelProfileId;
  codeLabel: 'Profile C' | 'Profile B' | 'Profile A';
  tier: ProfileTier;
  dropdownOnly: boolean;
  name: string;
  shortLabel: string;
  vramEstimateLabel: string;
  estimatedVramGb: number;
  description: string;
  badge: string;
  models: {
    vad: { repoId: string; sizeMb: number; label: string };
    asr: {
      repoId: string;
      sizeMb: number;
      label: string;
      mode: 'parakeet-webgpu' | 'omni-audio';
    };
    brain: {
      repoId: string;
      dtype: 'q4f16' | 'q4' | 'fp16';
      sizeMb: number;
      label: string;
      family: 'lfm3-vl' | 'gemma4' | 'nemotron-bolt-gemma4';
      supportsVision: boolean;
      supportsAudioIn: boolean;
    };
    visionObserver: {
      repoId: string;
      sizeMb: number;
      label: string;
      sharedWithBrain: boolean;
    };
    trackerDetector: {
      repoId: string;
      sizeMb: number;
      label: string;
    };
    defaultTts: TtsEngineId;
    defaultA2f: A2fEngineId;
  };
}

/**
 * Explicit dropdown order:
 * 1. Profile C (Default — Fastest WebGPU, 1.24 GB Brain+Vision, Short-Conv O(1) decode)
 * 2. Profile B (Co-Primary — Google Gemma 4 E2B Omni, unified Text + Vision + 16kHz Audio-In)
 * 3. Profile A (Dropdown Opt-In — NVIDIA Nemotron 3.5 Bolt E4B Flagship for 8GB+ Desktop GPUs)
 */
export const PROFILE_DROPDOWN_ORDER: readonly ModelProfileId[] = [
  'lfm3-omni',
  'gemma4-omni',
  'nvidia-bolt-flagship',
] as const;

export const FEATURED_PROFILES: readonly ModelProfileId[] = [
  'lfm3-omni',
  'gemma4-omni',
] as const;

export const DEFAULT_PROFILE_ID: ModelProfileId = 'lfm3-omni';

export const MODEL_PROFILES: Record<ModelProfileId, ModelProfileSpec> = {
  'lfm3-omni': {
    id: 'lfm3-omni',
    codeLabel: 'Profile C',
    tier: 'default-c',
    dropdownOnly: false,
    name: 'Profile C — Liquid AI LFM3-VL 2B Fast Stack (Default)',
    shortLabel: 'Profile C (Default): LiquidAI LFM3-VL 2B q4f16 — Fastest',
    vramEstimateLabel: 'VRAM: ~1.7 GiB',
    estimatedVramGb: 1.7,
    badge: 'Default · Fastest WebGPU',
    description:
      'Fastest single-GPU WebGPU stack: Liquid AI LFM3-VL-2B-ONNX (q4f16, only 1.24 GB total for Brain + shared Costume Vision using 75% gated Short-Conv O(1) cache), paired with NVIDIA Parakeet/Nemotron 0.6B CTC WebGPU ASR, Kokoro-82M TTS, and NVIDIA Audio2Face-3D v2.3 Mark.',
    models: {
      vad: {
        repoId: 'onnx-community/silero-vad',
        sizeMb: 2,
        label: 'Silero VAD (300ms EOU)',
      },
      asr: {
        repoId: 'onnx-community/parakeet-ctc-0.6b-ONNX',
        sizeMb: 433,
        label: 'NVIDIA Parakeet / Nemotron 0.6B CTC (q4f16 WebGPU)',
        mode: 'parakeet-webgpu',
      },
      brain: {
        repoId: 'onnx-community/LFM3-VL-2B-ONNX',
        dtype: 'q4f16',
        sizeMb: 1236,
        label: 'Liquid AI LFM3-VL 2B (q4f16 Hybrid Short-Conv + GQA)',
        family: 'lfm3-vl',
        supportsVision: true,
        supportsAudioIn: false,
      },
      visionObserver: {
        repoId: 'onnx-community/LFM3-VL-2B-ONNX',
        sizeMb: 0,
        label: 'LFM3-VL Vision Encoder q4f16 (Shared, 0 extra VRAM)',
        sharedWithBrain: true,
      },
      trackerDetector: {
        repoId: 'onnx-community/yolov10s',
        sizeMb: 32,
        label: 'YOLOv10s WebGPU + TS ByteTrack',
      },
      defaultTts: 'kokoro-webgpu',
      defaultA2f: 'nvidia-a2f-mark-webgpu',
    },
  },
  'gemma4-omni': {
    id: 'gemma4-omni',
    codeLabel: 'Profile B',
    tier: 'coprimary-b',
    dropdownOnly: false,
    name: 'Profile B — Google Gemma 4 E2B Multimodal Omni',
    shortLabel: 'Profile B: Gemma 4 E2B Omni q4f16 — Audio+Vision',
    vramEstimateLabel: 'VRAM: ~3.4 GiB',
    estimatedVramGb: 3.4,
    badge: 'Co-Primary · Audio+Vision',
    description:
      'Runs Google Gemma 4 E2B-it (q4f16, 3.22 GB) as a single unified Brain + Webcam Costume Observer + direct 16 kHz Audio-In listener (audio_encoder_q4f16, requiring 0 extra ASR VRAM), paired with Kokoro/Chatterbox WebGPU TTS and NVIDIA Audio2Face-3D v2.3 Mark.',
    models: {
      vad: {
        repoId: 'onnx-community/silero-vad',
        sizeMb: 2,
        label: 'Silero VAD (300ms EOU)',
      },
      asr: {
        repoId: 'onnx-community/gemma-4-E2B-it-ONNX',
        sizeMb: 0,
        label: 'Gemma 4 Native 16kHz Audio Encoder (q4f16, Shared)',
        mode: 'omni-audio',
      },
      brain: {
        repoId: 'onnx-community/gemma-4-E2B-it-ONNX',
        dtype: 'q4f16',
        sizeMb: 3224,
        label: 'Google Gemma 4 E2B-it (q4f16 Text+Vision+Audio)',
        family: 'gemma4',
        supportsVision: true,
        supportsAudioIn: true,
      },
      visionObserver: {
        repoId: 'onnx-community/gemma-4-E2B-it-ONNX',
        sizeMb: 0,
        label: 'Gemma 4 Vision Encoder q4f16 (Shared, 0 extra VRAM)',
        sharedWithBrain: true,
      },
      trackerDetector: {
        repoId: 'onnx-community/yolov10s',
        sizeMb: 32,
        label: 'YOLOv10s WebGPU + TS ByteTrack',
      },
      defaultTts: 'kokoro-webgpu',
      defaultA2f: 'nvidia-a2f-mark-webgpu',
    },
  },
  'nvidia-bolt-flagship': {
    id: 'nvidia-bolt-flagship',
    codeLabel: 'Profile A',
    tier: 'dropdown-a',
    dropdownOnly: true,
    name: 'Profile A — NVIDIA Nemotron 3.5 Bolt E4B (8GB+ Desktop)',
    shortLabel: 'Profile A (Dropdown): Nemotron Bolt E4B q4f16 — 8GB+ GPU',
    vramEstimateLabel: 'VRAM: ~5.8 GiB',
    estimatedVramGb: 5.8,
    badge: 'Dropdown Opt-In · 8GB+ GPU',
    description:
      'Optional high-VRAM desktop profile: exact NVIDIA Nemotron 3.5 Bolt E4B weights (NVIDIA post-training of Gemma 4 E4B, 4.68 GB q4f16 ONNX) paired with NVIDIA Parakeet 0.6B CTC ASR, Chatterbox Zero-Shot TTS, and NVIDIA Audio2Face-3D v2.3 Mark.',
    models: {
      vad: {
        repoId: 'onnx-community/silero-vad',
        sizeMb: 2,
        label: 'Silero VAD (300ms EOU)',
      },
      asr: {
        repoId: 'onnx-community/parakeet-ctc-0.6b-ONNX',
        sizeMb: 433,
        label: 'NVIDIA Parakeet / Nemotron 0.6B CTC (q4f16 WebGPU)',
        mode: 'parakeet-webgpu',
      },
      brain: {
        repoId: 'RASMUS/NVIDIA-Nemotron-3.5-Bolt-E4B-ONNX',
        dtype: 'q4f16',
        sizeMb: 4678,
        label: 'NVIDIA Nemotron 3.5 Bolt E4B (q4f16 ONNX)',
        family: 'nemotron-bolt-gemma4',
        supportsVision: false,
        supportsAudioIn: false,
      },
      visionObserver: {
        repoId: 'onnx-community/LFM3-VL-2B-ONNX',
        sizeMb: 1236,
        label: 'Optional LFM3-VL Costume Subagent (On-Demand)',
        sharedWithBrain: false,
      },
      trackerDetector: {
        repoId: 'onnx-community/yolov10s',
        sizeMb: 32,
        label: 'YOLOv10s WebGPU + TS ByteTrack',
      },
      defaultTts: 'chatterbox-zeroshot',
      defaultA2f: 'nvidia-a2f-mark-webgpu',
    },
  },
};

export interface TtsEngineSpec {
  id: TtsEngineId;
  name: string;
  repoId: string;
  sizeMb: number;
  supportsZeroShotCloning: boolean;
  description: string;
}

export const TTS_ENGINES: Record<TtsEngineId, TtsEngineSpec> = {
  'kokoro-webgpu': {
    id: 'kokoro-webgpu',
    name: 'Kokoro-82M v1.0 Timestamped (WebGPU)',
    repoId: 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped',
    sizeMb: 86,
    supportsZeroShotCloning: false,
    description:
      'Sub-150ms British pirate base synthesis (bm_fable / bm_george) with phoneme timestamps and 7-mood prosody shaping.',
  },
  'chatterbox-zeroshot': {
    id: 'chatterbox-zeroshot',
    name: 'Chatterbox Turbo Zero-Shot (WebGPU)',
    repoId: 'spacekaren/chatterbox-turbo-webgpu',
    sizeMb: 539,
    supportsZeroShotCloning: true,
    description:
      'True zero-shot voice conditioning from 3–10s per-emotion microphone samples recorded in Tools -> Sample your Voice.',
  },
  'lfm3-codec': {
    id: 'lfm3-codec',
    name: 'LFM3-Omni 24kHz Neural Codec',
    repoId: 'LiquidAI/LFM3-Omni-2B-ONNX',
    sizeMb: 0,
    supportsZeroShotCloning: false,
    description:
      'Native interleaved 24kHz audio output decoded via LFM3 depth_decoder (3 MaskGIT steps) + codec_decoder.',
  },
  'web-speech-fallback': {
    id: 'web-speech-fallback',
    name: 'Instant Acoustic Synth + Web Speech',
    repoId: 'builtin://instant-pirate-synth',
    sizeMb: 0,
    supportsZeroShotCloning: false,
    description:
      'Zero-download instant fallback synthesizer driving WebAudio Demon DSP and 44-target formant animation while WebGPU weights stream in.',
  },
};

export interface A2fEngineSpec {
  id: A2fEngineId;
  name: string;
  repoId: string;
  sizeMb: number;
  description: string;
}

export const A2F_ENGINES: Record<A2fEngineId, A2fEngineSpec> = {
  'nvidia-a2f-mark-webgpu': {
    id: 'nvidia-a2f-mark-webgpu',
    name: 'NVIDIA Audio2Face-3D v2.3 Mark (ONNX WebGPU)',
    repoId: 'nvidia/Audio2Face-3D-v2.3-Mark',
    sizeMb: 76,
    description:
      'Runs genuine NVIDIA network.onnx ([1,1,8320] 16kHz PCM + 26-dim emotion tensor) projected onto the 44 active ARKit sound targets.',
  },
  'acoustic-formant': {
    id: 'acoustic-formant',
    name: 'Zero-Latency Formant + Phoneme Solver',
    repoId: 'builtin://formant-44-solver',
    sizeMb: 0,
    description:
      'Zero-VRAM spectral F1/F2 formant, plosive energy, and sibilant analyzer driving all 44 ARKit mouth shapes at 60 FPS.',
  },
};
