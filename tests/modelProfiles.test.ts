import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_ID,
  FEATURED_PROFILES,
  MODEL_PROFILES,
  PROFILE_DROPDOWN_ORDER,
} from '../src/ai/modelRegistry';
import { useMonsterStore } from '../src/store/useMonsterStore';

describe('WebGPU Model Profiles (Profile C Default, Profile B Co-Primary, Profile A Dropdown)', () => {
  it('defaults to Profile C (lfm3-omni) for fastest WebGPU startup & lowest VRAM', () => {
    expect(DEFAULT_PROFILE_ID).toBe('lfm3-omni');
    expect(useMonsterStore.getState().selectedProfileId).toBe('lfm3-omni');
    expect(MODEL_PROFILES['lfm3-omni'].codeLabel).toBe('Profile C');
    expect(MODEL_PROFILES['lfm3-omni'].tier).toBe('default-c');
    expect(MODEL_PROFILES['lfm3-omni'].models.brain.repoId).toBe('onnx-community/LFM3-VL-2B-ONNX');
  });

  it('features only Profile C and Profile B in primary UI cards while keeping Profile A in dropdown', () => {
    expect(FEATURED_PROFILES).toEqual(['lfm3-omni', 'gemma4-omni']);
    expect(PROFILE_DROPDOWN_ORDER).toEqual([
      'lfm3-omni',
      'gemma4-omni',
      'nvidia-bolt-flagship',
    ]);

    expect(MODEL_PROFILES['lfm3-omni'].dropdownOnly).toBe(false);
    expect(MODEL_PROFILES['gemma4-omni'].dropdownOnly).toBe(false);
    expect(MODEL_PROFILES['nvidia-bolt-flagship'].dropdownOnly).toBe(true);
    expect(MODEL_PROFILES['nvidia-bolt-flagship'].codeLabel).toBe('Profile A');
  });

  it('ensures Profile C has strictly smaller weight & VRAM footprint than Profile B and Profile A', () => {
    const c = MODEL_PROFILES['lfm3-omni'];
    const b = MODEL_PROFILES['gemma4-omni'];
    const a = MODEL_PROFILES['nvidia-bolt-flagship'];

    expect(c.models.brain.sizeMb).toBeLessThan(b.models.brain.sizeMb);
    expect(b.models.brain.sizeMb).toBeLessThan(a.models.brain.sizeMb);
    expect(c.estimatedVramGb).toBeLessThan(b.estimatedVramGb);
    expect(b.estimatedVramGb).toBeLessThan(a.estimatedVramGb);

    // Both primary profiles share their vision encoder with 0 extra vision VRAM
    expect(c.models.visionObserver.sharedWithBrain).toBe(true);
    expect(b.models.visionObserver.sharedWithBrain).toBe(true);
    // Profile B shares its native 16kHz audio encoder with 0 extra ASR download
    expect(b.models.brain.supportsAudioIn).toBe(true);
    expect(b.models.asr.mode).toBe('omni-audio');
  });
});
