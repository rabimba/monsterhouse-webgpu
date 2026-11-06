import { Cpu, Download, Gauge, Layers, Zap } from 'lucide-react';
import {
  A2F_ENGINES,
  FEATURED_PROFILES,
  MODEL_PROFILES,
  PROFILE_DROPDOWN_ORDER,
  TTS_ENGINES,
} from '../../ai/modelRegistry';
import { useMonsterStore } from '../../store/useMonsterStore';
import type { A2fEngineId, ModelProfileId, TtsEngineId } from '../../types/monster';

export function ServicesTab() {
  const selectedProfileId = useMonsterStore((s) => s.selectedProfileId);
  const selectedTtsEngine = useMonsterStore((s) => s.selectedTtsEngine);
  const selectedA2fEngine = useMonsterStore((s) => s.selectedA2fEngine);
  const syncMs = useMonsterStore((s) => s.a2fSyncCompensationMs);
  const workerStatus = useMonsterStore((s) => s.workerStatus);
  const gpuAdapterSummary = useMonsterStore((s) => s.gpuAdapterSummary);
  const benchmarkRunning = useMonsterStore((s) => s.benchmarkRunning);
  const benchmarkWinner = useMonsterStore((s) => s.benchmarkWinner);
  const benchmarkResults = useMonsterStore((s) => s.benchmarkResults);

  const selectModelProfile = useMonsterStore((s) => s.selectModelProfile);
  const setTtsEngine = useMonsterStore((s) => s.setTtsEngine);
  const setA2fEngine = useMonsterStore((s) => s.setA2fEngine);
  const setSyncMs = useMonsterStore((s) => s.setA2fSyncCompensationMs);
  const loadWebGpuModelsNow = useMonsterStore((s) => s.loadWebGpuModelsNow);
  const benchmarkProfilesCandB = useMonsterStore((s) => s.benchmarkProfilesCandB);

  return (
    <div className="mh-col">
      <section className="mh-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <div className="mh-section-label">
              PRIMARY WEBGPU PROFILES (PROFILE C DEFAULT · PROFILE B CO-PRIMARY)
            </div>
            <h2 className="mh-hero-heading">Performance-First Browser Inference Stack</h2>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              GPU Adapter: <strong style={{ color: '#fff' }}>{gpuAdapterSummary}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="mh-btn"
              disabled={benchmarkRunning}
              onClick={() => void benchmarkProfilesCandB()}
              title="Measures warm TTFT and decode tok/s on Profile C and Profile B, then selects the fastest on your GPU"
            >
              <Gauge size={13} color="#91e000" />
              {benchmarkRunning
                ? 'Benchmarking C vs B...'
                : 'Benchmark C vs B & Auto-Pick Fastest'}
            </button>
            <button
              type="button"
              className="mh-btn mh-btn-primary"
              disabled={workerStatus.brain.state === 'loading'}
              onClick={loadWebGpuModelsNow}
            >
              <Download size={13} />{' '}
              {workerStatus.brain.state === 'loading'
                ? `Streaming (${workerStatus.brain.progressPct.toFixed(1)}%)`
                : 'Load / Warm Selected Stack'}
            </button>
          </div>
        </div>

        {/* 2-Column Hero Focus on Profile C & Profile B */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
            gap: 10,
            marginTop: 12,
          }}
        >
          {FEATURED_PROFILES.map((id) => {
            const p = MODEL_PROFILES[id];
            const active = selectedProfileId === id;
            const bench = benchmarkResults[id];
            const isWinner = benchmarkWinner === id;
            return (
              <div
                key={id}
                className="mh-card-subtle"
                style={{
                  cursor: 'pointer',
                  borderColor: active ? '#91e000' : undefined,
                  background: active ? 'rgba(118,185,0,0.13)' : undefined,
                  boxShadow: active ? '0 0 18px rgba(118,185,0,0.18)' : undefined,
                }}
                onClick={() => selectModelProfile(id)}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 5,
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: '#91e000',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                    }}
                  >
                    {p.badge} {isWinner ? '· ★ GPU WINNER' : ''}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {p.vramEstimateLabel}
                  </span>
                </div>

                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {p.description}
                </div>

                <div
                  style={{
                    marginTop: 9,
                    paddingTop: 7,
                    borderTop: '1px solid rgba(118,185,0,0.15)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>
                    {p.models.brain.repoId} ({p.models.brain.sizeMb} MB)
                  </span>
                  {bench && (
                    <span style={{ color: '#91e000', fontWeight: 700 }}>
                      <Zap size={10} style={{ verticalAlign: 'middle' }} /> {bench.tokPerSec} tok/s
                      · {bench.ttftMs}ms TTFT
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Compact Dropdown Selector Preserving Profile A as Opt-In Option */}
        <div
          className="mh-card-subtle"
          style={{
            marginTop: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            <strong>Full Profile Dropdown</strong> (includes optional{' '}
            <code>Profile A: NVIDIA Nemotron 3.5 Bolt E4B</code> for 8GB+ desktop GPUs):
          </div>
          <select
            className="mh-select"
            style={{ maxWidth: 420 }}
            value={selectedProfileId}
            onChange={(e) => selectModelProfile(e.target.value as ModelProfileId)}
          >
            {PROFILE_DROPDOWN_ORDER.map((pid) => (
              <option key={pid} value={pid}>
                {MODEL_PROFILES[pid].shortLabel} ({MODEL_PROFILES[pid].vramEstimateLabel})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Worker Slots Status */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>DEDICATED WEB WORKER SLOTS</span>
          <Cpu size={13} color="#76b900" />
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {[
            {
              name: 'Listening Worker (Silero VAD + Parakeet 0.6B CTC / Gemma 4 Audio)',
              slot: workerStatus.asr,
            },
            {
              name: 'Thinking Worker (LFM3-VL 2B Default / Gemma 4 E2B / Bolt E4B)',
              slot: workerStatus.brain,
            },
            { name: 'Speaking Worker (Kokoro / Chatterbox Zero-Shot)', slot: workerStatus.tts },
            { name: 'Animating Worker (NVIDIA Audio2Face-3D v2.3 Mark)', slot: workerStatus.a2f },
            { name: 'Seeing Worker (YOLOv10s + ByteTrack)', slot: workerStatus.vision },
          ].map((item) => (
            <div key={item.name} className="mh-card-subtle">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <strong>{item.name}</strong>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: item.slot.state === 'ready' ? '#91e000' : 'var(--text-secondary)',
                  }}
                >
                  {item.slot.state.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                {item.slot.detail}
              </div>
              {item.slot.state === 'loading' && (
                <div
                  style={{
                    height: 4,
                    background: '#172214',
                    borderRadius: 4,
                    marginTop: 6,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${item.slot.progressPct}%`,
                      height: '100%',
                      background: '#76b900',
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* TTS + Audio2Face & Sync Tuning */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>VOICE, AUDIO2FACE-3D &amp; SYNC COMPENSATION</span>
          <Layers size={13} color="#76b900" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
              TTS Synthesizer
            </div>
            <select
              className="mh-select"
              value={selectedTtsEngine}
              onChange={(e) => setTtsEngine(e.target.value as TtsEngineId)}
            >
              {Object.values(TTS_ENGINES).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.sizeMb} MB)
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Mouth Blendshape Engine
            </div>
            <select
              className="mh-select"
              value={selectedA2fEngine}
              onChange={(e) => setA2fEngine(e.target.value as A2fEngineId)}
            >
              {Object.values(A2F_ENGINES).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Audio2Face Buffer Sync Offset: <strong>{syncMs} ms</strong>
            </div>
            <input
              type="range"
              className="mh-range"
              min={0}
              max={300}
              step={10}
              value={syncMs}
              onChange={(e) => setSyncMs(Number(e.target.value))}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
              Article default: 100 ms compensates for Audio2Face-3D buffering.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
