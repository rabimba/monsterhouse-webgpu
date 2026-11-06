import { Camera, RotateCcw, Sliders, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useMonsterStore } from '../store/useMonsterStore';
import { ACTIVE_44_SOUND_TARGETS, type BlendshapeName } from '../types/monster';

export function RightSidebar() {
  const [shapeFilter, setShapeFilter] = useState('');
  const [resetBulkValue, setResetBulkValue] = useState('1');

  const webcamEnabled = useMonsterStore((s) => s.webcamEnabled);
  const syntheticReplayEnabled = useMonsterStore((s) => s.syntheticReplayEnabled);
  const visionChunkSeconds = useMonsterStore((s) => s.visionChunkSeconds);
  const visitors = useMonsterStore((s) => s.visitors);

  const voiceMod = useMonsterStore((s) => s.voiceMod);
  const multipliers = useMonsterStore((s) => s.blendshapeMultipliers);
  const liveBlendshapes = useMonsterStore((s) => s.liveBlendshapes);

  const setWebcamEnabled = useMonsterStore((s) => s.setWebcamEnabled);
  const setSyntheticReplayEnabled = useMonsterStore((s) => s.setSyntheticReplayEnabled);
  const setVisionChunkSeconds = useMonsterStore((s) => s.setVisionChunkSeconds);
  const setActiveTab = useMonsterStore((s) => s.setActiveTab);

  const updateVoiceMod = useMonsterStore((s) => s.updateVoiceMod);
  const resetVoiceMod = useMonsterStore((s) => s.resetVoiceMod);

  const setBlendshapeMultiplier = useMonsterStore((s) => s.setBlendshapeMultiplier);
  const resetAllBlendshapeMultipliers = useMonsterStore((s) => s.resetAllBlendshapeMultipliers);

  const filteredTargets = ACTIVE_44_SOUND_TARGETS.filter((name) =>
    name.toLowerCase().includes(shapeFilter.trim().toLowerCase()),
  );

  return (
    <aside className="mh-col mh-right-col" aria-label="Vision, Voice Mod, and Mouth Shapes">
      {/* Webcam Vision Card */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>WEBCAM VISION</span>
          <Camera size={13} color="#76b900" />
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className={webcamEnabled ? 'mh-btn mh-btn-primary' : 'mh-btn'}
            style={{ flex: 1, fontSize: 11 }}
            onClick={() => {
              setWebcamEnabled(!webcamEnabled);
              setActiveTab('VISION');
            }}
          >
            {webcamEnabled ? 'Webcam Live' : 'Connect webcam'}
          </button>
          <button
            type="button"
            className="mh-btn"
            style={{ fontSize: 11 }}
            onClick={() => {
              setSyntheticReplayEnabled(true);
              setActiveTab('VISION');
            }}
            title="Open the 5-costume synthetic trick-or-treater test replay"
          >
            Test Replay
          </button>
        </div>

        <div style={{ marginTop: 7, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`mh-dot ${webcamEnabled || syntheticReplayEnabled ? 'live' : ''}`} />
          {webcamEnabled
            ? `Webcam live · ${visitors.length} tracked`
            : syntheticReplayEnabled
              ? `Synthetic replay ready · ${visitors.length} tracked`
              : 'Webcam off'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>CHUNK</span>
          <select
            className="mh-select"
            style={{ width: 82, padding: '3px 6px', fontSize: 11 }}
            value={visionChunkSeconds}
            onChange={(e) => setVisionChunkSeconds(Number(e.target.value))}
          >
            <option value={1}>1s</option>
            <option value={2}>2s</option>
            <option value={4}>4s</option>
            <option value={6}>6s</option>
          </select>
        </div>
      </section>

      {/* Voice Mod DSP Rack */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>VOICE MOD</span>
          <Volume2 size={13} color="#76b900" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={voiceMod.enabled}
              onChange={(e) => updateVoiceMod({ enabled: e.target.checked })}
              style={{ accentColor: '#76b900' }}
            />
            Use voice mod
          </label>
          <button
            type="button"
            className="mh-btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={resetVoiceMod}
          >
            <RotateCcw size={11} /> Reset
          </button>
        </div>

        <div style={{ display: 'grid', gap: 7 }}>
          <DspSlider
            label="Pitch"
            value={voiceMod.pitchSemitones}
            min={-12}
            max={12}
            step={0.5}
            unit="st"
            onChange={(v) => updateVoiceMod({ pitchSemitones: v })}
          />
          <DspSlider
            label="Low weight"
            value={voiceMod.lowWeightDb}
            min={-6}
            max={18}
            step={0.5}
            unit="dB"
            onChange={(v) => updateVoiceMod({ lowWeightDb: v })}
          />
          <DspSlider
            label="Drive"
            value={voiceMod.driveDb}
            min={0}
            max={20}
            step={0.5}
            unit="dB"
            onChange={(v) => updateVoiceMod({ driveDb: v })}
          />
          <DspSlider
            label="Presence"
            value={voiceMod.presenceDb}
            min={-8}
            max={12}
            step={0.5}
            unit="dB"
            onChange={(v) => updateVoiceMod({ presenceDb: v })}
          />
          <DspSlider
            label="Chamber"
            value={voiceMod.chamberPct}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateVoiceMod({ chamberPct: v })}
          />
          <DspSlider
            label="Effect mix"
            value={voiceMod.effectMixPct}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateVoiceMod({ effectMixPct: v })}
          />
          <DspSlider
            label="Output trim"
            value={voiceMod.outputTrimDb}
            min={-12}
            max={12}
            step={0.5}
            unit="dB"
            onChange={(v) => updateVoiceMod({ outputTrimDb: v })}
          />
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 7 }}>
          {voiceMod.enabled
            ? 'Clean speech drives 44 mouth targets; Demon DSP routes to speakers.'
            : 'Bypassed — original clean audio.'}
        </div>
      </section>

      {/* Mouth Shapes (44 Active ARKit Sound Targets) */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>MOUTH SHAPES (44 TARGETS)</span>
          <Sliders size={13} color="#76b900" />
        </div>

        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 7 }}>
          0x off · 0.5x half · 1x original · 2x amplified. Applies to speech and idle. Final weights stop at 1.0.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button
            type="button"
            className="mh-btn"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={() => resetAllBlendshapeMultipliers(Number(resetBulkValue) || 0)}
          >
            Reset all to:
          </button>
          <input
            type="number"
            className="mh-input"
            style={{ width: 54, padding: '3px 6px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            min={0}
            max={2}
            step={0.1}
            value={resetBulkValue}
            onChange={(e) => setResetBulkValue(e.target.value)}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>x</span>
        </div>

        <input
          type="text"
          className="mh-input"
          placeholder="Find a shape (e.g. jawOpen, funnel)..."
          value={shapeFilter}
          onChange={(e) => setShapeFilter(e.target.value)}
          style={{ marginBottom: 8, fontSize: 11 }}
        />

        <div style={{ maxHeight: 270, overflowY: 'auto', paddingRight: 4, display: 'grid', gap: 7 }}>
          {filteredTargets.map((shapeName: BlendshapeName) => {
            const mult = multipliers[shapeName] ?? 1;
            const liveVal = liveBlendshapes[shapeName] ?? 0;
            return (
              <div key={shapeName} style={{ fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: liveVal > 0.08 ? '#91e000' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {shapeName}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {mult.toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  className="mh-range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={mult}
                  onChange={(e) => setBlendshapeMultiplier(shapeName, Number(e.target.value))}
                />
                {liveVal > 0.01 && (
                  <div
                    style={{
                      height: 2,
                      marginTop: 2,
                      width: `${Math.round(liveVal * 100)}%`,
                      background: '#ff7b00',
                      borderRadius: 2,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function DspSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (val: number) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr 48px', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{props.label}</span>
      <input
        type="range"
        className="mh-range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-secondary)' }}>
        {props.value} {props.unit}
      </span>
    </div>
  );
}
