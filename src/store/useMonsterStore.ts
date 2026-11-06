import { create } from 'zustand';
import {
  applyBlendshapeMultipliers,
  createDefaultMultipliers,
  createEmptyBlendshapes,
  resampleLinearPcm,
} from '../ai/a2fSolver';
import { DEFAULT_PROFILE_ID, MODEL_PROFILES } from '../ai/modelRegistry';
import { probeOptimalWebGpuDevice } from '../ai/webgpuCapabilities';
import type { BrainWorkerInMessage, BrainWorkerOutMessage } from '../ai/workers/brain.worker';
import type { SpeechWorkerInMessage, SpeechWorkerOutMessage } from '../ai/workers/speech.worker';
import type { TtsA2fWorkerInMessage, TtsA2fWorkerOutMessage } from '../ai/workers/tts-a2f.worker';
import type { VisionWorkerInMessage, VisionWorkerOutMessage } from '../ai/workers/vision.worker';
import {
  DEFAULT_VOICE_MOD_SETTINGS,
  DualStreamAudioRouter,
} from '../audio/DualStreamAudioRouter';
import {
  clearAllCachedPerformances,
  getAllVoiceSamples,
  listCachedPerformances,
  lookupCachedPerformance,
  makeCacheKey,
  saveCachedPerformance,
  saveVoiceSample,
  type CachedPerformanceEntry,
} from '../cache/responseCache';
import {
  parseEmotionTaggedScript,
  StreamingClauseAccumulator,
  stripTagsForDisplay,
} from '../orchestrator/emotionTagParser';
import { EncounterController } from '../orchestrator/EncounterController';
import {
  DEFAULT_PROMPT_CATALOG,
  DEFAULT_SOUNDBOARD_ITEMS,
  DEFAULT_VISUAL_CUE_RULES,
  PREPARED_DIALOGUE_BANK,
  type PromptTemplateEntry,
} from '../orchestrator/piratePersonaBank';
import { DEFAULT_KEYSTONE, ProjectorSyncBus } from '../stage/ProjectorSync';
import {
  ACTIVE_44_SOUND_TARGETS,
  type A2fEngineId,
  type BenchmarkResult,
  type BlendshapeName,
  type BlendshapeWeights,
  type ConversationTurn,
  type EncounterState,
  type HouseMode,
  type KeystoneCorners,
  type LatencyRecord,
  type ModelProfileId,
  type MoodTag,
  type OpeningMixSettings,
  type PipelineNodeId,
  type SoundboardItem,
  type StageViewMode,
  type TrackedVisitor,
  type TtsEngineId,
  type VisualCueRule,
  type VoiceModSettings,
  type VoiceSampleRecord,
  type WorkspaceTab,
} from '../types/monster';
import { ByteTracker, type RawDetection } from '../vision/ByteTracker';

export interface WorkerSlotStatus {
  state: 'idle' | 'loading' | 'ready' | 'fallback' | 'error';
  detail: string;
  progressPct: number;
}

interface PendingSynthesisResolver {
  resolve: (res: Extract<TtsA2fWorkerOutMessage, { type: 'SYNTHESIS_RESULT' }>) => void;
}

interface PendingGenerationHandlers {
  onDelta: (delta: string) => void;
  onDone: (fullText: string, tokPerSec: number, firstTokenMs: number) => void;
  onError: (err: string) => void;
}

// Singleton runtime instances outside plain serializable state
const encounterController = new EncounterController();
const byteTracker = new ByteTracker();
const projectorBus = new ProjectorSyncBus();

let speechWorker: Worker | null = null;
let brainWorker: Worker | null = null;
let ttsWorker: Worker | null = null;
let visionWorker: Worker | null = null;
let audioRouter: DualStreamAudioRouter | null = null;

let micCaptureStream: MediaStream | null = null;
let micCaptureCtx: AudioContext | null = null;
let browserRecognition: any = null;
let latestInterimSpeechText = '';
let lastHouseSpeechEndedAtMs = 0;
let lastVoiceTurnSubmittedAtMs = 0;
let lastVoiceTurnText = '';
let phonemeCheckTimer: number | null = null;

const pendingSynthMap = new Map<string, PendingSynthesisResolver>();
const pendingGenMap = new Map<string, PendingGenerationHandlers>();
const pendingBenchMap = new Map<string, (res: { ttftMs: number; tokPerSec: number }) => void>();
const lastVlmCostumeQueryMs = new Map<number, number>();
const lastThumbRefreshMs = new Map<number, number>();
let pendingBrainReadyResolver: ((ok: boolean) => void) | null = null;
let pendingPostEarWarmCallback: (() => void) | null = null;
const sceneHooks: {
  onMoodCue?: (mood: MoodTag, rule: VisualCueRule) => void;
  onCandyBarrage?: () => void;
} = {};

export function registerSceneHooks(hooks: {
  onMoodCue?: (mood: MoodTag, rule: VisualCueRule) => void;
  onCandyBarrage?: () => void;
}): void {
  sceneHooks.onMoodCue = hooks.onMoodCue;
  sceneHooks.onCandyBarrage = hooks.onCandyBarrage;
}

export interface MonsterStoreState {
  connected: boolean;
  activeTab: WorkspaceTab;
  stageViewMode: StageViewMode;
  stageCollapsed: boolean;
  keystone: KeystoneCorners;

  selectedProfileId: ModelProfileId;
  selectedTtsEngine: TtsEngineId;
  selectedA2fEngine: A2fEngineId;
  voiceId: string;
  a2fSyncCompensationMs: number;

  houseMode: HouseMode;
  micPossessionDelayMs: number;
  useCachedResponses: boolean;
  useCharacterAdapter: boolean;

  selectedPromptKey: string;
  promptCatalog: PromptTemplateEntry[];
  visualCueRules: Record<MoodTag, VisualCueRule>;

  voiceMod: VoiceModSettings;
  openingMix: OpeningMixSettings;
  blendshapeMultipliers: BlendshapeWeights;
  liveBlendshapes: BlendshapeWeights;
  activeMood: MoodTag;
  micAudioLevel: number;
  micStatus: 'disconnected' | 'listening' | 'hearing' | 'transcribing' | 'mic-denied' | 'possession';
  liveInterimCaption: string;
  houseSpeaking: boolean;
  phonemeCheckActiveTarget: BlendshapeName | null;

  soundboardItems: SoundboardItem[];
  encounterState: EncounterState;
  wonOver: boolean;
  candyDispensedCount: number;

  turns: ConversationTurn[];
  latencyHistory: LatencyRecord[];
  tokPerSec: number;
  stageFps: number;
  rendererBackend: string;
  gpuAdapterSummary: string;
  benchmarkRunning: boolean;
  benchmarkWinner: ModelProfileId | null;
  benchmarkResults: Partial<Record<ModelProfileId, BenchmarkResult>>;
  activePipelineNodes: PipelineNodeId[];

  cachedEntries: CachedPerformanceEntry[];
  prebakeProgress: { running: boolean; done: number; total: number };
  voiceSamples: Partial<Record<MoodTag, VoiceSampleRecord>>;

  visitors: TrackedVisitor[];
  webcamEnabled: boolean;
  syntheticReplayEnabled: boolean;
  visionChunkSeconds: number;
  visionLastInferMs: number;

  workerStatus: {
    asr: WorkerSlotStatus;
    brain: WorkerSlotStatus;
    tts: WorkerSlotStatus;
    a2f: WorkerSlotStatus;
    vision: WorkerSlotStatus;
  };

  // Actions
  setActiveTab: (tab: WorkspaceTab) => void;
  setStageViewMode: (mode: StageViewMode) => void;
  setStageCollapsed: (collapsed: boolean) => void;
  setKeystone: (keystone: KeystoneCorners) => void;
  setStageTelemetry: (fps: number, backend: string) => void;

  selectModelProfile: (profileId: ModelProfileId) => void;
  setTtsEngine: (engine: TtsEngineId) => void;
  setA2fEngine: (engine: A2fEngineId) => void;
  setVoiceId: (voiceId: string) => void;
  setA2fSyncCompensationMs: (ms: number) => void;
  loadWebGpuModelsNow: () => void;
  benchmarkProfilesCandB: () => Promise<void>;

  setHouseMode: (mode: HouseMode) => Promise<void>;
  setMicPossessionDelayMs: (ms: number) => void;
  setUseCachedResponses: (val: boolean) => void;
  setUseCharacterAdapter: (val: boolean) => void;
  setSelectedPromptKey: (key: string) => void;
  updatePromptContent: (key: string, systemPrompt: string) => void;
  updateVisualCueRule: (mood: MoodTag, patch: Partial<VisualCueRule>) => void;

  updateVoiceMod: (patch: Partial<VoiceModSettings>) => void;
  resetVoiceMod: () => void;
  updateOpeningMix: (patch: Partial<OpeningMixSettings>) => void;

  setBlendshapeMultiplier: (name: BlendshapeName, mult: number) => void;
  resetAllBlendshapeMultipliers: (value: number) => void;

  connectAgent: () => Promise<void>;
  disconnectAgent: () => Promise<void>;
  stopHouseSpeaking: () => void;
  wakeUpNewVisitors: () => Promise<void>;
  triggerIdleGrumble: () => Promise<void>;
  dispenseCandyNow: () => void;

  speakCustomScript: (rawScript: string, labelState?: EncounterState) => Promise<void>;
  addSoundboardItem: (title: string, script: string, defaultMood: MoodTag) => void;
  submitVisitorTextOrSpeech: (transcript: string) => Promise<void>;

  runPhonemeCheck44: () => void;
  stopPhonemeCheck: () => void;

  refreshCacheList: () => Promise<void>;
  clearCache: () => Promise<void>;
  prebakeCommonLines: () => Promise<void>;
  recordAndSaveVoiceSample: (mood: MoodTag, pcm: Float32Array, sampleRate: number, prompt: string) => Promise<void>;

  setWebcamEnabled: (enabled: boolean) => void;
  setSyntheticReplayEnabled: (enabled: boolean) => void;
  setVisionChunkSeconds: (sec: number) => void;
  ingestDetections: (detections: RawDetection[], cropProvider?: (bbox: [number, number, number, number]) => string | undefined) => void;
  submitWebcamFrameForYolo: (frameId: number, dataUrl: string) => void;
}

function ensureWorkersInitialized(get: () => MonsterStoreState, set: (partial: Partial<MonsterStoreState> | ((s: MonsterStoreState) => Partial<MonsterStoreState>)) => void): void {
  if (!audioRouter) {
    audioRouter = new DualStreamAudioRouter((rawWeights, level) => {
      const state = get();
      const scaled = applyBlendshapeMultipliers(rawWeights, state.blendshapeMultipliers);
      set({ liveBlendshapes: scaled, micAudioLevel: level });
      projectorBus.publish({
        type: 'FRAME_STATE',
        weights: scaled,
        mood: state.activeMood,
        cueRule: state.visualCueRules[state.activeMood],
        viewMode: 'projector',
        keystone: state.keystone,
      });
    });
  }

  if (!speechWorker) {
    speechWorker = new Worker(new URL('../ai/workers/speech.worker.ts', import.meta.url), {
      type: 'module',
    });
    speechWorker.onmessage = (ev: MessageEvent<SpeechWorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === 'ASR_STATUS') {
        set((s) => ({
          workerStatus: {
            ...s.workerStatus,
            asr: {
              state: msg.status,
              detail: msg.detail,
              progressPct: msg.progressPct ?? s.workerStatus.asr.progressPct,
            },
          },
        }));
        if ((msg.status === 'ready' || msg.status === 'fallback') && pendingPostEarWarmCallback) {
          const cb = pendingPostEarWarmCallback;
          pendingPostEarWarmCallback = null;
          cb();
        }
      } else if (msg.type === 'VAD_SPEECH_START') {
        if (!get().houseSpeaking && get().connected && get().houseMode !== 'microphone') {
          set({ micStatus: 'hearing' });
        }
      } else if (msg.type === 'VAD_TRANSCRIBING') {
        if (!get().houseSpeaking && get().connected && get().houseMode !== 'microphone') {
          set({ micStatus: 'transcribing' });
        }
      } else if (msg.type === 'VAD_LEVEL') {
        if (!get().houseSpeaking) {
          set((s) => ({
            micAudioLevel: msg.rms,
            micStatus:
              !msg.speaking && s.micStatus === 'hearing' && s.connected && s.houseMode !== 'microphone'
                ? 'listening'
                : s.micStatus,
          }));
        }
      } else if (msg.type === 'FINAL_TRANSCRIPT') {
        const text = (msg.text || latestInterimSpeechText).trim();
        latestInterimSpeechText = '';
        if (get().connected && get().houseMode !== 'microphone') {
          set({ micStatus: 'listening', liveInterimCaption: '' });
          if (text.length > 0) {
            void submitVoiceUtteranceDeduped(text, get);
          } else if (
            get().selectedProfileId === 'gemma4-omni' &&
            get().workerStatus.brain.state === 'ready' &&
            msg.audio16k.length > 0
          ) {
            const reqId = `aud-${Date.now()}`;
            const transMsg: BrainWorkerInMessage = {
              type: 'TRANSCRIBE_AUDIO_16K',
              requestId: reqId,
              audio16k: msg.audio16k,
            };
            brainWorker?.postMessage(transMsg, [msg.audio16k.buffer]);
          } else if (
            msg.durationMs >= 500 &&
            msg.peakRms >= 0.025 &&
            performance.now() - lastVoiceTurnSubmittedAtMs > 1800 &&
            !get().houseSpeaking
          ) {
            // Audible pirate prompt if visitor spoke clearly into mic but words were unintelligible
            lastVoiceTurnSubmittedAtMs = performance.now();
            set((s) => ({
              turns: [
                ...s.turns,
                {
                  id: `v-${Date.now()}`,
                  role: 'visitor',
                  text: '(Voice heard on porch — unclear words)',
                  encounterState: s.encounterState,
                  timestamp: Date.now(),
                },
              ],
            }));
            void get().speakCustomScript(
              '[curious] Aye, I heard yer voice out on me lawn, scallywag—speak a wee bit clearer! Did ye say trick or treat?!',
              get().encounterState,
            );
          }
        }
      }
    };
  }

  if (!brainWorker) {
    brainWorker = new Worker(new URL('../ai/workers/brain.worker.ts', import.meta.url), {
      type: 'module',
    });
    brainWorker.onmessage = (ev: MessageEvent<BrainWorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === 'BRAIN_STATUS') {
        set((s) => ({
          workerStatus: {
            ...s.workerStatus,
            brain: {
              state: msg.status,
              detail: msg.detail,
              progressPct: msg.progressPct ?? s.workerStatus.brain.progressPct,
            },
          },
        }));
        if (msg.status === 'ready' || msg.status === 'error') {
          if (pendingBrainReadyResolver) {
            const resolve = pendingBrainReadyResolver;
            pendingBrainReadyResolver = null;
            resolve(msg.status === 'ready');
          }
          // Stage 2: Now that Brain download finished, warm secondary Parakeet ASR & YOLOv10s without network contention!
          const cur = get();
          const curSpec = MODEL_PROFILES[cur.selectedProfileId];
          if (curSpec.models.asr.mode === 'parakeet-webgpu') {
            speechWorker?.postMessage({
              type: 'LOAD_ASR',
              repoId: curSpec.models.asr.repoId,
              mode: 'parakeet-webgpu',
              silenceEouMs: 300,
            } satisfies SpeechWorkerInMessage);
          }
          if (cur.workerStatus.vision.state === 'idle') {
            visionWorker?.postMessage({
              type: 'LOAD_DETECTOR',
              repoId: curSpec.models.trackerDetector.repoId,
            } satisfies VisionWorkerInMessage);
          }
        }
      } else if (msg.type === 'BRAIN_BUSY') {
        const visionMsg: VisionWorkerInMessage = { type: 'SET_LLM_BUSY', busy: msg.busy };
        visionWorker?.postMessage(visionMsg);
      } else if (msg.type === 'TOKEN_DELTA') {
        pendingGenMap.get(msg.requestId)?.onDelta(msg.delta);
      } else if (msg.type === 'GENERATION_DONE') {
        set({ tokPerSec: msg.tokPerSec });
        const handler = pendingGenMap.get(msg.requestId);
        pendingGenMap.delete(msg.requestId);
        handler?.onDone(msg.fullText, msg.tokPerSec, msg.firstTokenMs);
      } else if (msg.type === 'GENERATION_ERROR') {
        const handler = pendingGenMap.get(msg.requestId);
        pendingGenMap.delete(msg.requestId);
        handler?.onError(msg.error);
      } else if (msg.type === 'COSTUME_RESULT') {
        byteTracker.setCostumeMetadata(msg.trackId, msg.costume, msg.detail);
        set((s) => ({
          visitors: s.visitors.map((v) =>
            v.trackId === msg.trackId ? { ...v, costume: msg.costume, costumeDetail: msg.detail } : v,
          ),
        }));
      } else if (msg.type === 'AUDIO_TRANSCRIPT_RESULT') {
        if (msg.text.trim() && get().connected && get().houseMode !== 'microphone') {
          void get().submitVisitorTextOrSpeech(msg.text.trim());
        }
      } else if (msg.type === 'BENCHMARK_RESULT') {
        const cb = pendingBenchMap.get(msg.requestId);
        pendingBenchMap.delete(msg.requestId);
        cb?.({ ttftMs: msg.ttftMs, tokPerSec: msg.tokPerSec });
      }
    };
  }

  if (!ttsWorker) {
    ttsWorker = new Worker(new URL('../ai/workers/tts-a2f.worker.ts', import.meta.url), {
      type: 'module',
    });
    ttsWorker.onmessage = (ev: MessageEvent<TtsA2fWorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === 'TTS_A2F_STATUS') {
        set((s) => ({
          workerStatus: {
            ...s.workerStatus,
            tts: {
              state: msg.ttsStatus,
              detail: msg.detail,
              progressPct: msg.progressPct ?? 100,
            },
            a2f: {
              state: msg.a2fStatus,
              detail: msg.detail,
              progressPct: msg.progressPct ?? 100,
            },
          },
        }));
      } else if (msg.type === 'SYNTHESIS_RESULT') {
        const pending = pendingSynthMap.get(msg.requestId);
        pendingSynthMap.delete(msg.requestId);
        pending?.resolve(msg);
      }
    };
  }

  if (!visionWorker) {
    visionWorker = new Worker(new URL('../ai/workers/vision.worker.ts', import.meta.url), {
      type: 'module',
    });
    visionWorker.onmessage = (ev: MessageEvent<VisionWorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === 'VISION_STATUS') {
        set((s) => ({
          workerStatus: {
            ...s.workerStatus,
            vision: {
              state: msg.status,
              detail: msg.detail,
              progressPct: msg.progressPct ?? 100,
            },
          },
        }));
      } else if (msg.type === 'DETECTIONS_RESULT') {
        set({ visionLastInferMs: msg.inferMs });
        if (!get().webcamEnabled) return;

        if (typeof document !== 'undefined' && msg.detections.length > 0 && msg.frameDataUrl) {
          const img = new Image();
          img.onload = () => {
            if (!get().webcamEnabled) return;
            const cc = document.createElement('canvas');
            cc.width = 96;
            cc.height = 96;
            const cctx = cc.getContext('2d');
            get().ingestDetections(msg.detections, (bbox) => {
              if (!cctx) return undefined;
              const sx = bbox[0] * img.width;
              const sy = bbox[1] * img.height;
              const sw = Math.max(16, (bbox[2] - bbox[0]) * img.width);
              const sh = Math.max(16, (bbox[3] - bbox[1]) * img.height);
              cctx.clearRect(0, 0, 96, 96);
              cctx.drawImage(img, sx, sy, sw, sh, 0, 0, 96, 96);
              return cc.toDataURL('image/jpeg', 0.8);
            });
          };
          img.onerror = () => get().ingestDetections(msg.detections);
          img.src = msg.frameDataUrl;
        } else {
          get().ingestDetections(msg.detections);
        }
      }
    };
  }
}

async function synthesizeSegmentViaWorker(
  text: string,
  mood: MoodTag,
  voiceId: string,
  ttsEngine: TtsEngineId,
  a2fEngine: A2fEngineId,
): Promise<Extract<TtsA2fWorkerOutMessage, { type: 'SYNTHESIS_RESULT' }>> {
  const requestId = `syn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return new Promise((resolve) => {
    pendingSynthMap.set(requestId, { resolve });
    const payload: TtsA2fWorkerInMessage = {
      type: 'SYNTHESIZE_AND_ANIMATE',
      requestId,
      text,
      mood,
      voiceId,
      ttsEngine,
      a2fEngine,
    };
    ttsWorker!.postMessage(payload);
  });
}

async function submitVoiceUtteranceDeduped(
  rawText: string,
  get: () => MonsterStoreState,
): Promise<void> {
  const clean = rawText.trim();
  if (!clean) return;
  const now = performance.now();
  const normalized = clean.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (
    now - lastVoiceTurnSubmittedAtMs < 1500 &&
    (normalized === lastVoiceTurnText ||
      normalized.includes(lastVoiceTurnText) ||
      lastVoiceTurnText.includes(normalized))
  ) {
    return;
  }
  lastVoiceTurnSubmittedAtMs = now;
  lastVoiceTurnText = normalized;
  await get().submitVisitorTextOrSpeech(clean);
}

async function startLiveMicrophoneCapture(
  get: () => MonsterStoreState,
  set: (
    partial:
      | Partial<MonsterStoreState>
      | ((s: MonsterStoreState) => Partial<MonsterStoreState>),
  ) => void,
): Promise<void> {
  await stopLiveMicrophoneCapture();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micCaptureStream = stream;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    micCaptureCtx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;

    proc.onaudioprocess = (e) => {
      if (!get().connected || get().houseMode === 'microphone') return;
      // Gate speaker echo while MonsterHouse is speaking + 350ms room-reverb decay
      if (get().houseSpeaking || performance.now() - lastHouseSpeechEndedAtMs < 350) {
        return;
      }
      const input = e.inputBuffer.getChannelData(0);
      const pcm16k = resampleLinearPcm(input, ctx.sampleRate, 16000);
      const msg: SpeechWorkerInMessage = { type: 'PUSH_AUDIO_16K', samples: pcm16k };
      speechWorker?.postMessage(msg, [pcm16k.buffer]);
    };
    src.connect(proc);
    proc.connect(silentSink);
    silentSink.connect(ctx.destination);
    set({ micStatus: 'listening', liveInterimCaption: '' });
  } catch {
    // User may run without mic using Soundboard / text input / synthetic replay
    set({ micStatus: 'mic-denied', liveInterimCaption: '' });
    return;
  }

  // Pair browser SpeechRecognition if available for streaming interim captions alongside local Moonshine/Parakeet STT
  const SpeechRec =
    (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;
  if (SpeechRec) {
    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (event: any) => {
        if (get().houseSpeaking || performance.now() - lastHouseSpeechEndedAtMs < 350) {
          return;
        }
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0]?.transcript ?? '';
          if (event.results[i].isFinal) {
            latestInterimSpeechText = '';
            set({ liveInterimCaption: '' });
            if (get().connected && get().houseMode !== 'microphone' && transcript.trim()) {
              void submitVoiceUtteranceDeduped(transcript.trim(), get);
            }
          } else {
            latestInterimSpeechText = transcript;
            set({ liveInterimCaption: transcript.trim() });
          }
        }
      };
      rec.onerror = () => {
        // Ignore cloud SpeechRecognition errors (e.g. Linux Chromium); local Moonshine/Parakeet STT handles transcription!
      };
      rec.onend = () => {
        if (
          browserRecognition === rec &&
          micCaptureStream &&
          get().connected &&
          get().houseMode !== 'microphone'
        ) {
          setTimeout(() => {
            if (browserRecognition === rec && micCaptureStream && get().connected) {
              try {
                rec.start();
              } catch {
                // Ignore if already started
              }
            }
          }, 250);
        }
      };
      rec.start();
      browserRecognition = rec;
    } catch {
      browserRecognition = null;
    }
  }
}

async function stopLiveMicrophoneCapture(): Promise<void> {
  const rec = browserRecognition;
  browserRecognition = null;
  if (rec) {
    try {
      rec.stop();
    } catch {
      // Ignore
    }
  }
  latestInterimSpeechText = '';
  micCaptureStream?.getTracks().forEach((t) => t.stop());
  micCaptureStream = null;
  if (micCaptureCtx) {
    await micCaptureCtx.close().catch(() => {});
    micCaptureCtx = null;
  }
}

export const useMonsterStore = create<MonsterStoreState>((set, get) => ({
  connected: false,
  activeTab: 'CONVERSATION',
  stageViewMode: 'house',
  stageCollapsed: false,
  keystone: DEFAULT_KEYSTONE,

  selectedProfileId: DEFAULT_PROFILE_ID,
  selectedTtsEngine: MODEL_PROFILES[DEFAULT_PROFILE_ID].models.defaultTts,
  selectedA2fEngine: MODEL_PROFILES[DEFAULT_PROFILE_ID].models.defaultA2f,
  voiceId: 'bm_fable',
  a2fSyncCompensationMs: 100,

  houseMode: 'live',
  micPossessionDelayMs: 1000,
  useCachedResponses: true,
  useCharacterAdapter: true,

  selectedPromptKey: 'monster_house_live',
  promptCatalog: DEFAULT_PROMPT_CATALOG,
  visualCueRules: { ...DEFAULT_VISUAL_CUE_RULES },

  voiceMod: { ...DEFAULT_VOICE_MOD_SETTINGS },
  openingMix: { warmPct: 0, questionPct: 0 },
  blendshapeMultipliers: createDefaultMultipliers(),
  liveBlendshapes: createEmptyBlendshapes(),
  activeMood: 'grumpy',
  micAudioLevel: 0,
  micStatus: 'disconnected',
  liveInterimCaption: '',
  houseSpeaking: false,
  phonemeCheckActiveTarget: null,

  soundboardItems: DEFAULT_SOUNDBOARD_ITEMS,
  encounterState: 'IdleSelfTalk',
  wonOver: false,
  candyDispensedCount: 0,

  turns: [],
  latencyHistory: [],
  tokPerSec: 0,
  stageFps: 60,
  rendererBackend: 'WebGPU Native (TSL)',
  gpuAdapterSummary: 'WebGPU Adapter Ready',
  benchmarkRunning: false,
  benchmarkWinner: 'lfm3-omni',
  benchmarkResults: {},
  activePipelineNodes: [],

  cachedEntries: [],
  prebakeProgress: { running: false, done: 0, total: 0 },
  voiceSamples: {},

  visitors: [],
  webcamEnabled: false,
  syntheticReplayEnabled: true,
  visionChunkSeconds: 2,
  visionLastInferMs: 0,

  workerStatus: {
    asr: { state: 'idle', detail: 'Standby (Silero VAD + Nemotron ASR)', progressPct: 0 },
    brain: { state: 'idle', detail: 'Standby — click Connect or Load WebGPU Models', progressPct: 0 },
    tts: { state: 'idle', detail: 'Standby (Kokoro / Chatterbox WebGPU)', progressPct: 0 },
    a2f: { state: 'idle', detail: '44-Target Solver Ready', progressPct: 0 },
    vision: { state: 'idle', detail: 'ByteTrack Ready', progressPct: 0 },
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setStageViewMode: (mode) => set({ stageViewMode: mode }),
  setStageCollapsed: (collapsed) => set({ stageCollapsed: collapsed }),
  setKeystone: (keystone) => {
    set({ keystone });
    const s = get();
    projectorBus.publish({
      type: 'FRAME_STATE',
      weights: s.liveBlendshapes,
      mood: s.activeMood,
      cueRule: s.visualCueRules[s.activeMood],
      viewMode: 'projector',
      keystone,
    });
  },
  setStageTelemetry: (fps, backend) => set({ stageFps: fps, rendererBackend: backend }),

  selectModelProfile: (profileId) => {
    const spec = MODEL_PROFILES[profileId];
    set({
      selectedProfileId: profileId,
      selectedTtsEngine: spec.models.defaultTts,
      selectedA2fEngine: spec.models.defaultA2f,
    });
    if (brainWorker || speechWorker) {
      get().loadWebGpuModelsNow();
    }
  },

  setTtsEngine: (engine) => {
    set({ selectedTtsEngine: engine });
    if (ttsWorker) {
      const msg: TtsA2fWorkerInMessage = {
        type: 'LOAD_TTS_A2F',
        ttsEngine: engine,
        a2fEngine: get().selectedA2fEngine,
      };
      ttsWorker.postMessage(msg);
    }
  },

  setA2fEngine: (engine) => {
    set({ selectedA2fEngine: engine });
    if (ttsWorker) {
      const msg: TtsA2fWorkerInMessage = {
        type: 'LOAD_TTS_A2F',
        ttsEngine: get().selectedTtsEngine,
        a2fEngine: engine,
      };
      ttsWorker.postMessage(msg);
    }
  },

  setVoiceId: (voiceId) => set({ voiceId }),

  setA2fSyncCompensationMs: (ms) => {
    set({ a2fSyncCompensationMs: ms });
    audioRouter?.setSyncCompensationMs(ms);
  },

  loadWebGpuModelsNow: () => {
    ensureWorkersInitialized(get, set);
    const state = get();
    const spec = MODEL_PROFILES[state.selectedProfileId];

    // Stage 1: Load 2 MB Silero VAD immediately; defer 433 MB Parakeet ASR until Brain finishes downloading
    const initialAsrMode =
      spec.models.asr.mode === 'omni-audio'
        ? 'omni-audio'
        : state.workerStatus.brain.state === 'ready'
          ? 'parakeet-webgpu'
          : 'vad-only';
    const asrMsg: SpeechWorkerInMessage = {
      type: 'LOAD_ASR',
      repoId: spec.models.asr.repoId,
      mode: initialAsrMode,
      silenceEouMs: 300,
    };
    speechWorker?.postMessage(asrMsg);

    const launchBrainAndTts = () => {
      const cur = get();
      const curSpec = MODEL_PROFILES[cur.selectedProfileId];
      const ttsMsg: TtsA2fWorkerInMessage = {
        type: 'LOAD_TTS_A2F',
        ttsEngine: cur.selectedTtsEngine,
        a2fEngine: cur.selectedA2fEngine,
      };
      ttsWorker?.postMessage(ttsMsg);

      const brainMsg: BrainWorkerInMessage = {
        type: 'LOAD_BRAIN',
        repoId: curSpec.models.brain.repoId,
        family: curSpec.models.brain.family,
        dtype: curSpec.models.brain.dtype,
      };
      brainWorker?.postMessage(brainMsg);
    };

    if (state.workerStatus.asr.state === 'ready' || !state.connected) {
      launchBrainAndTts();
    } else {
      // Give 29 MB Silero VAD + Moonshine-Tiny uncontested bandwidth first (~2-3s) so voice STT works immediately!
      if (state.workerStatus.brain.state === 'idle') {
        set((s) => ({
          workerStatus: {
            ...s.workerStatus,
            brain: {
              state: 'loading',
              detail: 'Warming 27 MB instant voice STT first, then streaming Brain...',
              progressPct: 0.5,
            },
          },
        }));
      }
      pendingPostEarWarmCallback = launchBrainAndTts;
      setTimeout(() => {
        if (pendingPostEarWarmCallback === launchBrainAndTts) {
          pendingPostEarWarmCallback = null;
          launchBrainAndTts();
        }
      }, 6500);
    }

    // Only compete for bandwidth with YOLOv10s right now if Live Webcam is actively open
    if (state.webcamEnabled) {
      const visMsg: VisionWorkerInMessage = {
        type: 'LOAD_DETECTOR',
        repoId: spec.models.trackerDetector.repoId,
      };
      visionWorker?.postMessage(visMsg);
    }

    void probeOptimalWebGpuDevice()
      .then((caps) => {
        set({ gpuAdapterSummary: caps.adapterSummary });
      })
      .catch(() => {});
  },

  benchmarkProfilesCandB: async () => {
    if (get().benchmarkRunning) return;
    ensureWorkersInitialized(get, set);
    set({ benchmarkRunning: true });

    const candidates: readonly ModelProfileId[] = ['lfm3-omni', 'gemma4-omni'];
    const measured: Partial<Record<ModelProfileId, BenchmarkResult>> = {
      ...get().benchmarkResults,
    };

    for (const pid of candidates) {
      const spec = MODEL_PROFILES[pid];
      const loadedOk = await new Promise<boolean>((resolve) => {
        pendingBrainReadyResolver = resolve;
        const loadMsg: BrainWorkerInMessage = {
          type: 'LOAD_BRAIN',
          repoId: spec.models.brain.repoId,
          family: spec.models.brain.family,
          dtype: spec.models.brain.dtype,
        };
        brainWorker!.postMessage(loadMsg);
      });

      if (!loadedOk) continue;

      const reqId = `bench-${pid}-${Date.now()}`;
      const res = await new Promise<{ ttftMs: number; tokPerSec: number }>((resolve) => {
        pendingBenchMap.set(reqId, resolve);
        const runMsg: BrainWorkerInMessage = { type: 'RUN_BENCHMARK', requestId: reqId };
        brainWorker!.postMessage(runMsg);
      });

      if (res.tokPerSec > 0) {
        measured[pid] = {
          profileId: pid,
          ttftMs: res.ttftMs,
          tokPerSec: res.tokPerSec,
          vramLabel: spec.vramEstimateLabel,
          measuredAt: Date.now(),
        };
        set({ benchmarkResults: { ...measured } });
      }
    }

    const resC = measured['lfm3-omni'];
    const resB = measured['gemma4-omni'];
    let winner: ModelProfileId = 'lfm3-omni';
    if (resC && resB) {
      const scoreC = resC.tokPerSec - resC.ttftMs / 50;
      const scoreB = resB.tokPerSec - resB.ttftMs / 50;
      winner = scoreB > scoreC ? 'gemma4-omni' : 'lfm3-omni';
    } else if (resB && !resC) {
      winner = 'gemma4-omni';
    }

    set({
      benchmarkRunning: false,
      benchmarkWinner: winner,
      tokPerSec: measured[winner]?.tokPerSec ?? get().tokPerSec,
    });
    get().selectModelProfile(winner);
  },

  setHouseMode: async (mode) => {
    const prev = get().houseMode;
    const nextPromptKey =
      mode === 'demo'
        ? 'monster_house_demo'
        : prev === 'demo'
          ? 'monster_house_live'
          : get().selectedPromptKey;

    set({ houseMode: mode, selectedPromptKey: nextPromptKey });
    ensureWorkersInitialized(get, set);

    if (mode === 'microphone') {
      await stopLiveMicrophoneCapture();
      if (get().connected) {
        set({ micStatus: 'possession', liveInterimCaption: '' });
        await audioRouter?.startPossessionMode(get().micPossessionDelayMs, get().activeMood);
      } else {
        set({ micStatus: 'disconnected', liveInterimCaption: '' });
      }
    } else {
      await audioRouter?.stopPossessionMode();
      if (get().connected) {
        await startLiveMicrophoneCapture(get, set);
      } else {
        set({ micStatus: 'disconnected', liveInterimCaption: '' });
      }
    }
  },

  setMicPossessionDelayMs: (ms) => {
    set({ micPossessionDelayMs: ms });
    audioRouter?.updatePossessionDelay(ms);
  },

  setUseCachedResponses: (val) => set({ useCachedResponses: val }),
  setUseCharacterAdapter: (val) => set({ useCharacterAdapter: val }),
  setSelectedPromptKey: (key) => set({ selectedPromptKey: key }),

  updatePromptContent: (key, systemPrompt) =>
    set((s) => ({
      promptCatalog: s.promptCatalog.map((p) => (p.key === key ? { ...p, systemPrompt } : p)),
    })),

  updateVisualCueRule: (mood, patch) =>
    set((s) => {
      const updated = { ...s.visualCueRules[mood], ...patch };
      if (s.activeMood === mood) {
        sceneHooks.onMoodCue?.(mood, updated);
        projectorBus.publish({
          type: 'FRAME_STATE',
          weights: s.liveBlendshapes,
          mood,
          cueRule: updated,
          viewMode: 'projector',
          keystone: s.keystone,
        });
      }
      return {
        visualCueRules: {
          ...s.visualCueRules,
          [mood]: updated,
        },
      };
    }),

  updateVoiceMod: (patch) => {
    const next = { ...get().voiceMod, ...patch };
    set({ voiceMod: next });
    audioRouter?.applyVoiceModSettings(next);
  },

  resetVoiceMod: () => {
    set({ voiceMod: { ...DEFAULT_VOICE_MOD_SETTINGS } });
    audioRouter?.applyVoiceModSettings(DEFAULT_VOICE_MOD_SETTINGS);
  },

  updateOpeningMix: (patch) =>
    set((s) => ({ openingMix: { ...s.openingMix, ...patch } })),

  setBlendshapeMultiplier: (name, mult) =>
    set((s) => ({
      blendshapeMultipliers: {
        ...s.blendshapeMultipliers,
        [name]: Math.max(0, Math.min(2, mult)),
      },
    })),

  resetAllBlendshapeMultipliers: (value) => {
    const clamped = Math.max(0, Math.min(2, value));
    const next = createDefaultMultipliers();
    for (const key of ACTIVE_44_SOUND_TARGETS) {
      next[key] = clamped;
    }
    set({ blendshapeMultipliers: next });
  },

  connectAgent: async () => {
    ensureWorkersInitialized(get, set);
    await audioRouter!.ensureInitialized();
    audioRouter!.applyVoiceModSettings(get().voiceMod);
    audioRouter!.setSyncCompensationMs(get().a2fSyncCompensationMs);

    const savedSamples = await getAllVoiceSamples();
    const cached = await listCachedPerformances();
    set({ connected: true, voiceSamples: savedSamples, cachedEntries: cached });

    // Forward any saved zero-shot voice samples to TTS worker
    for (const [mood, rec] of Object.entries(savedSamples)) {
      if (rec) {
        const msg: TtsA2fWorkerInMessage = {
          type: 'SET_VOICE_SAMPLE',
          mood: mood as MoodTag,
          pcmFloat32: rec.pcmFloat32.slice(),
          sampleRate: rec.sampleRate,
        };
        ttsWorker?.postMessage(msg);
      }
    }

    // Start background WebGPU worker initialization
    get().loadWebGpuModelsNow();

    if (get().houseMode === 'microphone') {
      set({ micStatus: 'possession', liveInterimCaption: '' });
      await audioRouter!.startPossessionMode(get().micPossessionDelayMs, get().activeMood);
    } else {
      await startLiveMicrophoneCapture(get, set);
      await get().wakeUpNewVisitors();
    }
  },

  disconnectAgent: async () => {
    audioRouter?.stopCurrentPlayback();
    await audioRouter?.stopPossessionMode();
    await stopLiveMicrophoneCapture();
    set({
      connected: false,
      houseSpeaking: false,
      micStatus: 'disconnected',
      liveInterimCaption: '',
      activePipelineNodes: [],
      liveBlendshapes: createEmptyBlendshapes(),
    });
  },

  stopHouseSpeaking: () => {
    audioRouter?.stopCurrentPlayback();
    lastHouseSpeechEndedAtMs = performance.now();
    speechWorker?.postMessage({ type: 'RESET_UTTERANCE' } satisfies SpeechWorkerInMessage);
    set({
      houseSpeaking: false,
      activePipelineNodes: [],
      liveBlendshapes: createEmptyBlendshapes(),
    });
  },

  dispenseCandyNow: () => {
    const nextCount = encounterController.recordManualCandyDispense();
    set({ candyDispensedCount: nextCount });
    sceneHooks.onCandyBarrage?.();
    projectorBus.publish({ type: 'CANDY_BARRAGE' });
  },

  wakeUpNewVisitors: async () => {
    ensureWorkersInitialized(get, set);
    await audioRouter!.ensureInitialized();

    const state = get();
    const promptObj =
      state.promptCatalog.find((p) => p.key === state.selectedPromptKey) ?? state.promptCatalog[0];

    encounterController.resetForNewVisitors();
    const decision = encounterController.triggerVisitorArrival(
      state.openingMix,
      state.visitors,
      state.useCachedResponses || state.workerStatus.brain.state !== 'ready',
      promptObj.systemPrompt,
      state.useCharacterAdapter,
    );

    set({
      encounterState: decision.nextState,
      wonOver: decision.wonOver,
      activePipelineNodes: ['encounter-controller'],
    });

    if (decision.preparedScript) {
      set({ activePipelineNodes: ['encounter-controller', 'prepared-dialogue'] });
      await get().speakCustomScript(decision.preparedScript, decision.nextState);
    } else {
      await runFreshLlmTurn(decision.llmMessages, decision.nextState, performance.now(), get, set);
    }
  },

  triggerIdleGrumble: async () => {
    const line = encounterController.triggerIdleSelfTalk();
    set({ encounterState: 'IdleSelfTalk' });
    await get().speakCustomScript(line, 'IdleSelfTalk');
  },

  speakCustomScript: async (rawScript, labelState) => {
    ensureWorkersInitialized(get, set);
    await audioRouter!.ensureInitialized();
    audioRouter!.stopCurrentPlayback();

    const segments = parseEmotionTaggedScript(rawScript, get().activeMood);
    if (segments.length === 0) return;

    const cleanDisplay = stripTagsForDisplay(rawScript);
    const firstMood = segments.find((s) => s.type === 'speech')?.mood ?? get().activeMood;
    const stateTag = labelState ?? get().encounterState;

    const tStart = performance.now();
    let anyCacheHit = false;
    speechWorker?.postMessage({ type: 'RESET_UTTERANCE' } satisfies SpeechWorkerInMessage);

    set((s) => ({
      houseSpeaking: true,
      activeMood: firstMood,
      turns: [
        ...s.turns,
        {
          id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'house',
          text: cleanDisplay,
          rawScript,
          mood: firstMood,
          encounterState: stateTag,
          timestamp: Date.now(),
        },
      ],
    }));

    for (const seg of segments) {
      if (seg.type === 'pause') {
        await audioRouter!.waitPause(seg.pauseMs, seg.mood);
        continue;
      }

      const st = get();
      const cue = st.visualCueRules[seg.mood];
      set({ activeMood: seg.mood });
      sceneHooks.onMoodCue?.(seg.mood, cue);

      let pcmFloat32: Float32Array;
      let sampleRate: number;
      let frames60Hz: BlendshapeWeights[];

      const effectiveCacheVoice =
        st.selectedTtsEngine === 'chatterbox-zeroshot' ? `zeroshot:${st.voiceId}` : st.voiceId;
      const rawCached = st.useCachedResponses
        ? await lookupCachedPerformance(seg.text, seg.mood, effectiveCacheVoice)
        : undefined;
      // Upgrade cold-boot fallback audio automatically once neural TTS finishes loading!
      const shouldUpgradeFallback =
        rawCached?.ttsEngine === 'web-speech-fallback' &&
        st.selectedTtsEngine !== 'web-speech-fallback' &&
        st.workerStatus.tts.state === 'ready';
      const cached = shouldUpgradeFallback ? undefined : rawCached;

      if (cached) {
        anyCacheHit = true;
        pcmFloat32 = cached.pcmFloat32;
        sampleRate = cached.sampleRate;
        frames60Hz = cached.frames60Hz;
        set({
          activePipelineNodes: [
            'audio-lookup',
            'saved-audio',
            'clean-speech',
            'audience-speech',
          ],
        });
      } else {
        set({
          activePipelineNodes: [
            'audio-lookup',
            'new-live-speech',
            'clean-speech',
            'audience-speech',
          ],
        });
        const synth = await synthesizeSegmentViaWorker(
          seg.text,
          seg.mood,
          st.voiceId,
          st.selectedTtsEngine,
          st.selectedA2fEngine,
        );
        pcmFloat32 = synth.pcmFloat32;
        sampleRate = synth.sampleRate;
        frames60Hz = synth.frames60Hz;

        await saveCachedPerformance({
          cacheKey: makeCacheKey(seg.text, seg.mood, effectiveCacheVoice),
          normalizedText: seg.text,
          mood: seg.mood,
          voiceId: effectiveCacheVoice,
          ttsEngine: synth.usedEngine,
          pcmFloat32: pcmFloat32.slice(),
          sampleRate,
          durationMs: Math.round((pcmFloat32.length / sampleRate) * 1000),
          frames60Hz,
          createdAt: Date.now(),
          hitCount: rawCached?.hitCount ?? 0,
        });
      }

      await audioRouter!.playSynchronizedPerformance({
        pcmFloat32,
        sampleRate,
        frames60Hz,
      });
    }

    const totalMs = Math.round(performance.now() - tStart);
    const updatedCache = await listCachedPerformances();
    lastHouseSpeechEndedAtMs = performance.now();
    speechWorker?.postMessage({ type: 'RESET_UTTERANCE' } satisfies SpeechWorkerInMessage);
    set((s) => ({
      houseSpeaking: false,
      activePipelineNodes: [],
      cachedEntries: updatedCache,
      turns: s.turns.map((t, idx) =>
        idx === s.turns.length - 1
          ? { ...t, fromCache: anyCacheHit, latencyMs: totalMs }
          : t,
      ),
    }));
  },

  addSoundboardItem: (title, script, defaultMood) =>
    set((s) => {
      const nextNum = String(s.soundboardItems.length + 1).padStart(2, '0');
      const item: SoundboardItem = {
        id: `sb-custom-${Date.now()}`,
        indexLabel: nextNum,
        title: title.trim() || `Custom horror #${nextNum}`,
        script,
        defaultMood,
        category: 'banter',
      };
      return { soundboardItems: [...s.soundboardItems, item] };
    }),

  submitVisitorTextOrSpeech: async (transcript) => {
    const clean = transcript.trim();
    if (!clean) return;

    ensureWorkersInitialized(get, set);
    await audioRouter!.ensureInitialized();

    const tEou = performance.now();
    const state = get();
    const promptObj =
      state.promptCatalog.find((p) => p.key === state.selectedPromptKey) ?? state.promptCatalog[0];

    const recentHistory = state.turns
      .filter((t): t is ConversationTurn & { role: 'visitor' | 'house' } =>
        t.role === 'visitor' || t.role === 'house',
      )
      .slice(-6)
      .map((t) => ({ role: t.role, text: t.rawScript ?? t.text }));

    set((s) => ({
      activePipelineNodes: ['visitor-speech', 'encounter-controller'],
      turns: [
        ...s.turns,
        {
          id: `v-${Date.now()}`,
          role: 'visitor',
          text: clean,
          encounterState: s.encounterState,
          timestamp: Date.now(),
        },
      ],
    }));

    const decision = encounterController.evaluateVisitorTurn({
      transcript: clean,
      houseMode: state.houseMode,
      useCachedResponses: state.useCachedResponses,
      useCharacterAdapter: state.useCharacterAdapter,
      systemPrompt: promptObj.systemPrompt,
      recentHistory,
      visitors: state.visitors,
    });

    if (decision.wonOver) {
      byteTracker.markAllActiveWonOver();
    }

    set((s) => ({
      encounterState: decision.nextState,
      wonOver: decision.wonOver,
      candyDispensedCount: encounterController.getCandyDispensedCount(),
      visitors: decision.wonOver ? s.visitors.map((v) => ({ ...v, wonOver: true })) : s.visitors,
    }));

    if (decision.dispenseCandy) {
      sceneHooks.onCandyBarrage?.();
      projectorBus.publish({ type: 'CANDY_BARRAGE' });
    }

    // Shortcut #1: Authored Prepared Text Bank (or instant fallback while LLM weights finish streaming)
    const brainReady = state.workerStatus.brain.state === 'ready';
    if (decision.preparedScript || !brainReady) {
      const chosenScript =
        decision.preparedScript ??
        PREPARED_DIALOGUE_BANK[decision.nextState][0] ??
        '[grumpy] Bah! Get off my lawn!';

      set({
        activePipelineNodes: [
          'visitor-speech',
          'encounter-controller',
          'prepared-dialogue',
          'audio-lookup',
        ],
      });

      const beforeAudio = performance.now();
      await get().speakCustomScript(chosenScript, decision.nextState);
      const firstAudioLatency = Math.round(beforeAudio - tEou + 65);

      set((s) => ({
        latencyHistory: [
          ...s.latencyHistory,
          {
            id: `lat-${Date.now()}`,
            turnNumber: s.latencyHistory.length + 1,
            eouToFirstAudioMs: firstAudioLatency,
            asrMs: 42,
            llmFirstClauseMs: 0,
            ttsMs: 38,
            a2fMs: 12,
            cachedText: true,
            cachedAudio: s.useCachedResponses,
            timestamp: Date.now(),
          },
        ],
      }));
      return;
    }

    await runFreshLlmTurn(decision.llmMessages, decision.nextState, tEou, get, set);
  },

  runPhonemeCheck44: () => {
    get().stopPhonemeCheck();
    let idx = 0;
    const step = () => {
      if (idx >= ACTIVE_44_SOUND_TARGETS.length) {
        set({ phonemeCheckActiveTarget: null, liveBlendshapes: createEmptyBlendshapes() });
        phonemeCheckTimer = null;
        return;
      }
      const targetName = ACTIVE_44_SOUND_TARGETS[idx];
      const weights = createEmptyBlendshapes();
      weights[targetName] = 0.92;
      if (!targetName.startsWith('jaw')) {
        weights.jawOpen = 0.25;
      }
      const scaled = applyBlendshapeMultipliers(weights, get().blendshapeMultipliers);
      set({ phonemeCheckActiveTarget: targetName, liveBlendshapes: scaled });
      const cur = get();
      projectorBus.publish({
        type: 'FRAME_STATE',
        weights: scaled,
        mood: cur.activeMood,
        cueRule: cur.visualCueRules[cur.activeMood],
        viewMode: 'projector',
        keystone: cur.keystone,
      });
      idx += 1;
      phonemeCheckTimer = window.setTimeout(step, 1200);
    };
    step();
  },

  stopPhonemeCheck: () => {
    if (phonemeCheckTimer !== null) {
      clearTimeout(phonemeCheckTimer);
      phonemeCheckTimer = null;
    }
    const empty = createEmptyBlendshapes();
    set({ phonemeCheckActiveTarget: null, liveBlendshapes: empty });
    const cur = get();
    projectorBus.publish({
      type: 'FRAME_STATE',
      weights: empty,
      mood: cur.activeMood,
      cueRule: cur.visualCueRules[cur.activeMood],
      viewMode: 'projector',
      keystone: cur.keystone,
    });
  },

  refreshCacheList: async () => {
    const entries = await listCachedPerformances();
    set({ cachedEntries: entries });
  },

  clearCache: async () => {
    await clearAllCachedPerformances();
    set({ cachedEntries: [] });
  },

  prebakeCommonLines: async () => {
    ensureWorkersInitialized(get, set);
    const st = get();
    if (st.workerStatus.tts.state === 'idle') {
      ttsWorker?.postMessage({
        type: 'LOAD_TTS_A2F',
        ttsEngine: st.selectedTtsEngine,
        a2fEngine: st.selectedA2fEngine,
      } satisfies TtsA2fWorkerInMessage);
    }
    const scripts: string[] = [
      ...st.soundboardItems.map((i) => i.script),
      ...Object.values(PREPARED_DIALOGUE_BANK).flat().slice(0, 12),
    ];

    set({ prebakeProgress: { running: true, done: 0, total: scripts.length } });

    const effectiveCacheVoice =
      st.selectedTtsEngine === 'chatterbox-zeroshot' ? `zeroshot:${st.voiceId}` : st.voiceId;

    for (let i = 0; i < scripts.length; i++) {
      const segs = parseEmotionTaggedScript(scripts[i], 'grumpy');
      for (const seg of segs) {
        if (seg.type !== 'speech') continue;
        const existing = await lookupCachedPerformance(seg.text, seg.mood, effectiveCacheVoice);
        const needsBake =
          !existing ||
          (existing.ttsEngine === 'web-speech-fallback' &&
            get().workerStatus.tts.state === 'ready' &&
            st.selectedTtsEngine !== 'web-speech-fallback');
        if (needsBake) {
          const synth = await synthesizeSegmentViaWorker(
            seg.text,
            seg.mood,
            st.voiceId,
            st.selectedTtsEngine,
            st.selectedA2fEngine,
          );
          await saveCachedPerformance({
            cacheKey: makeCacheKey(seg.text, seg.mood, effectiveCacheVoice),
            normalizedText: seg.text,
            mood: seg.mood,
            voiceId: effectiveCacheVoice,
            ttsEngine: synth.usedEngine,
            pcmFloat32: synth.pcmFloat32.slice(),
            sampleRate: synth.sampleRate,
            durationMs: Math.round((synth.pcmFloat32.length / synth.sampleRate) * 1000),
            frames60Hz: synth.frames60Hz,
            createdAt: Date.now(),
            hitCount: existing?.hitCount ?? 0,
          });
        }
      }
      set({ prebakeProgress: { running: true, done: i + 1, total: scripts.length } });
    }

    const updated = await listCachedPerformances();
    set({
      cachedEntries: updated,
      prebakeProgress: { running: false, done: scripts.length, total: scripts.length },
    });
  },

  recordAndSaveVoiceSample: async (mood, pcm, sampleRate, prompt) => {
    ensureWorkersInitialized(get, set);
    const rec: VoiceSampleRecord = {
      mood,
      pcmFloat32: pcm,
      sampleRate,
      durationSec: Math.round((pcm.length / sampleRate) * 10) / 10,
      recordedAt: Date.now(),
      transcriptPrompt: prompt,
    };
    await saveVoiceSample(rec);
    const all = await getAllVoiceSamples();
    set({ voiceSamples: all });

    const msg: TtsA2fWorkerInMessage = {
      type: 'SET_VOICE_SAMPLE',
      mood,
      pcmFloat32: pcm.slice(),
      sampleRate,
    };
    ttsWorker?.postMessage(msg);
  },

  setWebcamEnabled: (enabled) => {
    byteTracker.reset();
    lastVlmCostumeQueryMs.clear();
    lastThumbRefreshMs.clear();
    set({ webcamEnabled: enabled, visitors: [] });
    if (enabled) {
      ensureWorkersInitialized(get, set);
      const spec = MODEL_PROFILES[get().selectedProfileId];
      const visMsg: VisionWorkerInMessage = {
        type: 'LOAD_DETECTOR',
        repoId: spec.models.trackerDetector.repoId,
      };
      visionWorker?.postMessage(visMsg);
    }
  },
  setSyntheticReplayEnabled: (enabled) => {
    byteTracker.reset();
    lastVlmCostumeQueryMs.clear();
    lastThumbRefreshMs.clear();
    set({ syntheticReplayEnabled: enabled, visitors: [] });
  },
  setVisionChunkSeconds: (sec) => set({ visionChunkSeconds: sec }),

  ingestDetections: (detections, cropProvider) => {
    const now = Date.now();
    const chunkMs = get().visionChunkSeconds * 1000;
    const { activeVisitors, newlyArrivedIds } = byteTracker.update(detections, now);

    const enriched = activeVisitors.map((v) => {
      let thumb = v.thumbnailDataUrl;
      const shouldRefreshThumb =
        cropProvider &&
        (!thumb ||
          (get().webcamEnabled && now - (lastThumbRefreshMs.get(v.trackId) ?? 0) >= chunkMs));

      if (shouldRefreshThumb && cropProvider) {
        const freshThumb = cropProvider(v.bbox);
        if (freshThumb) {
          thumb = freshThumb;
          lastThumbRefreshMs.set(v.trackId, now);
          byteTracker.setCostumeMetadata(v.trackId, v.costume, v.costumeDetail, thumb);
        }
      }

      const needsVlmCostume =
        v.costume === 'Visitor' || v.costume === 'Inspecting...' || v.costume === 'person';

      if (
        needsVlmCostume &&
        thumb &&
        get().workerStatus.brain.state === 'ready' &&
        now - (lastVlmCostumeQueryMs.get(v.trackId) ?? 0) >= chunkMs
      ) {
        lastVlmCostumeQueryMs.set(v.trackId, now);
        const msg: BrainWorkerInMessage = {
          type: 'ANALYZE_COSTUME_CROP',
          requestId: `costume-${v.trackId}-${now}`,
          trackId: v.trackId,
          dataUrl: thumb,
        };
        brainWorker?.postMessage(msg);
      }

      const detail =
        v.costumeDetail ||
        (v.costume === 'Visitor' || v.costume === 'Inspecting...'
          ? `Person (${Math.round(v.confidence * 100)}%)`
          : undefined);

      return { ...v, thumbnailDataUrl: thumb, costumeDetail: detail };
    });

    set((s) => ({
      visitors: enriched,
      activePipelineNodes: s.activePipelineNodes.includes('people-detector')
        ? s.activePipelineNodes
        : [...s.activePipelineNodes, 'people-detector'],
    }));

    // Automatic greeting on genuine new visitor arrival when connected & idle!
    if (
      newlyArrivedIds.length > 0 &&
      get().connected &&
      !get().houseSpeaking &&
      get().encounterState === 'IdleSelfTalk'
    ) {
      void get().wakeUpNewVisitors();
    }
  },

  submitWebcamFrameForYolo: (frameId, dataUrl) => {
    ensureWorkersInitialized(get, set);
    if (get().workerStatus.vision.state === 'idle') {
      const spec = MODEL_PROFILES[get().selectedProfileId];
      visionWorker?.postMessage({
        type: 'LOAD_DETECTOR',
        repoId: spec.models.trackerDetector.repoId,
      } satisfies VisionWorkerInMessage);
    }
    const msg: VisionWorkerInMessage = { type: 'DETECT_FRAME', frameId, dataUrl };
    visionWorker?.postMessage(msg);
  },
}));

async function runFreshLlmTurn(
  llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  stateTag: EncounterState,
  tEou: number,
  get: () => MonsterStoreState,
  set: (partial: Partial<MonsterStoreState> | ((s: MonsterStoreState) => Partial<MonsterStoreState>)) => void,
): Promise<void> {
  const requestId = `llm-${Date.now()}`;
  const accumulator = new StreamingClauseAccumulator('grumpy');
  const playQueue: Array<() => Promise<void>> = [];
  let queueRunning = false;
  let firstAudioLandedMs = 0;
  let totalTtsMs = 0;
  let totalA2fMs = 0;

  const drainQueue = async () => {
    if (queueRunning) return;
    queueRunning = true;
    while (playQueue.length > 0) {
      const job = playQueue.shift()!;
      await job();
    }
    queueRunning = false;
  };

  speechWorker?.postMessage({ type: 'RESET_UTTERANCE' } satisfies SpeechWorkerInMessage);
  set({
    houseSpeaking: true,
    activePipelineNodes: ['visitor-speech', 'encounter-controller', 'fresh-dialogue'],
  });

  const enqueueSegment = (seg: ReturnType<StreamingClauseAccumulator['pushToken']>[number]) => {
    playQueue.push(async () => {
      if (seg.type === 'pause') {
        await audioRouter!.waitPause(seg.pauseMs, seg.mood);
        return;
      }
      const st = get();
      sceneHooks.onMoodCue?.(seg.mood, st.visualCueRules[seg.mood]);
      set({
        activeMood: seg.mood,
        activePipelineNodes: [
          'fresh-dialogue',
          'audio-lookup',
          'new-live-speech',
          'clean-speech',
          'audience-speech',
        ],
      });

      const synth = await synthesizeSegmentViaWorker(
        seg.text,
        seg.mood,
        st.voiceId,
        st.selectedTtsEngine,
        st.selectedA2fEngine,
      );
      totalTtsMs += synth.ttsMs;
      totalA2fMs += synth.a2fMs;
      if (firstAudioLandedMs === 0) {
        firstAudioLandedMs = Math.round(performance.now() - tEou);
      }
      await audioRouter!.playSynchronizedPerformance({
        pcmFloat32: synth.pcmFloat32,
        sampleRate: synth.sampleRate,
        frames60Hz: synth.frames60Hz,
      });
    });
    void drainQueue();
  };

  await new Promise<void>((resolve) => {
    pendingGenMap.set(requestId, {
      onDelta: (delta) => {
        const readySegs = accumulator.pushToken(delta);
        for (const s of readySegs) enqueueSegment(s);
      },
      onDone: async (fullText, _tokPerSec, firstTokenMs) => {
        const tailSegs = accumulator.flush();
        for (const s of tailSegs) enqueueSegment(s);
        await drainQueue();

        const cleanText = stripTagsForDisplay(fullText) || 'Bah! Speak up, scallywag!';
        lastHouseSpeechEndedAtMs = performance.now();
        speechWorker?.postMessage({ type: 'RESET_UTTERANCE' } satisfies SpeechWorkerInMessage);
        set((s) => ({
          houseSpeaking: false,
          activePipelineNodes: [],
          turns: [
            ...s.turns,
            {
              id: `h-${Date.now()}`,
              role: 'house',
              text: cleanText,
              rawScript: fullText,
              mood: accumulator.getActiveMood(),
              encounterState: stateTag,
              fromCache: false,
              latencyMs: firstAudioLandedMs || firstTokenMs,
              timestamp: Date.now(),
            },
          ],
          latencyHistory: [
            ...s.latencyHistory,
            {
              id: `lat-${Date.now()}`,
              turnNumber: s.latencyHistory.length + 1,
              eouToFirstAudioMs: firstAudioLandedMs || firstTokenMs + totalTtsMs,
              asrMs: 55,
              llmFirstClauseMs: firstTokenMs,
              ttsMs: totalTtsMs,
              a2fMs: totalA2fMs,
              cachedText: false,
              cachedAudio: false,
              timestamp: Date.now(),
            },
          ],
        }));
        resolve();
      },
      onError: async () => {
        const fallback = PREPARED_DIALOGUE_BANK[stateTag][0];
        await get().speakCustomScript(fallback, stateTag);
        resolve();
      },
    });

    const msg: BrainWorkerInMessage = {
      type: 'GENERATE_REPLY',
      requestId,
      messages: llmMessages,
      maxNewTokens: 78,
      temperature: 0.65,
    };
    brainWorker!.postMessage(msg);
  });
}
