import { describe, expect, it } from 'vitest';

import {
  detectMissedSessionNotice,
  missedSessionNoticeId,
  type MissedSessionNoticeInput,
} from '../missedSessionNotice';

/**
 * The Jotinha "treino pendente" notice, under free rotation.
 *
 * The scenario the feature exists for: session A was recommended for
 * Saturday, the user did not train, and opens the app on Monday. 2026-10-17
 * is a Saturday, 2026-10-19 a Monday — the real dates from the account this
 * was specified against.
 */
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const MON = '2026-10-19';
const TUE = '2026-10-20';

const base = (overrides: Partial<MissedSessionNoticeInput> = {}): MissedSessionNoticeInput => ({
  hasActiveProgram: true,
  sessionCount: 3,
  programInstanceId: 'wpi_1',
  recommendedWeekdays: ['SAT', 'MON'],
  lastPerformedLocalDate: '2026-10-14', // Wednesday before
  performedLocalDates: new Set(['2026-10-14']),
  coveredScheduledLocalDates: new Set(['2026-10-14']),
  suggestedSessionIndex: 0,             // A is still what the rotation offers
  todayLocalDate: MON,
  workoutCreditedToday: false,
  decidedNoticeIds: [],
  ...overrides,
});

describe('the specified scenario', () => {
  it('A was due Saturday, nothing was trained, Monday asks about it', () => {
    const notice = detectMissedSessionNotice(base());
    expect(notice).not.toBeNull();
    expect(notice!.missedScheduledDate).toBe(SAT);
    expect(notice!.pendingSessionIndex).toBe(0);
    expect(notice!.skipToSessionIndex).toBe(1);
    expect(notice!.noticeId).toBe(`wpi_1:${SAT}`);
  });

  it('skipping advances exactly ONE position, never one per elapsed day', () => {
    // Three recommended days went by. The old model consumed one rotation
    // position per occurrence; free rotation owes sessions to no day, so
    // declining drops exactly the session being declined.
    const notice = detectMissedSessionNotice(base({
      recommendedWeekdays: ['MON', 'WED', 'FRI', 'SAT'],
      lastPerformedLocalDate: '2026-10-09',
      todayLocalDate: MON,
    }));
    expect(notice!.missedOccurrenceCount).toBeGreaterThan(1);
    expect(notice!.skipToSessionIndex).toBe(1);
  });

  it('wraps the skip target around the rotation', () => {
    expect(detectMissedSessionNotice(base({ suggestedSessionIndex: 2 }))!.skipToSessionIndex).toBe(0);
  });
});

describe('it never fires when there is nothing honest to ask', () => {
  it('no recommended day went by (trained the last one)', () => {
    expect(detectMissedSessionNotice(base({ lastPerformedLocalDate: SAT }))).toBeNull();
  });

  it('today is a rest day', () => {
    // Sunday is not recommended: the notice must not interrupt a day the
    // user was never expected to train.
    expect(detectMissedSessionNotice(base({ todayLocalDate: SUN }))).toBeNull();
  });

  it('today is recommended but nothing was missed before it', () => {
    // Trained Saturday, today is Monday and Monday is still available.
    expect(detectMissedSessionNotice(base({
      lastPerformedLocalDate: SAT, todayLocalDate: MON,
    }))).toBeNull();
  });

  it('today is already trained', () => {
    expect(detectMissedSessionNotice(base({ workoutCreditedToday: true }))).toBeNull();
  });

  it('the account never trained — a first session is not a missed one', () => {
    expect(detectMissedSessionNotice(base({
      lastPerformedLocalDate: null,
      performedLocalDates: new Set<string>(),
      coveredScheduledLocalDates: new Set<string>(),
    }))).toBeNull();
  });

  it('no recommended weekdays are configured', () => {
    expect(detectMissedSessionNotice(base({ recommendedWeekdays: [] }))).toBeNull();
  });

  it('no active program, or an empty rotation', () => {
    expect(detectMissedSessionNotice(base({ hasActiveProgram: false }))).toBeNull();
    expect(detectMissedSessionNotice(base({ sessionCount: 0 }))).toBeNull();
  });

  it('TODAY is never itself the missed day', () => {
    // Monday is recommended and untrained, but it is the day being offered.
    // Only Saturday can be "missed" here.
    const notice = detectMissedSessionNotice(base());
    expect(notice!.missedScheduledDate).not.toBe(MON);
  });
});

describe('the same occurrence is never raised twice', () => {
  it('a decided notice id suppresses it', () => {
    expect(detectMissedSessionNotice(base({
      decidedNoticeIds: [`wpi_1:${SAT}`],
    }))).toBeNull();
  });

  it('the id ignores the session index, so skipping does not re-ask', () => {
    // FOLLOW_SCHEDULE changes which session is pending. Keyed on the session,
    // the notice would reappear for the next letter about the SAME Saturday.
    const before = detectMissedSessionNotice(base({ suggestedSessionIndex: 0 }))!;
    const afterSkip = detectMissedSessionNotice(base({
      suggestedSessionIndex: 1, decidedNoticeIds: [before.noticeId],
    }));
    expect(afterSkip).toBeNull();
  });

  it('a different missed occurrence still gets its own question', () => {
    // Answered about Saturday; the next week's Saturday is a new occurrence.
    const nextWeek = detectMissedSessionNotice(base({
      decidedNoticeIds: [`wpi_1:${SAT}`],
      lastPerformedLocalDate: '2026-10-21',
      todayLocalDate: '2026-10-26',
      recommendedWeekdays: ['SAT', 'MON', 'SUN'],
    }));
    expect(nextWeek).not.toBeNull();
    expect(nextWeek!.noticeId).not.toBe(`wpi_1:${SAT}`);
  });

  it('switching program instance scopes the id, never leaking an answer across', () => {
    expect(missedSessionNoticeId('wpi_1', SAT)).not.toBe(missedSessionNoticeId('wpi_2', SAT));
    expect(detectMissedSessionNotice(base({
      programInstanceId: 'wpi_2', decidedNoticeIds: [`wpi_1:${SAT}`],
    }))).not.toBeNull();
  });

  it('a missing instance id still produces a stable key', () => {
    expect(missedSessionNoticeId(null, SAT)).toBe(`no-instance:${SAT}`);
  });
});

describe('it is an offer, not a gate', () => {
  it('reports no status and cannot block — it only describes', () => {
    const notice = detectMissedSessionNotice(base())!;
    // The shape carries no decision requirement, no "canStartWorkout" and no
    // status: the resolution stays whatever `resolveFreeSchedule` said.
    expect(Object.keys(notice).sort()).toEqual([
      'missedOccurrenceCount', 'missedScheduledDate', 'noticeId',
      'pendingSessionIndex', 'skipToSessionIndex',
    ]);
  });

  it('the pending session is exactly what the rotation already offers', () => {
    // Under free rotation the suggestion never moved when the day was
    // skipped, so the pending session IS the current offer. Answering the
    // notice is what moves it — see the wiring test.
    for (const suggested of [0, 1, 2]) {
      expect(detectMissedSessionNotice(base({ suggestedSessionIndex: suggested }))!.pendingSessionIndex)
        .toBe(suggested);
    }
  });

  it('a later date is unaffected by an earlier unanswered notice', () => {
    // Tuesday is not recommended here, so the question simply waits.
    expect(detectMissedSessionNotice(base({ todayLocalDate: TUE }))).toBeNull();
  });
});

/**
 * ADVERSARIAL — real chronology.
 *
 * The first implementation trusted `scheduleState.lastPerformedLocalDate`
 * alone. That field is a projection: instance-scoped, absent on old
 * documents, and stale inside the crash window where an execution committed
 * but its schedule write did not. Every case below is one where trusting it
 * would present an already-trained or already-reorganized day as missed.
 */
describe('adversarial: a trained day can never be reported as missed', () => {
  it('the pointer lags behind a real execution (crash window)', () => {
    // Trained Saturday; the schedule write never landed, so the pointer
    // still says Wednesday. Saturday must not be called missed.
    expect(detectMissedSessionNotice(base({
      lastPerformedLocalDate: '2026-10-14',
      performedLocalDates: new Set(['2026-10-14', SAT]),
    }))).toBeNull();
  });

  it('the pointer is absent entirely (legacy document)', () => {
    // No pointer at all, but real executions exist: the window must still be
    // derived from them rather than collapsing to "never trained".
    expect(detectMissedSessionNotice(base({
      lastPerformedLocalDate: null,
      performedLocalDates: new Set([SAT]),
    }))).toBeNull();
  });

  it('the effort belongs to another program instance', () => {
    // `lastPerformedLocalDate` is instance-scoped and resets on a switch; the
    // execution list is not.
    expect(detectMissedSessionNotice(base({
      lastPerformedLocalDate: null,
      programInstanceId: 'wpi_2',
      performedLocalDates: new Set([SAT]),
    }))).toBeNull();
  });

  it('the pointer claims a FUTURE date and real history disagrees', () => {
    // A pointer ahead of reality must not hide a genuine miss by widening the
    // window past it — the latest signal wins, and here that is the pointer,
    // so nothing before it can be missed. Asserting the direction explicitly.
    const notice = detectMissedSessionNotice(base({
      lastPerformedLocalDate: SAT,
      performedLocalDates: new Set(['2026-10-14']),
    }));
    expect(notice).toBeNull();
  });

  it('the window starts at the LATEST effort, so older gaps are closed history', () => {
    // Wednesday went by untrained, but Saturday was then trained. Asking on
    // Monday about a Wednesday that precedes the user's most recent workout
    // would be relitigating settled history, so only days after Saturday can
    // be raised — and there are none (Sunday is not recommended).
    expect(detectMissedSessionNotice(base({
      recommendedWeekdays: ['WED', 'SAT', 'MON'],
      lastPerformedLocalDate: '2026-10-13', // Tuesday
      performedLocalDates: new Set(['2026-10-13', SAT]),
      todayLocalDate: MON,
    }))).toBeNull();
  });

  it('a day trained MID-GAP excuses itself without hiding a later miss', () => {
    // Trained Tuesday and then Wednesday; Saturday went by untrained. The
    // reported miss must be Saturday — the one real gap after the last
    // effort — and never the Wednesday that was actually trained.
    const notice = detectMissedSessionNotice(base({
      recommendedWeekdays: ['WED', 'SAT', 'MON'],
      lastPerformedLocalDate: '2026-10-13',
      performedLocalDates: new Set(['2026-10-13', '2026-10-14']),
      todayLocalDate: MON,
    }));
    expect(notice).not.toBeNull();
    expect(notice!.missedScheduledDate).toBe(SAT);
    expect(notice!.missedOccurrenceCount).toBe(1);
  });

  it('every recommended day in the gap was trained', () => {
    expect(detectMissedSessionNotice(base({
      recommendedWeekdays: ['WED', 'SAT', 'MON'],
      lastPerformedLocalDate: '2026-10-13',
      performedLocalDates: new Set(['2026-10-13', '2026-10-14', SAT]),
      todayLocalDate: MON,
    }))).toBeNull();
  });
});

describe('adversarial: an anticipated session covers its own scheduled day', () => {
  it("Saturday's session finished on Friday leaves Saturday covered, not missed", () => {
    // The real production shape: scheduledLocalDate in the future,
    // performedLocalDate on the day of the effort. Saturday has no effort of
    // its own, yet it was unquestionably trained.
    expect(detectMissedSessionNotice(base({
      lastPerformedLocalDate: '2026-10-16',           // Friday
      performedLocalDates: new Set(['2026-10-16']),
      coveredScheduledLocalDates: new Set([SAT]),     // the opportunity consumed
    }))).toBeNull();
  });

  it('a deferred session covers its scheduled day too', () => {
    // Scheduled Saturday, actually performed Sunday. Saturday is covered.
    expect(detectMissedSessionNotice(base({
      lastPerformedLocalDate: SUN,
      performedLocalDates: new Set([SUN]),
      coveredScheduledLocalDates: new Set([SAT]),
    }))).toBeNull();
  });

  it('covering an unrelated day does NOT excuse a real miss', () => {
    // The coverage set must be read per-day, never as a blanket amnesty.
    const notice = detectMissedSessionNotice(base({
      coveredScheduledLocalDates: new Set(['2026-10-10']),
    }));
    expect(notice).not.toBeNull();
    expect(notice!.missedScheduledDate).toBe(SAT);
  });

  it('a day covered mid-gap does not hide the next real miss', () => {
    const notice = detectMissedSessionNotice(base({
      recommendedWeekdays: ['WED', 'SAT', 'MON'],
      lastPerformedLocalDate: '2026-10-13',
      performedLocalDates: new Set(['2026-10-13']),
      coveredScheduledLocalDates: new Set(['2026-10-13', '2026-10-14']),
    }));
    expect(notice).not.toBeNull();
    expect(notice!.missedScheduledDate).toBe(SAT);
  });

  it('an ordinary completion keeps both sets equal, changing nothing', () => {
    // scheduled == performed for a normal session, so coverage adds nothing
    // and a genuine later miss is still reported.
    const notice = detectMissedSessionNotice(base({
      lastPerformedLocalDate: '2026-10-14',
      performedLocalDates: new Set(['2026-10-14']),
      coveredScheduledLocalDates: new Set(['2026-10-14']),
    }));
    expect(notice!.missedScheduledDate).toBe(SAT);
  });

  it('no date-derived "reorganization" signal remains in the contract', () => {
    // `scheduleState.updatedAt` is written by thirteen distinct writers,
    // completions included, so it can never stand for a deliberate
    // selection. The shape must not carry such a field at all.
    const keys = Object.keys(base());
    expect(keys).not.toContain('lastRotationChangeLocalDate');
    expect(keys).not.toContain('updatedAt');
    expect(keys).toContain('performedLocalDates');
    expect(keys).toContain('coveredScheduledLocalDates');
  });
});
