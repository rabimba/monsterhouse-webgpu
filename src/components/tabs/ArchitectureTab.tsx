import { Cpu, GitBranch, Zap } from 'lucide-react';
import { A2F_ENGINES, MODEL_PROFILES, TTS_ENGINES } from '../../ai/modelRegistry';
import { useMonsterStore } from '../../store/useMonsterStore';
import type { PipelineNodeId } from '../../types/monster';

interface PipelineCardSpec {
  id: PipelineNodeId;
  stage: string;
  title: string;
  subtitle: string;
  shortcutTag?: string;
}

export function ArchitectureTab() {
  const selectedProfileId = useMonsterStore((s) => s.selectedProfileId);
  const selectedTtsEngine = useMonsterStore((s) => s.selectedTtsEngine);
  const selectedA2fEngine = useMonsterStore((s) => s.selectedA2fEngine);
  const activePipelineNodes = useMonsterStore((s) => s.activePipelineNodes);
  const a2fSyncCompensationMs = useMonsterStore((s) => s.a2fSyncCompensationMs);

  const profile = MODEL_PROFILES[selectedProfileId];
  const ttsSpec = TTS_ENGINES[selectedTtsEngine];
  const a2fSpec = A2F_ENGINES[selectedA2fEngine];

  const isActive = (id: PipelineNodeId) => activePipelineNodes.includes(id);

  const renderNode = (spec: PipelineCardSpec) => {
    const lit = isActive(spec.id);
    return (
      <div
        key={spec.id}
        className="mh-card-subtle"
        style={{
          borderColor: lit ? '#91e000' : undefined,
          background: lit ? 'rgba(118, 185, 0, 0.18)' : undefined,
          boxShadow: lit ? '0 0 18px rgba(118, 185, 0, 0.32)' : undefined,
          transition: 'all 180ms ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span
            style={{
              fontSize: 9.5,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              color: lit ? '#91e000' : 'var(--text-muted)',
            }}
          >
            {spec.stage}
          </span>
          {spec.shortcutTag && (
            <span
              style={{
                fontSize: 9.5,
                padding: '1px 6px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                color: '#fde68a',
              }}
            >
              {spec.shortcutTag}
            </span>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: '#fff', marginBottom: 3 }}>
          {spec.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {spec.subtitle}
        </div>
      </div>
    );
  };

  return (
    <div className="mh-col">
      <section className="mh-card">
        <div className="mh-section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <GitBranch size={13} color="#91e000" />
            Live In-Browser WebGPU Pipeline Graph (Dual-Shortcut + Clean/Audience Split)
          </span>
          <span className="mh-pill">
            <Zap size={11} color="#91e000" />
            {activePipelineNodes.length > 0
              ? `Executing: ${activePipelineNodes.join(' → ')}`
              : 'Idle — Trigger speech or Soundboard to watch live routing'}
          </span>
        </div>

        {/* Tier 1: Parallel Sensory Inputs */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#91e000', marginBottom: 6 }}>
            1. SENSORY WORKERS (PARALLEL WEBGPU / WASM THREADS)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
            {renderNode({
              id: 'visitor-speech',
              stage: 'Speech Worker',
              title: 'Visitor Speech + 300ms VAD',
              subtitle: `${profile.models.asr.label} (${profile.models.asr.repoId}) + Silero EOU barge-in`,
            })}
            {renderNode({
              id: 'people-detector',
              stage: 'Vision Worker',
              title: 'People Detector + ByteTrack',
              subtitle: `${profile.models.trackerDetector.label} + Kalman IoU persistent visitor IDs`,
            })}
            {renderNode({
              id: 'omni-observer',
              stage: 'Async VLM Observer',
              title: 'Omni Costume Observer',
              subtitle: `${profile.models.visionObserver.label} — throttled off-critical-path costume crops`,
            })}
          </div>
        </div>

        {/* Tier 2: Deterministic Encounter FSM */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#91e000', marginBottom: 6 }}>
            2. DETERMINISTIC ENCOUNTER CONTROLLER (MAIN ORCHESTRATOR)
          </div>
          {renderNode({
            id: 'encounter-controller',
            stage: '10-State FSM',
            title: 'Encounter Controller & Manners Breakthrough Gate',
            subtitle:
              'Tracks visitor arrival, grumpy refusal, deterministic "please" breakthrough, 3-turn persistence, wonOver memory, and OpeningMix routing.',
          })}
        </div>

        {/* Tier 3: Dialogue Generation vs Shortcut #1 */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#91e000', marginBottom: 6 }}>
            3. DIALOGUE GENERATION &amp; SHORTCUT #1 (PREPARED TEXT BANK)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            {renderNode({
              id: 'fresh-dialogue',
              stage: 'Brain Worker (WebGPU q4f16)',
              title: 'Fresh Streaming SLM Dialogue',
              subtitle: `${profile.models.brain.label} (${profile.models.brain.repoId}) + Clause-Boundary Early Release`,
            })}
            {renderNode({
              id: 'prepared-dialogue',
              stage: '0 ms Text Bank',
              title: 'Prepared Pirate Dialogue Bank',
              subtitle:
                'Authored state-matched pirate lines bypass LLM latency on predictable greetings, first refusals, and farewells.',
              shortcutTag: 'Shortcut #1',
            })}
          </div>
        </div>

        {/* Tier 4: Audio Lookup & Shortcut #2 */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#91e000', marginBottom: 6 }}>
            4. AUDIO / BLENDSHAPE CACHE &amp; SHORTCUT #2 (INDEXEDDB)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
            {renderNode({
              id: 'audio-lookup',
              stage: 'IndexedDB Hash',
              title: 'Audio & 60Hz Curve Lookup',
              subtitle: 'SHA-style key over (normalizedText | moodTag | voiceId).',
            })}
            {renderNode({
              id: 'new-live-speech',
              stage: 'TTS + A2F Worker',
              title: 'New Live Speech + 44-Pose Solve',
              subtitle: `${ttsSpec.name} + ${a2fSpec.name}`,
            })}
            {renderNode({
              id: 'saved-audio',
              stage: 'Sub-5 ms Replay',
              title: 'Saved PCM + 60Hz ARKit Frames',
              subtitle: 'Replays pre-baked Float32 audio + 44 active blendshape trajectories with zero GPU inference wait.',
              shortcutTag: 'Shortcut #2',
            })}
          </div>
        </div>

        {/* Tier 5: Dual-Stream Audio Split */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#91e000', marginBottom: 6 }}>
            5. DUAL-STREAM AUDIO &amp; 3D WEBGPU STAGE SPLIT ({a2fSyncCompensationMs} MS SYNC LOCK)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            {renderNode({
              id: 'clean-speech',
              stage: 'Clean Stream → Lip-Sync',
              title: 'Clean Speech → Audio2Face-3D & Splintered Planks',
              subtitle:
                'Un-reverbed speech drives 44 active ARKit targets on the 24 split pirate-oak planks so heavy reverb never smears jaw timing.',
            })}
            {renderNode({
              id: 'audience-speech',
              stage: 'Audience Stream → Speakers',
              title: 'WebAudio DSP Monsterizer → Speakers',
              subtitle:
                'Granular Pitch-Shift (-4.5 st) → Low-Shelf (+7 dB) → Asymmetric Distortion → Haunted Hull Convolver Reverb.',
            })}
          </div>
        </div>
      </section>

      {/* Hardware & COOP/COEP Isolation Summary */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Cpu size={13} color="#91e000" />
            Active WebGPU Runtime Configuration ({profile.name})
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, fontSize: 11.5 }}>
          <div className="mh-card-subtle">
            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>CROSS-ORIGIN ISOLATION</div>
            <div style={{ fontWeight: 700, marginTop: 2 }}>
              {typeof window !== 'undefined' && window.crossOriginIsolated
                ? 'Active (SharedArrayBuffer + Multi-Thread ORT)'
                : 'Standard Mode (Single-Thread WASM + WebGPU)'}
            </div>
          </div>
          <div className="mh-card-subtle">
            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>ESTIMATED VRAM FOOTPRINT</div>
            <div style={{ fontWeight: 700, marginTop: 2 }}>{profile.vramEstimateLabel} (OPFS / Cache API persistent)</div>
          </div>
          <div className="mh-card-subtle">
            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>RENDER PIPELINE</div>
            <div style={{ fontWeight: 700, marginTop: 2 }}>Three.js WebGPURenderer + TSL Volumetric Hellfire</div>
          </div>
        </div>
      </section>
    </div>
  );
}
