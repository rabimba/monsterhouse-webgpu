export interface TransformersProgressEvent {
  status?: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface SmoothProgressSnapshot {
  progressPct: number;
  loadedMb: number;
  totalMb: number;
  speedMbPerSec: number;
  etaSec: number | null;
  detail: string;
}

export interface ProgressTrackerOptions {
  throttleMs?: number;
  /** Expected total repo weight size in MB so tiny early header files never spike progress to 100% */
  expectedTotalMb?: number;
}

/**
 * Aggregates multi-file `@huggingface/transformers` download callbacks into a single
 * monotonic, non-flickering byte progress stream with rolling MB/s & ETA.
 *
 * Fixes three real-world WebGPU model loading issues:
 * 1. `@huggingface/transformers` v4 `DefaultProgressCallback` emits BOTH `status: "progress_total"`
 *    (no `file`) AND `status: "progress"` (per-file) on every 16–64 KB stream chunk, which otherwise
 *    causes UI labels and percentages to flicker rapidly between concurrent files.
 * 2. Small `.onnx` graph header files (200 KB) finish before 1 GB `.onnx_data` blobs receive their
 *    `Content-Length` header; `expectedTotalMb` prevents premature 100% spikes.
 * 3. Throttles `postMessage` to 5 Hz (`200 ms`) instead of ~40,000 chunk events per GB.
 */
export function createSmoothProgressTracker(
  modelLabel: string,
  onUpdate: (snapshot: SmoothProgressSnapshot) => void,
  options: ProgressTrackerOptions = {},
): (info: TransformersProgressEvent) => void {
  const throttleMs = options.throttleMs ?? 200;
  const expectedTotalBytes = (options.expectedTotalMb ?? 0) * 1024 * 1024;
  const fileBytes = new Map<string, { loaded: number; total: number }>();
  let firstByteAtMs = 0;
  let lastEmitMs = 0;
  let maxPctSeen = 0.5;

  return (info: TransformersProgressEvent) => {
    if (!info || info.status === 'progress_total') {
      return;
    }

    if (
      info.status === 'progress' &&
      info.file &&
      typeof info.loaded === 'number' &&
      typeof info.total === 'number' &&
      info.total > 0
    ) {
      // Track ONNX graph & external weight data files (skip tiny JSON metadata)
      if (!info.file.includes('onnx') && info.total < 1_000_000) {
        return;
      }

      const now = performance.now();
      if (firstByteAtMs === 0 && info.loaded > 0) {
        firstByteAtMs = now;
      }

      const prev = fileBytes.get(info.file);
      fileBytes.set(info.file, {
        loaded: Math.max(prev?.loaded ?? 0, info.loaded),
        total: Math.max(prev?.total ?? 0, info.total),
      });

      let sumLoaded = 0;
      let sumTotal = 0;
      for (const entry of fileBytes.values()) {
        sumLoaded += entry.loaded;
        sumTotal += entry.total;
      }

      const denomBytes = Math.max(sumTotal, expectedTotalBytes);
      if (denomBytes <= 0) return;

      const allKnownFilesComplete =
        sumLoaded >= sumTotal && sumTotal >= expectedTotalBytes * 0.85;

      if (!allKnownFilesComplete && now - lastEmitMs < throttleMs) {
        return;
      }
      lastEmitMs = now;

      const rawPct = (sumLoaded / denomBytes) * 100;
      const clampedPct = Math.min(97.9, Math.max(maxPctSeen, Math.round(rawPct * 10) / 10));
      maxPctSeen = clampedPct;

      const loadedMb = sumLoaded / (1024 * 1024);
      const totalMb = denomBytes / (1024 * 1024);
      const transferSec = firstByteAtMs > 0 ? (now - firstByteAtMs) / 1000 : 0;
      const speedMbPerSec = transferSec >= 0.35 ? loadedMb / transferSec : 0;
      const remainingMb = Math.max(0, totalMb - loadedMb);
      const etaSec =
        transferSec >= 1.5 && speedMbPerSec > 0.25 && remainingMb > 1
          ? Math.ceil(remainingMb / speedMbPerSec)
          : null;

      let detail: string;
      if (allKnownFilesComplete) {
        detail = `Downloaded ${Math.round(loadedMb)} MB — compiling WebGPU pipelines for ${modelLabel}...`;
      } else {
        const speedPart = speedMbPerSec >= 0.2 ? ` · ${speedMbPerSec.toFixed(1)} MB/s` : '';
        let etaPart = '';
        if (etaSec !== null) {
          etaPart =
            etaSec >= 60
              ? ` (~${Math.floor(etaSec / 60)}m ${etaSec % 60}s left)`
              : ` (~${etaSec}s left)`;
        }
        detail = `Streaming ${modelLabel}: ${Math.round(loadedMb)} / ${Math.round(totalMb)} MB (${clampedPct.toFixed(1)}%)${speedPart}${etaPart}`;
      }

      onUpdate({
        progressPct: allKnownFilesComplete ? 98 : clampedPct,
        loadedMb,
        totalMb,
        speedMbPerSec,
        etaSec,
        detail,
      });
    }
  };
}
