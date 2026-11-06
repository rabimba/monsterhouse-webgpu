import { describe, expect, it } from 'vitest';
import { ByteTracker, computeIoU } from '../src/vision/ByteTracker';

describe('ByteTracker (Multi-Visitor Doorbell Tracker)', () => {
  it('computes exact Intersection-over-Union (IoU) for normalized boxes', () => {
    expect(computeIoU([0.1, 0.1, 0.5, 0.5], [0.1, 0.1, 0.5, 0.5])).toBeCloseTo(1.0, 5);
    expect(computeIoU([0.0, 0.0, 0.2, 0.2], [0.5, 0.5, 0.8, 0.8])).toBe(0);
    // 50% horizontal overlap on identical height -> 0.5 / 1.5 = 1/3
    expect(computeIoU([0.0, 0.0, 0.4, 0.4], [0.2, 0.0, 0.6, 0.4])).toBeCloseTo(1 / 3, 4);
  });

  it('maintains persistent trackIds across moving frames and recovers low-confidence occluded frames', () => {
    const tracker = new ByteTracker({
      highThresh: 0.5,
      lowThresh: 0.15,
      matchIoUThresh: 0.25,
      maxLostFrames: 10,
    });

    // Frame 1: Two trick-or-treaters arrive
    const f1 = tracker.update(
      [
        { bbox: [0.1, 0.2, 0.3, 0.8], score: 0.92, label: 'Pirate' },
        { bbox: [0.6, 0.25, 0.8, 0.85], score: 0.88, label: 'Witch' },
      ],
      1000,
    );

    expect(f1.newlyArrivedIds).toEqual([1, 2]);
    expect(f1.activeVisitors).toHaveLength(2);

    // Frame 2: Slight motion; trackIds stay [1, 2], newlyArrivedIds is empty
    const f2 = tracker.update(
      [
        { bbox: [0.12, 0.2, 0.32, 0.8], score: 0.91 },
        { bbox: [0.58, 0.25, 0.78, 0.85], score: 0.86 },
      ],
      1100,
    );
    expect(f2.newlyArrivedIds).toEqual([]);
    expect(f2.activeVisitors.map((v) => v.trackId)).toEqual([1, 2]);
    // Costume labels persist across generic detector updates
    expect(f2.activeVisitors[0].costume).toBe('Pirate');
    expect(f2.activeVisitors[1].costume).toBe('Witch');

    // Frame 3: Visitor #1 experiences partial occlusion (low confidence 0.24 -> Stage 2 ByteTrack recovery!)
    const f3 = tracker.update(
      [
        { bbox: [0.13, 0.2, 0.33, 0.8], score: 0.24 },
        { bbox: [0.57, 0.25, 0.77, 0.85], score: 0.89 },
      ],
      1200,
    );
    expect(f3.newlyArrivedIds).toEqual([]);
    expect(f3.activeVisitors.map((v) => v.trackId)).toEqual([1, 2]);
  });
});
