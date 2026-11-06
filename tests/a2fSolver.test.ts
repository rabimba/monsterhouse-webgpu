import { describe, expect, it } from 'vitest';
import {
  applyBlendshapeMultipliers,
  createDefaultMultipliers,
  createEmptyBlendshapes,
  moodToAudio2FaceEmotionVector,
  solveAcousticBlendshapes60Hz,
} from '../src/ai/a2fSolver';
import {
  ACTIVE_44_SOUND_TARGETS,
  ALL_MOODS,
  ARKIT_52_BLENDSHAPES,
  BS_SOLVE_ACTIVE_MASK,
} from '../src/types/monster';

describe('Audio2Face-3D 44-Target Solver & Emotion Vector Mapping', () => {
  it('enforces exact 44 active sound targets out of 52 ARKit poses (matching bs_skin_config.json)', () => {
    expect(ARKIT_52_BLENDSHAPES).toHaveLength(52);
    expect(BS_SOLVE_ACTIVE_MASK).toHaveLength(52);
    const activeSum = BS_SOLVE_ACTIVE_MASK.reduce((acc, v) => acc + v, 0);
    expect(activeSum).toBe(44);
    expect(ACTIVE_44_SOUND_TARGETS).toHaveLength(44);
  });

  it('produces valid 26-float Audio2Face emotion vectors for all 7 MonsterHouse moods', () => {
    for (const mood of ALL_MOODS) {
      const vec = moodToAudio2FaceEmotionVector(mood);
      expect(vec).toHaveLength(26);
      const maxExplicit = Math.max(...Array.from(vec.subarray(16)));
      expect(maxExplicit).toBeGreaterThan(0.5);
    }
  });

  it('masks out inactive eye poses and clamps scaled weights to [0.0, 1.0]', () => {
    const raw = createEmptyBlendshapes();
    raw.jawOpen = 0.8;
    raw.eyeBlinkLeft = 0.95; // Inactive on eyeless house!

    const mults = createDefaultMultipliers();
    mults.jawOpen = 1.6; // 0.8 * 1.6 = 1.28 -> clamped to 1.0

    const out = applyBlendshapeMultipliers(raw, mults);
    expect(out.jawOpen).toBe(1.0);
    expect(out.eyeBlinkLeft).toBe(0);
  });

  it('solves 60Hz blendshape curves from clean speech PCM with bounded non-NaN weights', () => {
    const sampleRate = 16000;
    const durationSec = 0.5;
    const pcm = new Float32Array(sampleRate * durationSec);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sampleRate;
      const env = Math.sin(Math.PI * (t / durationSec));
      pcm[i] = Math.sin(2 * Math.PI * 140 * t) * 0.45 * env;
    }

    const frames = solveAcousticBlendshapes60Hz(pcm, sampleRate, 'menacing');
    expect(frames.length).toBeGreaterThanOrEqual(29);
    expect(frames.length).toBeLessThanOrEqual(31);

    let peakJaw = 0;
    for (const frame of frames) {
      for (const name of ARKIT_52_BLENDSHAPES) {
        expect(Number.isNaN(frame[name])).toBe(false);
        expect(frame[name]).toBeGreaterThanOrEqual(0);
        expect(frame[name]).toBeLessThanOrEqual(1);
      }
      peakJaw = Math.max(peakJaw, frame.jawOpen);
    }
    expect(peakJaw).toBeGreaterThan(0.25);
  });
});
