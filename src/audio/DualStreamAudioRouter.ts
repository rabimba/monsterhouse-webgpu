import {
  createEmptyBlendshapes,
  solveAcousticBlendshapes60Hz,
} from '../ai/a2fSolver';
import type {
  BlendshapeWeights,
  MoodTag,
  VoiceModSettings,
} from '../types/monster';

/**
 * Inline WebAudio AudioWorklet processor source implementing a real-time dual-grain Hann-windowed
 * pitch shifter so MonsterHouse gets theatrical deep ship-timber vocal heft without slowing tempo!
 */
const PITCH_SHIFTER_WORKLET_CODE = `
class GranularPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitchSemitones', defaultValue: -4.5, minValue: -12, maxValue: 12 }];
  }

  constructor() {
    super();
    this.bufSize = 4096;
    this.buffer = new Float32Array(this.bufSize);
    this.writeIndex = 0;
    this.phase = 0;
    this.grainSize = 1024;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const inChan = input[0];
    const pitchArr = parameters.pitchSemitones;
    const semi = pitchArr.length > 0 ? pitchArr[0] : -4.5;
    const ratio = Math.pow(2, semi / 12);
    const phaseStep = (1 - ratio) / this.grainSize;

    for (let i = 0; i < inChan.length; i++) {
      this.buffer[this.writeIndex] = inChan[i];

      let outSample = inChan[i];
      if (Math.abs(semi) > 0.05) {
        this.phase += phaseStep;
        if (this.phase >= 1) this.phase -= 1;
        if (this.phase < 0) this.phase += 1;

        const phaseB = (this.phase + 0.5) % 1;
        const delayA = this.phase * this.grainSize;
        const delayB = phaseB * this.grainSize;

        const winA = 0.5 - 0.5 * Math.cos(2 * Math.PI * this.phase);
        const winB = 0.5 - 0.5 * Math.cos(2 * Math.PI * phaseB);

        const sampleA = this.readInterp(this.writeIndex - delayA);
        const sampleB = this.readInterp(this.writeIndex - delayB);
        outSample = sampleA * winA + sampleB * winB;
      }

      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = outSample;
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufSize;
    }
    return true;
  }

  readInterp(pos) {
    while (pos < 0) pos += this.bufSize;
    const idx0 = Math.floor(pos) % this.bufSize;
    const idx1 = (idx0 + 1) % this.bufSize;
    const frac = pos - Math.floor(pos);
    return this.buffer[idx0] * (1 - frac) + this.buffer[idx1] * frac;
  }
}
registerProcessor('granular-pitch-processor', GranularPitchProcessor);
`;

export const DEFAULT_VOICE_MOD_SETTINGS: VoiceModSettings = {
  enabled: true,
  pitchSemitones: -4.5,
  lowWeightDb: 7.5,
  driveDb: 6.0,
  presenceDb: 3.5,
  chamberPct: 42,
  effectMixPct: 88,
  outputTrimDb: 0.0,
};

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function makeDriveCurve(driveDb: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = Math.max(0.01, dbToLinear(driveDb) - 0.9);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    // Asymmetric warm ship-timber saturation
    curve[i] = x >= 0 ? Math.tanh(x * (1 + k * 1.6)) : Math.tanh(x * (1 + k * 2.1)) * 0.95;
  }
  return curve;
}

function createHauntedHullImpulse(ctx: AudioContext, durationSec = 1.85): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSec);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, 2.8);
      // Early wooden hull slapback reflections at ~38ms and ~79ms
      const earlyBoost =
        Math.abs(i - Math.floor(ctx.sampleRate * 0.038)) < 48 ||
        Math.abs(i - Math.floor(ctx.sampleRate * 0.079)) < 48
          ? 2.2
          : 1.0;
      const white = (Math.random() * 2 - 1) * env * earlyBoost;
      // Dark low-pass damping so chamber sounds like deep oak timber, not metallic tin
      lp = lp * 0.72 + white * 0.28;
      data[i] = lp;
    }
  }
  return impulse;
}

/**
 * Synthesizes an instant, expressive, gravelly pirate vocalization waveform in pure JS
 * when WebGPU TTS weights are not yet loaded or `web-speech-fallback` is selected,
 * guaranteeing zero-wait audio + 44-target mouth motion on first click!
 */
export function synthesizeInstantPiratePcm(
  text: string,
  mood: MoodTag,
  sampleRate = 24000,
): Float32Array {
  const words = text.split(/\s+/).filter(Boolean);
  const secPerWord = mood === 'weary' ? 0.38 : mood === 'irritated' ? 0.25 : 0.3;
  const durationSec = Math.max(0.75, Math.min(9.0, words.length * secPerWord + 0.25));
  const totalSamples = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(totalSamples);

  const baseF0 =
    mood === 'delighted'
      ? 118
      : mood === 'curious'
        ? 114
        : mood === 'menacing'
          ? 86
          : mood === 'weary'
            ? 90
            : 98;

  let phase0 = 0;
  let phaseF1 = 0;
  let phaseF2 = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const charIdx = Math.min(text.length - 1, Math.floor((i / totalSamples) * text.length));
    const ch = text[charIdx]?.toLowerCase() ?? 'a';

    // Syllable envelope modulated by spaces and punctuation
    const isPause = ch === ' ' || ch === ',' || ch === '.' || ch === '!' || ch === '?';
    const isSibilant = 'szfthc'.includes(ch);
    const f1 =
      ch === 'a' || ch === 'o'
        ? 680
        : ch === 'e' || ch === 'i'
          ? 440
          : ch === 'u'
            ? 340
            : 520;
    const f2 =
      ch === 'e' || ch === 'i'
        ? 2050
        : ch === 'u' || ch === 'o'
          ? 920
          : 1380;

    const sylRate = mood === 'irritated' ? 5.2 : 4.1;
    const syllableEnv = isPause
      ? 0.08
      : 0.45 + 0.55 * Math.max(0, Math.sin(t * Math.PI * 2 * sylRate));

    // Vocal fry / pirate growl subharmonic
    const inflection = 1 + 0.14 * Math.sin(t * 3.8) + (text.endsWith('?') ? (t / durationSec) * 0.22 : -0.08 * (t / durationSec));
    const f0 = baseF0 * inflection;

    phase0 += (2 * Math.PI * f0) / sampleRate;
    phaseF1 += (2 * Math.PI * f1) / sampleRate;
    phaseF2 += (2 * Math.PI * f2) / sampleRate;

    const glottal =
      Math.sin(phase0) * 0.52 +
      Math.sin(phase0 * 2) * 0.28 +
      Math.sin(phase0 * 0.5) * 0.18; // sub-octave pirate growl
    const formants = Math.sin(phaseF1) * 0.35 + Math.sin(phaseF2) * 0.16;
    const fricative = isSibilant ? (Math.random() * 2 - 1) * 0.26 : (Math.random() * 2 - 1) * 0.03;

    // Fade-in & fade-out
    const edgeFade = Math.min(1, i / (sampleRate * 0.03), (totalSamples - i) / (sampleRate * 0.06));
    out[i] = Math.tanh((glottal + formants + fricative) * syllableEnv * edgeFade * 0.85);
  }

  return out;
}

/**
 * Dual-Stream Synchronized Audio & Animation Router (`3_voice_pipeline.png`):
 * - Stream A (Clean Speech): Drives the 60 Hz 44-target ARKit blendshape timeline.
 * - Stream B (Audience Speech): Passes through the real-time WebAudio Voice Mod DSP chain
 *   with configurable `a2fSyncCompensationMs` (default 100ms) so mouth motion and treated
 *   demonic speaker output land together!
 * - Also powers `Microphone` ("Possession") Mode!
 */
export class DualStreamAudioRouter {
  private ctx: AudioContext | null = null;
  private workletReady = false;

  private inputGain!: GainNode;
  private dryGain!: GainNode;
  private wetGain!: GainNode;
  private pitchNode: AudioWorkletNode | null = null;
  private lowShelf!: BiquadFilterNode;
  private waveShaper!: WaveShaperNode;
  private presenceEq!: BiquadFilterNode;
  private chamberConvolver!: ConvolverNode;
  private chamberWetGain!: GainNode;
  private chamberDryGain!: GainNode;
  private outputTrim!: GainNode;

  private settings: VoiceModSettings = { ...DEFAULT_VOICE_MOD_SETTINGS };
  private a2fSyncCompensationMs = 100;
  private activeSource: AudioBufferSourceNode | null = null;
  private animRafId: number | null = null;
  private currentStopToken = 0;

  // Possession mode state
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micDelayNode: DelayNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micRafId: number | null = null;

  private onBlendshapeFrame: (weights: BlendshapeWeights, audioLevel: number) => void;

  constructor(
    onBlendshapeFrame: (weights: BlendshapeWeights, audioLevel: number) => void,
  ) {
    this.onBlendshapeFrame = onBlendshapeFrame;
  }

  async ensureInitialized(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return this.ctx;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // Use native hardware sampleRate (44.1/48 kHz) so Linux PipeWire/PulseAudio & AudioWorklet
    // never stall alongside getUserMedia capture; createBuffer(..., sampleRate) resamples cleanly.
    const ctx = new AudioCtx();
    this.ctx = ctx;

    try {
      const blob = new Blob([PITCH_SHIFTER_WORKLET_CODE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.workletReady = true;
    } catch {
      this.workletReady = false;
    }

    this.inputGain = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();

    this.lowShelf = ctx.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 115;

    this.waveShaper = ctx.createWaveShaper();
    this.waveShaper.oversample = '2x';

    this.presenceEq = ctx.createBiquadFilter();
    this.presenceEq.type = 'peaking';
    this.presenceEq.frequency.value = 2750;
    this.presenceEq.Q.value = 1.1;

    this.chamberConvolver = ctx.createConvolver();
    this.chamberConvolver.buffer = createHauntedHullImpulse(ctx);
    this.chamberWetGain = ctx.createGain();
    this.chamberDryGain = ctx.createGain();

    this.outputTrim = ctx.createGain();

    // Wire dry path
    this.inputGain.connect(this.dryGain);
    this.dryGain.connect(this.outputTrim);

    // Wire wet Demon/Pirate DSP chain
    let wetHead: AudioNode = this.inputGain;
    if (this.workletReady) {
      this.pitchNode = new AudioWorkletNode(ctx, 'granular-pitch-processor');
      this.inputGain.connect(this.pitchNode);
      wetHead = this.pitchNode;
    }

    wetHead.connect(this.lowShelf);
    this.lowShelf.connect(this.waveShaper);
    this.waveShaper.connect(this.presenceEq);

    // Chamber split
    this.presenceEq.connect(this.chamberDryGain);
    this.presenceEq.connect(this.chamberConvolver);
    this.chamberConvolver.connect(this.chamberWetGain);

    this.chamberDryGain.connect(this.wetGain);
    this.chamberWetGain.connect(this.wetGain);
    this.wetGain.connect(this.outputTrim);

    this.outputTrim.connect(ctx.destination);
    this.applyVoiceModSettings(this.settings);

    return ctx;
  }

  setSyncCompensationMs(ms: number): void {
    this.a2fSyncCompensationMs = Math.max(0, Math.min(500, ms));
  }

  applyVoiceModSettings(next: VoiceModSettings): void {
    this.settings = { ...next };
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    if (!next.enabled) {
      this.dryGain.gain.setTargetAtTime(1.0, now, 0.02);
      this.wetGain.gain.setTargetAtTime(0.0, now, 0.02);
      this.outputTrim.gain.setTargetAtTime(1.0, now, 0.02);
      return;
    }

    const mix = Math.max(0, Math.min(1, next.effectMixPct / 100));
    this.dryGain.gain.setTargetAtTime(1 - mix, now, 0.02);
    this.wetGain.gain.setTargetAtTime(mix, now, 0.02);

    if (this.pitchNode) {
      const param = this.pitchNode.parameters.get('pitchSemitones');
      param?.setTargetAtTime(next.pitchSemitones, now, 0.02);
    }

    this.lowShelf.gain.setTargetAtTime(next.lowWeightDb, now, 0.02);
    this.waveShaper.curve = makeDriveCurve(next.driveDb);
    this.presenceEq.gain.setTargetAtTime(next.presenceDb, now, 0.02);

    const chamber = Math.max(0, Math.min(1, next.chamberPct / 100));
    this.chamberDryGain.gain.setTargetAtTime(1 - chamber * 0.45, now, 0.02);
    this.chamberWetGain.gain.setTargetAtTime(chamber * 1.15, now, 0.02);

    this.outputTrim.gain.setTargetAtTime(dbToLinear(next.outputTrimDb), now, 0.02);
  }

  stopCurrentPlayback(): void {
    this.currentStopToken += 1;
    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch {
        // Ignore already-stopped AudioBufferSourceNode
      }
      this.activeSource = null;
    }
    if (this.animRafId !== null) {
      cancelAnimationFrame(this.animRafId);
      this.animRafId = null;
    }
    this.onBlendshapeFrame(createEmptyBlendshapes(), 0);
  }

  /**
   * Plays a clean speech PCM buffer + 60Hz blendshape curve in synchronized dual-stream mode.
   */
  async playSynchronizedPerformance(params: {
    pcmFloat32: Float32Array;
    sampleRate: number;
    frames60Hz: BlendshapeWeights[];
  }): Promise<void> {
    const ctx = await this.ensureInitialized();
    const token = ++this.currentStopToken;

    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // Ignore
      }
    }

    const { pcmFloat32, sampleRate, frames60Hz } = params;
    const audioBuf = ctx.createBuffer(1, pcmFloat32.length, sampleRate);
    audioBuf.getChannelData(0).set(pcmFloat32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(this.inputGain);
    this.activeSource = source;

    const syncDelaySec = this.a2fSyncCompensationMs / 1000;
    const startAudioAt = ctx.currentTime + Math.max(0.015, syncDelaySec);
    const animStartPerfMs = performance.now();

    return new Promise<void>((resolve) => {
      const tick = () => {
        if (token !== this.currentStopToken) {
          resolve();
          return;
        }
        const elapsedSec = (performance.now() - animStartPerfMs) / 1000;
        const frameIdx = Math.floor(elapsedSec * 60);
        if (frameIdx < frames60Hz.length) {
          const w = frames60Hz[frameIdx];
          this.onBlendshapeFrame(w, w.jawOpen ?? 0);
          this.animRafId = requestAnimationFrame(tick);
        } else {
          this.onBlendshapeFrame(createEmptyBlendshapes(), 0);
        }
      };

      this.animRafId = requestAnimationFrame(tick);

      source.onended = () => {
        if (this.activeSource === source) {
          this.activeSource = null;
        }
        if (this.animRafId !== null) {
          cancelAnimationFrame(this.animRafId);
          this.animRafId = null;
        }
        this.onBlendshapeFrame(createEmptyBlendshapes(), 0);
        resolve();
      };

      source.start(startAudioAt);
    });
  }

  async waitPause(ms: number, mood: MoodTag): Promise<void> {
    const token = this.currentStopToken;
    const idleFrames = solveAcousticBlendshapes60Hz(new Float32Array(240), 24000, mood);
    if (idleFrames[0]) {
      this.onBlendshapeFrame(idleFrames[0], 0);
    }
    await new Promise<void>((r) => setTimeout(r, ms));
    if (token !== this.currentStopToken) return;
  }

  /**
   * Starts "Possession" (Microphone) mode: clean live voice drives the 44 mouth shapes
   * immediately while Audience speakers hear the Voice Mod treated stream after `delayMs`.
   */
  async startPossessionMode(delayMs: number, mood: MoodTag): Promise<void> {
    await this.stopPossessionMode();
    const ctx = await this.ensureInitialized();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.micStream = stream;
    this.micSource = ctx.createMediaStreamSource(stream);
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;

    this.micDelayNode = ctx.createDelay(3.0);
    this.micDelayNode.delayTime.value = Math.max(0, Math.min(2.5, delayMs / 1000));

    // Clean stream -> analyser (for mouth shapes)
    this.micSource.connect(this.micAnalyser);
    // Delayed stream -> Voice Mod DSP -> Audience speakers
    this.micSource.connect(this.micDelayNode);
    this.micDelayNode.connect(this.inputGain);

    const pcmWindow = new Float32Array(this.micAnalyser.fftSize);
    const loop = () => {
      if (!this.micAnalyser) return;
      this.micAnalyser.getFloatTimeDomainData(pcmWindow);
      const solved = solveAcousticBlendshapes60Hz(pcmWindow, ctx.sampleRate, mood);
      if (solved[0]) {
        this.onBlendshapeFrame(solved[0], solved[0].jawOpen ?? 0);
      }
      this.micRafId = requestAnimationFrame(loop);
    };
    this.micRafId = requestAnimationFrame(loop);
  }

  updatePossessionDelay(delayMs: number): void {
    if (this.micDelayNode && this.ctx) {
      this.micDelayNode.delayTime.setTargetAtTime(
        Math.max(0, Math.min(2.5, delayMs / 1000)),
        this.ctx.currentTime,
        0.03,
      );
    }
  }

  async stopPossessionMode(): Promise<void> {
    if (this.micRafId !== null) {
      cancelAnimationFrame(this.micRafId);
      this.micRafId = null;
    }
    this.micSource?.disconnect();
    this.micDelayNode?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource = null;
    this.micDelayNode = null;
    this.micAnalyser = null;
    this.micStream = null;
    this.onBlendshapeFrame(createEmptyBlendshapes(), 0);
  }
}
