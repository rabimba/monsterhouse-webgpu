import { AlertTriangle, Camera, Cpu, Eye, Sparkles, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MODEL_PROFILES } from '../../ai/modelRegistry';
import { COSTUME_QUIPS } from '../../orchestrator/piratePersonaBank';
import { useMonsterStore } from '../../store/useMonsterStore';
import {
  renderSyntheticDoorbellReplay,
  SYNTHETIC_SHEEP_ACTORS,
} from '../../vision/ByteTracker';

const YOLO_TRACKER_INTERVAL_MS = 180;

export function CameraVisionTab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const webcamEnabled = useMonsterStore((s) => s.webcamEnabled);
  const syntheticReplayEnabled = useMonsterStore((s) => s.syntheticReplayEnabled);
  const visionChunkSeconds = useMonsterStore((s) => s.visionChunkSeconds);
  const visionLastInferMs = useMonsterStore((s) => s.visionLastInferMs);
  const visionStatus = useMonsterStore((s) => s.workerStatus.vision);
  const brainStatus = useMonsterStore((s) => s.workerStatus.brain);
  const selectedProfileId = useMonsterStore((s) => s.selectedProfileId);
  const visitors = useMonsterStore((s) => s.visitors);

  const setWebcamEnabled = useMonsterStore((s) => s.setWebcamEnabled);
  const setSyntheticReplayEnabled = useMonsterStore((s) => s.setSyntheticReplayEnabled);
  const setVisionChunkSeconds = useMonsterStore((s) => s.setVisionChunkSeconds);
  const ingestDetections = useMonsterStore((s) => s.ingestDetections);
  const submitWebcamFrameForYolo = useMonsterStore((s) => s.submitWebcamFrameForYolo);
  const speakCustomScript = useMonsterStore((s) => s.speakCustomScript);
  const loadWebGpuModelsNow = useMonsterStore((s) => s.loadWebGpuModelsNow);

  const profileSpec = MODEL_PROFILES[selectedProfileId];

  // Manage live webcam stream when enabled
  useEffect(() => {
    const videoEl = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;

    if (webcamEnabled) {
      navigator.mediaDevices
        .getUserMedia({ video: { width: { ideal: 800 }, height: { ideal: 480 }, facingMode: 'user' } })
        .then((s) => {
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          setCameraError(null);
          stream = s;
          if (videoEl) {
            videoEl.srcObject = s;
            void videoEl.play();
          }
        })
        .catch((err) => {
          if (cancelled) return;
          const reason = err instanceof Error ? err.message : 'Camera unavailable';
          setCameraError(
            `Could not access physical webcam (${reason}). Switched back to Synthetic Replay — grant browser camera permission and click "Live Webcam" to retry.`,
          );
          setWebcamEnabled(false);
          setSyntheticReplayEnabled(true);
        });
    }

    return () => {
      cancelled = true;
      if (videoEl) {
        videoEl.srcObject = null;
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [webcamEnabled, setWebcamEnabled, setSyntheticReplayEnabled]);

  // Render loop for Doorbell Viewport + Neon Green ByteTrack Overlays (`5_sheep_vision.png`)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!cropCanvasRef.current) {
      cropCanvasRef.current = document.createElement('canvas');
      cropCanvasRef.current.width = 96;
      cropCanvasRef.current.height = 96;
    }

    let rafId = 0;
    const t0 = performance.now();
    let lastTrackerTick = 0;
    let lastYoloTick = 0;
    let frameId = 1;

    const cropBox = (bbox: [number, number, number, number]): string | undefined => {
      const cc = cropCanvasRef.current;
      if (!cc) return undefined;
      const cctx = cc.getContext('2d');
      if (!cctx) return undefined;
      const sx = bbox[0] * canvas.width;
      const sy = bbox[1] * canvas.height;
      const sw = Math.max(16, (bbox[2] - bbox[0]) * canvas.width);
      const sh = Math.max(16, (bbox[3] - bbox[1]) * canvas.height);
      cctx.clearRect(0, 0, 96, 96);
      cctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 96, 96);
      return cc.toDataURL('image/jpeg', 0.78);
    };

    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const now = performance.now();
      const elapsedSec = (now - t0) / 1000;
      const w = canvas.width;
      const h = canvas.height;

      if (webcamEnabled) {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          ctx.drawImage(videoRef.current, 0, 0, w, h);
          if (now - lastYoloTick >= YOLO_TRACKER_INTERVAL_MS) {
            lastYoloTick = now;
            submitWebcamFrameForYolo(frameId++, canvas.toDataURL('image/jpeg', 0.72));
          }
        } else {
          ctx.fillStyle = '#060906';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#91e000';
          ctx.font = '600 14px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Opening webcam stream — allow browser camera permission if prompted...', w / 2, h / 2);
          return;
        }
      } else if (syntheticReplayEnabled) {
        const dets = renderSyntheticDoorbellReplay(ctx, w, h, elapsedSec);
        if (now - lastTrackerTick >= 160) {
          lastTrackerTick = now;
          ingestDetections(dets, cropBox);
        }
      } else {
        ctx.fillStyle = '#060906';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#657660';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Camera off — enable Webcam or Synthetic Replay above', w / 2, h / 2);
        return;
      }

      // Overlay neon-green ByteTrack boxes & Track ID + Costume labels (`01 · Pirate`...)
      const activeVisitors = useMonsterStore.getState().visitors;
      for (const v of activeVisitors) {
        const x = v.bbox[0] * w;
        const y = v.bbox[1] * h;
        const bw = (v.bbox[2] - v.bbox[0]) * w;
        const bh = (v.bbox[3] - v.bbox[1]) * h;

        ctx.strokeStyle = '#91e000';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x, y, bw, bh);

        const badgeText = `${String(v.trackId).padStart(2, '0')} · ${v.costume}`;
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        const textW = ctx.measureText(badgeText).width + 14;

        ctx.fillStyle = 'rgba(8, 14, 6, 0.92)';
        ctx.strokeStyle = '#91e000';
        ctx.lineWidth = 1.5;
        const labelY = Math.max(4, y - 24);
        ctx.fillRect(x, labelY, textW, 22);
        ctx.strokeRect(x, labelY, textW, 22);

        ctx.fillStyle = '#b4ff39';
        ctx.textAlign = 'left';
        ctx.fillText(badgeText, x + 7, labelY + 15);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [
    webcamEnabled,
    syntheticReplayEnabled,
    ingestDetections,
    submitWebcamFrameForYolo,
  ]);

  const handleReactToCostumes = () => {
    if (visitors.length === 0) return;
    const names = visitors.map((v) => v.costume).filter(Boolean);
    const firstKey = names[0]?.toLowerCase() ?? '';
    if (COSTUME_QUIPS[firstKey] && names.length === 1) {
      void speakCustomScript(COSTUME_QUIPS[firstKey]);
      return;
    }
    const listStr = names.slice(0, 5).join(', ');
    void speakCustomScript(
      `[curious] Hold fast! My echolocation pings ${visitors.length} trick-or-treater${visitors.length === 1 ? '' : 's'} on my porch: ${listStr}! [amused] Even the sea monsters off Port Royal dressed less dramatically than this crew!`,
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 12 }}>
      {/* Main Camera Vision Viewport */}
      <section className="mh-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--nvidia-green)', letterSpacing: '0.04em' }}>
              CAMERA VISION
            </span>
            <span className="mh-pill">
              ByteTrack + Omni Observer
            </span>
            {webcamEnabled && (
              <span
                className="mh-pill"
                style={{
                  borderColor: visionStatus.state === 'ready' ? '#91e000' : 'rgba(250, 204, 21, 0.5)',
                  color: visionStatus.state === 'ready' ? '#b4ff39' : '#fde68a',
                }}
              >
                <span className={`mh-dot ${visionStatus.state === 'ready' ? 'live' : ''}`} />
                {visionStatus.state === 'loading'
                  ? `Loading YOLOv10s (${visionStatus.progressPct}%)`
                  : visionStatus.state === 'ready'
                    ? `YOLOv10s Live${visionLastInferMs > 0 ? ` · ${visionLastInferMs} ms` : ''}`
                    : visionStatus.detail}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={syntheticReplayEnabled && !webcamEnabled ? 'mh-btn mh-btn-primary' : 'mh-btn'}
              onClick={() => {
                setCameraError(null);
                setWebcamEnabled(false);
                setSyntheticReplayEnabled(true);
              }}
            >
              <Video size={13} /> Synthetic Replay (5 Costumes)
            </button>
            <button
              type="button"
              className={webcamEnabled ? 'mh-btn mh-btn-primary' : 'mh-btn'}
              onClick={() => {
                setCameraError(null);
                setWebcamEnabled(!webcamEnabled);
              }}
            >
              <Camera size={13} /> {webcamEnabled ? 'Stop Webcam' : 'Live Webcam'}
            </button>
            <button
              type="button"
              className="mh-btn"
              onClick={handleReactToCostumes}
              disabled={visitors.length === 0}
            >
              <Sparkles size={13} color="#91e000" /> Echolocation Roast
            </button>
          </div>
        </div>

        {cameraError && (
          <div
            className="mh-card-subtle"
            style={{
              marginBottom: 10,
              borderColor: 'rgba(245, 158, 11, 0.55)',
              color: '#fde68a',
              fontSize: 11.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertTriangle size={14} />
            <span>{cameraError}</span>
          </div>
        )}

        <video ref={videoRef} style={{ display: 'none' }} muted playsInline />

        <div
          style={{
            width: '100%',
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid var(--nvidia-border)',
            background: '#050805',
          }}
        >
          <canvas
            ref={canvasRef}
            width={820}
            height={480}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap', gap: 8 }}>
          <span>
            <strong style={{ color: '#91e000' }}>
              {webcamEnabled ? 'LIVE WEBCAM (YOLOv10s + ByteTrack)' : 'SYNTHETIC REPLAY'}
            </strong>{' '}
            · People counting &amp; ByteTrack IDs run continuously (~5 FPS) separate from Omni VLM costume chunks
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              VLM CHUNK:
              <select
                className="mh-select"
                style={{ width: 66, padding: '2px 5px', fontSize: 11 }}
                value={visionChunkSeconds}
                onChange={(e) => setVisionChunkSeconds(Number(e.target.value))}
              >
                <option value={1}>1s</option>
                <option value={2}>2s</option>
                <option value={4}>4s</option>
                <option value={6}>6s</option>
              </select>
            </label>
            <span style={{ fontFamily: 'var(--font-mono)', color: '#fff', fontWeight: 600 }}>
              {visitors.length} visible
            </span>
          </div>
        </div>
      </section>

      {/* Right Column: OMNI OBSERVER Costume Cards (`5_sheep_vision.png`) */}
      <section className="mh-card">
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--nvidia-green)', marginBottom: 2 }}>
          OMNI OBSERVER
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
          {visitors.length} visitor{visitors.length === 1 ? '' : 's'} tracked
        </div>

        {webcamEnabled && !profileSpec.models.brain.supportsVision && (
          <div
            className="mh-card-subtle"
            style={{ marginBottom: 8, fontSize: 11, borderColor: 'rgba(245, 158, 11, 0.45)', color: '#fde68a' }}
          >
            Switch to <strong>Profile C (LFM3-VL)</strong> or <strong>Profile B (Gemma 4)</strong> in the left sidebar for live VLM costume naming.
          </div>
        )}

        {webcamEnabled && profileSpec.models.brain.supportsVision && brainStatus.state !== 'ready' && (
          <div className="mh-card-subtle" style={{ marginBottom: 8, fontSize: 11 }}>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
              <strong>YOLOv10s + ByteTrack</strong> tracks people immediately. Warm{' '}
              <strong>{profileSpec.codeLabel}</strong> VLM to also classify costumes/outfits:
            </div>
            <button
              type="button"
              className="mh-btn"
              style={{ width: '100%', fontSize: 11 }}
              disabled={brainStatus.state === 'loading'}
              onClick={loadWebGpuModelsNow}
            >
              <Cpu size={12} color="#91e000" />
              {brainStatus.state === 'loading'
                ? `Loading Costume VLM (${brainStatus.progressPct}%)...`
                : `Warm ${profileSpec.codeLabel} Costume VLM`}
            </button>
          </div>
        )}

        {visitors.length === 0 ? (
          <div
            className="mh-card-subtle"
            style={{ padding: '18px 12px', textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}
          >
            {webcamEnabled
              ? visionStatus.state === 'loading'
                ? `Downloading YOLOv10s detector (${visionStatus.progressPct}%)...`
                : 'Step into the webcam frame — YOLOv10s + ByteTrack will lock onto you automatically.'
              : 'Waiting for trick-or-treaters...'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {visitors.map((v) => {
              const synthDetail = SYNTHETIC_SHEEP_ACTORS.find(
                (a) => a.costume.toLowerCase() === v.costume.toLowerCase(),
              )?.detail;
              return (
                <div
                  key={v.trackId}
                  className="mh-card-subtle"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: '#91e000',
                      fontSize: 12,
                    }}
                  >
                    {String(v.trackId).padStart(2, '0')}
                  </span>

                  {v.thumbnailDataUrl ? (
                    <img
                      src={v.thumbnailDataUrl}
                      alt={v.costume}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        objectFit: 'cover',
                        border: '1px solid var(--nvidia-border)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        background: '#131d11',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Eye size={16} color="#76b900" />
                    </div>
                  )}

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{v.costume}</div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {v.costumeDetail || synthDetail || `Conf ${(v.confidence * 100).toFixed(0)}%`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
