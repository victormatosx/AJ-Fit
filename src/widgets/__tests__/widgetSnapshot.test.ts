import { describe, expect, it } from 'vitest';
import {
  buildWidgetSnapshot,
  isSupportedWidgetSnapshotVersion,
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
  type WidgetSnapshotBuilderInput,
} from '../widgetSnapshot';

const baseFixedInput: WidgetSnapshotBuilderInput = {
  isAuthenticated: true,
  hasActiveProgram: true,
  todayLocalDate: '2026-09-09', // Wednesday
  timezone: 'America/Sao_Paulo',
  generatedAtMs: 1_000_000,
  trainingDays: ['MON', 'WED', 'FRI'],
  activeRecoveryDays: [],
  activatedAtLocalDate: '2026-08-01',
  dailyActivityStreak: { current: 0, complete: true },
  completedDates: new Set(['2026-09-07', '2026-09-09']), // today (Wed) already completed — settled
};

describe('buildWidgetSnapshot — empty states', () => {
  it('UNAUTHENTICATED carries nothing else — no localDate, no streak, no activity', () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, isAuthenticated: false });
    expect(snapshot).toEqual({ schemaVersion: 2, status: 'UNAUTHENTICATED' });
  });

  it('NO_PROGRAM is distinct from a zeroed-out READY snapshot', () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, hasActiveProgram: false });
    expect(snapshot).toEqual({
      schemaVersion: 2,
      status: 'NO_PROGRAM',
      localDate: '2026-09-09',
      generatedAtMs: 1_000_000,
    });
    expect(snapshot).not.toHaveProperty('streak');
    expect(snapshot).not.toHaveProperty('futureEntries');
  });

  it('a program with zero completions yet is READY, not a missing-data state — streak is a real 0, not absent', () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, completedDates: new Set() });
    expect(snapshot.status).toBe('READY');
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.streak).toEqual({ scheduleMode: 'fixed', unit: 'days', current: 0, complete: true });
    expect(snapshot.monthlyActivity.completedLocalDates).toEqual([]);
    expect(snapshot.frequencyWindow.completedLocalDates).toEqual([]);
    expect(snapshot.weeklyActivity).toHaveLength(7);
    // Today (Wed, not a completion yet) is TODAY_PENDING — unsettled — so
    // the horizon correctly stops at today: no future entries invented.
    expect(snapshot.futureEntries).toEqual([]);
  });
});

describe('buildWidgetSnapshot — fixed schedule', () => {
  // Chama 2.0: the streak field carries the SAME metric the Home shows, and it
  // is resolved by `fetchWidgetDailyActivityStreak` (workouts UNION confirmed
  // food entries) before reaching this builder. It is deliberately no longer
  // derived from `completedDates`, because a day backed only by a food entry
  // is a real streak day that completions cannot see.
  it('passes the resolved Chama 2.0 through verbatim, never re-deriving it', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      dailyActivityStreak: { current: 17, complete: true },
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.streak).toEqual({ scheduleMode: 'fixed', unit: 'days', current: 17, complete: true });
  });

  it('reports an inexact streak as inexact — never as an exact value', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      dailyActivityStreak: { current: 520, complete: false },
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.streak).toMatchObject({ current: 520, complete: false });
  });

  it('keeps the adherence data independent of the streak — the two are never mixed', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      dailyActivityStreak: { current: 99, complete: true },
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    // Completions still drive the week/month/frequency surfaces.
    expect(snapshot.weeklyActivity.find((d) => d.weekday === 'MON')!.status).toBe('COMPLETED');
    expect(snapshot.monthlyActivity.completedLocalDates.length).toBeGreaterThan(0);
    expect(snapshot.streak.current).toBe(99);
  });

  it('weeklyActivity is exactly buildWeekOverview output for the same inputs — never re-derived', () => {
    const snapshot = buildWidgetSnapshot(baseFixedInput);
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.weeklyActivity).toHaveLength(7);
    const byWeekday = Object.fromEntries(snapshot.weeklyActivity.map((d) => [d.weekday, d]));
    expect(byWeekday.MON.status).toBe('COMPLETED');
    expect(byWeekday.WED.status).toBe('TODAY_COMPLETED');
    expect(byWeekday.TUE.status).toBe('REST');
    expect(byWeekday.FRI.status).toBe('UPCOMING');
  });

  it('REST days never appear in monthlyActivity/frequencyWindow — only real completions do', () => {
    const snapshot = buildWidgetSnapshot(baseFixedInput);
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.monthlyActivity.completedLocalDates).toEqual(['2026-09-07', '2026-09-09']);
  });

  it('ACTIVE_RECOVERY days are visible in weeklyActivity, distinct from REST', () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, activeRecoveryDays: ['TUE'] });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    const tuesday = snapshot.weeklyActivity.find((d) => d.weekday === 'TUE')!;
    expect(tuesday.status).toBe('ACTIVE_RECOVERY');
  });

  it('a past training day with no completion shows MISSED in weeklyActivity', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-09-11', // Friday
      completedDates: new Set(['2026-09-07']), // Wed (09-09) never completed
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.weeklyActivity.find((d) => d.weekday === 'WED')!.status).toBe('MISSED');
  });

  it('today not yet trained (day not over) shows TODAY_PENDING, never MISSED', () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, completedDates: new Set(['2026-09-07']) });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.weeklyActivity.find((d) => d.weekday === 'WED')!.status).toBe('TODAY_PENDING');
  });

  it('FULFILLED_EARLY is visible in weeklyActivity and does not inflate the streak (see streak.test.ts for the full walk)', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-09-18', // Friday
      trainingDays: ['WED', 'FRI'],
      completedDates: new Set(['2026-09-16', '2026-09-17']), // Wed + early Fri session on Thu (same week)
      fulfilledScheduledDates: new Set(['2026-09-18']), // Fri
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.weeklyActivity.find((d) => d.weekday === 'FRI')!.status).toBe('FULFILLED_EARLY');
    // The streak no longer reacts to completion shapes at all — it is the
    // value handed in.
    expect(snapshot.streak.unit).toBe('days');
  });

  it('multiple executions on the same day never double-count in monthlyActivity (completedDates is already deduplicated per day)', () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, completedDates: new Set(['2026-09-07']) });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.monthlyActivity.completedLocalDates).toEqual(['2026-09-07']);
  });
});

describe('buildWidgetSnapshot — streak truncation (Phase 2.5 §A)', () => {
  // `historyAvailableFromLocalDate` still bounds the ADHERENCE windows; the
  // streak's own truncation is decided by `fetchWidgetDailyActivityStreak`
  // and arrives already resolved in `dailyActivityStreak.complete`.
  it('propagates the streak exactness it was given, in both directions', () => {
    for (const complete of [true, false]) {
      const snapshot = buildWidgetSnapshot({
        ...baseFixedInput,
        historyAvailableFromLocalDate: '2026-09-07',
        dailyActivityStreak: { current: 5, complete },
      });
      if (snapshot.status !== 'READY') throw new Error('unreachable');
      expect(snapshot.streak.complete).toBe(complete);
    }
  });

  it('omitting historyAvailableFromLocalDate still bounds only the adherence windows', () => {
    const snapshot = buildWidgetSnapshot(baseFixedInput);
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.streak.complete).toBe(true);
  });

  it('a future entry\'s streak also reflects the same historyAvailableFromLocalDate floor', () => {
    // Make today settled (REST, not a trainingDay) so a future entry exists to inspect.
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-09-08', // Tuesday — REST, settled
      trainingDays: ['MON', 'WED', 'FRI'],
      completedDates: new Set(['2026-09-07']), // Monday completed, unbroken run going back further than the floor
      historyAvailableFromLocalDate: '2026-09-07',
      dailyActivityStreak: { current: 12, complete: false },
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.futureEntries.length).toBeGreaterThan(0);
    // Every pre-computed future day carries the same resolved streak: a
    // future entry must never present an inexact value as exact, and must
    // never invent a different number than the current entry.
    for (const entry of snapshot.futureEntries) {
      expect(entry.streak).toEqual({ scheduleMode: 'fixed', unit: 'days', current: 12, complete: false });
    }
  });
});

describe('buildWidgetSnapshot — flexible schedule', () => {
  // Chama 2.0 is the same metric in both modalities: consecutive DAYS with a
  // valid activity. `flexible` no longer gets a different unit, because the
  // streak never consulted the modality in the first place.
  it('reports the same day-based streak for a flexible schedule', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 2,
      trainingDays: [],
      completedDates: new Set(['2026-09-07', '2026-09-08']),
      dailyActivityStreak: { current: 4, complete: true },
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.streak).toEqual({ scheduleMode: 'fixed', unit: 'days', current: 4, complete: true });
  });

  it('flexible weeklyActivity never marks an untrained day MISSED', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      trainingDays: [],
      completedDates: new Set(['2026-09-07']),
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.weeklyActivity.some((d) => d.status === 'MISSED')).toBe(false);
  });

  it('flexible days are always REST or COMPLETED — always settled — so the horizon is bounded only by MAX_TIMELINE_ENTRIES', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      trainingDays: [],
      completedDates: new Set(['2026-09-07']),
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.futureEntries).toHaveLength(3); // today + 3 future = MAX_TIMELINE_ENTRIES
  });
});

describe('buildWidgetSnapshot — month boundary ("virada de mês")', () => {
  it('the last day of a month and the first day of the next produce different monthlyActivity windows', () => {
    const lastDayOfSeptember = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-09-30',
      completedDates: new Set(['2026-09-01', '2026-10-01']),
    });
    const firstDayOfOctober = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-10-01',
      completedDates: new Set(['2026-09-01', '2026-10-01']),
    });
    if (lastDayOfSeptember.status !== 'READY' || firstDayOfOctober.status !== 'READY') throw new Error('unreachable');
    expect(lastDayOfSeptember.monthlyActivity).toMatchObject({ year: 2026, month: 9, daysInMonth: 30 });
    expect(lastDayOfSeptember.monthlyActivity.completedLocalDates).toEqual(['2026-09-01']);
    expect(firstDayOfOctober.monthlyActivity).toMatchObject({ year: 2026, month: 10, daysInMonth: 31 });
    expect(firstDayOfOctober.monthlyActivity.completedLocalDates).toEqual(['2026-10-01']);
  });

  it('handles a leap-year February correctly', () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, todayLocalDate: '2028-02-15' });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.monthlyActivity.daysInMonth).toBe(29);
  });

  it('a settled Dec 31 produces a future entry for Jan 1 with the correct new-year monthlyActivity', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-12-31', // Thursday — not MON/WED/FRI -> REST, settled
      trainingDays: ['MON', 'WED', 'FRI'],
      completedDates: new Set(),
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    const jan1 = snapshot.futureEntries.find((e) => e.effectiveLocalDate === '2027-01-01');
    expect(jan1).toBeDefined();
    expect(jan1!.monthlyActivity).toMatchObject({ year: 2027, month: 1 });
  });
});

describe('buildWidgetSnapshot — week boundary ("virada de semana")', () => {
  it('Sunday and the following Monday fall in different weeklyActivity windows', () => {
    const sunday = buildWidgetSnapshot({ ...baseFixedInput, todayLocalDate: '2026-09-13' });
    const monday = buildWidgetSnapshot({ ...baseFixedInput, todayLocalDate: '2026-09-14' });
    if (sunday.status !== 'READY' || monday.status !== 'READY') throw new Error('unreachable');
    expect(sunday.weeklyActivity[0].localDate).toBe('2026-09-07');
    expect(sunday.weeklyActivity[6].localDate).toBe('2026-09-13');
    expect(monday.weeklyActivity[0].localDate).toBe('2026-09-14');
    expect(monday.weeklyActivity[6].localDate).toBe('2026-09-20');
  });
});

describe('buildWidgetSnapshot — future timeline entries (Phase 2.5 §B/§C)', () => {
  it("a still-pending today ('TODAY_PENDING') yields an EMPTY futureEntries — never a guessed MISSED", () => {
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, completedDates: new Set(['2026-09-07']) }); // today (Wed) not yet completed
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.weeklyActivity.find((d) => d.weekday === 'WED')!.status).toBe('TODAY_PENDING');
    expect(snapshot.futureEntries).toEqual([]);
  });

  it('a settled today (already completed) yields future entries up to the first unsettled day, inclusive', () => {
    // today = Wed (TODAY_COMPLETED, settled) -> Thu REST (settled) -> Fri UPCOMING trainingDay (unsettled, included, stop).
    const snapshot = buildWidgetSnapshot(baseFixedInput);
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.futureEntries.map((e) => e.effectiveLocalDate)).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('a future entry for an UPCOMING trainingDay honestly reports TODAY_PENDING for its own date, never a false COMPLETED/MISSED guess', () => {
    const snapshot = buildWidgetSnapshot(baseFixedInput);
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    const friday = snapshot.futureEntries.find((e) => e.effectiveLocalDate === '2026-09-11')!;
    expect(friday.weeklyActivity.find((d) => d.weekday === 'FRI')!.status).toBe('TODAY_PENDING');
  });

  it('a REST day in futureEntries correctly shows the earlier settled day as COMPLETED, not re-litigated', () => {
    const snapshot = buildWidgetSnapshot(baseFixedInput);
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    const thursday = snapshot.futureEntries.find((e) => e.effectiveLocalDate === '2026-09-10')!;
    expect(thursday.weeklyActivity.find((d) => d.weekday === 'WED')!.status).toBe('COMPLETED');
  });

  it('a completion recorded after the timeline would have been generated is simply not reflected — the caller must resync (see Phase 2.5 report §C)', () => {
    // Simulates: snapshot generated at 3pm with Wed pending; the user then
    // trains at 8pm. This generator call itself still only knows what it
    // was given — completedDates WITHOUT the later completion — proving
    // the pre-computation never assumes a resolution it cannot know.
    const beforeCompletion = buildWidgetSnapshot({ ...baseFixedInput, completedDates: new Set(['2026-09-07']) });
    if (beforeCompletion.status !== 'READY') throw new Error('unreachable');
    expect(beforeCompletion.futureEntries).toEqual([]); // honestly stops at today

    // The actual completion event must trigger a BRAND NEW build (this is
    // what `resyncNow`/`finalizeWorkoutSession` do in production) — never a
    // patch of the old one.
    const afterCompletion = buildWidgetSnapshot({ ...baseFixedInput, completedDates: new Set(['2026-09-07', '2026-09-09']) });
    if (afterCompletion.status !== 'READY') throw new Error('unreachable');
    expect(afterCompletion.futureEntries.length).toBeGreaterThan(0); // now correctly extends, from fresh data
  });

  it('every entry (current + future) carries a DST-correct effectiveAtMs, never computed by native', () => {
    // Realistic generatedAtMs (6pm on the fixture's own todayLocalDate) —
    // `baseFixedInput`'s placeholder `1_000_000` is intentionally arbitrary
    // for tests that don't care about it, but this one specifically checks
    // the current entry's effectiveAtMs lands before a real "generated at".
    const snapshot = buildWidgetSnapshot({ ...baseFixedInput, generatedAtMs: Date.UTC(2026, 8, 9, 18, 0, 0) });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(typeof snapshot.effectiveAtMs).toBe('number');
    expect(snapshot.effectiveAtMs).toBeLessThanOrEqual(snapshot.generatedAtMs);
    for (const entry of snapshot.futureEntries) {
      expect(typeof entry.effectiveAtMs).toBe('number');
      expect(entry.effectiveAtMs).toBeGreaterThan(snapshot.effectiveAtMs);
    }
    // Strictly ascending, one per day.
    const all = [snapshot.effectiveAtMs, ...snapshot.futureEntries.map((e) => e.effectiveAtMs)];
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i] - all[i - 1]).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('respects the MAX_TIMELINE_ENTRIES cap even when every day is settled (REST-heavy schedule)', () => {
    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-09-08', // Tuesday, REST — settled
      trainingDays: ['FRI'], // only one trainingDay/week -> many consecutive REST days ahead
      completedDates: new Set(),
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');
    expect(snapshot.futureEntries.length).toBeLessThanOrEqual(3); // 4 total entries - today
  });
});

describe('buildWidgetSnapshot — timezone', () => {
  it('date-based fields (localDate/weeklyActivity/monthlyActivity/streak) never depend on the timezone string — only effectiveAtMs does', () => {
    const fromSaoPaulo = buildWidgetSnapshot({ ...baseFixedInput, timezone: 'America/Sao_Paulo' });
    const fromTokyo = buildWidgetSnapshot({ ...baseFixedInput, timezone: 'Asia/Tokyo' });
    if (fromSaoPaulo.status !== 'READY' || fromTokyo.status !== 'READY') throw new Error('unreachable');

    const { effectiveAtMs: _a, futureEntries: futuresA, ...restA } = fromSaoPaulo;
    const { effectiveAtMs: _b, futureEntries: futuresB, ...restB } = fromTokyo;
    expect(restA).toEqual(restB);
    expect(futuresA.map((e) => ({ ...e, effectiveAtMs: undefined })))
      .toEqual(futuresB.map((e) => ({ ...e, effectiveAtMs: undefined })));

    // But the actual wall-clock instant DOES differ between zones.
    expect(fromSaoPaulo.effectiveAtMs).not.toBe(fromTokyo.effectiveAtMs);
  });

  it('never resolves "now"/the current instant — only ever converts the already-given todayLocalDate', () => {
    const a = buildWidgetSnapshot(baseFixedInput);
    const b = buildWidgetSnapshot(baseFixedInput);
    expect(a).toEqual(b); // no hidden dependency on real wall-clock time
  });
});

describe('buildWidgetSnapshot — determinism', () => {
  it('identical input always produces deeply-equal output', () => {
    const first = buildWidgetSnapshot(baseFixedInput);
    const second = buildWidgetSnapshot(baseFixedInput);
    expect(first).toEqual(second);
  });
});

describe('buildWidgetSnapshot — schemaVersion', () => {
  it('every newly built status variant carries schemaVersion 2 while V1 stays readable', () => {
    expect(buildWidgetSnapshot({ ...baseFixedInput, isAuthenticated: false }).schemaVersion).toBe(2);
    expect(buildWidgetSnapshot({ ...baseFixedInput, hasActiveProgram: false }).schemaVersion).toBe(2);
    expect(buildWidgetSnapshot(baseFixedInput).schemaVersion).toBe(2);
    expect(WIDGET_SNAPSHOT_SCHEMA_VERSION).toBe(2);
  });

  it('isSupportedWidgetSnapshotVersion rejects unknown future versions', () => {
    expect(isSupportedWidgetSnapshotVersion(1)).toBe(true);
    expect(isSupportedWidgetSnapshotVersion(2)).toBe(true);
    expect(isSupportedWidgetSnapshotVersion(0)).toBe(false);
  });
});

describe('buildWidgetSnapshot — absence of PII', () => {
  const forbiddenKeys = ['uid', 'email', 'name', 'token', 'idToken', 'appCheckToken', 'entitlement', 'programId', 'timezone'];

  it('no forbidden key appears anywhere in a READY snapshot, including inside futureEntries', () => {
    const snapshot = buildWidgetSnapshot(baseFixedInput);
    const serialized = JSON.stringify(snapshot).toLowerCase();
    for (const key of forbiddenKeys) {
      expect(serialized).not.toContain(key.toLowerCase());
    }
  });
});

describe('buildWidgetSnapshot — bounded size regardless of input history', () => {
  it('a large multi-year completedDates input never grows the snapshot beyond its fixed windows, even with a full future timeline', () => {
    const manyDates = new Set<string>();
    for (let year = 2015; year <= 2026; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        for (const day of [1, 10, 20]) {
          manyDates.add(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }
      }
    }

    const snapshot = buildWidgetSnapshot({
      ...baseFixedInput,
      todayLocalDate: '2026-09-08', // Tuesday, REST — settled, maximizes futureEntries
      completedDates: manyDates,
      historyAvailableFromLocalDate: '2015-01-01',
    });
    if (snapshot.status !== 'READY') throw new Error('unreachable');

    expect(snapshot.weeklyActivity).toHaveLength(7);
    expect(snapshot.monthlyActivity.completedLocalDates.length).toBeLessThanOrEqual(31);
    expect(snapshot.frequencyWindow.completedLocalDates.length).toBeLessThanOrEqual(30);
    expect(snapshot.futureEntries.length).toBeLessThanOrEqual(3);

    const byteSize = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
    expect(byteSize).toBeLessThan(16_384); // generous — 4 entries' worth of weekly/monthly/frequency windows, still tiny
  });
});
