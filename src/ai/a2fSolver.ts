import {
  ARKIT_52_BLENDSHAPES,
  BS_SOLVE_ACTIVE_MASK,
  type BlendshapeName,
  type BlendshapeWeights,
  type MoodTag,
} from '../types/monster';

/**
 * Creates a zeroed 52-pose ARKit blendshape weight map.
 */
export function createEmptyBlendshapes(): BlendshapeWeights {
  const weights = {} as BlendshapeWeights;
  for (const name of ARKIT_52_BLENDSHAPES) {
    weights[name] = 0;
  }
  return weights;
}

/**
 * Creates default 1.0x user multipliers for all 52 ARKit shapes
 * (matching the Control Desk right sidebar defaults: jawOpen 0.85, mouthClose 0.5, etc. customizable).
 */
export function createDefaultMultipliers(): BlendshapeWeights {
  const mults = {} as BlendshapeWeights;
  for (let i = 0; i < ARKIT_52_BLENDSHAPES.length; i++) {
    const name = ARKIT_52_BLENDSHAPES[i];
    mults[name] = BS_SOLVE_ACTIVE_MASK[i] === 1 ? 1.0 : 0.0;
  }
  return mults;
}

/**
 * NVIDIA Audio2Face-3D v2.3 Mark takes a [batch, 1, 26] emotion tensor:
 * - First 16 floats: implicit emotion latent (0.0 neutral baseline)
 * - Next 10 floats: explicit emotions in exact network_info.json order:
 *   [amazement, anger, cheekiness, disgust, fear, grief, joy, outofbreath, pain, sadness]
 */
export function moodToAudio2FaceEmotionVector(mood: MoodTag): Float32Array {
  const vec = new Float32Array(26);
  // Explicit emotion indices start at offset 16
  const AMAZEMENT = 16;
  const ANGER = 17;
  const CHEEKINESS = 18;
  const DISGUST = 19;
  const JOY = 22;
  const OUTOFBREATH = 23;
  const SADNESS = 25;

  switch (mood) {
    case 'grumpy':
      vec[ANGER] = 0.65;
      vec[DISGUST] = 0.45;
      break;
    case 'irritated':
      vec[ANGER] = 0.85;
      vec[DISGUST] = 0.35;
      break;
    case 'menacing':
      vec[ANGER] = 0.9;
      vec[CHEEKINESS] = 0.55;
      break;
    case 'amused':
      vec[CHEEKINESS] = 0.75;
      vec[JOY] = 0.55;
      break;
    case 'curious':
      vec[AMAZEMENT] = 0.75;
      vec[CHEEKINESS] = 0.25;
      break;
    case 'delighted':
      vec[JOY] = 0.92;
      vec[AMAZEMENT] = 0.45;
      break;
    case 'weary':
      vec[OUTOFBREATH] = 0.7;
      vec[SADNESS] = 0.55;
      break;
  }
  return vec;
}

/**
 * Applies MonsterHouse mood expression baselines onto the 44 active sound targets
 * so the splintered pirate mouth holds expressive snarls, grins, or weary droops
 * both during speech and between syllables.
 */
export function applyMoodExpressionBaseline(
  target: BlendshapeWeights,
  mood: MoodTag,
  intensity = 1.0,
): void {
  const k = Math.max(0, Math.min(1.5, intensity));
  switch (mood) {
    case 'grumpy':
      target.mouthFrownLeft = Math.max(target.mouthFrownLeft, 0.48 * k);
      target.mouthFrownRight = Math.max(target.mouthFrownRight, 0.38 * k);
      target.noseSneerLeft = Math.max(target.noseSneerLeft, 0.35 * k);
      target.jawLeft = Math.max(target.jawLeft, 0.14 * k);
      target.browDownLeft = Math.max(target.browDownLeft, 0.55 * k);
      target.browDownRight = Math.max(target.browDownRight, 0.55 * k);
      break;
    case 'irritated':
      target.mouthUpperUpLeft = Math.max(target.mouthUpperUpLeft, 0.42 * k);
      target.noseSneerLeft = Math.max(target.noseSneerLeft, 0.52 * k);
      target.noseSneerRight = Math.max(target.noseSneerRight, 0.35 * k);
      target.mouthFrownLeft = Math.max(target.mouthFrownLeft, 0.4 * k);
      target.mouthFrownRight = Math.max(target.mouthFrownRight, 0.45 * k);
      target.jawClench = Math.max(target.jawClench, 0.3 * k);
      break;
    case 'menacing':
      target.mouthUpperUpLeft = Math.max(target.mouthUpperUpLeft, 0.55 * k);
      target.mouthUpperUpRight = Math.max(target.mouthUpperUpRight, 0.55 * k);
      target.mouthLowerDownLeft = Math.max(target.mouthLowerDownLeft, 0.42 * k);
      target.mouthLowerDownRight = Math.max(target.mouthLowerDownRight, 0.42 * k);
      target.mouthStretchLeft = Math.max(target.mouthStretchLeft, 0.38 * k);
      target.mouthStretchRight = Math.max(target.mouthStretchRight, 0.38 * k);
      target.jawForward = Math.max(target.jawForward, 0.35 * k);
      break;
    case 'amused':
      target.mouthSmileLeft = Math.max(target.mouthSmileLeft, 0.58 * k);
      target.mouthSmileRight = Math.max(target.mouthSmileRight, 0.36 * k); // Asymmetric pirate smirk
      target.mouthDimpleLeft = Math.max(target.mouthDimpleLeft, 0.35 * k);
      target.cheekSquintLeft = Math.max(target.cheekSquintLeft, 0.4 * k);
      break;
    case 'curious':
      target.mouthPucker = Math.max(target.mouthPucker, 0.28 * k);
      target.jawRight = Math.max(target.jawRight, 0.16 * k);
      target.browInnerUp = Math.max(target.browInnerUp, 0.55 * k);
      target.browOuterUpRight = Math.max(target.browOuterUpRight, 0.45 * k);
      break;
    case 'delighted':
      target.mouthSmileLeft = Math.max(target.mouthSmileLeft, 0.76 * k);
      target.mouthSmileRight = Math.max(target.mouthSmileRight, 0.74 * k);
      target.cheekSquintLeft = Math.max(target.cheekSquintLeft, 0.55 * k);
      target.cheekSquintRight = Math.max(target.cheekSquintRight, 0.55 * k);
      target.browInnerUp = Math.max(target.browInnerUp, 0.35 * k);
      break;
    case 'weary':
      target.mouthFrownLeft = Math.max(target.mouthFrownLeft, 0.52 * k);
      target.mouthFrownRight = Math.max(target.mouthFrownRight, 0.52 * k);
      target.mouthRollLower = Math.max(target.mouthRollLower, 0.32 * k);
      target.mouthShrugLower = Math.max(target.mouthShrugLower, 0.28 * k);
      break;
  }
}

/**
 * Applies the Control Desk's per-shape user multipliers (0x .. 2x), enforces the 44-active-target
 * mask from `bs_skin_config.json`, and clamps final weights to [0.0, 1.0].
 */
export function applyBlendshapeMultipliers(
  raw: BlendshapeWeights,
  multipliers: BlendshapeWeights,
): BlendshapeWeights {
  const out = createEmptyBlendshapes();
  for (let i = 0; i < ARKIT_52_BLENDSHAPES.length; i++) {
    const name: BlendshapeName = ARKIT_52_BLENDSHAPES[i];
    if (BS_SOLVE_ACTIVE_MASK[i] === 0) {
      out[name] = 0;
      continue;
    }
    const val = (raw[name] ?? 0) * (multipliers[name] ?? 1.0);
    out[name] = Math.max(0, Math.min(1.0, val));
  }
  return out;
}

/**
 * High-precision offline/streaming 60 Hz Acoustic Formant + Plosive Viseme Solver.
 * Analyzes clean speech PCM at 60 FPS using zero-crossing rate, RMS envelope, low-band F1
 * jaw energy, mid-band F2 spread energy, and high-band fricative energy to drive all 44 active
 * ARKit sound targets smoothly.
 */
export function solveAcousticBlendshapes60Hz(
  pcm: Float32Array,
  sampleRate: number,
  mood: MoodTag,
): BlendshapeWeights[] {
  const fps = 60;
  const hopSamples = Math.max(1, Math.round(sampleRate / fps));
  const winSamples = Math.max(hopSamples * 2, Math.round(sampleRate * 0.032));
  const numFrames = Math.max(1, Math.ceil(pcm.length / hopSamples));
  const frames: BlendshapeWeights[] = [];

  let prevJaw = 0;
  let prevFunnel = 0;
  let prevPucker = 0;
  let prevStretch = 0;
  let prevUpperUp = 0;
  let prevRms = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSamples;
    const end = Math.min(pcm.length, start + winSamples);
    const len = end - start;
    const weights = createEmptyBlendshapes();

    if (len > 8) {
      let sumSq = 0;
      let diffSq = 0;
      let zeroCrossings = 0;
      let lowPass = 0;
      let lowPassSq = 0;
      const alphaLow = Math.min(0.95, (2 * Math.PI * 650) / sampleRate);

      for (let i = start; i < end; i++) {
        const s = pcm[i];
        sumSq += s * s;
        lowPass += alphaLow * (s - lowPass);
        lowPassSq += lowPass * lowPass;
        if (i > start) {
          const prev = pcm[i - 1];
          const d = s - prev;
          diffSq += d * d;
          if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) {
            zeroCrossings += 1;
          }
        }
      }

      const rms = Math.sqrt(sumSq / len);
      const lowRms = Math.sqrt(lowPassSq / len);
      const highRms = Math.sqrt(diffSq / len);
      const zcr = (zeroCrossings / len) * (sampleRate / 16000);

      const voicedEnergy = Math.min(1, rms * 5.2);
      const f1Open = Math.min(1, lowRms * 6.8);
      const highRatio = rms > 0.004 ? Math.min(1, highRms / (rms * 1.45)) : 0;
      const plosiveAttack = Math.max(0, Math.min(1, (rms - prevRms) * 14));
      prevRms = rms;

      // Jaw open driven by F1 open-vowel energy, damped during high-ZCR sibilants (S/SH/F/TH)
      const sibilantDamp = zcr > 0.22 ? 0.42 : 1.0;
      const targetJaw = Math.min(1, f1Open * 0.92 * sibilantDamp + plosiveAttack * 0.18);
      // Funnel ("OO", "SH", "CH", "R") when rounded/mid-high spectrum
      const targetFunnel =
        voicedEnergy > 0.08
          ? Math.min(1, (1 - Math.abs(highRatio - 0.45) * 1.8) * voicedEnergy * 0.85)
          : 0;
      // Pucker ("W", "OO", "U") when heavily low-frequency dominant
      const targetPucker =
        voicedEnergy > 0.08 && zcr < 0.09 ? Math.min(1, (lowRms / (rms + 1e-4)) * voicedEnergy * 0.72) : 0;
      // Wide stretch ("EE", "IH", "AE", "S") when mid-high ZCR + strong voiced/sibilant energy
      const targetStretch = zcr > 0.14 ? Math.min(1, highRatio * voicedEnergy * 0.9) : 0;
      // Lip press / close on plosive onset ("B", "P", "M")
      const targetClose = plosiveAttack > 0.25 && targetJaw < 0.35 ? plosiveAttack * 0.75 : 0;
      const targetUpperUp = Math.min(1, voicedEnergy * 0.48 + plosiveAttack * 0.25);

      // Temporal smoothing matching Audio2Face strengthTemporalSmoothing = 0.3
      prevJaw = prevJaw * 0.52 + targetJaw * 0.48;
      prevFunnel = prevFunnel * 0.6 + Math.max(0, targetFunnel) * 0.4;
      prevPucker = prevPucker * 0.62 + Math.max(0, targetPucker) * 0.38;
      prevStretch = prevStretch * 0.58 + Math.max(0, targetStretch) * 0.42;
      prevUpperUp = prevUpperUp * 0.55 + targetUpperUp * 0.45;

      weights.jawOpen = prevJaw;
      weights.jawForward = prevJaw * 0.22 + prevFunnel * 0.18;
      weights.mouthClose = targetClose;
      weights.mouthPressLeft = targetClose * 0.7;
      weights.mouthPressRight = targetClose * 0.7;
      weights.mouthFunnel = prevFunnel;
      weights.mouthPucker = prevPucker;
      weights.mouthStretchLeft = prevStretch;
      weights.mouthStretchRight = prevStretch;
      weights.mouthUpperUpLeft = prevUpperUp;
      weights.mouthUpperUpRight = prevUpperUp * 0.92;
      weights.mouthLowerDownLeft = prevJaw * 0.65;
      weights.mouthLowerDownRight = prevJaw * 0.65;
      weights.mouthRollLower = prevPucker * 0.35;
      weights.mouthRollUpper = prevPucker * 0.3;
      weights.mouthShrugUpper = plosiveAttack * 0.35;
      weights.cheekPuff = plosiveAttack * 0.22;
      weights.tongueOut = prevJaw > 0.55 && zcr > 0.12 ? (prevJaw - 0.5) * 0.45 : 0;

      // Subtle nautical jaw swagger during loud syllables
      const cadenceWave = Math.sin(f * 0.21);
      weights.jawLeft = cadenceWave > 0 ? cadenceWave * prevJaw * 0.18 : 0;
      weights.jawRight = cadenceWave < 0 ? -cadenceWave * prevJaw * 0.18 : 0;
    } else {
      prevJaw *= 0.7;
      weights.jawOpen = prevJaw;
    }

    applyMoodExpressionBaseline(weights, mood, 0.75 + weights.jawOpen * 0.35);
    frames.push(weights);
  }

  return frames;
}

/**
 * Projects raw NVIDIA Audio2Face-3D v2.3 Mark `network.onnx` output tensor ([B, 301] geometry/PCA
 * activations: 272 skin + 10 tongue + 15 jaw + 4 eyes) onto the 44 active ARKit sound targets,
 * blended with acoustic envelope precision.
 */
export function projectNvidiaA2fOutputToBlendshapes(
  rawOutput: Float32Array,
  mood: MoodTag,
  acousticAnchor?: BlendshapeWeights,
): BlendshapeWeights {
  const weights = acousticAnchor ? { ...acousticAnchor } : createEmptyBlendshapes();
  if (rawOutput.length < 290) {
    applyMoodExpressionBaseline(weights, mood, 0.85);
    return weights;
  }

  // Extract jaw (offset 282..296) and primary lower-face PCA components (0..64)
  const jawSlice = rawOutput.subarray(282, 297);
  let jawMag = 0;
  for (let i = 0; i < jawSlice.length; i++) {
    jawMag += Math.abs(jawSlice[i]);
  }
  const normalizedJaw = Math.min(1, jawMag / 4.5);

  const skinEnergy = (idx: number, scale = 0.35): number =>
    Math.max(0, Math.min(1, Math.abs(rawOutput[idx] ?? 0) * scale));

  weights.jawOpen = Math.min(1, weights.jawOpen * 0.45 + normalizedJaw * 0.75);
  weights.jawForward = Math.min(1, Math.max(weights.jawForward, skinEnergy(4, 0.3)));
  weights.jawLeft = Math.min(1, Math.max(weights.jawLeft, rawOutput[283] > 0 ? rawOutput[283] * 0.25 : 0));
  weights.jawRight = Math.min(1, Math.max(weights.jawRight, rawOutput[283] < 0 ? -rawOutput[283] * 0.25 : 0));
  weights.mouthFunnel = Math.min(1, weights.mouthFunnel * 0.5 + skinEnergy(1, 0.42) * 0.5);
  weights.mouthPucker = Math.min(1, weights.mouthPucker * 0.5 + skinEnergy(2, 0.42) * 0.5);
  weights.mouthStretchLeft = Math.min(1, weights.mouthStretchLeft * 0.5 + skinEnergy(3, 0.38) * 0.5);
  weights.mouthStretchRight = Math.min(1, weights.mouthStretchRight * 0.5 + skinEnergy(3, 0.38) * 0.5);
  weights.mouthUpperUpLeft = Math.min(1, weights.mouthUpperUpLeft * 0.5 + skinEnergy(5, 0.4) * 0.5);
  weights.mouthUpperUpRight = Math.min(1, weights.mouthUpperUpRight * 0.5 + skinEnergy(6, 0.4) * 0.5);
  weights.mouthLowerDownLeft = Math.min(1, weights.mouthLowerDownLeft * 0.5 + skinEnergy(7, 0.42) * 0.5);
  weights.mouthLowerDownRight = Math.min(1, weights.mouthLowerDownRight * 0.5 + skinEnergy(8, 0.42) * 0.5);

  applyMoodExpressionBaseline(weights, mood, 0.8);
  return weights;
}

/**
 * Resamples arbitrary PCM audio to 16 kHz mono Float32Array (required by NVIDIA Audio2Face & Nemotron ASR).
 */
export function resampleLinearPcm(
  input: Float32Array,
  fromRate: number,
  toRate = 16000,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = srcIdx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
