import { describe, expect, it } from 'vitest';

import {
  nextRecommendedDate,
  nonPunitiveWorkoutReminder,
  resolveFreeSchedule,
  type FreeScheduleResolution,
} from '../freeScheduleResolver';
import { selectSession } from '../sessionSuggestion';
import type { Weekday } from '../../state/AppState';

// 2026-10-19 Mon · 20 Tue · 21 Wed · 24 Sat · 25 Sun
const MON = '2026-10-19';
const TUE = '2026-10-20';
const SAT = '2026-10-24';
const SUN = '2026-10-25';
const MON_FRI = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as Weekday[];

const at = (today: string, overrides: Partial<Parameters<typeof resolveFreeSchedule>[0]> = {}) =>
  resolveFreeSchedule({
    hasActiveProgram: true,
    sessionCount: 3,
    state: { nextSessionIndex: 1 },
    recommendedWeekdays: MON_FRI,
    todayLocalDate: today,
    ...overrides,
  });

const ready = (resolution: FreeScheduleResolution) => {
  if (resolution.status !== 'SESSION_READY') throw new Error(`expected SESSION_READY, got ${resolution.status}`);
  return resolution;
};
const done = (resolution: FreeScheduleResolution) => {
  if (resolution.status !== 'TODAY_COMPLETED') throw new Error(`expected TODAY_COMPLETED, got ${resolution.status}`);
  return resolution;
};

describe('it can never refuse to let the user train', () => {
  it('offers a session on a recommended day', () => {
    expect(ready(at(MON)).sessionIndex).toBe(1);
  });

  it('offers a session on a NON-recommended day (former REST_DAY)', () => {
    const resolution = ready(at(SAT));
    expect(resolution.status).toBe('SESSION_READY');
    expect(resolution.todayIsRecommended).toBe(false);
  });

  it('offers a session with NO recommended weekdays configured at all (former SCHEDULE_SETUP_REQUIRED)', () => {
    for (const recommendedWeekdays of [[] as Weekday[], undefined]) {
      const resolution = ready(at(MON, { recommendedWeekdays }));
      expect(resolution.todayIsRecommended).toBe(false);
      expect(resolution.nextRecommendedLocalDate).toBeNull();
      expect(resolution.sessionIndex).toBe(1);
    }
  });

  it('offers a session after months of inactivity (former MISSED_SESSION_DECISION_REQUIRED)', () => {
    // The old resolver collapsed every elapsed training day into a blocking
    // decision. There is no such concept here: `cursorDate` is not an input.
    const resolution = ready(at(MON, { state: { nextSessionIndex: 2 } }));
    expect(resolution.sessionIndex).toBe(2);
  });

  it('never blocks for a CALENDAR reason — only a credited workout closes the day', () => {
    const statuses = [MON, TUE, SAT, SUN].map(day => at(day).status);
    expect(new Set(statuses)).toEqual(new Set(['SESSION_READY']));
    for (const day of [MON, TUE, SAT, SUN]) expect(ready(at(day)).canStartWorkout).toBe(true);
  });

  it('ignores a stale pendingMissDecision — it is not even readable from the input', () => {
    const resolution = ready(at(SAT, {
      state: { nextSessionIndex: 0, suggestionVersion: 5 } as never,
    }));
    expect(resolution.sessionIndex).toBe(0);
    expect(resolution.suggestionVersion).toBe(5);
  });
});

describe('what it offers is the user’s own choice', () => {
  it('follows suggestedSessionIndex when present', () => {
    expect(ready(at(MON, { state: { suggestedSessionIndex: 2, nextSessionIndex: 0 } })).sessionIndex).toBe(2);
  });

  it('falls back to the legacy nextSessionIndex with no migration', () => {
    expect(ready(at(MON, { state: { nextSessionIndex: 2 } })).sessionIndex).toBe(2);
  });

  it('starts at 0 for a rotation that was never walked', () => {
    expect(ready(at(MON, { state: null })).sessionIndex).toBe(0);
  });

  it('degrades an out-of-range stored pointer instead of blocking', () => {
    expect(ready(at(MON, { state: { nextSessionIndex: 99 } })).sessionIndex).toBe(0);
  });

  it('exposes the version an execution must carry', () => {
    expect(ready(at(MON, { state: { nextSessionIndex: 1, suggestionVersion: 7 } })).suggestionVersion).toBe(7);
  });
});

describe('recommended days are informative only', () => {
  it('flags today correctly in both directions', () => {
    expect(ready(at(MON)).todayIsRecommended).toBe(true);
    expect(ready(at(SAT)).todayIsRecommended).toBe(false);
  });

  it('reports the next recommended day strictly after today', () => {
    expect(ready(at(MON)).nextRecommendedLocalDate).toBe(TUE);
    expect(ready(at(SAT)).nextRecommendedLocalDate).toBe('2026-10-26');
  });

  it('works for a single recommended weekday', () => {
    const resolution = ready(at(MON, { recommendedWeekdays: ['MON'] as Weekday[] }));
    expect(resolution.todayIsRecommended).toBe(true);
    expect(resolution.nextRecommendedLocalDate).toBe('2026-10-26');
  });

  it('crosses month and year boundaries', () => {
    expect(nextRecommendedDate(['MON'] as Weekday[], '2026-12-28')).toBe('2027-01-04');
    expect(nextRecommendedDate(['SUN'] as Weekday[], '2026-10-31')).toBe('2026-11-01');
  });

  it('returns null with no configured days', () => {
    expect(nextRecommendedDate([], MON)).toBeNull();
  });
});

describe('one credited workout per day', () => {
  it('reports TODAY_COMPLETED once the day is claimed, and refuses a start', () => {
    const resolution = done(at(MON, { workoutCreditedToday: true }));
    expect(resolution.canStartWorkout).toBe(false);
  });

  it('still names the session the user will train next, for the friendly copy', () => {
    const resolution = done(at(MON, { workoutCreditedToday: true, state: { nextSessionIndex: 2 } }));
    expect(resolution.sessionIndex).toBe(2);
    expect(resolution.suggestionVersion).toBe(0);
  });

  it('closes the day on a NON-recommended day too — the limit is not calendar-based', () => {
    expect(done(at(SAT, { workoutCreditedToday: true })).canStartWorkout).toBe(false);
  });

  it('opens again when the day is not claimed', () => {
    for (const value of [undefined, false]) {
      expect(ready(at(MON, { workoutCreditedToday: value })).canStartWorkout).toBe(true);
    }
  });

  it('keeps the recommended-day information while the day is closed', () => {
    const resolution = done(at(MON, { workoutCreditedToday: true }));
    expect(resolution.todayIsRecommended).toBe(true);
    expect(resolution.nextRecommendedLocalDate).toBe(TUE);
  });
});

describe('no program', () => {
  it('reports PROGRAM_NOT_AVAILABLE without a program or sessions', () => {
    expect(at(MON, { hasActiveProgram: false }).status).toBe('PROGRAM_NOT_AVAILABLE');
    expect(at(MON, { sessionCount: 0 }).status).toBe('PROGRAM_NOT_AVAILABLE');
  });
});

describe('nonPunitiveWorkoutReminder — decision 2.b', () => {
  it('nudges on a recommended day with no training yet', () => {
    expect(nonPunitiveWorkoutReminder(at(MON))).toEqual({ send: true, kind: 'RECOMMENDED_DAY' });
  });

  it('stays silent once the user trained today', () => {
    expect(nonPunitiveWorkoutReminder(at(MON, { workoutCreditedToday: true })))
      .toEqual({ send: false, reason: 'ALREADY_TRAINED_TODAY' });
  });

  it('stays silent on a day the user did not ask to be nudged on', () => {
    expect(nonPunitiveWorkoutReminder(at(SAT)))
      .toEqual({ send: false, reason: 'NOT_A_RECOMMENDED_DAY' });
  });

  it('stays silent with no recommended days configured', () => {
    expect(nonPunitiveWorkoutReminder(at(MON, { recommendedWeekdays: [] })))
      .toEqual({ send: false, reason: 'NOT_A_RECOMMENDED_DAY' });
  });

  it('stays silent without an active program', () => {
    expect(nonPunitiveWorkoutReminder(at(MON, { hasActiveProgram: false })))
      .toEqual({ send: false, reason: 'NO_ACTIVE_PROGRAM' });
  });

  it('has NO punitive outcome in its union — a missed day is never notified', () => {
    // Structural: every reachable decision is either a forward-looking nudge
    // or silence. Nothing reports a day as missed.
    const decisions = [MON, TUE, SAT, SUN].flatMap(day => [
      nonPunitiveWorkoutReminder(at(day)),
      nonPunitiveWorkoutReminder(at(day, { workoutCreditedToday: true })),
    ]);
    for (const decision of decisions) {
      if (decision.send) expect(decision.kind).toBe('RECOMMENDED_DAY');
      else expect(['NOT_A_RECOMMENDED_DAY', 'ALREADY_TRAINED_TODAY', 'NO_ACTIVE_PROGRAM']).toContain(decision.reason);
    }
  });
});

describe('selecting after already training today — the invariant the product calls out', () => {
  it('advances the suggestion while the day stays closed to starting', () => {
    // Today is credited, and the user picks what they intend to train
    // TOMORROW. The suggestion must move (B → C) and the day must stay
    // closed: choosing is allowed, starting is not.
    const credited = at(MON, { workoutCreditedToday: true, state: { nextSessionIndex: 1 } });
    expect(done(credited).sessionIndex).toBe(1);
    expect(done(credited).canStartWorkout).toBe(false);

    // After selecting B, the stored suggestion is C — and the day is STILL
    // closed, because the limit is about completion, not about choosing.
    const afterSelection = selectSession(
      { suggestedSessionIndex: 1, version: 3, lastSelectedSessionIndex: 0 }, 1, 3,
    );
    expect(afterSelection.status).toBe('APPLIED');
    if (afterSelection.status !== 'APPLIED') throw new Error('unreachable');
    expect(afterSelection.suggestion.suggestedSessionIndex).toBe(2);

    const stillClosed = at(MON, {
      workoutCreditedToday: true,
      state: {
        suggestedSessionIndex: afterSelection.suggestion.suggestedSessionIndex,
        suggestionVersion: afterSelection.suggestion.version,
      },
    });
    expect(done(stillClosed).sessionIndex).toBe(2);
    expect(done(stillClosed).canStartWorkout).toBe(false);
  });

  it('opens again the next day, on the session the selection chose', () => {
    const tomorrow = at(TUE, {
      workoutCreditedToday: false,
      state: { suggestedSessionIndex: 2, suggestionVersion: 4 },
    });
    expect(ready(tomorrow).sessionIndex).toBe(2);
    expect(ready(tomorrow).canStartWorkout).toBe(true);
  });
});
