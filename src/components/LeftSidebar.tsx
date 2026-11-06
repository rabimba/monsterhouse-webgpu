import { Cpu, Mic, Radio } from 'lucide-react';
import {
  FEATURED_PROFILES,
  MODEL_PROFILES,
  PROFILE_DROPDOWN_ORDER,
  TTS_ENGINES,
} from '../ai/modelRegistry';
import { useMonsterStore } from '../store/useMonsterStore';
import type { ModelProfileId, TtsEngineId } from '../types/monster';

const KOKORO_VOICES = [
  { id: 'bm_fable', label: 'MonsterHouse Pirate (British Fable)' },
  { id: 'bm_george', label: 'Captain George (Deep British)' },
  { id: 'bm_daniel', label: 'Quartermaster Daniel (Stern)' },
  { id: 'am_fenrir', label: 'Dread Fenrir (Gravelly)' },
  { id: 'am_onyx', label: 'Hull Onyx (Resonant)' },
];

export function LeftSidebar() {
  const selectedProfileId = useMonsterStore((s) => s.selectedProfileId);
  const selectedTtsEngine = useMonsterStore((s) => s.selectedTtsEngine);
  const voiceId = useMonsterStore((s) => s.voiceId);
  const houseMode = useMonsterStore((s) => s.houseMode);
  const micDelay = useMonsterStore((s) => s.micPossessionDelayMs);
  const useCached = useMonsterStore((s) => s.useCachedResponses);
  const useAdapter = useMonsterStore((s) => s.useCharacterAdapter);
  const selectedPromptKey = useMonsterStore((s) => s.selectedPromptKey);
  const promptCatalog = useMonsterStore((s) => s.promptCatalog);
  const micAudioLevel = useMonsterStore((s) => s.micAudioLevel);
  const micStatus = useMonsterStore((s) => s.micStatus);
  const houseSpeaking = useMonsterStore((s) => s.houseSpeaking);
  const brainStatus = useMonsterStore((s) => s.workerStatus.brain);

  const selectModelProfile = useMonsterStore((s) => s.selectModelProfile);
  const setTtsEngine = useMonsterStore((s) => s.setTtsEngine);
  const setVoiceId = useMonsterStore((s) => s.setVoiceId);
  const setHouseMode = useMonsterStore((s) => s.setHouseMode);
  const setMicDelay = useMonsterStore((s) => s.setMicPossessionDelayMs);
  const setUseCached = useMonsterStore((s) => s.setUseCachedResponses);
  const setUseAdapter = useMonsterStore((s) => s.setUseCharacterAdapter);
  const setSelectedPromptKey = useMonsterStore((s) => s.setSelectedPromptKey);
  const loadWebGpuModelsNow = useMonsterStore((s) => s.loadWebGpuModelsNow);

  const profileSpec = MODEL_PROFILES[selectedProfileId];

  return (
    <aside className="mh-col" aria-label="Agent Configuration Sidebar">
      {/* Response Model */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>Response model</span>
          <Cpu size={13} color="#76b900" />
        </div>

        {/* Fast Toggle between Featured Profiles C & B */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 7 }}>
          {FEATURED_PROFILES.map((pid) => {
            const p = MODEL_PROFILES[pid];
            const isSelected = selectedProfileId === pid;
            return (
              <button
                key={pid}
                type="button"
                className={isSelected ? 'mh-btn mh-btn-primary' : 'mh-btn'}
                style={{ padding: '4px 6px', fontSize: 10.5 }}
                onClick={() => selectModelProfile(pid)}
                title={p.name}
              >
                {p.codeLabel} · {pid === 'lfm3-omni' ? 'LFM3' : 'Gemma 4'}
              </button>
            );
          })}
        </div>

        <select
          className="mh-select"
          aria-label="Response model profile dropdown"
          value={selectedProfileId}
          onChange={(e) => selectModelProfile(e.target.value as ModelProfileId)}
        >
          {PROFILE_DROPDOWN_ORDER.map((pid) => {
            const p = MODEL_PROFILES[pid];
            return (
              <option key={p.id} value={p.id}>
                {p.shortLabel}
              </option>
            );
          })}
        </select>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 7,
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)' }}>{profileSpec.vramEstimateLabel}</span>
          <span
            style={{
              fontSize: 10,
              color: '#91e000',
              border: '1px solid var(--nvidia-border)',
              padding: '1px 5px',
              borderRadius: 4,
            }}
          >
            {profileSpec.badge}
          </span>
        </div>

        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {brainStatus.detail}
        </div>
        {brainStatus.state === 'loading' && (
          <div
            style={{
              height: 5,
              background: '#141e12',
              borderRadius: 99,
              marginTop: 6,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(2, brainStatus.progressPct))}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #76b900, #a4ff2e)',
                transition: 'width 180ms ease-out',
              }}
            />
          </div>
        )}
        {brainStatus.state !== 'ready' && (
          <button
            type="button"
            className="mh-btn"
            style={{ width: '100%', marginTop: 8, fontSize: 11 }}
            disabled={brainStatus.state === 'loading'}
            onClick={loadWebGpuModelsNow}
          >
            {brainStatus.state === 'loading'
              ? `Streaming Weights (${brainStatus.progressPct.toFixed(1)}%)`
              : 'Warm WebGPU Models'}
          </button>
        )}
      </section>

      {/* House Mode */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>HOUSE MODE</span>
          <Radio size={13} color="#76b900" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            type="button"
            className={houseMode === 'live' ? 'mh-btn mh-btn-primary' : 'mh-btn'}
            onClick={() => void setHouseMode('live')}
          >
            Live
          </button>
          <button
            type="button"
            className={houseMode === 'demo' ? 'mh-btn mh-btn-primary' : 'mh-btn'}
            onClick={() => void setHouseMode('demo')}
          >
            Demo
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
          }}
        >
          <button
            type="button"
            className={houseMode === 'microphone' ? 'mh-btn mh-btn-primary' : 'mh-btn'}
            style={{ flex: 1, fontSize: 11, padding: '5px 8px' }}
            onClick={() => void setHouseMode(houseMode === 'microphone' ? 'live' : 'microphone')}
            title="Puppet / Possession Mode: speak AS MonsterHouse through the demon voice DSP (use Live or Demo to talk TO the AI)"
          >
            <Mic size={12} /> Puppet Mic
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
            Delay
            <input
              type="number"
              className="mh-input"
              style={{ width: 58, padding: '4px 6px', fontFamily: 'var(--font-mono)', fontSize: 11 }}
              min={0}
              max={2500}
              step={50}
              value={micDelay}
              onChange={(e) => setMicDelay(Number(e.target.value) || 0)}
            />
            ms
          </label>
        </div>

        {/* Live Mic / Voice Level Bar */}
        <div
          style={{
            marginTop: 8,
            height: 4,
            background: '#141e12',
            borderRadius: 99,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.round(micAudioLevel * 220))}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #76b900, #ff7b00)',
              transition: 'width 60ms linear',
            }}
          />
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            lineHeight: 1.35,
            color:
              micStatus === 'hearing' || micStatus === 'transcribing'
                ? '#a4ff2e'
                : micStatus === 'mic-denied'
                  ? '#ffaa44'
                  : 'var(--text-muted)',
          }}
        >
          {micStatus === 'disconnected' && 'Mic idle — click Connect (top right) to talk'}
          {micStatus === 'possession' &&
            '🎭 Puppet Mode active (click Live above to talk TO MonsterHouse)'}
          {micStatus === 'mic-denied' &&
            '⚠️ Mic blocked/unavailable — allow mic in browser address bar'}
          {micStatus === 'hearing' && !houseSpeaking && '🎙️ Hearing you speak...'}
          {micStatus === 'transcribing' && !houseSpeaking && '⚡ Transcribing your speech...'}
          {micStatus === 'listening' &&
            (houseSpeaking
              ? '🔊 MonsterHouse speaking (speak right after it finishes)'
              : '🎙️ Mic listening — speak anytime')}
        </div>
      </section>

      {/* Response Mode */}
      <section className="mh-card">
        <div className="mh-section-label">RESPONSE MODE</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={useCached}
            onChange={(e) => setUseCached(e.target.checked)}
            style={{ accentColor: '#76b900' }}
          />
          Use cached responses
        </label>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Prepared text skips fresh LLM work; IndexedDB audio + 44-pose cache skips TTS synthesis.
        </div>
      </section>

      {/* Character Adapter */}
      <section className="mh-card">
        <div className="mh-section-label">CHARACTER ADAPTER</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={useAdapter}
            onChange={(e) => setUseAdapter(e.target.checked)}
            style={{ accentColor: '#76b900' }}
          />
          Use Persona Adapter
        </label>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Injects state-indexed pirate ship exemplars & emotion-tag grammar per encounter turn.
        </div>
      </section>

      {/* Prompt Selector */}
      <section className="mh-card">
        <div className="mh-section-label">PROMPT</div>
        <select
          className="mh-select"
          value={selectedPromptKey}
          onChange={(e) => setSelectedPromptKey(e.target.value)}
        >
          {promptCatalog.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key}
            </option>
          ))}
        </select>
      </section>

      {/* Voice Settings */}
      <section className="mh-card">
        <div className="mh-section-label">VOICE SETTINGS</div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Language</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>en-US</span>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>TTS Engine</div>
            <select
              className="mh-select"
              value={selectedTtsEngine}
              onChange={(e) => setTtsEngine(e.target.value as TtsEngineId)}
            >
              {Object.values(TTS_ENGINES).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Voice</div>
            <select
              className="mh-select"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
            >
              {KOKORO_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
    </aside>
  );
}
