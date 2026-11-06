export interface WebGpuProbeResult {
  hasHardwareWebGpu: boolean;
  hasSoftwareWebGpu: boolean;
  hasShaderF16: boolean;
  device: 'webgpu' | 'wasm';
  dtype: 'q4f16' | 'q4';
  adapterSummary: string;
}

interface GpuAdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}

interface GpuAdapterLike {
  info?: GpuAdapterInfoLike;
  isFallbackAdapter?: boolean;
  features?: { has?: (feature: string) => boolean };
  limits?: { maxBufferSize?: number };
  requestAdapterInfo?: () => Promise<GpuAdapterInfoLike>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      globalThis.setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

/**
 * Probes `navigator.gpu` safely in either the Main Thread or a Web Worker.
 * Distinguishes true hardware WebGPU adapters (Metal / Vulkan / D3D12) from
 * Dawn's software SwiftShader / llvmpipe fallback adapters, which lack `shader-f16`
 * and fail `mappedAtCreation` buffer allocations in Three.js & ONNX Runtime Web.
 */
export async function probeOptimalWebGpuDevice(timeoutMs = 600): Promise<WebGpuProbeResult> {
  const nav = globalThis.navigator as unknown as {
    gpu?: {
      requestAdapter?: (opts?: { powerPreference?: string }) => Promise<GpuAdapterLike | null>;
    };
  };

  if (!nav?.gpu?.requestAdapter) {
    return {
      hasHardwareWebGpu: false,
      hasSoftwareWebGpu: false,
      hasShaderF16: false,
      device: 'wasm',
      dtype: 'q4',
      adapterSummary: 'WebGPU unavailable — SIMD WASM + WebGL2 active',
    };
  }

  const adapter = await withTimeout(
    nav.gpu.requestAdapter({ powerPreference: 'high-performance' }),
    timeoutMs,
    null,
  );

  if (!adapter) {
    return {
      hasHardwareWebGpu: false,
      hasSoftwareWebGpu: false,
      hasShaderF16: false,
      device: 'wasm',
      dtype: 'q4',
      adapterSummary: 'No WebGPU adapter — SIMD WASM + WebGL2 active',
    };
  }

  let info: GpuAdapterInfoLike = adapter.info ?? {};
  if (!info.vendor && !info.architecture && typeof adapter.requestAdapterInfo === 'function') {
    info = await withTimeout(adapter.requestAdapterInfo(), 250, info);
  }

  const vendor = (info.vendor ?? '').toLowerCase();
  const arch = (info.architecture ?? '').toLowerCase();
  const desc = (info.description ?? '').toLowerCase();
  const dev = (info.device ?? '').toLowerCase();

  const isSoftware =
    Boolean(adapter.isFallbackAdapter) ||
    Boolean(info.isFallbackAdapter) ||
    arch.includes('swiftshader') ||
    desc.includes('swiftshader') ||
    dev.includes('swiftshader') ||
    desc.includes('llvmpipe') ||
    (vendor === 'google' && (arch === 'swiftshader' || desc.includes('angle')));

  const hasShaderF16 = !isSoftware && Boolean(adapter.features?.has?.('shader-f16'));

  if (isSoftware) {
    return {
      hasHardwareWebGpu: false,
      hasSoftwareWebGpu: true,
      hasShaderF16: false,
      device: 'wasm',
      dtype: 'q4',
      adapterSummary: 'Software GPU (SwiftShader) — WebGL2 TSL + SIMD WASM active',
    };
  }

  const label = info.description || info.device || info.vendor || info.architecture || 'Hardware WebGPU';
  const maxBufGib = adapter.limits?.maxBufferSize
    ? `${(adapter.limits.maxBufferSize / 1024 ** 3).toFixed(1)} GiB max buffer`
    : hasShaderF16
      ? 'shader-f16 active'
      : 'q4 active';

  return {
    hasHardwareWebGpu: true,
    hasSoftwareWebGpu: false,
    hasShaderF16,
    device: 'webgpu',
    dtype: hasShaderF16 ? 'q4f16' : 'q4',
    adapterSummary: `${label} (${maxBufGib}${hasShaderF16 ? ', FP16' : ''})`,
  };
}

export function resolveWorkerDtype(
  requested: 'q4f16' | 'q4' | 'fp16',
  caps: WebGpuProbeResult,
): 'q4f16' | 'q4' | 'fp16' {
  if (!caps.hasHardwareWebGpu || !caps.hasShaderF16) {
    return 'q4';
  }
  return requested;
}
