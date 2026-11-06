import { Activity, Candy, Maximize, Mic, Play, RotateCcw, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resampleLinearPcm } from '../../ai/a2fSolver';
import { VOICE_SAMPLE_PROMPTS } from '../../orchestrator/piratePersonaBank';
import { DEFAULT_KEYSTONE } from '../../stage/ProjectorSync';
import { useMonsterStore } from '../../store/useMonsterStore';
import {
  ACTIVE_44_SOUND_TARGETS,
  ALL_MOODS,
  type KeystoneCorners,
  type MoodTag,
} from '../../types/monster';

export function ToolsTab() {
  const voiceSamples = useMonsterStore((s) => s.voiceSamples);
  const phonemeCheckActiveTarget = useMonsterStore((s) => s.phonemeCheckActiveTarget);
  const candyDispensedCount = useMonsterStore((s) => s.candyDispensedCount);
  const keystone = useMonsterStore((s) => s.keystone);
  const selectedTtsEngine = useMonsterStore((s) => s.selectedTtsEngine);

  const recordAndSaveVoiceSample = useMonsterStore((s) => s.recordAndSaveVoiceSample);
  const setTtsEngine = useMonsterStore((s) => s.setTtsEngine);
  const runPhonemeCheck44 = useMonsterStore((s) => s.runPhonemeCheck44);
  const stopPhonemeCheck = useMonsterStore((s) => s.stopPhonemeCheck);
  const dispenseCandyNow = useMonsterStore((s) => s.dispenseCandyNow);
  const setKeystone = useMonsterStore((s) => s.setKeystone);

  const [recordingMood, setRecordingMood] = useState<MoodTag | null>(null);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const activeCaptureRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    chunks: Float32Array[];
    timerId: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (activeCaptureRef.current) {
        clearInterval(activeCaptureRef.current.timerId);
        activeCaptureRef.current.stream.getTracks().forEach((t) => t.stop());
        void activeCaptureRef.current.ctx.close();
      }
    };
  }, []);

  const startVoiceSampleCapture = async (mood: MoodTag) => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      const chunks: Float32Array[] = [];

      proc.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
      };

      src.connect(proc);
      proc.connect(silentGain);
      silentGain.connect(ctx.destination);

      let ticks = 0;
      const timerId = window.setInterval(() => {
        ticks += 1;
        const sec = ticks / 10;
        setRecordingElapsedSec(sec);
        if (sec >= 10) {
          void finishVoiceSampleCapture(mood);
        }
      }, 100);

      activeCaptureRef.current = { stream, ctx, chunks, timerId };
      setRecordingMood(mood);
      setRecordingElapsedSec(0);
    } catch {
      // Synthesize a clean calibration pirate growl if headless / no physical mic attached
      const sr = 24000;
      const len = sr * 3;
      const synthetic = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.sin(Math.min(1, t / 0.2) * (Math.PI / 2)) * Math.exp(-t * 0.35);
        synthetic[i] =
          (Math.sin(2 * Math.PI * 105 * t) * 0.5 + Math.sin(2 * Math.PI * 210 * t) * 0.3) * env;
      }
      await recordAndSaveVoiceSample(mood, synthetic, sr, VOICE_SAMPLE_PROMPTS[mood]);
      setMicError(
        'No physical microphone detected — stored a 3.0s synthetic baritone reference sample for zero-shot conditioning.',
      );
    }
  };

  const finishVoiceSampleCapture = async (mood: MoodTag) => {
    const cap = activeCaptureRef.current;
    if (!cap) return;
    activeCaptureRef.current = null;
    clearInterval(cap.timerId);
    cap.stream.getTracks().forEach((t) => t.stop());

    const totalSamples = cap.chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const c of cap.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    const pcm24k = resampleLinearPcm(merged, cap.ctx.sampleRate, 24000);
    await cap.ctx.close().catch(() => {});

    setRecordingMood(null);
    if (pcm24k.length > 1200) {
      await recordAndSaveVoiceSample(mood, pcm24k, 24000, VOICE_SAMPLE_PROMPTS[mood]);
    }
  };

  const playSavedSample = (mood: MoodTag) => {
    const rec = voiceSamples[mood];
    if (!rec) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const buf = ctx.createBuffer(1, rec.pcmFloat32.length, rec.sampleRate);
    buf.getChannelData(0).set(rec.pcmFloat32);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      void ctx.close();
    };
    src.start();
  };

  const updateCorner = (
    corner: keyof KeystoneCorners,
    axis: 0 | 1,
    val: number,
  ) => {
    const nextPair: [number, number] = [...keystone[corner]] as [number, number];
    nextPair[axis] = val;
    setKeystone({ ...keystone, [corner]: nextPair });
  };

  const savedCount = Object.keys(voiceSamples).length;

  return (
    <div className="mh-col">
      {/* Sample Your Voice Studio */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Mic size={13} color="#91e000" />
            &ldquo;Sample Your Voice&rdquo; — Zero-Shot Pirate Voice Conditioning Studio
          </span>
          <span className="mh-pill">
            {savedCount} / {ALL_MOODS.length} Moods Sampled
          </span>
        </div>

        <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--text-secondary)' }}>
          Record 3–10 seconds for each pirate mood below. Saved reference clips persist in IndexedDB
          and condition <strong>Chatterbox-Turbo WebGPU</strong> zero-shot voice cloning per emotion tag.
        </p>

        {selectedTtsEngine !== 'chatterbox-zeroshot' && savedCount > 0 && (
          <div
            className="mh-card-subtle"
            style={{
              marginBottom: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11.5 }}>
              Switch TTS engine to <strong>Chatterbox-Turbo Zero-Shot</strong> to use your recorded voice samples live.
            </span>
            <button
              type="button"
              className="mh-btn mh-btn-primary"
              onClick={() => setTtsEngine('chatterbox-zeroshot')}
            >
              Activate Zero-Shot Voice
            </button>
          </div>
        )}

        {micError && (
          <div
            className="mh-card-subtle"
            style={{ marginBottom: 10, borderColor: 'rgba(245, 158, 11, 0.5)', color: '#fde68a', fontSize: 11.5 }}
          >
            {micError}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
          {ALL_MOODS.map((mood) => {
            const sample = voiceSamples[mood];
            const isRec = recordingMood === mood;
            return (
              <div key={mood} className="mh-card-subtle">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>
                    [{mood}]
                  </span>
                  <span style={{ fontSize: 10.5, color: sample ? '#91e000' : 'var(--text-muted)' }}>
                    {sample ? `Saved (${sample.durationSec}s)` : 'No sample yet'}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    fontStyle: 'italic',
                    marginBottom: 8,
                    minHeight: 32,
                  }}
                >
                  &ldquo;{VOICE_SAMPLE_PROMPTS[mood]}&rdquo;
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {isRec ? (
                    <button
                      type="button"
                      className="mh-btn mh-btn-danger"
                      style={{ flex: 1 }}
                      onClick={() => void finishVoiceSampleCapture(mood)}
                    >
                      <Square size={11} />
                      Stop ({recordingElapsedSec.toFixed(1)}s)
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mh-btn"
                      style={{ flex: 1 }}
                      disabled={recordingMood !== null}
                      onClick={() => void startVoiceSampleCapture(mood)}
                    >
                      <Mic size={11} color="#91e000" />
                      {sample ? 'Re-record' : 'Record 3–10s'}
                    </button>
                  )}

                  {sample && (
                    <button
                      type="button"
                      className="mh-btn"
                      title="Play recorded voice sample"
                      onClick={() => playSavedSample(mood)}
                    >
                      <Play size={11} />
                      Play
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 44-Target ARKit Phoneme Calibration & Candy Launcher */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <section className="mh-card">
          <div className="mh-section-label">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Activity size={13} color="#91e000" />
              44-Target ARKit Splintered-Plank Calibration
            </span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Sweeps all <strong>{ACTIVE_44_SOUND_TARGETS.length} active sound targets</strong> from{' '}
            <code>bs_skin_config.json</code> (1.2s per pose) across the 24 split garage-door planks while
            keeping the 8 eyeless poses masked to <code>0</code>.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {phonemeCheckActiveTarget ? (
              <button type="button" className="mh-btn mh-btn-danger" onClick={stopPhonemeCheck}>
                <Square size={12} />
                Stop Check ({phonemeCheckActiveTarget})
              </button>
            ) : (
              <button type="button" className="mh-btn mh-btn-primary" onClick={runPhonemeCheck44}>
                <Play size={12} />
                Phoneme check ({ACTIVE_44_SOUND_TARGETS.length} targets)
              </button>
            )}
          </div>
        </section>

        <section className="mh-card">
          <div className="mh-section-label">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Candy size={13} color="#fde047" />
              Physical / 3D Treat Chute Trigger
            </span>
            <span className="mh-pill">Dispensed: {candyDispensedCount}</span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Fires a celebratory golden spark burst and launches spinning full-size candy bars out of the
            furnace mouth onto the wet driveway (and synced projector window).
          </p>
          <button type="button" className="mh-btn mh-btn-primary" onClick={dispenseCandyNow}>
            <Candy size={13} />
            Dispense Candy Barrage Now
          </button>
        </section>
      </div>

      {/* Garage-Door Projector Keystone Corner-Pin */}
      <section className="mh-card">
        <div className="mh-section-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Maximize size={13} color="#91e000" />
            Projector Keystone Corner-Pin Calibration
          </span>
          <button
            type="button"
            className="mh-btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => setKeystone(DEFAULT_KEYSTONE)}
          >
            <RotateCcw size={11} />
            Reset Geometry
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {(
            [
              ['topLeft', 'Top Left'],
              ['topRight', 'Top Right'],
              ['bottomLeft', 'Bottom Left'],
              ['bottomRight', 'Bottom Right'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="mh-card-subtle">
              <div style={{ fontWeight: 700, fontSize: 11.5, marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                X: {keystone[key][0]}%
                <input
                  type="range"
                  className="mh-range"
                  min={0}
                  max={100}
                  value={keystone[key][0]}
                  onChange={(e) => updateCorner(key, 0, Number(e.target.value))}
                />
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                Y: {keystone[key][1]}%
                <input
                  type="range"
                  className="mh-range"
                  min={0}
                  max={100}
                  value={keystone[key][1]}
                  onChange={(e) => updateCorner(key, 1, Number(e.target.value))}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
