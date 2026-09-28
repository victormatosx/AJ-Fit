import { describe, expect, it } from 'vitest';

import {
  evaluateSetForPersonalRecord,
  loggedWeightsForExercise,
  replayQueuedPersonalRecordChecks,
} from '../personalRecord';

describe('evaluateSetForPersonalRecord', () => {
  it('fires a PR on the very first set that beats the historical record — no second set required', () => {
    const evaluation = evaluateSetForPersonalRecord({
      historicalRecordKg: 55,
      sessionLoggedWeightsKg: [],
      candidateWeightKg: 60,
    });
    expect(evaluation).toEqual({ isRecord: true, baselineKg: 55 });
  });

  it('fires a second, independent PR once the session baseline has moved up', () => {
    // Session state after the 60kg set above: logged = [60].
    const evaluation = evaluateSetForPersonalRecord({
      historicalRecordKg: 55,
      sessionLoggedWeightsKg: [60],
      candidateWeightKg: 65,
    });
    expect(evaluation).toEqual({ isRecord: true, baselineKg: 60 });
  });

  it('does not fire when the set falls below the updated session baseline', () => {
    const evaluation = evaluateSetForPersonalRecord({
      historicalRecordKg: 55,
      sessionLoggedWeightsKg: [60, 65],
      candidateWeightKg: 63,
    });
    expect(evaluation).toEqual({ isRecord: false, baselineKg: 65 });
  });

  it('does not fire when the set exactly matches the record (must strictly beat it)', () => {
    const evaluation = evaluateSetForPersonalRecord({
      historicalRecordKg: 65,
      sessionLoggedWeightsKg: [],
      candidateWeightKg: 65,
    });
    expect(evaluation).toEqual({ isRecord: false, baselineKg: 65 });
  });

  it('never fires against a zero baseline (no history and no prior session set yet)', () => {
    const evaluation = evaluateSetForPersonalRecord({
      historicalRecordKg: 0,
      sessionLoggedWeightsKg: [],
      candidateWeightKg: 40,
    });
    expect(evaluation).toEqual({ isRecord: false, baselineKg: 0 });
  });

  it('the full reported sequence: 55 record -> 60 PR -> 65 PR -> 63 no PR', () => {
    let sessionLoggedWeightsKg: number[] = [];
    const historicalRecordKg = 55;

    const first = evaluateSetForPersonalRecord({ historicalRecordKg, sessionLoggedWeightsKg, candidateWeightKg: 60 });
    expect(first.isRecord).toBe(true);
    expect(first.baselineKg).toBe(55);
    sessionLoggedWeightsKg = [...sessionLoggedWeightsKg, 60];

    const second = evaluateSetForPersonalRecord({ historicalRecordKg, sessionLoggedWeightsKg, candidateWeightKg: 65 });
    expect(second.isRecord).toBe(true);
    expect(second.baselineKg).toBe(60);
    sessionLoggedWeightsKg = [...sessionLoggedWeightsKg, 65];

    const third = evaluateSetForPersonalRecord({ historicalRecordKg, sessionLoggedWeightsKg, candidateWeightKg: 63 });
    expect(third.isRecord).toBe(false);
    expect(third.baselineKg).toBe(65);
  });
});

describe('replayQueuedPersonalRecordChecks — resolves the loading-race without a false negative', () => {
  it('recognizes a set confirmed before the historical record finished loading', () => {
    // Historical record = 55kg. The user confirms 60kg while it's still
    // loading — `evaluateSetForPersonalRecord` never runs synchronously for
    // it; it goes on this queue instead, replayed once the record resolves.
    const { recognized } = replayQueuedPersonalRecordChecks(
      [{ exerciseId: 'bench', weightKg: 60 }],
      { bench: 55 },
    );
    expect(recognized).toEqual({ exerciseId: 'bench', weightKg: 60, baselineKg: 55 });
  });

  it('replays a whole chain in confirmation order: 55 -> 60 PR -> 65 PR -> 63 no PR', () => {
    const { recognized } = replayQueuedPersonalRecordChecks(
      [
        { exerciseId: 'bench', weightKg: 60 },
        { exerciseId: 'bench', weightKg: 65 },
        { exerciseId: 'bench', weightKg: 63 },
      ],
      { bench: 55 },
    );
    // Only the latest newly-recognized PR is surfaced — 65, not 60.
    expect(recognized).toEqual({ exerciseId: 'bench', weightKg: 65, baselineKg: 60 });
  });

  it('reports no PR when nothing in the queue beats the resolved record', () => {
    const { recognized } = replayQueuedPersonalRecordChecks(
      [{ exerciseId: 'bench', weightKg: 50 }],
      { bench: 55 },
    );
    expect(recognized).toBeNull();
  });

  it('treats a missing historical record the same as zero, never inventing a baseline', () => {
    const { recognized } = replayQueuedPersonalRecordChecks(
      [{ exerciseId: 'new-exercise', weightKg: 40 }],
      {},
    );
    expect(recognized).toBeNull();
  });

  it('does nothing for an empty queue (the common case — history usually loads before any set is confirmed)', () => {
    expect(replayQueuedPersonalRecordChecks([], { bench: 55 }).recognized).toBeNull();
  });

  it('keeps exercises independent within the same replay pass', () => {
    const { recognized } = replayQueuedPersonalRecordChecks(
      [
        { exerciseId: 'bench', weightKg: 50 }, // below its 55 record — no PR
        { exerciseId: 'squat', weightKg: 90 }, // above its 80 record — PR
      ],
      { bench: 55, squat: 80 },
    );
    expect(recognized).toEqual({ exerciseId: 'squat', weightKg: 90, baselineKg: 80 });
  });
});

describe('loggedWeightsForExercise', () => {
  it('reads only the logged sets for the given exercise id', () => {
    expect(loggedWeightsForExercise({
      'bench-0': 60,
      'bench-1': 65,
      'squat-0': 100,
    }, 'bench')).toEqual([60, 65]);
  });

  it('does not match a different exercise whose id is a prefix of this one', () => {
    expect(loggedWeightsForExercise({
      'bench-press-0': 40,
      'bench-0': 60,
    }, 'bench')).toEqual([60]);
  });

  it('returns nothing for an exercise with no logged sets yet', () => {
    expect(loggedWeightsForExercise({}, 'bench')).toEqual([]);
  });
});
