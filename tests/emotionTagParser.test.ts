import { describe, expect, it } from 'vitest';
import {
  filterNemotronSpeechText,
  parseEmotionTaggedScript,
  StreamingClauseAccumulator,
  stripTagsForDisplay,
} from '../src/orchestrator/emotionTagParser';

describe('emotionTagParser & StreamingClauseAccumulator', () => {
  it('parses [mood], [pause]=900ms, and [short pause]=300ms without speaking tags aloud', () => {
    const raw =
      '[grumpy] Get off my lawn! [short pause] Wait a second... [curious] Is that a pirate hat? [pause] [delighted] Take a candy bar!';
    const segments = parseEmotionTaggedScript(raw, 'weary');

    expect(segments).toEqual([
      { type: 'speech', text: 'Get off my lawn!', mood: 'grumpy', pauseMs: 0 },
      { type: 'pause', text: '', mood: 'grumpy', pauseMs: 300 },
      { type: 'speech', text: 'Wait a second...', mood: 'grumpy', pauseMs: 0 },
      { type: 'speech', text: 'Is that a pirate hat?', mood: 'curious', pauseMs: 0 },
      { type: 'pause', text: '', mood: 'curious', pauseMs: 900 },
      { type: 'speech', text: 'Take a candy bar!', mood: 'delighted', pauseMs: 0 },
    ]);
  });

  it('strips TTS-reserved characters (*, {}, <tag>, markdown) cleanly', () => {
    const dirty = '*growls* <prosody> {scary} `Boo` [link](https://example.com) matey!';
    expect(filterNemotronSpeechText(dirty)).toBe('growls prosody> scary Boo link matey!');
    expect(stripTagsForDisplay('[menacing] *Step* closer! [short pause] Scallywag!')).toBe(
      'Step closer! Scallywag!',
    );
  });

  it('releases first spoken clause early during token-by-token streaming', () => {
    const acc = new StreamingClauseAccumulator('grumpy');
    const tokens = [
      '[irri',
      'tated] ',
      'Hold ',
      'your ',
      'horses, ',
      'matey! ',
      '[amused] ',
      'You ',
      'actually ',
      'said ',
      'please.',
    ];

    const earlyReleased = [];
    for (const tok of tokens.slice(0, 6)) {
      earlyReleased.push(...acc.pushToken(tok));
    }

    // First clause should already be released before the second clause even arrives!
    expect(earlyReleased).toHaveLength(1);
    expect(earlyReleased[0]).toEqual({
      type: 'speech',
      text: 'Hold your horses, matey!',
      mood: 'irritated',
      pauseMs: 0,
    });

    for (const tok of tokens.slice(6)) {
      earlyReleased.push(...acc.pushToken(tok));
    }
    earlyReleased.push(...acc.flush());

    expect(earlyReleased).toHaveLength(2);
    expect(earlyReleased[1]).toEqual({
      type: 'speech',
      text: 'You actually said please.',
      mood: 'amused',
      pauseMs: 0,
    });
    expect(acc.getActiveMood()).toBe('amused');
  });

  it('suppresses <think>...</think> chain-of-thought blocks in both static and streaming modes', () => {
    expect(
      parseEmotionTaggedScript('<think>Visitor said please! Dispense candy.</think>[delighted] Aye, take a treat!'),
    ).toEqual([{ type: 'speech', text: 'Aye, take a treat!', mood: 'delighted', pauseMs: 0 }]);

    const acc = new StreamingClauseAccumulator('grumpy');
    expect(acc.pushToken('<think>Let me think. ')).toEqual([]);
    expect(acc.pushToken('Should I give candy?')).toEqual([]);
    const afterClose = acc.pushToken('</think>[amused] Fine, catch! ');
    expect(afterClose).toEqual([
      { type: 'speech', text: 'Fine, catch!', mood: 'amused', pauseMs: 0 },
    ]);
  });
});
