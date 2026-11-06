import { AutoModel, AutoProcessor, env, RawImage } from '@huggingface/transformers';
import type { RawDetection } from '../../vision/ByteTracker';
import { createSmoothProgressTracker } from '../progressTracker';
import { probeOptimalWebGpuDevice } from '../webgpuCapabilities';

env.allowLocalModels = false;

export type VisionWorkerInMessage =
  | { type: 'LOAD_DETECTOR'; repoId: string }
  | { type: 'SET_LLM_BUSY'; busy: boolean }
  | { type: 'DETECT_FRAME'; frameId: number; dataUrl: string };

export type VisionWorkerOutMessage =
  | {
      type: 'VISION_STATUS';
      status: 'idle' | 'loading' | 'ready' | 'fallback';
      detail: string;
      progressPct?: number;
    }
  | {
      type: 'DETECTIONS_RESULT';
      frameId: number;
      detections: RawDetection[];
      inferMs: number;
      frameDataUrl: string;
    };

let detectorModel: any = null;
let detectorProcessor: any = null;
let loadingPromise: Promise<void> | null = null;
let loadedRepoId = '';
let llmBusy = false;
let inFlight = false;

function post(msg: VisionWorkerOutMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

async function loadDetector(repoId: string): Promise<void> {
  if (detectorModel && detectorProcessor && loadedRepoId === repoId) {
    post({
      type: 'VISION_STATUS',
      status: 'ready',
      detail: `${repoId} person detector active`,
      progressPct: 100,
    });
    return;
  }
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const caps = await probeOptimalWebGpuDevice();
    const runtimeLabel = caps.device === 'webgpu' ? 'WebGPU' : 'SIMD WASM';

    post({
      type: 'VISION_STATUS',
      status: 'loading',
      detail: `Loading ${repoId} person detector on ${runtimeLabel}...`,
      progressPct: 0.5,
    });

    const shortName = repoId.split('/').pop() ?? repoId;
    const progressCallback = createSmoothProgressTracker(shortName, (snap) => {
      post({
        type: 'VISION_STATUS',
        status: 'loading',
        detail: snap.detail,
        progressPct: snap.progressPct,
      });
    });

    try {
      detectorProcessor = await AutoProcessor.from_pretrained(repoId);

      try {
        detectorModel = await AutoModel.from_pretrained(repoId, {
          device: caps.device,
          dtype: caps.device === 'webgpu' ? (caps.hasShaderF16 ? 'fp16' : 'fp32') : 'q8',
          progress_callback: progressCallback,
        });
      } catch {
        // Guaranteed universal fallback to quantized SIMD WASM if WebGPU op fails
        detectorModel = await AutoModel.from_pretrained(repoId, {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: progressCallback,
        });
      }

      loadedRepoId = repoId;
      post({
        type: 'VISION_STATUS',
        status: 'ready',
        detail: `${repoId} (${runtimeLabel}) person detector active`,
        progressPct: 100,
      });
    } catch (err) {
      detectorModel = null;
      detectorProcessor = null;
      post({
        type: 'VISION_STATUS',
        status: 'fallback',
        detail: `Detector load error: ${err instanceof Error ? err.message : 'offline'}`,
      });
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

async function detectFrame(frameId: number, dataUrl: string): Promise<void> {
  // Single-GPU Compute Pacing: yield during active LLM token prefill/decode
  if (llmBusy || inFlight) return;

  if (!detectorModel || !detectorProcessor) {
    if (!loadingPromise) {
      void loadDetector(loadedRepoId || 'onnx-community/yolov10s');
    }
    return;
  }

  inFlight = true;
  const t0 = performance.now();

  try {
    const img = await RawImage.fromURL(dataUrl);
    const { pixel_values, reshaped_input_sizes } = await detectorProcessor(img);
    const [reshapedH, reshapedW] = reshaped_input_sizes[0] as [number, number];

    const outputs = await detectorModel({ images: pixel_values });
    const outTensor = outputs.output0 ?? outputs[Object.keys(outputs)[0]];
    const data = outTensor.data as Float32Array;
    const numRows = outTensor.dims?.[1] ?? Math.floor(data.length / 6);
    const id2label: Record<number, string> = detectorModel.config?.id2label ?? { 0: 'person' };

    const detections: RawDetection[] = [];
    for (let i = 0; i < numRows; i++) {
      const base = i * 6;
      const score = data[base + 4];
      if (score < 0.28) continue;

      const classId = Math.round(data[base + 5]);
      const label = id2label[classId] ?? String(classId);
      // Strictly track real people as porch visitors so room furniture (chair/laptop/tv) is ignored
      if (label !== 'person') continue;

      const xmin = Math.max(0, Math.min(1, data[base] / reshapedW));
      const ymin = Math.max(0, Math.min(1, data[base + 1] / reshapedH));
      const xmax = Math.max(0, Math.min(1, data[base + 2] / reshapedW));
      const ymax = Math.max(0, Math.min(1, data[base + 3] / reshapedH));

      if (xmax - xmin > 0.015 && ymax - ymin > 0.02) {
        detections.push({
          bbox: [xmin, ymin, xmax, ymax],
          score,
          label: 'Visitor',
        });
      }
    }

    post({
      type: 'DETECTIONS_RESULT',
      frameId,
      detections,
      inferMs: Math.round(performance.now() - t0),
      frameDataUrl: dataUrl,
    });
  } catch {
    // Ignore transient frame decode error
  } finally {
    inFlight = false;
  }
}

self.onmessage = (ev: MessageEvent<VisionWorkerInMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'LOAD_DETECTOR':
      void loadDetector(msg.repoId);
      break;
    case 'SET_LLM_BUSY':
      llmBusy = msg.busy;
      break;
    case 'DETECT_FRAME':
      void detectFrame(msg.frameId, msg.dataUrl);
      break;
  }
};
