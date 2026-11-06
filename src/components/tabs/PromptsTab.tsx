import { Flame, RotateCcw, Sparkles, Terminal } from 'lucide-react';
import {
  DEFAULT_PROMPT_CATALOG,
  DEFAULT_VISUAL_CUE_RULES,
  STATE_PERSONA_EXEMPLARS,
} from '../../orchestrator/piratePersonaBank';
import { useMonsterStore } from '../../store/useMonsterStore';
import { ALL_MOODS, type EncounterState, type MoodTag } from '../../types/monster';

const ENCOUNTER_STATES: EncounterState[] = [
  'GrumpyGreeting',
  'WarmGreeting',
  'FirstRefusal',
  'GrumpyBanter',
  'AnswerPlusCandy',
  'GivingIn',
  'WarmFollowUp',
  'GrudgingFollowUp',
  'Goodbye',
  'IdleSelfTalk',
];

export function PromptsTab() {
  const promptCatalog = useMonsterStore((s) => s.promptCatalog);
  const selectedPromptKey = useMonsterStore((s) => s.selectedPromptKey);
  const useCharacterAdapter = useMonsterStore((s) => s.useCharacterAdapter);
  const visualCueRules = useMonsterStore((s) => s.visualCueRules);
  const activeMood = useMonsterStore((s) => s.activeMood);
  const encounterState = useMonsterStore((s) => s.encounterState);

  const setSelectedPromptKey = useMonsterStore((s) => s.setSelectedPromptKey);
  const updatePromptContent = useMonsterStore((s) => s.updatePromptContent);
  const setUseCharacterAdapter = useMonsterStore((s) => s.setUseCharacterAdapter);
  const updateVisualCueRule = useMonsterStore((s) => s.updateVisualCueRule);

  const activePrompt =
    promptCatalog.find((entry) => entry.key === selectedPromptKey) ?? promptCatalog[0];
  const defaultPrompt =
    DEFAULT_PROMPT_CATALOG.find((entry) => entry.key === activePrompt.key) ??
    DEFAULT_PROMPT_CATALOG[0];

  const previewMoodOnStage = (mood: MoodTag) => {
    useMonsterStore.setState({ activeMood: mood });
    updateVisualCueRule(mood, {});
  };

  const resetVisualCues = () => {
    for (const mood of ALL_MOODS) {
      updateVisualCueRule(mood, DEFAULT_VISUAL_CUE_RULES[mood]);
    }
  };

  return (
    <div className="mh-col">
      {/* Editable System Prompt Catalog */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Terminal size={13} color="#91e000" />
            Persona System Prompt Catalog
          </span>
          <button
            type="button"
            className="mh-btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => updatePromptContent(activePrompt.key, defaultPrompt.systemPrompt)}
          >
            <RotateCcw size={11} />
            Reset Template
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 10 }}>
          {promptCatalog.map((entry) => {
            const isSelected = entry.key === activePrompt.key;
            return (
              <button
                key={entry.key}
                type="button"
                className="mh-card-subtle"
                onClick={() => setSelectedPromptKey(entry.key)}
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: isSelected ? '#91e000' : undefined,
                  background: isSelected ? 'rgba(118, 185, 0, 0.14)' : undefined,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 12, color: isSelected ? '#fff' : '#cfe8a9' }}>
                  {entry.key}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {entry.description}
                </div>
              </button>
            );
          })}
        </div>

        <label
          htmlFor="mh-system-prompt-editor"
          style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5 }}
        >
          Live System Instructions ({activePrompt.label}) — injected into every fresh WebGPU SLM turn:
        </label>
        <textarea
          id="mh-system-prompt-editor"
          className="mh-textarea"
          rows={9}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, resize: 'vertical' }}
          value={activePrompt.systemPrompt}
          onChange={(e) => updatePromptContent(activePrompt.key, e.target.value)}
        />
      </section>

      {/* Mood -> Hellfire TSL Shader Visual Cue Rules */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Flame size={13} color="#ff6a00" />
            Mood → 3D Hellfire &amp; Ember Visual Cue Rules
          </span>
          <button
            type="button"
            className="mh-btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={resetVisualCues}
          >
            <RotateCcw size={11} />
            Reset All Cues
          </button>
        </div>

        <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--text-secondary)' }}>
          Inline mood tags like <code>[menacing]</code> or <code>[delighted]</code> drive both the
          26-dim Audio2Face emotion vector and the WebGPU TSL volumetric furnace shader in real time.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))', gap: 8 }}>
          {ALL_MOODS.map((mood) => {
            const rule = visualCueRules[mood];
            const isCurrent = activeMood === mood;
            return (
              <div
                key={mood}
                className="mh-card-subtle"
                style={{
                  borderColor: isCurrent ? '#91e000' : undefined,
                  boxShadow: isCurrent ? '0 0 12px rgba(118, 185, 0, 0.2)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: '#fff' }}>
                    [{mood}]
                  </span>
                  <button
                    type="button"
                    className="mh-btn"
                    style={{ padding: '2px 8px', fontSize: 10.5 }}
                    onClick={() => previewMoodOnStage(mood)}
                  >
                    <Sparkles size={10} color="#ff9900" />
                    {isCurrent ? 'Active on Stage' : 'Preview on 3D Stage'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                    Core Fire
                    <input
                      type="color"
                      value={rule.firePrimaryHex}
                      onChange={(e) => updateVisualCueRule(mood, { firePrimaryHex: e.target.value })}
                      style={{ width: '100%', height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                  </label>
                  <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                    Flame Tip
                    <input
                      type="color"
                      value={rule.fireSecondaryHex}
                      onChange={(e) => updateVisualCueRule(mood, { fireSecondaryHex: e.target.value })}
                      style={{ width: '100%', height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                  </label>
                  <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                    Rim Glow
                    <input
                      type="color"
                      value={rule.rimGlowHex}
                      onChange={(e) => updateVisualCueRule(mood, { rimGlowHex: e.target.value })}
                      style={{ width: '100%', height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                  </label>
                </div>

                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-secondary)' }}>
                    <span>Turbulence</span>
                    <span>{rule.turbulence.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    className="mh-range"
                    min={0.2}
                    max={2.5}
                    step={0.05}
                    value={rule.turbulence}
                    onChange={(e) => updateVisualCueRule(mood, { turbulence: Number(e.target.value) })}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-secondary)' }}>
                    <span>Ember Rate</span>
                    <span>{rule.emberRateMultiplier.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    className="mh-range"
                    min={0.2}
                    max={2.5}
                    step={0.05}
                    value={rule.emberRateMultiplier}
                    onChange={(e) =>
                      updateVisualCueRule(mood, { emberRateMultiplier: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* State-Indexed Dynamic Persona Adapter Bank (LoRA Equivalent) */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span>State-Indexed Character Adapter Exemplars (In-Browser LoRA Conditioning)</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none' }}>
            <input
              type="checkbox"
              checked={useCharacterAdapter}
              onChange={(e) => setUseCharacterAdapter(e.target.checked)}
            />
            <span>Adapter Active</span>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 7 }}>
          {ENCOUNTER_STATES.map((st) => {
            const exemplars = STATE_PERSONA_EXEMPLARS[st];
            const active = encounterState === st;
            return (
              <div
                key={st}
                className="mh-card-subtle"
                style={{ borderColor: active ? '#91e000' : undefined }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#91e000' : '#fff', marginBottom: 4 }}>
                  {st}
                </div>
                {exemplars.map((ex, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    <div style={{ color: '#8fa38a' }}>Visitor: &ldquo;{ex.visitor}&rdquo;</div>
                    <div style={{ color: '#dbead5', fontFamily: 'var(--font-mono)', fontSize: 10.5, marginTop: 2 }}>
                      {ex.house}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
