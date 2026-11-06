import { Candy, Eye, Flame, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { HauntedHouseScene } from '../stage/HauntedHouseScene';
import { DEFAULT_KEYSTONE, ProjectorSyncBus } from '../stage/ProjectorSync';
import { registerSceneHooks, useMonsterStore } from '../store/useMonsterStore';
import type { KeystoneCorners, StageViewMode } from '../types/monster';

function isKeystoneModified(k: KeystoneCorners): boolean {
  return (
    k.topLeft[0] !== 0 ||
    k.topLeft[1] !== 0 ||
    k.topRight[0] !== 100 ||
    k.topRight[1] !== 0 ||
    k.bottomRight[0] !== 100 ||
    k.bottomRight[1] !== 100 ||
    k.bottomLeft[0] !== 0 ||
    k.bottomLeft[1] !== 100
  );
}

function buildKeystoneClipPath(k: KeystoneCorners): string {
  return `polygon(${k.topLeft[0]}% ${k.topLeft[1]}%, ${k.topRight[0]}% ${k.topRight[1]}%, ${k.bottomRight[0]}% ${k.bottomRight[1]}%, ${k.bottomLeft[0]}% ${k.bottomLeft[1]}%)`;
}

export function StageViewport({ isProjectorPopup = false }: { isProjectorPopup?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HauntedHouseScene | null>(null);
  const [theaterSize, setTheaterSize] = useState(false);
  const [popupKeystone, setPopupKeystone] = useState<KeystoneCorners>(DEFAULT_KEYSTONE);

  const stageViewMode = useMonsterStore((s) => s.stageViewMode);
  const stageCollapsed = useMonsterStore((s) => s.stageCollapsed);
  const keystone = useMonsterStore((s) => s.keystone);
  const liveBlendshapes = useMonsterStore((s) => s.liveBlendshapes);
  const activeMood = useMonsterStore((s) => s.activeMood);
  const stageFps = useMonsterStore((s) => s.stageFps);
  const rendererBackend = useMonsterStore((s) => s.rendererBackend);
  const turns = useMonsterStore((s) => s.turns);
  const houseSpeaking = useMonsterStore((s) => s.houseSpeaking);
  const phonemeTarget = useMonsterStore((s) => s.phonemeCheckActiveTarget);
  const candyCount = useMonsterStore((s) => s.candyDispensedCount);

  const setStageViewMode = useMonsterStore((s) => s.setStageViewMode);
  const setStageCollapsed = useMonsterStore((s) => s.setStageCollapsed);
  const setStageTelemetry = useMonsterStore((s) => s.setStageTelemetry);
  const dispenseCandyNow = useMonsterStore((s) => s.dispenseCandyNow);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || stageCollapsed) return;

    const scene = new HauntedHouseScene((fps, backend) => {
      setStageTelemetry(fps, backend);
    });
    sceneRef.current = scene;
    void scene.mount(el);
    scene.applyViewMode(isProjectorPopup ? 'projector' : useMonsterStore.getState().stageViewMode);

    registerSceneHooks({
      onMoodCue: (mood, rule) => scene.setMoodCue(mood, rule),
      onCandyBarrage: () => scene.triggerCandyBarrage(),
    });

    let popupBus: ProjectorSyncBus | null = null;
    if (isProjectorPopup) {
      popupBus = new ProjectorSyncBus((msg) => {
        if (msg.type === 'FRAME_STATE') {
          scene.setBlendshapes(msg.weights);
          scene.setMoodCue(msg.mood, msg.cueRule);
          setPopupKeystone(msg.keystone);
        } else if (msg.type === 'CANDY_BARRAGE') {
          scene.triggerCandyBarrage();
        }
      });
    }

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        scene.resize(width, height);
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      popupBus?.close();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [isProjectorPopup, stageCollapsed, setStageTelemetry]);

  useEffect(() => {
    if (!isProjectorPopup) {
      sceneRef.current?.applyViewMode(stageViewMode);
    }
  }, [stageViewMode, isProjectorPopup]);

  useEffect(() => {
    sceneRef.current?.setBlendshapes(liveBlendshapes);
  }, [liveBlendshapes]);

  const latestHouseTurn = [...turns].reverse().find((t) => t.role === 'house');
  const activeKeystone = isProjectorPopup ? popupKeystone : keystone;
  const shouldApplyKeystone =
    isProjectorPopup || stageViewMode === 'projector' || isKeystoneModified(activeKeystone);
  const keystoneStyle = shouldApplyKeystone
    ? { clipPath: buildKeystoneClipPath(activeKeystone) }
    : undefined;

  if (isProjectorPopup) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#000', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', ...keystoneStyle }} />
      </div>
    );
  }

  return (
    <div
      className={`mh-stage-shell ${theaterSize ? 'theater' : ''} ${stageCollapsed ? 'collapsed' : ''}`}
    >
      {!stageCollapsed && (
        <div ref={containerRef} className="mh-stage-canvas" style={keystoneStyle} />
      )}

      <div className="mh-stage-overlay-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="mh-pill">
            <span className="mh-dot live" />
            {rendererBackend} · {stageFps} FPS
          </span>
          <span className="mh-pill">
            <Flame size={12} color="#ff7700" />
            Mood: <strong style={{ color: '#fff', textTransform: 'capitalize' }}>{activeMood}</strong>
          </span>
          {candyCount > 0 && (
            <span className="mh-pill" style={{ borderColor: 'rgba(250, 204, 21, 0.5)', color: '#fde047' }}>
              <Candy size={12} /> Treats Given: {candyCount}
            </span>
          )}
          {phonemeTarget && (
            <span className="mh-pill" style={{ borderColor: '#76b900', color: '#91e000' }}>
              Phoneme Target: {phonemeTarget}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!stageCollapsed && (
            <>
              {(['house', 'closeup', 'projector'] as StageViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className="mh-btn"
                  style={{
                    padding: '4px 9px',
                    fontSize: 11,
                    borderColor: stageViewMode === m ? '#76b900' : undefined,
                    background: stageViewMode === m ? 'rgba(118,185,0,0.2)' : 'rgba(10,15,10,0.82)',
                  }}
                  onClick={() => setStageViewMode(m)}
                >
                  <Eye size={12} />
                  {m === 'house' ? 'Full House' : m === 'closeup' ? 'Close-Up Maw' : 'Projector Mask'}
                </button>
              ))}
              <button
                type="button"
                className="mh-btn"
                style={{ padding: '4px 9px', fontSize: 11, background: 'rgba(10,15,10,0.82)' }}
                onClick={dispenseCandyNow}
                title="Launch celebratory candy bars onto the driveway"
              >
                <Candy size={12} color="#facc15" /> Toss Candy
              </button>
              <button
                type="button"
                className="mh-btn"
                style={{ padding: '4px 8px', background: 'rgba(10,15,10,0.82)' }}
                onClick={() => setTheaterSize((v) => !v)}
                title={theaterSize ? 'Standard Stage Height' : 'Expand Theater Stage'}
              >
                {theaterSize ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            </>
          )}
          <button
            type="button"
            className="mh-btn"
            style={{ padding: '4px 9px', fontSize: 11, background: 'rgba(10,15,10,0.88)' }}
            onClick={() => setStageCollapsed(!stageCollapsed)}
          >
            {stageCollapsed ? 'Show 3D Haunted House' : 'Hide Stage'}
          </button>
        </div>
      </div>

      {!stageCollapsed && (houseSpeaking || latestHouseTurn) && (
        <div className="mh-stage-subtitle">
          {houseSpeaking ? '🔥 ' : '🏴‍☠️ '}
          {latestHouseTurn?.text ?? 'Grumbling inside the floorboards...'}
        </div>
      )}
    </div>
  );
}
