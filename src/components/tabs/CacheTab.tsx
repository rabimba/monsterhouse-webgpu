import { Database, Play, Sparkles, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useMonsterStore } from '../../store/useMonsterStore';

export function CacheTab() {
  const cachedEntries = useMonsterStore((s) => s.cachedEntries);
  const prebakeProgress = useMonsterStore((s) => s.prebakeProgress);
  const refreshCacheList = useMonsterStore((s) => s.refreshCacheList);
  const clearCache = useMonsterStore((s) => s.clearCache);
  const prebakeCommonLines = useMonsterStore((s) => s.prebakeCommonLines);
  const speakCustomScript = useMonsterStore((s) => s.speakCustomScript);

  useEffect(() => {
    void refreshCacheList();
  }, [refreshCacheList]);

  const totalSec =
    cachedEntries.reduce((acc, e) => acc + e.durationMs, 0) / 1000;
  const totalHits = cachedEntries.reduce((acc, e) => acc + e.hitCount, 0);

  return (
    <div className="mh-col">
      <section className="mh-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="mh-section-label" style={{ marginBottom: 3 }}>
              <span>INDEXEDDB AUDIO + 44-POSE PERFORMANCE CACHE</span>
            </div>
            <h2 className="mh-hero-heading" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={18} /> Rehearsed Grumbles & Instant Replies
            </h2>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Caches both clean PCM speech and pre-solved 60 Hz 44-target ARKit mouth curves locally in the browser for &lt;50 ms playback.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="mh-btn mh-btn-primary"
              disabled={prebakeProgress.running}
              onClick={() => void prebakeCommonLines()}
            >
              <Sparkles size={13} />
              {prebakeProgress.running
                ? `Baking (${prebakeProgress.done}/${prebakeProgress.total})...`
                : 'Pre-Bake Soundboard & Common Lines'}
            </button>
            <button
              type="button"
              className="mh-btn mh-btn-danger"
              disabled={cachedEntries.length === 0}
              onClick={() => void clearCache()}
            >
              <Trash2 size={13} /> Clear Cache
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
          <div className="mh-card-subtle">
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cached Clauses</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#91e000' }}>
              {cachedEntries.length}
            </div>
          </div>
          <div className="mh-card-subtle">
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Synthesized Audio</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {totalSec.toFixed(1)}s
            </div>
          </div>
          <div className="mh-card-subtle">
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Live Cache Hits</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fbbf24' }}>
              {totalHits}
            </div>
          </div>
        </div>
      </section>

      <section className="mh-card">
        <div className="mh-section-label">SAVED PERFORMANCES ({cachedEntries.length})</div>

        {cachedEntries.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            No cached lines yet. Click any Soundboard button or click “Pre-Bake Soundboard & Common Lines” above!
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
            {cachedEntries.map((entry) => (
              <div
                key={entry.cacheKey}
                className="mh-card-subtle"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: '#91e000' }}>[{entry.mood}]</span>
                    <span>{entry.voiceId}</span>
                    <span>{(entry.durationMs / 1000).toFixed(2)}s</span>
                    <span>{entry.frames60Hz.length} ARKit frames</span>
                    <span>Hits: {entry.hitCount}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {entry.normalizedText}
                  </div>
                </div>

                <button
                  type="button"
                  className="mh-btn"
                  onClick={() => void speakCustomScript(`[${entry.mood}] ${entry.normalizedText}`)}
                >
                  <Play size={12} color="#76b900" /> Audition
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
