export type MoodTag =
  | 'grumpy'
  | 'irritated'
  | 'menacing'
  | 'amused'
  | 'curious'
  | 'delighted'
  | 'weary';

export const ALL_MOODS: readonly MoodTag[] = [
  'grumpy',
  'irritated',
  'menacing',
  'amused',
  'curious',
  'delighted',
  'weary',
] as const;

export type HouseMode = 'live' | 'demo' | 'microphone';

export type ModelProfileId = 'lfm3-omni' | 'gemma4-omni' | 'nvidia-bolt-flagship';

export type ProfileTier = 'default-c' | 'coprimary-b' | 'dropdown-a';

export interface BenchmarkResult {
  profileId: ModelProfileId;
  ttftMs: number;
  tokPerSec: number;
  vramLabel: string;
  measuredAt: number;
}

export type TtsEngineId =
  | 'kokoro-webgpu'
  | 'chatterbox-zeroshot'
  | 'lfm3-codec'
  | 'web-speech-fallback';

export type A2fEngineId = 'nvidia-a2f-mark-webgpu' | 'acoustic-formant';

/**
 * Exact 10-card Conversation Flow states from the MonsterHouse Control Desk.
 */
export type EncounterState =
  | 'WarmGreeting'
  | 'GrumpyGreeting'
  | 'FirstRefusal'
  | 'GrumpyBanter'
  | 'AnswerPlusCandy'
  | 'GivingIn'
  | 'WarmFollowUp'
  | 'GrudgingFollowUp'
  | 'Goodbye'
  | 'IdleSelfTalk';

export type WorkspaceTab =
  | 'CONVERSATION'
  | 'CACHE'
  | 'METRICS'
  | 'SERVICES'
  | 'PROMPTS'
  | 'TOOLS'
  | 'VISION'
  | 'ARCHITECTURE';

export type StageViewMode = 'house' | 'closeup' | 'projector';

/**
 * Standard 52 ARKit blendshapes ordered to match NVIDIA Audio2Face-3D bs_skin_config.json.
 * Indices with 0 in BS_SOLVE_ACTIVE_MASK are the 8 eye/blink poses disabled on the eyeless house,
 * leaving the exact 44 active sound targets referenced in the MonsterHouse Control Desk.
 */
export const ARKIT_52_BLENDSHAPES = [
  'browDownLeft',          // 0  - active
  'eyeBlinkLeft',          // 1  - inactive (no eyes)
  'eyeLookDownLeft',       // 2  - inactive
  'eyeLookInLeft',         // 3  - inactive
  'eyeLookOutLeft',        // 4  - inactive
  'browDownRight',         // 5  - active
  'browInnerUp',           // 6  - active
  'browOuterUpLeft',       // 7  - active
  'eyeBlinkRight',         // 8  - inactive
  'eyeLookDownRight',      // 9  - inactive
  'eyeLookInRight',        // 10 - inactive
  'eyeLookOutRight',       // 11 - inactive
  'browOuterUpRight',      // 12 - active
  'cheekPuff',             // 13 - active
  'cheekSquintLeft',       // 14 - active
  'cheekSquintRight',      // 15 - active
  'jawForward',            // 16 - active
  'jawLeft',               // 17 - active
  'jawOpen',               // 18 - active
  'jawRight',              // 19 - active
  'mouthClose',            // 20 - active
  'mouthDimpleLeft',       // 21 - active
  'mouthDimpleRight',      // 22 - active
  'mouthFrownLeft',        // 23 - active
  'mouthFrownRight',       // 24 - active
  'mouthFunnel',           // 25 - active
  'mouthLeft',             // 26 - active
  'mouthLowerDownLeft',    // 27 - active
  'mouthLowerDownRight',   // 28 - active
  'mouthPressLeft',        // 29 - active
  'mouthPressRight',       // 30 - active
  'mouthPucker',           // 31 - active
  'mouthRight',            // 32 - active
  'mouthRollLower',        // 33 - active
  'mouthRollUpper',        // 34 - active
  'mouthShrugLower',       // 35 - active
  'mouthShrugUpper',       // 36 - active
  'mouthSmileLeft',        // 37 - active
  'mouthSmileRight',       // 38 - active
  'mouthStretchLeft',      // 39 - active
  'mouthStretchRight',     // 40 - active
  'mouthUpperUpLeft',      // 41 - active
  'mouthUpperUpRight',     // 42 - active
  'noseSneerLeft',         // 43 - active
  'noseSneerRight',        // 44 - active
  'tongueOut',             // 45 - active
  'eyeSquintLeft',         // 46 - active (transmits upper-cheek tension)
  'eyeSquintRight',        // 47 - active
  'eyeWideLeft',           // 48 - active
  'eyeWideRight',          // 49 - active
  'jawClench',             // 50 - active
  'mouthTension',          // 51 - active
] as const;

export type BlendshapeName = (typeof ARKIT_52_BLENDSHAPES)[number];

/**
 * Exact 52-entry mask from nvidia/Audio2Face-3D-v2.3-Mark/bs_skin_config.json (sum = 44).
 */
export const BS_SOLVE_ACTIVE_MASK: readonly number[] = [
  1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1,
] as const;

export const ACTIVE_44_SOUND_TARGETS: readonly BlendshapeName[] = ARKIT_52_BLENDSHAPES.filter(
  (_, idx) => BS_SOLVE_ACTIVE_MASK[idx] === 1,
);

export type BlendshapeWeights = Record<BlendshapeName, number>;

export interface SpeechSegment {
  type: 'speech' | 'pause';
  text: string;
  mood: MoodTag;
  pauseMs: number;
}

export interface SoundboardItem {
  id: string;
  indexLabel: string;
  title: string;
  script: string;
  defaultMood: MoodTag;
  category: 'greeting' | 'refusal' | 'banter' | 'manners' | 'candy' | 'idle';
}

export interface VoiceModSettings {
  enabled: boolean;
  pitchSemitones: number;
  lowWeightDb: number;
  driveDb: number;
  presenceDb: number;
  chamberPct: number;
  effectMixPct: number;
  outputTrimDb: number;
}

export interface OpeningMixSettings {
  /** 0 = 100% Grumpy, 100 = 100% Warm */
  warmPct: number;
  /** 0 = 100% Greeting, 100 = 100% Question */
  questionPct: number;
}

export interface TrackedVisitor {
  trackId: number;
  /** Normalized [x1, y1, x2, y2] in 0..1 */
  bbox: [number, number, number, number];
  confidence: number;
  costume: string;
  costumeDetail?: string;
  thumbnailDataUrl?: string;
  firstSeenMs: number;
  lastSeenMs: number;
  wonOver: boolean;
}

export interface ConversationTurn {
  id: string;
  role: 'visitor' | 'house' | 'system';
  text: string;
  rawScript?: string;
  mood?: MoodTag;
  encounterState: EncounterState;
  fromCache?: boolean;
  latencyMs?: number;
  timestamp: number;
}

export interface LatencyRecord {
  id: string;
  turnNumber: number;
  eouToFirstAudioMs: number;
  asrMs: number;
  llmFirstClauseMs: number;
  ttsMs: number;
  a2fMs: number;
  cachedText: boolean;
  cachedAudio: boolean;
  timestamp: number;
}

export interface VisualCueRule {
  mood: MoodTag;
  firePrimaryHex: string;
  fireSecondaryHex: string;
  rimGlowHex: string;
  emberRateMultiplier: number;
  turbulence: number;
  lightningChance: number;
}

export interface VoiceSampleRecord {
  mood: MoodTag;
  pcmFloat32: Float32Array;
  sampleRate: number;
  durationSec: number;
  recordedAt: number;
  transcriptPrompt: string;
}

export interface KeystoneCorners {
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
}

export type PipelineNodeId =
  | 'visitor-speech'
  | 'people-detector'
  | 'omni-observer'
  | 'encounter-controller'
  | 'fresh-dialogue'
  | 'prepared-dialogue'
  | 'audio-lookup'
  | 'new-live-speech'
  | 'saved-audio'
  | 'clean-speech'
  | 'audience-speech';
