import type { TrackedVisitor } from '../types/monster';

export interface RawDetection {
  /** Normalized [x1, y1, x2, y2] in 0..1 */
  bbox: [number, number, number, number];
  score: number;
  label?: string;
}

interface InternalTrack {
  trackId: number;
  bbox: [number, number, number, number];
  velocity: [number, number, number, number];
  confidence: number;
  lostFrames: number;
  hits: number;
  firstSeenMs: number;
  lastSeenMs: number;
  costume: string;
  costumeDetail?: string;
  thumbnailDataUrl?: string;
  wonOver: boolean;
}

export function computeIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const xA = Math.max(a[0], b[0]);
  const yA = Math.max(a[1], b[1]);
  const xB = Math.min(a[2], b[2]);
  const yB = Math.min(a[3], b[3]);

  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;

  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - interArea;
  return union > 0 ? interArea / union : 0;
}

export interface ByteTrackUpdateResult {
  activeVisitors: TrackedVisitor[];
  newlyArrivedIds: number[];
}

/**
 * Pure TypeScript ByteTrack Multi-Object Tracker (two-stage high/low confidence IoU association
 * with constant-velocity motion prediction), keeping visitor counting & tracking separate from
 * the Omni VLM costume observer—mirroring MonsterHouse's architecture.
 */
export class ByteTracker {
  private tracks: InternalTrack[] = [];
  private nextId = 1;
  private readonly highThresh: number;
  private readonly lowThresh: number;
  private readonly matchIoUThresh: number;
  private readonly maxLostFrames: number;

  constructor(options?: {
    highThresh?: number;
    lowThresh?: number;
    matchIoUThresh?: number;
    maxLostFrames?: number;
  }) {
    this.highThresh = options?.highThresh ?? 0.45;
    this.lowThresh = options?.lowThresh ?? 0.15;
    this.matchIoUThresh = options?.matchIoUThresh ?? 0.25;
    this.maxLostFrames = options?.maxLostFrames ?? 24;
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }

  setCostumeMetadata(
    trackId: number,
    costume: string,
    costumeDetail?: string,
    thumbnailDataUrl?: string,
  ): void {
    const trk = this.tracks.find((t) => t.trackId === trackId);
    if (trk) {
      trk.costume = costume;
      if (costumeDetail !== undefined) trk.costumeDetail = costumeDetail;
      if (thumbnailDataUrl !== undefined) trk.thumbnailDataUrl = thumbnailDataUrl;
    }
  }

  markAllActiveWonOver(): void {
    for (const trk of this.tracks) {
      if (trk.lostFrames === 0) {
        trk.wonOver = true;
      }
    }
  }

  update(detections: RawDetection[], nowMs = Date.now()): ByteTrackUpdateResult {
    // 1. Predict next box location via velocity damped step
    for (const t of this.tracks) {
      t.bbox = [
        Math.max(0, Math.min(1, t.bbox[0] + t.velocity[0] * 0.5)),
        Math.max(0, Math.min(1, t.bbox[1] + t.velocity[1] * 0.5)),
        Math.max(0, Math.min(1, t.bbox[2] + t.velocity[2] * 0.5)),
        Math.max(0, Math.min(1, t.bbox[3] + t.velocity[3] * 0.5)),
      ];
    }

    const highDets = detections.filter((d) => d.score >= this.highThresh);
    const lowDets = detections.filter((d) => d.score >= this.lowThresh && d.score < this.highThresh);

    const unmatchedTrackIndices = new Set<number>(this.tracks.map((_, idx) => idx));
    const unmatchedHighDetIndices = new Set<number>(highDets.map((_, idx) => idx));
    const newlyArrivedIds: number[] = [];

    // Stage 1: Associate existing tracks with high-confidence detections
    this.greedyMatch(
      unmatchedTrackIndices,
      highDets,
      unmatchedHighDetIndices,
      nowMs,
    );

    // Stage 2: Associate remaining lost/occluded tracks with low-confidence detections
    const unmatchedLowDetIndices = new Set<number>(lowDets.map((_, idx) => idx));
    this.greedyMatch(
      unmatchedTrackIndices,
      lowDets,
      unmatchedLowDetIndices,
      nowMs,
    );

    // Mark remaining unmatched tracks as lost
    for (const tIdx of unmatchedTrackIndices) {
      this.tracks[tIdx].lostFrames += 1;
    }

    // Spawn new tracks for unmatched high-confidence detections
    for (const dIdx of unmatchedHighDetIndices) {
      const det = highDets[dIdx];
      const trackId = this.nextId++;
      this.tracks.push({
        trackId,
        bbox: [...det.bbox],
        velocity: [0, 0, 0, 0],
        confidence: det.score,
        lostFrames: 0,
        hits: 1,
        firstSeenMs: nowMs,
        lastSeenMs: nowMs,
        costume: det.label && det.label !== 'person' ? det.label : 'Inspecting...',
        wonOver: false,
      });
      newlyArrivedIds.push(trackId);
    }

    // Prune expired tracks
    this.tracks = this.tracks.filter((t) => t.lostFrames <= this.maxLostFrames);

    const activeVisitors: TrackedVisitor[] = this.tracks
      .filter((t) => t.lostFrames <= 2)
      .map((t) => ({
        trackId: t.trackId,
        bbox: [...t.bbox],
        confidence: t.confidence,
        costume: t.costume,
        costumeDetail: t.costumeDetail,
        thumbnailDataUrl: t.thumbnailDataUrl,
        firstSeenMs: t.firstSeenMs,
        lastSeenMs: t.lastSeenMs,
        wonOver: t.wonOver,
      }));

    return { activeVisitors, newlyArrivedIds };
  }

  private greedyMatch(
    candidateTrackIndices: Set<number>,
    dets: RawDetection[],
    candidateDetIndices: Set<number>,
    nowMs: number,
  ): void {
    const pairs: Array<{ tIdx: number; dIdx: number; iou: number }> = [];
    for (const tIdx of candidateTrackIndices) {
      for (const dIdx of candidateDetIndices) {
        const iou = computeIoU(this.tracks[tIdx].bbox, dets[dIdx].bbox);
        if (iou >= this.matchIoUThresh) {
          pairs.push({ tIdx, dIdx, iou });
        }
      }
    }
    pairs.sort((a, b) => b.iou - a.iou);

    for (const { tIdx, dIdx } of pairs) {
      if (!candidateTrackIndices.has(tIdx) || !candidateDetIndices.has(dIdx)) continue;
      const trk = this.tracks[tIdx];
      const det = dets[dIdx];
      trk.velocity = [
        (det.bbox[0] - trk.bbox[0]) * 0.4,
        (det.bbox[1] - trk.bbox[1]) * 0.4,
        (det.bbox[2] - trk.bbox[2]) * 0.4,
        (det.bbox[3] - trk.bbox[3]) * 0.4,
      ];
      trk.bbox = [...det.bbox];
      trk.confidence = det.score;
      trk.lostFrames = 0;
      trk.hits += 1;
      trk.lastSeenMs = nowMs;
      if (det.label && det.label !== 'person' && trk.costume === 'Inspecting...') {
        trk.costume = det.label;
      }
      candidateTrackIndices.delete(tIdx);
      candidateDetIndices.delete(dIdx);
    }
  }
}

export interface SyntheticVisitorActor {
  costume: string;
  detail: string;
  baseX: number;
  baseY: number;
  w: number;
  h: number;
  phase: number;
}

export const SYNTHETIC_SHEEP_ACTORS: SyntheticVisitorActor[] = [
  { costume: 'Pirate', detail: 'Tricorne skull hat, eye patch & red bandana', baseX: 0.16, baseY: 0.52, w: 0.19, h: 0.42, phase: 0.0 },
  { costume: 'Vampire', detail: 'Crimson-lined Dracula cape & little fangs', baseX: 0.33, baseY: 0.47, w: 0.16, h: 0.39, phase: 1.3 },
  { costume: 'Witch', detail: 'Pointed black buckle hat right up at the lens', baseX: 0.49, baseY: 0.64, w: 0.31, h: 0.56, phase: 2.4 },
  { costume: 'Pumpkin', detail: 'Carved orange jack-o-lantern fleece suit', baseX: 0.68, baseY: 0.49, w: 0.17, h: 0.40, phase: 3.7 },
  { costume: 'Ghost', detail: 'Classic white sheet with spooky eye cutouts', baseX: 0.84, baseY: 0.56, w: 0.17, h: 0.46, phase: 4.9 },
];

/**
 * Renders the built-in "Synthetic Replay" porch doorbell camera scene (5 costumed woolly
 * trick-or-treaters bobbing in front of a night-time porch—faithful homage to the article's
 * synthetic test replay!) and returns ground-truth detections + cropped avatar data URLs.
 */
export function renderSyntheticDoorbellReplay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsedSec: number,
): RawDetection[] {
  ctx.save();

  // Night sky + neighborhood twilight backdrop
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  skyGrad.addColorStop(0, '#050814');
  skyGrad.addColorStop(0.6, '#0d162c');
  skyGrad.addColorStop(1, '#1b1d24');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Distant warm neighborhood streetlights
  const lights = [0.18, 0.42, 0.74, 0.89];
  for (const lx of lights) {
    const g = ctx.createRadialGradient(lx * width, height * 0.32, 1, lx * width, height * 0.32, 26);
    g.addColorStop(0, 'rgba(255, 195, 95, 0.9)');
    g.addColorStop(1, 'rgba(255, 140, 20, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx * width - 28, height * 0.32 - 28, 56, 56);
  }

  // Porch concrete & pillars
  ctx.fillStyle = '#3c3630';
  ctx.fillRect(0, height * 0.52, width, height * 0.48);
  ctx.fillStyle = '#cfc7ba';
  ctx.fillRect(width * 0.21, 0, width * 0.045, height * 0.55);
  ctx.fillRect(width * 0.69, 0, width * 0.045, height * 0.55);

  const detections: RawDetection[] = [];

  for (const actor of SYNTHETIC_SHEEP_ACTORS) {
    const swayX = Math.sin(elapsedSec * 1.4 + actor.phase) * 0.012;
    const bobY = Math.cos(elapsedSec * 2.1 + actor.phase) * 0.01;
    const cx = (actor.baseX + swayX) * width;
    const cy = (actor.baseY + bobY) * height;
    const bw = actor.w * width;
    const bh = actor.h * height;

    ctx.save();
    ctx.translate(cx, cy);

    if (actor.costume === 'Ghost') {
      // Flowing white ghost sheet
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.42, bh * 0.46, 0, Math.PI, 0);
      ctx.lineTo(bw * 0.44, bh * 0.45);
      ctx.lineTo(-bw * 0.44, bh * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.ellipse(-bw * 0.12, -bh * 0.18, 6, 9, 0, 0, Math.PI * 2);
      ctx.ellipse(bw * 0.12, -bh * 0.18, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Costume body
      if (actor.costume === 'Pirate') ctx.fillStyle = '#7f1d1d';
      else if (actor.costume === 'Vampire') ctx.fillStyle = '#18181b';
      else if (actor.costume === 'Witch') ctx.fillStyle = '#2e1065';
      else if (actor.costume === 'Pumpkin') ctx.fillStyle = '#ea580c';

      ctx.beginPath();
      ctx.ellipse(0, bh * 0.16, bw * 0.4, bh * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      if (actor.costume === 'Pumpkin') {
        // Jack-o-lantern triangles on belly
        ctx.fillStyle = '#1c1917';
        ctx.beginPath();
        ctx.moveTo(-14, bh * 0.1);
        ctx.lineTo(-6, bh * 0.18);
        ctx.lineTo(-20, bh * 0.18);
        ctx.moveTo(14, bh * 0.1);
        ctx.lineTo(20, bh * 0.18);
        ctx.lineTo(6, bh * 0.18);
        ctx.fill();
      }

      // Fluffy woolly face + ears
      ctx.fillStyle = '#e7dfd3';
      ctx.beginPath();
      ctx.ellipse(-bw * 0.34, -bh * 0.1, bw * 0.14, bh * 0.05, -0.35, 0, Math.PI * 2);
      ctx.ellipse(bw * 0.34, -bh * 0.1, bw * 0.14, bh * 0.05, 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f5efe6';
      ctx.beginPath();
      ctx.ellipse(0, -bh * 0.06, bw * 0.28, bh * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      // Snout & eyes
      ctx.fillStyle = '#d6c7b6';
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.16, bh * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-bw * 0.12, -bh * 0.09, Math.max(3, bw * 0.03), 0, Math.PI * 2);
      ctx.arc(bw * 0.12, -bh * 0.09, Math.max(3, bw * 0.03), 0, Math.PI * 2);
      ctx.fill();

      // Costume hats & props
      if (actor.costume === 'Pirate') {
        // Eye patch + Tricorne skull hat
        ctx.fillStyle = '#09090b';
        ctx.beginPath();
        ctx.arc(bw * 0.12, -bh * 0.09, Math.max(5, bw * 0.048), 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-bw * 0.45, -bh * 0.2);
        ctx.quadraticCurveTo(0, -bh * 0.48, bw * 0.45, -bh * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(0, -bh * 0.28, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (actor.costume === 'Vampire') {
        // High red collar + little white fangs
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(-bw * 0.35, -bh * 0.15);
        ctx.lineTo(-bw * 0.18, bh * 0.05);
        ctx.lineTo(bw * 0.18, bh * 0.05);
        ctx.lineTo(bw * 0.35, -bh * 0.15);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-6, bh * 0.03, 3, 7);
        ctx.fillRect(3, bh * 0.03, 3, 7);
      } else if (actor.costume === 'Witch') {
        // Tall pointed witch hat + gold buckle
        ctx.fillStyle = '#18181b';
        ctx.beginPath();
        ctx.ellipse(0, -bh * 0.2, bw * 0.46, bh * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-bw * 0.25, -bh * 0.2);
        ctx.lineTo(0, -bh * 0.52);
        ctx.lineTo(bw * 0.25, -bh * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.strokeRect(-8, -bh * 0.27, 16, 10);
      } else if (actor.costume === 'Pumpkin') {
        // Orange pumpkin cap + green stem
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(0, -bh * 0.22, bw * 0.26, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#16a34a';
        ctx.fillRect(-4, -bh * 0.38, 8, 12);
      }
    }

    ctx.restore();

    const x1 = Math.max(0.01, (cx - bw * 0.48) / width);
    const y1 = Math.max(0.02, (cy - bh * 0.48) / height);
    const x2 = Math.min(0.99, (cx + bw * 0.48) / width);
    const y2 = Math.min(0.98, (cy + bh * 0.48) / height);

    detections.push({
      bbox: [x1, y1, x2, y2],
      score: 0.94,
      label: actor.costume,
    });
  }

  // Fisheye doorbell vignette
  const vig = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    width * 0.34,
    width * 0.5,
    height * 0.5,
    width * 0.56,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.86)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
  return detections;
}
