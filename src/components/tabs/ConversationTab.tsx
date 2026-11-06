import { MessageSquare, Play, Plus, Send, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useMonsterStore } from '../../store/useMonsterStore';
import { ALL_MOODS, type EncounterState, type MoodTag } from '../../types/monster';

const FLOW_CARDS: Array<{
  state: EncounterState;
  title: string;
  subtitle: string;
}> = [
  { state: 'WarmGreeting', title: 'Warm greeting', subtitle: 'Greeting selected × warm chance' },
  { state: 'FirstRefusal', title: 'First refusal', subtitle: 'First candy request → grumpy no' },
  { state: 'AnswerPlusCandy', title: 'Answer + candy', subtitle: 'Answers our question → related reply + candy' },
  { state: 'WarmFollowUp', title: 'Warm follow-up greeting', subtitle: 'Greeting after manners or conversation warmed the encounter' },
  { state: 'Goodbye', title: 'Goodbye', subtitle: 'Visitor says thank you / goodbye → warm farewell' },
  { state: 'GrumpyGreeting', title: 'Grumpy greeting', subtitle: 'Greeting selected × grumpy' },
  { state: 'GrumpyBanter', title: 'Grumpy banter', subtitle: 'Playful challenge → quick comeback' },
  { state: 'GivingIn', title: 'Giving in', subtitle: '"Please" breaks through immediately or persistence wins' },
  { state: 'GrudgingFollowUp', title: 'Grudging follow-up', subtitle: 'Won over after resistance → stays fond' },
  { state: 'IdleSelfTalk', title: 'Idle self-talk', subtitle: 'Driveway empty → nautical muttering' },
];

const QUICK_TRICK_OR_TREAT_LINES = [
  'Trick or treat! Give us candy!',
  'Come on garage door, stop grumbling!',
  'Trick or treat, may we please have some candy?',
  'You look awesome for an old pirate ship!',
  'Thank you Monster House, Happy Halloween!',
];

export function ConversationTab() {
  const [customScript, setCustomScript] = useState(
    '[grumpy] Get off my lawn! [short pause] [delighted] Oh, wait—did you say please?',
  );
  const [customButtonTitle, setCustomButtonTitle] = useState('');
  const [visitorInput, setVisitorInput] = useState('');

  const soundboardItems = useMonsterStore((s) => s.soundboardItems);
  const openingMix = useMonsterStore((s) => s.openingMix);
  const encounterState = useMonsterStore((s) => s.encounterState);
  const turns = useMonsterStore((s) => s.turns);
  const houseSpeaking = useMonsterStore((s) => s.houseSpeaking);
  const connected = useMonsterStore((s) => s.connected);
  const houseMode = useMonsterStore((s) => s.houseMode);
  const micStatus = useMonsterStore((s) => s.micStatus);
  const liveInterimCaption = useMonsterStore((s) => s.liveInterimCaption);
  const phonemeTarget = useMonsterStore((s) => s.phonemeCheckActiveTarget);

  const speakCustomScript = useMonsterStore((s) => s.speakCustomScript);
  const addSoundboardItem = useMonsterStore((s) => s.addSoundboardItem);
  const updateOpeningMix = useMonsterStore((s) => s.updateOpeningMix);
  const submitVisitorTextOrSpeech = useMonsterStore((s) => s.submitVisitorTextOrSpeech);
  const connectAgent = useMonsterStore((s) => s.connectAgent);
  const setHouseMode = useMonsterStore((s) => s.setHouseMode);
  const stopHouseSpeaking = useMonsterStore((s) => s.stopHouseSpeaking);
  const runPhonemeCheck44 = useMonsterStore((s) => s.runPhonemeCheck44);
  const stopPhonemeCheck = useMonsterStore((s) => s.stopPhonemeCheck);
  const triggerIdleGrumble = useMonsterStore((s) => s.triggerIdleGrumble);

  const appendTag = (tag: string) => {
    setCustomScript((prev) => `${prev}${prev.endsWith(' ') || prev.length === 0 ? '' : ' '}[${tag}] `);
  };

  const handleVisitorSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitorInput.trim()) return;
    const text = visitorInput.trim();
    setVisitorInput('');
    void submitVisitorTextOrSpeech(text);
  };

  const grumpyPct = 100 - openingMix.warmPct;
  const greetingPct = 100 - openingMix.questionPct;

  return (
    <div className="mh-col">
      {/* 1. Soundboard ("Little horrors. On demand.") */}
      <section className="mh-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.09em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              THE MONSTER HAS SOMETHING TO SAY
            </div>
            <h2 className="mh-hero-heading">Little horrors. On demand.</h2>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>
              Cut into a story. Pick a line. Phoneme check runs 44 sound targets, one target every 1.2 seconds.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="mh-btn"
              style={{ fontSize: 11 }}
              onClick={() => (phonemeTarget ? stopPhonemeCheck() : runPhonemeCheck44())}
            >
              {phonemeTarget ? `Stop Check (${phonemeTarget})` : 'Phoneme Check (44)'}
            </button>
            <button
              type="button"
              className="mh-btn"
              style={{ fontSize: 11 }}
              onClick={() => void triggerIdleGrumble()}
            >
              Idle Grumble
            </button>
          </div>
        </div>

        <div className="mh-soundboard-grid">
          {soundboardItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="mh-sb-btn"
              onClick={() => void speakCustomScript(item.script)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
                  {item.indexLabel}
                </span>
                <span style={{ fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.title}
                </span>
              </span>
              <Play size={11} color="#76b900" fill="#76b900" />
            </button>
          ))}
        </div>
      </section>

      {/* 2. Put Words In My Mouth */}
      <section className="mh-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--nvidia-green)' }}>
              Put words in my mouth
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              What should the monster say?
            </div>
          </div>

          <div className="mh-chip-row">
            {ALL_MOODS.map((m: MoodTag) => (
              <button
                key={m}
                type="button"
                className="mh-chip"
                onClick={() => appendTag(m)}
                style={{ textTransform: 'capitalize' }}
              >
                {m}
              </button>
            ))}
            <button type="button" className="mh-chip" onClick={() => appendTag('pause')}>
              Pause
            </button>
            <button type="button" className="mh-chip" onClick={() => appendTag('short pause')}>
              Short pause
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 3 }}>
          {customScript.length}/1,200
        </div>

        <textarea
          className="mh-textarea"
          rows={3}
          maxLength={1200}
          value={customScript}
          onChange={(e) => setCustomScript(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            Emotion tags affect following words. [pause] adds 900 ms of silence; [short pause] adds 300 ms. Tags are not spoken.
          </span>
          <button
            type="button"
            className="mh-btn mh-btn-primary"
            onClick={() => void speakCustomScript(customScript)}
          >
            <Volume2 size={13} /> Speak
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Button name</span>
          <input
            type="text"
            className="mh-input"
            placeholder="Optional soundboard label"
            value={customButtonTitle}
            onChange={(e) => setCustomButtonTitle(e.target.value)}
          />
          <button
            type="button"
            className="mh-btn"
            style={{ whiteSpace: 'nowrap' }}
            onClick={() => {
              if (!customScript.trim()) return;
              addSoundboardItem(customButtonTitle, customScript, 'grumpy');
              setCustomButtonTitle('');
            }}
          >
            <Plus size={13} /> Add to soundboard
          </button>
        </div>
      </section>

      {/* 3. Opening Mix */}
      <section className="mh-card">
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--nvidia-green)', marginBottom: 8 }}>
          Opening mix
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
              <span>
                Grumpy <strong>{grumpyPct}%</strong> ↔ Warm <strong>{openingMix.warmPct}%</strong>
              </span>
            </div>
            <input
              type="range"
              className="mh-range"
              min={0}
              max={100}
              value={openingMix.warmPct}
              onChange={(e) => updateOpeningMix({ warmPct: Number(e.target.value) })}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
              <span>
                Greeting <strong>{greetingPct}%</strong> ↔ Question <strong>{openingMix.questionPct}%</strong>
              </span>
            </div>
            <input
              type="range"
              className="mh-range"
              min={0}
              max={100}
              value={openingMix.questionPct}
              onChange={(e) => updateOpeningMix({ questionPct: Number(e.target.value) })}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Live openings · warm/grumpy applies when a greeting is chosen.
        </div>
      </section>

      {/* 4. Conversation Flow (10-State FSM Visualizer) + Interactive Trick-or-Treat Bar */}
      <section className="mh-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--nvidia-green)' }}>
              Conversation flow
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Speak into your microphone when Connected, or test trick-or-treaters directly below:
            </div>
          </div>
          {houseSpeaking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mh-pill" style={{ borderColor: '#ff7b00', color: '#ffaa44' }}>
                MonsterHouse Speaking...
              </span>
              <button
                type="button"
                className="mh-btn"
                style={{ fontSize: 10.5, padding: '3px 8px' }}
                onClick={stopHouseSpeaking}
              >
                Stop
              </button>
            </div>
          )}
        </div>

        <div className="mh-flow-grid" style={{ marginBottom: 12 }}>
          {FLOW_CARDS.map((c) => {
            const isActive = encounterState === c.state;
            return (
              <div key={c.state} className={`mh-flow-card ${isActive ? 'active' : ''}`}>
                <div style={{ fontWeight: 700, fontSize: 12, color: isActive ? '#ffffff' : 'var(--text-primary)' }}>
                  {c.title}
                  {c.state === 'WarmGreeting' && ` · ${openingMix.warmPct}%`}
                  {c.state === 'GrumpyGreeting' && ` · ${grumpyPct}%`}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.35 }}>
                  {c.subtitle}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Trick-or-Treater Prompt Buttons + Text Box */}
        <div className="mh-card-subtle">
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MessageSquare size={12} color="#76b900" />
            Walk up to the garage door (Quick Trick-or-Treater Prompts or Type Anything):
          </div>
          <div className="mh-chip-row" style={{ marginBottom: 8 }}>
            {QUICK_TRICK_OR_TREAT_LINES.map((line) => (
              <button
                key={line}
                type="button"
                className="mh-chip"
                onClick={() => void submitVisitorTextOrSpeech(line)}
              >
                “{line}”
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 8,
              padding: '6px 9px',
              borderRadius: 6,
              background: 'rgba(118, 185, 0, 0.07)',
              border: '1px solid rgba(118, 185, 0, 0.2)',
              fontSize: 11.5,
            }}
          >
            {!connected ? (
              <>
                <span style={{ color: 'var(--text-secondary)' }}>
                  🎙️ Want to speak with your real voice? Click <strong>Connect</strong> first so MonsterHouse listens to your mic:
                </span>
                <button
                  type="button"
                  className="mh-btn mh-btn-primary"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => void connectAgent()}
                >
                  Connect &amp; Enable Mic
                </button>
              </>
            ) : houseMode === 'microphone' ? (
              <>
                <span style={{ color: '#ffaa44' }}>
                  🎭 You are in <strong>Puppet Mic</strong> mode (speaking <em>as</em> the house). Switch to <strong>Live</strong> to talk <em>to</em> MonsterHouse!
                </span>
                <button
                  type="button"
                  className="mh-btn mh-btn-primary"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => void setHouseMode('live')}
                >
                  Switch to Live Mode
                </button>
              </>
            ) : (
              <span
                style={{
                  color:
                    micStatus === 'hearing' || micStatus === 'transcribing'
                      ? '#a4ff2e'
                      : micStatus === 'mic-denied'
                        ? '#ffaa44'
                        : 'var(--text-secondary)',
                }}
              >
                {micStatus === 'mic-denied' &&
                  '⚠️ Microphone permission blocked or missing — allow mic access in your browser bar, or type below.'}
                {micStatus === 'hearing' &&
                  `🎙️ Hearing you speak${liveInterimCaption ? `: “${liveInterimCaption}”` : '...'}`}
                {micStatus === 'transcribing' && '⚡ Transcribing your voice & preparing pirate answer...'}
                {micStatus === 'listening' &&
                  (houseSpeaking
                    ? '🔊 MonsterHouse is answering — speak your next line as soon as it finishes!'
                    : '🎙️ Microphone live & listening — speak anytime (pause ~0.3s when done) or type below!')}
              </span>
            )}
          </div>

          <form onSubmit={handleVisitorSend} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="mh-input"
              placeholder="Say something to MonsterHouse (try demanding candy vs saying 'please' or 'thank you')..."
              value={visitorInput}
              onChange={(e) => setVisitorInput(e.target.value)}
            />
            <button type="submit" className="mh-btn mh-btn-primary">
              <Send size={13} /> Say to House
            </button>
          </form>

          {turns.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 185, overflowY: 'auto', display: 'grid', gap: 6 }}>
              {turns.slice(-8).map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: '6px 9px',
                    borderRadius: 5,
                    background: t.role === 'house' ? 'rgba(118, 185, 0, 0.09)' : 'rgba(255, 255, 255, 0.04)',
                    borderLeft: `3px solid ${t.role === 'house' ? '#76b900' : '#60a5fa'}`,
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                    <span>
                      {t.role === 'house' ? `🏴‍☠️ MonsterHouse [${t.mood ?? 'grumpy'}]` : '🎃 Trick-or-Treater'} · {t.encounterState}
                    </span>
                    {t.latencyMs !== undefined && (
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {t.fromCache ? '⚡ Cached' : '🧠 Live'} · {t.latencyMs} ms
                      </span>
                    )}
                  </div>
                  <div>{t.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
