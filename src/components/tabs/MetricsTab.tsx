import { Activity, Cpu, Gauge, Zap } from 'lucide-react';
import { FEATURED_PROFILES, MODEL_PROFILES } from '../../ai/modelRegistry';
import { useMonsterStore } from '../../store/useMonsterStore';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

export function MetricsTab() {
  const latencyHistory = useMonsterStore((s) => s.latencyHistory);
  const tokPerSec = useMonsterStore((s) => s.tokPerSec);
  const stageFps = useMonsterStore((s) => s.stageFps);
  const rendererBackend = useMonsterStore((s) => s.rendererBackend);
  const selectedProfileId = useMonsterStore((s) => s.selectedProfileId);
  const benchmarkResults = useMonsterStore((s) => s.benchmarkResults);
  const benchmarkRunning = useMonsterStore((s) => s.benchmarkRunning);
  const benchmarkProfilesCandB = useMonsterStore((s) => s.benchmarkProfilesCandB);

  const liveRuns = latencyHistory.filter((r) => !r.cachedText).map((r) => r.eouToFirstAudioMs);
  const cachedRuns = latencyHistory.filter((r) => r.cachedText).map((r) => r.eouToFirstAudioMs);

  const medLive = median(liveRuns);
  const medCached = median(cachedRuns);

  return (
    <div className="mh-col">
      <section className="mh-card">
        <div className="mh-section-label">
          <span>TURNAROUND &amp; WEBGPU TELEMETRY</span>
          <Gauge size={14} color="#76b900" />
        </div>
        <h2 className="mh-hero-heading">A Voice Worth Waiting For — Live Benchmarks</h2>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Active Stack: <strong>{MODEL_PROFILES[selectedProfileId].name}</strong> · Article
          workstation baseline: <strong>1,700 ms</strong> median EOU-to-audio and{' '}
          <strong>720 ms</strong> cached responses (with 300 ms silence EOU).
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div className="mh-card-subtle">
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Median Live EOU → Audio</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: '#91e000',
              }}
            >
              {medLive !== null ? `${medLive} ms` : '—'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Target: ≤ 1,700 ms</div>
          </div>

          <div className="mh-card-subtle">
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Median Cached EOU → Audio</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: '#38bdf8',
              }}
            >
              {medCached !== null ? `${medCached} ms` : '—'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Article ref: 720 ms</div>
          </div>

          <div className="mh-card-subtle">
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>WebGPU LLM Decode</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: '#fbbf24',
              }}
            >
              {tokPerSec > 0 ? `${tokPerSec} tok/s` : 'Standby'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Clause-streamed early TTS</div>
          </div>

          <div className="mh-card-subtle">
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>3D Haunted Stage</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {stageFps} FPS
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{rendererBackend}</div>
          </div>
        </div>
      </section>

      {/* Profile C vs Profile B Head-to-Head Matrix */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Cpu size={13} color="#91e000" />
            PROFILE C VS PROFILE B — SINGLE-GPU WEBGPU PERFORMANCE MATRIX
          </span>
          <button
            type="button"
            className="mh-btn"
            style={{ padding: '3px 9px', fontSize: 11 }}
            disabled={benchmarkRunning}
            onClick={() => void benchmarkProfilesCandB()}
          >
            {benchmarkRunning ? 'Running GPU Benchmark...' : 'Run Live C vs B Benchmark'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {FEATURED_PROFILES.map((pid) => {
            const spec = MODEL_PROFILES[pid];
            const measured = benchmarkResults[pid];
            const isDefault = pid === 'lfm3-omni';
            return (
              <div key={pid} className="mh-card-subtle">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong style={{ color: isDefault ? '#91e000' : '#fff' }}>
                    {spec.codeLabel}: {isDefault ? 'LiquidAI LFM3-VL 2B' : 'Google Gemma 4 E2B Omni'}
                  </strong>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {spec.vramEstimateLabel}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Brain+Vision Payload: <strong>{spec.models.brain.sizeMb} MB</strong> (
                  {spec.models.brain.dtype}) ·{' '}
                  {isDefault
                    ? '75% Short-Conv O(1) cache (Default Winner)'
                    : 'Unified Vision + 16kHz Audio-In'}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    color: measured ? '#91e000' : 'var(--text-muted)',
                  }}
                >
                  {measured
                    ? `Measured: ${measured.tokPerSec} tok/s · ${measured.ttftMs} ms TTFT`
                    : 'Not yet benchmarked on this session'}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mh-card">
        <div className="mh-section-label">
          <span>PER-TURN LATENCY BREAKDOWN ({latencyHistory.length} TURNS)</span>
          <Activity size={13} color="#76b900" />
        </div>

        {latencyHistory.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            Send a trick-or-treater prompt in the Conversation tab to record turnaround breakdowns.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--nvidia-border)',
                    textAlign: 'left',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <th style={{ padding: '6px 8px' }}>Turn</th>
                  <th style={{ padding: '6px 8px' }}>Path</th>
                  <th style={{ padding: '6px 8px' }}>EOU → Audio</th>
                  <th style={{ padding: '6px 8px' }}>LLM 1st Clause</th>
                  <th style={{ padding: '6px 8px' }}>TTS</th>
                  <th style={{ padding: '6px 8px' }}>A2F 44-Pose</th>
                </tr>
              </thead>
              <tbody>
                {[...latencyHistory].reverse().map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid rgba(118,185,0,0.1)' }}>
                    <td style={{ padding: '6px 8px' }}>#{row.turnNumber}</td>
                    <td
                      style={{
                        padding: '6px 8px',
                        color: row.cachedText ? '#38bdf8' : '#91e000',
                      }}
                    >
                      <Zap size={11} style={{ verticalAlign: 'middle' }} />{' '}
                      {row.cachedText ? 'Prepared / Cached' : 'Fresh WebGPU LLM'}
                    </td>
                    <td style={{ padding: '6px 8px', fontWeight: 700 }}>
                      {row.eouToFirstAudioMs} ms
                    </td>
                    <td style={{ padding: '6px 8px' }}>{row.llmFirstClauseMs} ms</td>
                    <td style={{ padding: '6px 8px' }}>{row.ttsMs} ms</td>
                    <td style={{ padding: '6px 8px' }}>{row.a2fMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
