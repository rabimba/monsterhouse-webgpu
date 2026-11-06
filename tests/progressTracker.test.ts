import { describe, expect, it } from 'vitest';
import {
  createSmoothProgressTracker,
  type SmoothProgressSnapshot,
} from '../src/ai/progressTracker';

describe('createSmoothProgressTracker', () => {
  it('eliminates filename flickering, prevents early small-header 100% spikes, and tracks monotonic MB progress', () => {
    const snapshots: SmoothProgressSnapshot[] = [];
    const track = createSmoothProgressTracker(
      'LFM3-VL-2B-ONNX',
      (s) => snapshots.push(s),
      { throttleMs: 0, expectedTotalMb: 1236 },
    );

    const MB = 1024 * 1024;

    // 1. Small 200 KB .onnx header finishes before 988 MB .onnx_data starts — must NOT spike to 100%!
    track({
      status: 'progress',
      file: 'onnx/vision_encoder_q4f16.onnx',
      loaded: 0.2 * MB,
      total: 0.2 * MB,
      progress: 100,
    });
    expect(snapshots[0].progressPct).toBeLessThan(2);

    // 2. Duplicate progress_total events emitted by @huggingface/transformers v4 are ignored
    track({
      status: 'progress_total',
      name: 'onnx-community/LFM3-VL-2B-ONNX',
      loaded: 100 * MB,
      total: 1236 * MB,
      progress: 8.1,
    });
    expect(snapshots).toHaveLength(1);

    // 3. Concurrent multi-file chunks aggregate smoothly without switching file names
    track({
      status: 'progress',
      file: 'onnx/vision_encoder_q4f16.onnx_data',
      loaded: 103.5 * MB,
      total: 103.5 * MB,
    });
    track({
      status: 'progress',
      file: 'onnx/embed_tokens_q4f16.onnx_data',
      loaded: 144.5 * MB,
      total: 144.5 * MB,
    });
    track({
      status: 'progress',
      file: 'onnx/decoder_model_merged_q4f16.onnx_data',
      loaded: 465 * MB,
      total: 988.3 * MB,
    });

    const mid = snapshots[snapshots.length - 1];
    // (0.2 + 103.5 + 144.5 + 465) / 1236.5 = ~57.7% across the whole repo!
    expect(mid.progressPct).toBeGreaterThan(55);
    expect(mid.progressPct).toBeLessThan(60);
    expect(mid.detail).toContain('Streaming LFM3-VL-2B-ONNX:');
    expect(mid.detail).toContain('/ 1237 MB');
    expect(mid.detail).not.toContain('decoder_model_merged');

    // 4. Strictly non-decreasing across every emitted snapshot
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].progressPct).toBeGreaterThanOrEqual(snapshots[i - 1].progressPct);
    }

    // 5. Transitions to WebGPU pipeline compile phase at 98% when all weights arrive
    track({
      status: 'progress',
      file: 'onnx/decoder_model_merged_q4f16.onnx_data',
      loaded: 988.3 * MB,
      total: 988.3 * MB,
    });
    const finalSnap = snapshots[snapshots.length - 1];
    expect(finalSnap.progressPct).toBe(98);
    expect(finalSnap.detail).toContain('compiling WebGPU pipelines');
  });
});
