import { afterEach, describe, expect, it } from 'vitest';
import {
  probeOptimalWebGpuDevice,
  resolveWorkerDtype,
} from '../src/ai/webgpuCapabilities';
import { EncounterController } from '../src/orchestrator/EncounterController';

describe('WebGPU Hardware vs Software Adapter Detection & Store Sync', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('selects hardware webgpu + q4f16 when discrete/integrated GPU supports shader-f16', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter: async () => ({
            info: { vendor: 'nvidia', architecture: 'blackwell', description: 'NVIDIA RTX 5080' },
            features: new Set(['shader-f16']),
            limits: { maxBufferSize: 4 * 1024 ** 3 },
          }),
        },
      },
      configurable: true,
    });

    const caps = await probeOptimalWebGpuDevice();
    expect(caps.hasHardwareWebGpu).toBe(true);
    expect(caps.hasShaderF16).toBe(true);
    expect(caps.device).toBe('webgpu');
    expect(caps.dtype).toBe('q4f16');
    expect(resolveWorkerDtype('q4f16', caps)).toBe('q4f16');
  });

  it('downgrades dtype to q4 on hardware WebGPU without shader-f16', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter: async () => ({
            info: { vendor: 'intel', architecture: 'gen-12lp', description: 'Intel Iris Xe' },
            features: new Set<string>(),
          }),
        },
      },
      configurable: true,
    });

    const caps = await probeOptimalWebGpuDevice();
    expect(caps.hasHardwareWebGpu).toBe(true);
    expect(caps.hasShaderF16).toBe(false);
    expect(caps.device).toBe('webgpu');
    expect(caps.dtype).toBe('q4');
    expect(resolveWorkerDtype('q4f16', caps)).toBe('q4');
  });

  it('falls back to SIMD wasm + WebGL2 when Dawn returns a software SwiftShader adapter', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter: async () => ({
            info: { vendor: 'google', architecture: 'swiftshader', description: 'Google SwiftShader' },
            features: new Set<string>(),
          }),
        },
      },
      configurable: true,
    });

    const caps = await probeOptimalWebGpuDevice();
    expect(caps.hasHardwareWebGpu).toBe(false);
    expect(caps.hasSoftwareWebGpu).toBe(true);
    expect(caps.device).toBe('wasm');
    expect(caps.dtype).toBe('q4');
  });

  it('preserves manual Toss Candy count across subsequent EncounterController evaluations', () => {
    const ctrl = new EncounterController();
    expect(ctrl.recordManualCandyDispense()).toBe(1);
    const refusal = ctrl.evaluateVisitorTurn({
      transcript: 'Give me candy!',
      houseMode: 'live',
      useCachedResponses: true,
      useCharacterAdapter: true,
      systemPrompt: 'Pirate house',
      recentHistory: [],
      visitors: [],
    });
    expect(refusal.nextState).toBe('FirstRefusal');
    expect(ctrl.getCandyDispensedCount()).toBe(1);

    const givingIn = ctrl.evaluateVisitorTurn({
      transcript: 'May I please have candy?',
      houseMode: 'live',
      useCachedResponses: true,
      useCharacterAdapter: true,
      systemPrompt: 'Pirate house',
      recentHistory: [],
      visitors: [],
    });
    expect(givingIn.nextState).toBe('GivingIn');
    expect(givingIn.dispenseCandy).toBe(true);
    expect(ctrl.getCandyDispensedCount()).toBe(2);
  });
});
