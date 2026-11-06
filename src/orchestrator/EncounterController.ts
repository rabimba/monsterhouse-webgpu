import type {
  EncounterState,
  HouseMode,
  MoodTag,
  OpeningMixSettings,
  TrackedVisitor,
} from '../types/monster';
import {
  COSTUME_QUIPS,
  PREPARED_DIALOGUE_BANK,
  QUESTION_OPENERS,
  STATE_PERSONA_EXEMPLARS,
} from './piratePersonaBank';

export interface EncounterDecision {
  nextState: EncounterState;
  mood: MoodTag;
  dispenseCandy: boolean;
  wonOver: boolean;
  /** Non-null if the prepared authored text bank should handle this beat immediately */
  preparedScript: string | null;
  /** Compiled system + context + few-shot messages when delegating to the WebGPU LLM */
  llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

const POLITE_REGEX = /\b(please|pretty please|kindly|if you please|s'il vous plait|por favor)\b/i;
const THANKS_FAREWELL_REGEX =
  /\b(thank you|thanks|thank ye|thx|bye|goodbye|good night|goodnight|happy halloween|see ya|see you|farewell)\b/i;
const CANDY_REQUEST_REGEX =
  /\b(trick or treat|candy|treat|treats|chocolate|loot|sweets|sugar|plunder|bar|give me|can i have|may i have)\b/i;

const STATE_DEFAULT_MOOD: Record<EncounterState, MoodTag> = {
  WarmGreeting: 'amused',
  GrumpyGreeting: 'grumpy',
  FirstRefusal: 'grumpy',
  GrumpyBanter: 'irritated',
  AnswerPlusCandy: 'delighted',
  GivingIn: 'delighted',
  WarmFollowUp: 'delighted',
  GrudgingFollowUp: 'amused',
  Goodbye: 'delighted',
  IdleSelfTalk: 'weary',
};

/**
 * Stateful Trick-or-Treat Encounter Controller.
 * Keeps politeness, refusal count, question-asked state, and won-over memory in deterministic
 * application logic—matching the MonsterHouse architecture diagram (`3_voice_pipeline.png`).
 */
export class EncounterController {
  private state: EncounterState = 'IdleSelfTalk';
  private wonOver = false;
  private candyDispensedCount = 0;
  private refusalTurns = 0;
  private askedOpeningQuestion = false;
  private bankCounters: Record<string, number> = {};

  getState(): EncounterState {
    return this.state;
  }

  isWonOver(): boolean {
    return this.wonOver;
  }

  getRefusalTurns(): number {
    return this.refusalTurns;
  }

  getCandyDispensedCount(): number {
    return this.candyDispensedCount;
  }

  recordManualCandyDispense(): number {
    this.candyDispensedCount += 1;
    return this.candyDispensedCount;
  }

  resetForNewVisitors(): void {
    this.state = 'IdleSelfTalk';
    this.wonOver = false;
    this.refusalTurns = 0;
    this.askedOpeningQuestion = false;
  }

  /**
   * Triggered by "Wake up / new visitors" button or ByteTrack detecting a new driveway arrival.
   */
  triggerVisitorArrival(
    openingMix: OpeningMixSettings,
    visitors: TrackedVisitor[],
    usePreparedBank: boolean,
    systemPrompt: string,
    useCharacterAdapter: boolean,
    rng: () => number = Math.random,
  ): EncounterDecision {
    this.wonOver = visitors.length > 0 && visitors.every((v) => v.wonOver);
    this.refusalTurns = 0;

    if (this.wonOver) {
      this.state = 'WarmFollowUp';
      return {
        nextState: this.state,
        mood: 'delighted',
        dispenseCandy: false,
        wonOver: true,
        preparedScript: usePreparedBank ? this.pickFromBank('WarmFollowUp') : null,
        llmMessages: this.buildLlmMessages(
          '(Returning polite visitors stepped up to the driveway)',
          visitors,
          systemPrompt,
          useCharacterAdapter,
        ),
      };
    }

    const askQuestion = rng() * 100 < openingMix.questionPct;
    const isWarm = rng() * 100 < openingMix.warmPct;
    this.askedOpeningQuestion = askQuestion;
    this.state = isWarm ? 'WarmGreeting' : 'GrumpyGreeting';
    const mood: MoodTag = askQuestion ? 'curious' : isWarm ? 'amused' : 'grumpy';

    // Check if Omni Observer already identified a distinctive costume!
    const knownCostumeVisitor = visitors.find(
      (v) => v.costume && v.costume.toLowerCase() !== 'unknown' && v.costume.toLowerCase() !== 'visitor',
    );

    let preparedScript: string | null = null;
    if (usePreparedBank) {
      if (knownCostumeVisitor) {
        const key = knownCostumeVisitor.costume.toLowerCase();
        if (COSTUME_QUIPS[key]) {
          preparedScript = COSTUME_QUIPS[key];
        }
      }
      if (!preparedScript) {
        preparedScript = askQuestion
          ? this.pickRoundRobin('question', QUESTION_OPENERS)
          : this.pickFromBank(this.state);
      }
    }

    return {
      nextState: this.state,
      mood,
      dispenseCandy: false,
      wonOver: false,
      preparedScript,
      llmMessages: this.buildLlmMessages(
        askQuestion
          ? '(New trick-or-treaters arrived at the driveway. Greet them and ask a playful Halloween question.)'
          : `(New trick-or-treaters arrived at the driveway. Give a ${isWarm ? 'warm pirate' : 'grumpy pirate'} greeting.)`,
        visitors,
        systemPrompt,
        useCharacterAdapter,
      ),
    };
  }

  /**
   * Triggered during idle driveway stretches for atmospheric grumbling.
   */
  triggerIdleSelfTalk(): string {
    this.state = 'IdleSelfTalk';
    return this.pickFromBank('IdleSelfTalk');
  }

  /**
   * Evaluates a visitor's spoken utterance and advances the Encounter FSM.
   */
  evaluateVisitorTurn(params: {
    transcript: string;
    houseMode: HouseMode;
    useCachedResponses: boolean;
    useCharacterAdapter: boolean;
    systemPrompt: string;
    recentHistory: Array<{ role: 'visitor' | 'house'; text: string }>;
    visitors: TrackedVisitor[];
  }): EncounterDecision {
    const {
      transcript,
      houseMode,
      useCachedResponses,
      useCharacterAdapter,
      systemPrompt,
      recentHistory,
      visitors,
    } = params;

    const clean = transcript.trim();

    // Demo Mode: always generate fresh self-aware architectural banter unless empty
    if (houseMode === 'demo') {
      this.state = 'WarmFollowUp';
      return {
        nextState: 'WarmFollowUp',
        mood: 'amused',
        dispenseCandy: false,
        wonOver: true,
        preparedScript: null,
        llmMessages: this.buildLlmMessages(
          clean || 'Explain how MonsterHouse works in the browser using WebGPU.',
          visitors,
          systemPrompt,
          useCharacterAdapter,
          recentHistory,
        ),
      };
    }

    const saidPlease = POLITE_REGEX.test(clean);
    const saidThanksOrBye = THANKS_FAREWELL_REGEX.test(clean);
    const askedForCandy = CANDY_REQUEST_REGEX.test(clean);
    let dispenseCandy = false;

    if (saidThanksOrBye && (this.wonOver || this.candyDispensedCount > 0)) {
      this.state = 'Goodbye';
    } else if (saidPlease && !this.wonOver) {
      // "A 'Please' could break through immediately!"
      this.state = 'GivingIn';
      this.wonOver = true;
      dispenseCandy = true;
      this.candyDispensedCount += 1;
      this.askedOpeningQuestion = false;
    } else if (this.wonOver) {
      // "Once a visitor won him over, I wanted him to stay won over."
      this.state = this.refusalTurns > 0 ? 'GrudgingFollowUp' : 'WarmFollowUp';
    } else if (this.askedOpeningQuestion && clean.split(/\s+/).length >= 1 && !askedForCandy) {
      this.state = 'AnswerPlusCandy';
      this.wonOver = true;
      dispenseCandy = true;
      this.candyDispensedCount += 1;
      this.askedOpeningQuestion = false;
    } else if (this.refusalTurns === 0 && askedForCandy) {
      this.state = 'FirstRefusal';
      this.refusalTurns = 1;
    } else if (this.refusalTurns >= 2) {
      // Persistence wears him down so nobody gets stuck in an endless argument with a garage door!
      this.state = 'GivingIn';
      this.wonOver = true;
      dispenseCandy = true;
      this.candyDispensedCount += 1;
    } else {
      this.state = 'GrumpyBanter';
      this.refusalTurns += 1;
    }

    const mood = STATE_DEFAULT_MOOD[this.state];

    // Decide whether Authored Prepared Text Bank should answer directly (Shortcut #1)
    // We use prepared text when `useCachedResponses` is checked AND the turn hits a classic
    // structural beat (pure "Trick or treat!", pure "Please!", or pure "Thank you / Bye!"),
    // while letting open-ended conversational questions flow to the LLM!
    const isShortFormulaicBeat =
      clean.split(/\s+/).length <= 7 &&
      (this.state === 'FirstRefusal' || this.state === 'GivingIn' || this.state === 'Goodbye');

    const preparedScript =
      useCachedResponses && isShortFormulaicBeat ? this.pickFromBank(this.state) : null;

    return {
      nextState: this.state,
      mood,
      dispenseCandy,
      wonOver: this.wonOver,
      preparedScript,
      llmMessages: this.buildLlmMessages(
        clean,
        visitors,
        systemPrompt,
        useCharacterAdapter,
        recentHistory,
      ),
    };
  }

  private pickFromBank(state: EncounterState): string {
    return this.pickRoundRobin(state, PREPARED_DIALOGUE_BANK[state]);
  }

  private pickRoundRobin(key: string, items: string[]): string {
    if (items.length === 0) return '[grumpy] Bah!';
    const idx = (this.bankCounters[key] ?? 0) % items.length;
    this.bankCounters[key] = idx + 1;
    return items[idx];
  }

  private buildLlmMessages(
    visitorInput: string,
    visitors: TrackedVisitor[],
    systemPrompt: string,
    useCharacterAdapter: boolean,
    recentHistory: Array<{ role: 'visitor' | 'house'; text: string }> = [],
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const costumeNote =
      visitors.length > 0
        ? `CURRENT VISIBLE VISITORS (ECHOLOCATION): ${visitors.length} visitor(s) at the door — ${visitors
            .map(
              (v) =>
                `#${String(v.trackId).padStart(2, '0')}: ${v.costume}${v.costumeDetail ? ` (${v.costumeDetail})` : ''}`,
            )
            .join('; ')}.`
        : 'CURRENT VISIBLE VISITORS (ECHOLOCATION): Camera off or no costumes identified.';

    const stateDirective = `CURRENT ENCOUNTER STATE: ${this.state} | Visitor Won Over: ${
      this.wonOver ? 'YES (stay warm/fond, do not refuse)' : 'NO'
    } | Refusal Count: ${this.refusalTurns}.`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `${systemPrompt}\n\n${stateDirective}\n${costumeNote}`,
      },
    ];

    if (useCharacterAdapter) {
      const exemplars = STATE_PERSONA_EXEMPLARS[this.state] ?? [];
      for (const ex of exemplars) {
        messages.push({ role: 'user', content: ex.visitor });
        messages.push({ role: 'assistant', content: ex.house });
      }
    }

    for (const turn of recentHistory.slice(-6)) {
      messages.push({
        role: turn.role === 'visitor' ? 'user' : 'assistant',
        content: turn.text,
      });
    }

    messages.push({
      role: 'user',
      content: visitorInput,
    });

    return messages;
  }
}
