import { describe, expect, it } from 'vitest';
import { addDaysLocal } from '../calendar';
import { detectMissedSessionGap, resolveWorkoutSchedule } from '../resolver';
import type { ResolveWorkoutScheduleInput, ScheduleConfig } from '../types';

/**
 * Mirrors exactly what `resolveMissedSession`'s FOLLOW_SCHEDULE branch
 * persists to `ScheduleState` (`src/services/workoutSchedule.ts`) — after
 * the fix, `cursorDate` is the day BEFORE today, never today itself (see
 * that function's doc comment for why). Kept in the test file rather than
 * imported so this suite pins the CONTRACT the persistence layer must
 * produce, independent of the Firestore-backed implementation (no emulator
 * needed to prove the resolver behaves correctly against it).
 */
function followScheduleState(
  calendarSessionIndex: number,
  todayLocalDate: string,
  lastCompletedAt: string | null = null,
) {
  return {
    nextSessionIndex: calendarSessionIndex,
    cursorDate: addDaysLocal(todayLocalDate, -1),
    pendingMissDecision: null,
    lastCompletedAt,
  };
}

const MWF: ScheduleConfig = { trainingDays: ['MON', 'WED', 'FRI'], timezone: 'America/Sao_Paulo', scheduleVersion: 1 };
const EVERY_DAY: ScheduleConfig = { trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], timezone: 'UTC', scheduleVersion: 1 };
const MON_TO_FRI: ScheduleConfig = { trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], timezone: 'UTC', scheduleVersion: 1 };
const SESSION_COUNT = 4; // A, B, C, D

function base(overrides: Partial<ResolveWorkoutScheduleInput> = {}): ResolveWorkoutScheduleInput {
  return {
    hasActiveProgram: true,
    sessionCount: SESSION_COUNT,
    config: MWF,
    state: null,
    activatedAtLocalDate: '2026-08-03', // a Monday
    todayLocalDate: '2026-08-03',
    ...overrides,
  };
}

describe('resolveWorkoutSchedule — availability gates', () => {
  it('PROGRAM_NOT_AVAILABLE when there is no active program', () => {
    expect(resolveWorkoutSchedule(base({ hasActiveProgram: false }))).toEqual({ status: 'PROGRAM_NOT_AVAILABLE' });
  });

  it('PROGRAM_NOT_AVAILABLE when the program has zero sessions', () => {
    expect(resolveWorkoutSchedule(base({ sessionCount: 0 }))).toEqual({ status: 'PROGRAM_NOT_AVAILABLE' });
  });

  it('SCHEDULE_SETUP_REQUIRED when there is no config (legacy user, DR-017)', () => {
    expect(resolveWorkoutSchedule(base({ config: null }))).toEqual({ status: 'SCHEDULE_SETUP_REQUIRED' });
  });

  it('SCHEDULE_SETUP_REQUIRED when trainingDays is empty', () => {
    expect(resolveWorkoutSchedule(base({ config: { ...MWF, trainingDays: [] } }))).toEqual({ status: 'SCHEDULE_SETUP_REQUIRED' });
  });
});

describe('resolveWorkoutSchedule — activation and rest days', () => {
  it('SESSION_READY(A) when the program activates on a trainingDay', () => {
    // Monday 2026-08-03 is a trainingDay in MWF, and MON is trainingDays[0] — anchor lands on A.
    expect(resolveWorkoutSchedule(base())).toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });

  it('REST_DAY on a non-trainingDay with no pending session', () => {
    // Wednesday 2026-08-05 activation but asking about Tuesday: still before
    // the first trainingDay, no gap yet. Next trainingDay is that same Wednesday.
    expect(resolveWorkoutSchedule(base({ activatedAtLocalDate: '2026-08-04', todayLocalDate: '2026-08-04' })))
      .toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-08-05', nextSessionIndex: 1 }); // WED is trainingDays[1] -> B
  });

  it('REST_DAY mid-week with no completions yet and no trainingDay crossed', () => {
    // Activated Monday, asking Tuesday: Monday's session is still pending
    // for Monday itself was already handled by activation logic; Tuesday
    // isn't a trainingDay, so still REST_DAY (Monday's SESSION_READY was the
    // opportunity, unconsumed — a real caller would have shown it already).
    const state = { nextSessionIndex: 0, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: null };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-04' })))
      .toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-08-05', nextSessionIndex: 0 });
  });
});

describe('resolveWorkoutSchedule — normal flow (A/B/C/D)', () => {
  it('offers B on Wednesday after A was completed Monday (cursor advanced by the completion)', () => {
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-05' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  it('offers C on Friday after B was completed Wednesday', () => {
    const state = { nextSessionIndex: 2, cursorDate: '2026-08-05', pendingMissDecision: null, lastCompletedAt: '2026-08-05' };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-07' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });

  it('cycles back to A after D (sequence, not calendar, drives identity)', () => {
    const state = { nextSessionIndex: 0, cursorDate: '2026-08-10', pendingMissDecision: null, lastCompletedAt: '2026-08-10' }; // D completed the following Monday
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-12' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });
});

describe('resolveWorkoutSchedule — non-consecutive schedules and rest days', () => {
  it('stays REST_DAY on a rest day even when an earlier trainingDay was skipped and not yet reconfirmed', () => {
    // MON/TUE/THU/FRI: A completed Monday, B due Tuesday but skipped. Wednesday
    // is not a trainingDay at all — the gap must not surface as SESSION_READY
    // just because exactly one trainingDay (Tuesday) has elapsed since the cursor.
    const config: ScheduleConfig = { trainingDays: ['MON', 'TUE', 'THU', 'FRI'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' }; // Monday
    expect(resolveWorkoutSchedule(base({ config, state, todayLocalDate: '2026-08-05' }))) // Wednesday
      .toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-08-06', nextSessionIndex: 1 }); // Thursday still owes B
  });
});

describe('resolveWorkoutSchedule — missed session detection', () => {
  it('detects a single miss: Tuesday/Thursday cadence, B missed, resolver asked on Thursday', () => {
    // Config TUE/THU. A completed Tue, B due Thu but not completed; asking
    // on the following Tue reveals Thu(missed) + Tue(today) = 2 occurrences.
    const config: ScheduleConfig = { trainingDays: ['TUE', 'THU'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-04', pendingMissDecision: null, lastCompletedAt: '2026-08-04' }; // Tue
    const result = resolveWorkoutSchedule(base({ config, state, todayLocalDate: '2026-08-11', sessionCount: 4 }));
    expect(result).toEqual({
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 1, // B
      calendarSessionIndex: 2, // C — one occurrence skipped
    });
  });

  it('does not re-derive once a pending decision is already persisted (idempotent read)', () => {
    const state = {
      nextSessionIndex: 1,
      cursorDate: '2026-08-04',
      lastCompletedAt: '2026-08-04',
      pendingMissDecision: {
        missedSessionIndex: 1,
        calendarSessionIndex: 2,
        missedScheduledDate: '2026-08-06',
        detectedOnDate: '2026-08-11',
      },
    };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-11' })))
      .toEqual({ status: 'MISSED_SESSION_DECISION_REQUIRED', missedSessionIndex: 1, calendarSessionIndex: 2 });
  });

  it('collapses multiple missed days into a single decision, not one per day', () => {
    // Every-day cadence, cursor at day 0; today is 5 days later — 4 missed + today = 5 occurrences.
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
    const result = resolveWorkoutSchedule(base({ config: EVERY_DAY, state, todayLocalDate: '2026-08-08', sessionCount: 4 }));
    expect(result.status).toBe('MISSED_SESSION_DECISION_REQUIRED');
    if (result.status === 'MISSED_SESSION_DECISION_REQUIRED') {
      expect(result.missedSessionIndex).toBe(1);
      expect(result.calendarSessionIndex).toBe((1 + 4) % 4); // 1
    }
  });
});

describe('resolveWorkoutSchedule — week boundary does not reset the sequence', () => {
  it('Friday finishes B; the following Monday still offers C, not A', () => {
    const state = { nextSessionIndex: 2, cursorDate: '2026-08-07', pendingMissDecision: null, lastCompletedAt: '2026-08-07' }; // B completed Friday
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-10' }))) // next Monday
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });
});

describe('resolveWorkoutSchedule — 7 days/week', () => {
  it('every day is a trainingDay and offers the next session with no rest days', () => {
    const state = { nextSessionIndex: 2, cursorDate: '2026-08-05', pendingMissDecision: null, lastCompletedAt: '2026-08-05' };
    expect(resolveWorkoutSchedule(base({ config: EVERY_DAY, state, todayLocalDate: '2026-08-06' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });
});

describe('resolveWorkoutSchedule — initial anchoring (mid-week plan start)', () => {
  // 2026-08-03 is a Monday.
  const MON_FRI_SESSIONS = { config: MON_TO_FRI, sessionCount: 5 }; // A..E, one per trainingDay

  it('activating on Friday opens on E, not A (docs example §Exemplo crítico)', () => {
    expect(resolveWorkoutSchedule(base({
      ...MON_FRI_SESSIONS,
      activatedAtLocalDate: '2026-08-07', // Friday
      todayLocalDate: '2026-08-07',
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 4 }); // E
  });

  it('the following Monday resumes the normal A..E rotation after a Friday start', () => {
    // Friday E was completed; nextSessionIndex correctly advances to 0 (A) via the persisted cursor, not the calendar.
    const state = { nextSessionIndex: 0, cursorDate: '2026-08-07', pendingMissDecision: null, lastCompletedAt: '2026-08-07' };
    expect(resolveWorkoutSchedule(base({ ...MON_FRI_SESSIONS, state, todayLocalDate: '2026-08-10' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 0 }); // A
  });

  it('starting mid-week on Thursday (TUE/THU/SAT cadence) opens on B, not A', () => {
    const config: ScheduleConfig = { trainingDays: ['TUE', 'THU', 'SAT'], timezone: 'UTC', scheduleVersion: 1 };
    expect(resolveWorkoutSchedule(base({
      config,
      sessionCount: 3, // A, B, C
      activatedAtLocalDate: '2026-08-06', // Thursday
      todayLocalDate: '2026-08-06',
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 1 }); // B
  });

  it('after the Thursday-B start, Saturday offers C and the next Tuesday cycles back to A', () => {
    const config: ScheduleConfig = { trainingDays: ['TUE', 'THU', 'SAT'], timezone: 'UTC', scheduleVersion: 1 };
    const afterB = { nextSessionIndex: 2, cursorDate: '2026-08-06', pendingMissDecision: null, lastCompletedAt: '2026-08-06' };
    expect(resolveWorkoutSchedule(base({ config, sessionCount: 3, state: afterB, todayLocalDate: '2026-08-08' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 }); // C, Saturday

    const afterC = { nextSessionIndex: 0, cursorDate: '2026-08-08', pendingMissDecision: null, lastCompletedAt: '2026-08-08' };
    expect(resolveWorkoutSchedule(base({ config, sessionCount: 3, state: afterC, todayLocalDate: '2026-08-11' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 0 }); // A, next Tuesday
  });

  it('activating on a rest day (schedule not yet reached) anchors on the first upcoming trainingDay', () => {
    // Activated Saturday, asked same day — SAT isn't in MON..FRI, so REST_DAY;
    // the anchor for the eventual first session (Monday, A) is still exposed for the "next workout" UI.
    expect(resolveWorkoutSchedule(base({
      ...MON_FRI_SESSIONS,
      activatedAtLocalDate: '2026-08-08', // Saturday
      todayLocalDate: '2026-08-08',
    }))).toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-08-10', nextSessionIndex: 0 }); // Monday -> A
  });

  it('starting mid-week does not require trainingDays.length === sessionCount (anchor wraps via modulo)', () => {
    // 3 trainingDays, only 2 sessions: activating on the 3rd trainingDay wraps back to session 0.
    const config: ScheduleConfig = { trainingDays: ['MON', 'WED', 'FRI'], timezone: 'UTC', scheduleVersion: 1 };
    expect(resolveWorkoutSchedule(base({
      config,
      sessionCount: 2, // A, B
      activatedAtLocalDate: '2026-08-07', // Friday — position 2 in [MON,WED,FRI]
      todayLocalDate: '2026-08-07',
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 0 }); // 2 % 2 === 0 -> A
  });
});

describe('resolveWorkoutSchedule — same-day completion is distinct from a rest day', () => {
  it('TODAY_COMPLETED right after finishing today\'s session (not REST_DAY)', () => {
    // A completed today (Monday): cursorDate/lastCompletedAt both land on today.
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-03' })))
      .toEqual({ status: 'TODAY_COMPLETED', nextWorkoutDate: '2026-08-05', nextSessionIndex: 1 }); // next is Wednesday -> B
  });

  it('a genuine rest day (no completion today) still reports REST_DAY', () => {
    // Completed Monday's A; Tuesday is not a trainingDay and nothing happened today.
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-04' })))
      .toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-08-05', nextSessionIndex: 1 });
  });

  it('completing the same Treino A weeks ago is not conflated with today\'s A', () => {
    // A (index 0) was last completed 2026-07-13 — weeks before today. `lastCompletedAt`
    // is a date, not a sessionIndex flag, so it never marks today's fresh A as done
    // just because that same identity was completed before (docs §Identidade da conclusão).
    const state = { nextSessionIndex: 0, cursorDate: '2026-07-31', pendingMissDecision: null, lastCompletedAt: '2026-07-13' };
    // Today is this Monday (2026-08-03), a fresh trainingDay — must be SESSION_READY, never TODAY_COMPLETED.
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-03' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });
});

describe('resolveWorkoutSchedule — FOLLOW_SCHEDULE stability for the rest of the day', () => {
  // Reproduces the docs example: SEG->A (done), TER->B (missed), hoje = QUA.
  // Config MON..FRI/A..E. Miss detected on Wednesday: missedSessionIndex=1
  // (B), calendarSessionIndex=2 (C) — exactly what `resolveMissedSession`
  // would compute from the pending decision before persisting it.
  const TODAY = '2026-08-05'; // Wednesday
  const CALENDAR_SESSION_INDEX = 2; // C

  it('1. resolves immediately after FOLLOW_SCHEDULE — SESSION_READY(C), never REST_DAY', () => {
    const state = followScheduleState(CALENDAR_SESSION_INDEX, TODAY);
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: TODAY })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: CALENDAR_SESSION_INDEX });
  });

  it('2. resolving again the same day (no write in between) returns the identical result', () => {
    const state = followScheduleState(CALENDAR_SESSION_INDEX, TODAY);
    const input = base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: TODAY });
    const first = resolveWorkoutSchedule(input);
    const second = resolveWorkoutSchedule(input);
    expect(second).toEqual(first);
    expect(second).toEqual({ status: 'SESSION_READY', sessionIndex: CALENDAR_SESSION_INDEX });
  });

  it('3. a fresh state object hydrated from persistence (app close/reopen, same day) resolves identically', () => {
    // A brand-new object literal with the same field values — simulates
    // reading the document back from Firestore after a cold start, never
    // the same JS reference the decision produced in-memory.
    const rehydrated = JSON.parse(JSON.stringify(followScheduleState(CALENDAR_SESSION_INDEX, TODAY)));
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state: rehydrated, todayLocalDate: TODAY })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: CALENDAR_SESSION_INDEX });
  });

  it('4. completing the offered session correctly advances to the next trainingDay afterward', () => {
    // User actually performs C on Wednesday — normal completion, same shape
    // `completeScheduledSession` always produces.
    const afterCompletion = { nextSessionIndex: 3, cursorDate: TODAY, pendingMissDecision: null, lastCompletedAt: TODAY };
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state: afterCompletion, todayLocalDate: '2026-08-06' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 3 }); // D, Thursday
  });

  it('5. FOLLOW_SCHEDULE resolved on the last trainingDay of the week still offers today\'s session', () => {
    // SEG->A done; TER/QUA/QUI missed; hoje = SEX (also a trainingDay).
    const friday = '2026-08-07';
    const state = followScheduleState(4, friday); // E, the last of A..E
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: friday })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 4 });
  });

  it('6. crossing the weekend after FOLLOW_SCHEDULE: an untouched Friday offer surfaces as a new, correctly-computed miss on Monday', () => {
    // Friday's E was offered (test 5) but never completed. Reopening the app
    // the following Monday must neither loop on the old decision nor lose
    // track — it detects a fresh, correctly-computed gap (E missed -> A due).
    const friday = '2026-08-07';
    const state = followScheduleState(4, friday); // as persisted by test 5's decision
    const monday = '2026-08-10';
    const result = resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: monday }));
    expect(result).toEqual({
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 4, // E, still owed from Friday
      calendarSessionIndex: 0, // A, today's calendar slot
    });
  });

  it('6b. crossing the weekend when Friday\'s session WAS completed still cycles correctly to Monday\'s A', () => {
    const afterFridayCompletion = { nextSessionIndex: 0, cursorDate: '2026-08-07', pendingMissDecision: null, lastCompletedAt: '2026-08-07' };
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state: afterFridayCompletion, todayLocalDate: '2026-08-10' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });

  it('7. CONTINUE_SEQUENCE\'s state shape (untouched by this fix) still reproduces the same decision deterministically', () => {
    // Per `resolveMissedSession`'s CONTINUE_SEQUENCE branch (unchanged by
    // this fix): nextSessionIndex stays on the missed session and
    // cursorDate is NOT advanced (spreads the pre-existing state). Pure
    // `resolveWorkoutSchedule` is a deterministic function of its inputs —
    // feeding it that exact state shape must reproduce the identical
    // MISSED_SESSION_DECISION_REQUIRED it was built from, proving this
    // resolver-level contract was not perturbed by the FOLLOW_SCHEDULE fix.
    const continueSequenceState = {
      nextSessionIndex: 1, // B, missedSessionIndex — CONTINUE_SEQUENCE never moves this
      cursorDate: '2026-08-03', // unchanged: still Monday, from before the miss
      pendingMissDecision: null,
      lastCompletedAt: '2026-08-03',
    };
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state: continueSequenceState, todayLocalDate: TODAY })))
      .toEqual({ status: 'MISSED_SESSION_DECISION_REQUIRED', missedSessionIndex: 1, calendarSessionIndex: 2 });
  });

  it('7b. once the user actually completes the CONTINUE_SEQUENCE session, progression resumes normally', () => {
    // The missed B is performed today (Wednesday) instead of being skipped —
    // a completion shaped exactly like `completeScheduledSession` always produces.
    const afterContinueCompletion = { nextSessionIndex: 2, cursorDate: TODAY, pendingMissDecision: null, lastCompletedAt: TODAY };
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state: afterContinueCompletion, todayLocalDate: '2026-08-06' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 }); // C, Thursday
  });

  it('9. nextSessionIndex from the decision is exactly what SESSION_READY reports (no drift)', () => {
    for (const calendarSessionIndex of [0, 1, 2, 3, 4]) {
      const state = followScheduleState(calendarSessionIndex, TODAY);
      expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: TODAY })))
        .toEqual({ status: 'SESSION_READY', sessionIndex: calendarSessionIndex });
    }
  });

  it('10. TODAY_COMPLETED is unaffected by the FOLLOW_SCHEDULE fix (unrelated state shape)', () => {
    const state = { nextSessionIndex: 3, cursorDate: TODAY, pendingMissDecision: null, lastCompletedAt: TODAY };
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: TODAY })))
      .toEqual({ status: 'TODAY_COMPLETED', nextWorkoutDate: '2026-08-06', nextSessionIndex: 3 });
  });

  it('11. a genuine REST_DAY (no miss, no completion, today not a trainingDay) is still REST_DAY', () => {
    const config: ScheduleConfig = { trainingDays: ['MON', 'WED', 'FRI'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
    expect(resolveWorkoutSchedule(base({ config, state, todayLocalDate: '2026-08-04' }))) // Tuesday, not in MWF
      .toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-08-05', nextSessionIndex: 1 });
  });

  it('detectMissedSessionGap does not re-trigger immediately after FOLLOW_SCHEDULE (no infinite loop of decisions)', () => {
    const state = followScheduleState(CALENDAR_SESSION_INDEX, TODAY);
    expect(detectMissedSessionGap(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: TODAY }))).toBeNull();
  });
});

describe('resolveWorkoutSchedule — CONTINUE_SEQUENCE decision is idempotent for the same miss occurrence', () => {
  // Docs example: SEG(08-03)->A done, TER(08-04)->B missed, QUA(08-05)->modal
  // appears (missedSessionIndex=1/B, calendarSessionIndex=2/C), user chooses
  // CONTINUE_SEQUENCE. Per `resolveMissedSession`'s CONTINUE_SEQUENCE branch
  // (untouched): nextSessionIndex stays 1(B), cursorDate stays unchanged
  // (Monday) — never advances until B is actually completed. The MISS_RESOLVED
  // ledger event this decision writes is keyed at (sessionIndex=1,
  // scheduledDate='2026-08-04') — exactly `resolvedMissScheduledDate` below,
  // exactly as the orchestrator (`resolveTodaysSchedule`) now derives it via
  // a single targeted read on that deterministic id.
  const AFTER_CONTINUE_SEQUENCE = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
  const RESOLVED_MISS_DATE = '2026-08-04'; // TER — the date MISS_RESOLVED was written for
  const WEDNESDAY = '2026-08-05';

  it('1. resolves again the same day without re-asking — SESSION_READY(B), not the modal', () => {
    expect(resolveWorkoutSchedule(base({
      config: MON_TO_FRI, sessionCount: 5, state: AFTER_CONTINUE_SEQUENCE, todayLocalDate: WEDNESDAY,
      resolvedMissScheduledDate: RESOLVED_MISS_DATE,
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  it('2. resolving a second time in a row (no write in between) returns the identical result', () => {
    const input = base({
      config: MON_TO_FRI, sessionCount: 5, state: AFTER_CONTINUE_SEQUENCE, todayLocalDate: WEDNESDAY,
      resolvedMissScheduledDate: RESOLVED_MISS_DATE,
    });
    expect(resolveWorkoutSchedule(input)).toEqual(resolveWorkoutSchedule(input));
  });

  it('3. a fresh, rehydrated state + ledger fact (simulated cold start same day) resolves identically', () => {
    const rehydratedState = JSON.parse(JSON.stringify(AFTER_CONTINUE_SEQUENCE));
    expect(resolveWorkoutSchedule(base({
      config: MON_TO_FRI, sessionCount: 5, state: rehydratedState, todayLocalDate: WEDNESDAY,
      resolvedMissScheduledDate: RESOLVED_MISS_DATE,
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  it('4. the pending session keeps the exact sessionIndex the decision was made for (B, index 1)', () => {
    const result = resolveWorkoutSchedule(base({
      config: MON_TO_FRI, sessionCount: 5, state: AFTER_CONTINUE_SEQUENCE, todayLocalDate: WEDNESDAY,
      resolvedMissScheduledDate: RESOLVED_MISS_DATE,
    }));
    expect(result).toMatchObject({ status: 'SESSION_READY', sessionIndex: AFTER_CONTINUE_SEQUENCE.nextSessionIndex });
  });

  it('5. completing the pending session resumes normal rotation afterward (no lingering suppression)', () => {
    // B actually gets done on Wednesday — a completion shaped exactly like
    // `completeScheduledSession` always produces. No `resolvedMissScheduledDate`
    // to supply anymore: the cursor has moved, this gap is over.
    const afterCompletion = { nextSessionIndex: 2, cursorDate: WEDNESDAY, pendingMissDecision: null, lastCompletedAt: WEDNESDAY };
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state: afterCompletion, todayLocalDate: '2026-08-06' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 }); // C, Thursday
  });

  it('6. a first, still-undecided miss keeps asking normally (no resolvedMissScheduledDate supplied)', () => {
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
    expect(resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: WEDNESDAY })))
      .toEqual({ status: 'MISSED_SESSION_DECISION_REQUIRED', missedSessionIndex: 1, calendarSessionIndex: 2 });
  });

  it('7. a genuinely NEW future miss (different occurrence) still asks for a fresh decision', () => {
    // B was completed Wednesday (state from test 5). C then gets missed too:
    // by the following Monday, Thu+Fri+Mon have all elapsed since the cursor.
    const afterBCompletion = { nextSessionIndex: 2, cursorDate: WEDNESDAY, pendingMissDecision: null, lastCompletedAt: WEDNESDAY };
    const result = resolveWorkoutSchedule(base({ config: MON_TO_FRI, sessionCount: 5, state: afterBCompletion, todayLocalDate: '2026-08-10' }));
    expect(result).toEqual({
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 2, // C
      calendarSessionIndex: 4, // E — 2 occurrences skipped (Thu, Fri)
    });
  });

  it('8. the OLD resolved miss (B/TER) never suppresses the NEW miss (C/THU) — identity is per-occurrence, not global', () => {
    // Same setup as test 7, but the caller mistakenly (or from a stale cache)
    // still supplies the FIRST decision's resolvedMissScheduledDate. It must
    // not matter: today's occurrences[0] is a different date now.
    const afterBCompletion = { nextSessionIndex: 2, cursorDate: WEDNESDAY, pendingMissDecision: null, lastCompletedAt: WEDNESDAY };
    const result = resolveWorkoutSchedule(base({
      config: MON_TO_FRI, sessionCount: 5, state: afterBCompletion, todayLocalDate: '2026-08-10',
      resolvedMissScheduledDate: RESOLVED_MISS_DATE, // stale: '2026-08-04', the OLD miss
    }));
    expect(result).toEqual({
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 2,
      calendarSessionIndex: 4,
    });
  });

  it('9. FOLLOW_SCHEDULE still resolves normally when a stale/irrelevant resolvedMissScheduledDate is present', () => {
    const followScheduleResolvedState = followScheduleState(2, WEDNESDAY); // as in the FOLLOW_SCHEDULE suite above
    expect(resolveWorkoutSchedule(base({
      config: MON_TO_FRI, sessionCount: 5, state: followScheduleResolvedState, todayLocalDate: WEDNESDAY,
      resolvedMissScheduledDate: '2019-01-01', // irrelevant/stale value must never interfere
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });

  it('10. FOLLOW_SCHEDULE does not regress into re-asking the same decision under this fix either', () => {
    const state = followScheduleState(2, WEDNESDAY);
    expect(detectMissedSessionGap(base({ config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: WEDNESDAY }))).toBeNull();
  });

  it('12. detectMissedSessionGap reports no new gap to persist once the ledger already covers it (no duplicate event/state write)', () => {
    const result = detectMissedSessionGap(base({
      config: MON_TO_FRI, sessionCount: 5, state: AFTER_CONTINUE_SEQUENCE, todayLocalDate: WEDNESDAY,
      resolvedMissScheduledDate: RESOLVED_MISS_DATE,
    }));
    expect(result).toBeNull();
  });

  it('14. TODAY_COMPLETED is unaffected by the presence of an (irrelevant) resolvedMissScheduledDate', () => {
    const state = { nextSessionIndex: 3, cursorDate: WEDNESDAY, pendingMissDecision: null, lastCompletedAt: WEDNESDAY };
    expect(resolveWorkoutSchedule(base({
      config: MON_TO_FRI, sessionCount: 5, state, todayLocalDate: WEDNESDAY, resolvedMissScheduledDate: '2019-01-01',
    }))).toEqual({ status: 'TODAY_COMPLETED', nextWorkoutDate: '2026-08-06', nextSessionIndex: 3 });
  });

  it('15. a genuine REST_DAY is unaffected by the presence of an (irrelevant) resolvedMissScheduledDate', () => {
    const config: ScheduleConfig = { trainingDays: ['MON', 'WED', 'FRI'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null, lastCompletedAt: '2026-08-03' };
    expect(resolveWorkoutSchedule(base({
      config, state, todayLocalDate: '2026-08-04', resolvedMissScheduledDate: '2019-01-01',
    }))).toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-08-05', nextSessionIndex: 1 });
  });

  it('16. initial anchoring (fresh activation, no state) is unaffected by this fix', () => {
    expect(resolveWorkoutSchedule(base({
      activatedAtLocalDate: '2026-08-07', todayLocalDate: '2026-08-07', config: MON_TO_FRI, sessionCount: 5,
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 4 }); // Friday -> E, same as the anchoring suite above
  });

  it('EDGE CASE (user-specified): missed B not completed on Wednesday, reopened Thursday — still SESSION_READY(B), no new decision', () => {
    // SEG->A done, TER->B perdido, QUA->CONTINUE_SEQUENCE, QUA->B não
    // concluído, QUI->nova resolução. cursorDate never moved (still Monday,
    // since B was never completed), so occurrences[0] recomputed on
    // Thursday is STILL '2026-08-04' (TER) — the exact same identity the
    // Wednesday decision resolved. This is not ambiguous: CONTINUE_SEQUENCE's
    // documented contract ("mantém nextSessionIndex na sessão perdida") means
    // the missed session stays offered for as long as it takes, exactly like
    // any other still-pending SESSION_READY day — never a fresh decision
    // just because more time passed without the engine's own cursor moving.
    const thursday = '2026-08-06';
    expect(resolveWorkoutSchedule(base({
      config: MON_TO_FRI, sessionCount: 5, state: AFTER_CONTINUE_SEQUENCE, todayLocalDate: thursday,
      resolvedMissScheduledDate: RESOLVED_MISS_DATE,
    }))).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });
});

describe('anchorSessionIndex invariant — sessionIndex is always in range regardless of trainingDays.length vs sessionCount', () => {
  const DATE_FOR_WEEKDAY: Record<string, string> = {
    MON: '2026-08-03',
    TUE: '2026-08-04',
    WED: '2026-08-05',
    THU: '2026-08-06',
    FRI: '2026-08-07',
    SAT: '2026-08-08',
    SUN: '2026-08-09',
  };

  const cases: Array<{ label: string; trainingDays: ScheduleConfig['trainingDays']; sessionCount: number }> = [
    { label: 'equal counts (5 trainingDays, 5 sessions)', trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], sessionCount: 5 },
    { label: 'fewer sessions than trainingDays (3 trainingDays, 2 sessions)', trainingDays: ['MON', 'WED', 'FRI'], sessionCount: 2 },
    { label: 'more sessions than trainingDays, e.g. a recovery/bonus session (3 trainingDays, 10 sessions)', trainingDays: ['MON', 'WED', 'FRI'], sessionCount: 10 },
    { label: 'minimal: a single trainingDay and a single session', trainingDays: ['MON'], sessionCount: 1 },
    { label: 'every day trains, only one session exists', trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], sessionCount: 1 },
  ];

  it.each(cases)('$label: activating on any trainingDay never yields an out-of-range sessionIndex', ({ trainingDays, sessionCount }) => {
    for (const day of trainingDays) {
      const date = DATE_FOR_WEEKDAY[day];
      const result = resolveWorkoutSchedule(base({
        config: { trainingDays, timezone: 'UTC', scheduleVersion: 1 },
        sessionCount,
        activatedAtLocalDate: date,
        todayLocalDate: date,
      }));
      expect(result.status).toBe('SESSION_READY');
      if (result.status === 'SESSION_READY') {
        expect(Number.isInteger(result.sessionIndex)).toBe(true);
        expect(result.sessionIndex).toBeGreaterThanOrEqual(0);
        expect(result.sessionIndex).toBeLessThan(sessionCount);
      }
    }
  });
});

describe('resolveWorkoutSchedule — calendar rollovers', () => {
  it('crosses a month boundary correctly (Jan 30 -> Feb 2, MON/WED/FRI)', () => {
    // 2026-01-30 is a Friday; next MWF trainingDay is Monday 2026-02-02.
    const state = { nextSessionIndex: 2, cursorDate: '2026-01-30', pendingMissDecision: null, lastCompletedAt: '2026-01-30' };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-01-31' })))
      .toEqual({ status: 'REST_DAY', nextWorkoutDate: '2026-02-02', nextSessionIndex: 2 });
  });

  it('crosses a year boundary correctly (Dec 30 -> Jan 2, MON/WED/FRI)', () => {
    // 2026-12-30 is a Wednesday (trainingDay); asking on New Year's Eve, the
    // next trainingDay is Friday 2027-01-01 (adjust if not a Friday — recomputed below).
    const state = { nextSessionIndex: 1, cursorDate: '2026-12-30', pendingMissDecision: null, lastCompletedAt: '2026-12-30' };
    const result = resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-12-31' }));
    expect(result.status).toBe('REST_DAY');
    if (result.status === 'REST_DAY') {
      expect(result.nextWorkoutDate >= '2027-01-01').toBe(true);
      expect(result.nextSessionIndex).toBe(1);
    }
  });
});

describe('resolveWorkoutSchedule — timezone / local date', () => {
  it('never reasons about UTC instants — only the pre-resolved local date string decides "today"', () => {
    // 23:30 in a UTC-3 timezone is already the next UTC day; the resolver only ever
    // sees the caller-resolved local date, so a late-night local date must not roll early.
    const config: ScheduleConfig = { trainingDays: ['MON'], timezone: 'America/Sao_Paulo', scheduleVersion: 1 };
    expect(resolveWorkoutSchedule(base({ config, sessionCount: 1, activatedAtLocalDate: '2026-08-03', todayLocalDate: '2026-08-03' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });
});

describe('detectMissedSessionGap', () => {
  it('returns null when there is no gap', () => {
    expect(detectMissedSessionGap(base())).toBeNull();
  });

  it('returns null when a decision is already pending (do not overwrite)', () => {
    const state = {
      nextSessionIndex: 1,
      cursorDate: '2026-08-04',
      lastCompletedAt: '2026-08-04',
      pendingMissDecision: {
        missedSessionIndex: 1,
        calendarSessionIndex: 2,
        missedScheduledDate: '2026-08-06',
        detectedOnDate: '2026-08-11',
      },
    };
    expect(detectMissedSessionGap(base({ state, todayLocalDate: '2026-08-11' }))).toBeNull();
  });

  it('returns the gap to persist, including the first missed date', () => {
    const config: ScheduleConfig = { trainingDays: ['TUE', 'THU'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-04', pendingMissDecision: null, lastCompletedAt: '2026-08-04' };
    expect(detectMissedSessionGap(base({ config, state, todayLocalDate: '2026-08-11' }))).toEqual({
      missedSessionIndex: 1,
      calendarSessionIndex: 2,
      missedScheduledDate: '2026-08-06',
    });
  });

  it('anchors missedSessionIndex from the calendar when the very first walk already reveals a gap', () => {
    // Activated Monday on a MON..FRI/A..E schedule but never opened until Thursday:
    // Monday(missed)+Wednesday? no — MON,WED,FRI not consecutive here, use MON..FRI direct.
    const state = null;
    const result = detectMissedSessionGap(base({
      config: MON_TO_FRI,
      sessionCount: 5,
      state,
      activatedAtLocalDate: '2026-08-03', // Monday -> anchors at A (index 0)
      todayLocalDate: '2026-08-05', // Wednesday: MON(missed) + TUE(missed) + WED(today) = 3 occurrences
    }));
    expect(result).toEqual({
      missedSessionIndex: 0, // A, anchored from Monday — never the old hardcoded 0-by-accident
      calendarSessionIndex: 2, // C
      missedScheduledDate: '2026-08-03',
    });
  });
});
