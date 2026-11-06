import { describe, expect, it } from 'vitest';
import { EncounterController } from '../src/orchestrator/EncounterController';
import type { TrackedVisitor } from '../src/types/monster';

const TEST_PROMPT = 'You are MonsterHouse, a grumpy pirate ship garage door.';

describe('EncounterController (10-State Trick-or-Treat FSM)', () => {
  it('routes initial candy demand to FirstRefusal without dispensing candy', () => {
    const ctrl = new EncounterController();
    ctrl.triggerVisitorArrival(
      { warmPct: 0, questionPct: 0 },
      [],
      true,
      TEST_PROMPT,
      true,
      () => 0.5,
    );
    expect(ctrl.getState()).toBe('GrumpyGreeting');

    const dec = ctrl.evaluateVisitorTurn({
      transcript: 'Trick or treat! Give us candy!',
      houseMode: 'live',
      useCachedResponses: true,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });

    expect(dec.nextState).toBe('FirstRefusal');
    expect(dec.dispenseCandy).toBe(false);
    expect(dec.wonOver).toBe(false);
    expect(dec.preparedScript).toBeTruthy();
  });

  it('breaks through immediately on "please" and dispenses candy', () => {
    const ctrl = new EncounterController();
    const dec = ctrl.evaluateVisitorTurn({
      transcript: 'Trick or treat, may we please have some chocolate?',
      houseMode: 'live',
      useCachedResponses: true,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });

    expect(dec.nextState).toBe('GivingIn');
    expect(dec.dispenseCandy).toBe(true);
    expect(dec.wonOver).toBe(true);
    expect(ctrl.getCandyDispensedCount()).toBe(1);
  });

  it('remembers wonOver visitors on subsequent turns without making them beg twice', () => {
    const ctrl = new EncounterController();
    ctrl.evaluateVisitorTurn({
      transcript: 'Please can I have candy?',
      houseMode: 'live',
      useCachedResponses: false,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });
    expect(ctrl.isWonOver()).toBe(true);

    const followUp = ctrl.evaluateVisitorTurn({
      transcript: 'Your flaming teeth look awesome!',
      houseMode: 'live',
      useCachedResponses: false,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });
    expect(followUp.nextState).toBe('WarmFollowUp');
    expect(followUp.wonOver).toBe(true);
    expect(followUp.dispenseCandy).toBe(false);

    const farewell = ctrl.evaluateVisitorTurn({
      transcript: 'Thank you Monster House, Happy Halloween!',
      houseMode: 'live',
      useCachedResponses: true,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });
    expect(farewell.nextState).toBe('Goodbye');
    expect(farewell.preparedScript).toBeTruthy();
  });

  it('gives in after persistent banter (>= 3 turns) so kids never get stuck', () => {
    const ctrl = new EncounterController();

    const t1 = ctrl.evaluateVisitorTurn({
      transcript: 'Give us treats right now!',
      houseMode: 'live',
      useCachedResponses: false,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });
    expect(t1.nextState).toBe('FirstRefusal');

    const t2 = ctrl.evaluateVisitorTurn({
      transcript: 'Come on, you are just a wooden garage door!',
      houseMode: 'live',
      useCachedResponses: false,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });
    expect(t2.nextState).toBe('GrumpyBanter');

    const t3 = ctrl.evaluateVisitorTurn({
      transcript: 'We are not leaving your driveway!',
      houseMode: 'live',
      useCachedResponses: false,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [],
    });
    expect(t3.nextState).toBe('GivingIn');
    expect(t3.dispenseCandy).toBe(true);
    expect(t3.wonOver).toBe(true);
  });

  it('routes OpeningMix probabilities for warm greetings and question openers -> AnswerPlusCandy', () => {
    const ctrl = new EncounterController();
    const visitor: TrackedVisitor = {
      trackId: 1,
      bbox: [0.2, 0.2, 0.5, 0.8],
      confidence: 0.94,
      costume: 'Unknown',
      firstSeenMs: 1000,
      lastSeenMs: 1000,
      wonOver: false,
    };

    const arrival = ctrl.triggerVisitorArrival(
      { warmPct: 100, questionPct: 100 },
      [visitor],
      true,
      TEST_PROMPT,
      true,
      () => 0.1,
    );
    expect(arrival.nextState).toBe('WarmGreeting');
    expect(arrival.mood).toBe('curious');

    const answer = ctrl.evaluateVisitorTurn({
      transcript: 'I would rather sail through a ghost storm!',
      houseMode: 'live',
      useCachedResponses: false,
      useCharacterAdapter: true,
      systemPrompt: TEST_PROMPT,
      recentHistory: [],
      visitors: [visitor],
    });
    expect(answer.nextState).toBe('AnswerPlusCandy');
    expect(answer.dispenseCandy).toBe(true);
  });
});
