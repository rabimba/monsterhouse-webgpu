import { ALL_MOODS, type MoodTag, type SpeechSegment } from '../types/monster';

/**
 * Ported directly from NVIDIA Nemotron Voice Agent's `nemotron_speech_text_filter.py`:
 * Strips characters reserved by TTS preprocessors (<tag>, *, {, }) and markdown artifacts.
 */
const THINK_BLOCK = /<think>[\s\S]*?<\/think>|<\|thought\|>[\s\S]*?<\/?\|?thought\|?>/gi;
const TTS_RESERVED_CHARACTERS = /<(?=[A-Za-z/!])|[*{}]/g;
const MARKDOWN_CODE_FENCE = /```[\s\S]*?```/g;
const MARKDOWN_INLINE_CODE = /`([^`]+)`/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;

export function filterNemotronSpeechText(input: string): string {
  return input
    .replace(THINK_BLOCK, ' ')
    .replace(MARKDOWN_CODE_FENCE, ' ')
    .replace(MARKDOWN_INLINE_CODE, '$1')
    .replace(MARKDOWN_LINK, '$1')
    .replace(TTS_RESERVED_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TAG_REGEX = /\[\s*(grumpy|irritated|menacing|amused|curious|delighted|weary|pause|short\s+pause)\s*\]/gi;

const VALID_MOOD_SET = new Set<string>(ALL_MOODS);

/**
 * Parses MonsterHouse inline emotion & timing tags:
 * - [grumpy], [irritated], [menacing], [amused], [curious], [delighted], [weary]
 *   affect all following spoken words until changed.
 * - [pause] inserts 900 ms of silence; [short pause] inserts 300 ms of silence.
 * - Tags themselves are never spoken aloud.
 */
export function parseEmotionTaggedScript(
  script: string,
  defaultMood: MoodTag = 'grumpy',
): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let currentMood: MoodTag = defaultMood;
  let lastIndex = 0;

  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(script)) !== null) {
    const preceding = filterNemotronSpeechText(script.slice(lastIndex, match.index));
    if (preceding.length > 0) {
      segments.push({
        type: 'speech',
        text: preceding,
        mood: currentMood,
        pauseMs: 0,
      });
    }

    const normalizedTag = match[1].toLowerCase().replace(/\s+/g, ' ');
    if (normalizedTag === 'pause') {
      segments.push({
        type: 'pause',
        text: '',
        mood: currentMood,
        pauseMs: 900,
      });
    } else if (normalizedTag === 'short pause') {
      segments.push({
        type: 'pause',
        text: '',
        mood: currentMood,
        pauseMs: 300,
      });
    } else if (VALID_MOOD_SET.has(normalizedTag)) {
      currentMood = normalizedTag as MoodTag;
    }

    lastIndex = match.index + match[0].length;
  }

  const trailing = filterNemotronSpeechText(script.slice(lastIndex));
  if (trailing.length > 0) {
    segments.push({
      type: 'speech',
      text: trailing,
      mood: currentMood,
      pauseMs: 0,
    });
  }

  return segments;
}

/**
 * Strips inline tags for clean subtitle/transcript display while preserving human readability.
 */
export function stripTagsForDisplay(script: string): string {
  return filterNemotronSpeechText(script.replace(TAG_REGEX, ' '));
}

/**
 * Streaming clause accumulator that releases speakable segments as soon as a sentence/clause
 * boundary (`.`, `!`, `?`, `—`, `;`) or `[pause]`/`[short pause]` arrives during LLM token streaming,
 * reproducing the article's low-latency early-speech release.
 */
export class StreamingClauseAccumulator {
  private buffer = '';
  private currentMood: MoodTag;

  constructor(initialMood: MoodTag = 'grumpy') {
    this.currentMood = initialMood;
  }

  pushToken(chunk: string): SpeechSegment[] {
    this.buffer += chunk;
    const ready: SpeechSegment[] = [];

    // Strip any completed <think>...</think> blocks immediately
    if (THINK_BLOCK.test(this.buffer)) {
      this.buffer = this.buffer.replace(THINK_BLOCK, ' ');
    }

    // Hold tokens if an unclosed <think> or <|thought|> block is still streaming
    const lowerBuf = this.buffer.toLowerCase();
    const openThink = Math.max(lowerBuf.lastIndexOf('<think>'), lowerBuf.lastIndexOf('<|thought|>'));
    const closeThink = Math.max(lowerBuf.lastIndexOf('</think>'), lowerBuf.lastIndexOf('<|thought|>', openThink - 1));
    if (openThink !== -1 && openThink > closeThink && this.buffer.length - openThink < 600) {
      return ready;
    }

    // Wait if an unclosed '[' tag is still streaming in
    const openBracket = this.buffer.lastIndexOf('[');
    const closeBracket = this.buffer.lastIndexOf(']');
    if (openBracket > closeBracket && this.buffer.length - openBracket < 24) {
      return ready;
    }

    // Look for sentence-ending punctuation followed by whitespace or tag
    const boundaryRegex = /([.!?]+(?:\s+|(?=\[))|—\s+|\[\s*(?:pause|short\s+pause)\s*\])/i;
    let match: RegExpExecArray | null;

    while ((match = boundaryRegex.exec(this.buffer)) !== null) {
      const cutEnd = match.index + match[0].length;
      const slice = this.buffer.slice(0, cutEnd);
      this.buffer = this.buffer.slice(cutEnd);

      const parsed = parseEmotionTaggedScript(slice, this.currentMood);
      for (const seg of parsed) {
        this.currentMood = seg.mood;
        if (seg.type === 'pause' || seg.text.length >= 2) {
          ready.push(seg);
        }
      }
    }

    return ready;
  }

  flush(): SpeechSegment[] {
    const cleanedBuf = this.buffer
      .replace(THINK_BLOCK, ' ')
      .replace(/<think>[\s\S]*$/i, ' ');
    if (!cleanedBuf.trim()) {
      this.buffer = '';
      return [];
    }
    const parsed = parseEmotionTaggedScript(cleanedBuf, this.currentMood);
    if (parsed.length > 0) {
      this.currentMood = parsed[parsed.length - 1].mood;
    }
    this.buffer = '';
    return parsed;
  }

  getActiveMood(): MoodTag {
    return this.currentMood;
  }
}
