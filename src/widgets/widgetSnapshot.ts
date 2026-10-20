import type { ScheduleMode, Weekday } from '../state/AppState';
import { addDaysLocal, weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';
import { localDateStartOfDayMs } from '../scheduleEngine/localDate';
import { monthBounds } from '../home/calendarMonth';
import { buildFrequencyWindow } from '../home/frequencyHeatmap';
import { computeStreak, type Streak } from '../home/streak';
import { buildWeekOverview, classifyDayStatus, type WeekDayStatus, type WeekDayViewModel } from '../home/weekOverview';
import type { WorkoutWidgetData } from './workoutWidgetProjection';

/**
 * Home Screen Widgets — Phase 1/2.5 contract + pure TypeScript snapshot
 * builder. No WidgetKit, Glance, native bridge UI, or deep link is wired up
 * yet. This module's only job is to turn the SAME authoritative sources the
 * Home screen already uses (`buildWeekOverview`, `buildFrequencyWindow`,
 * `computeStreak`) into a small, versioned, fully-resolved snapshot a
 * future native widget extension can render without re-implementing any
 * business rule — including, as of Phase 2.5, a few days of PRE-COMPUTED
 * future state so a widget can survive a midnight rollover with the app
 * closed (see `futureEntries` below and the Phase 2.5 report §B/§C).
 *
 * Hard rule carried over from the audit: the native layer must never decide
 * what day "today" is, whether a day is REST vs MISSED, whether an early
 * completion is FULFILLED_EARLY, or how streak is computed. Every field
 * below is already a fully-resolved, renderable value — at most, native
 * code does array indexing, `now >= effectiveAtMs` comparisons, and
 * enum-to-localized-string mapping.
 */

export const WIDGET_SNAPSHOT_SCHEMA_VERSION = 2 as const;

const SUPPORTED_WIDGET_SNAPSHOT_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([
  1,
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
]);

/**
 * Any future decoder (native or JS) reading a persisted snapshot must check
 * this BEFORE trusting its shape. An unrecognized `schemaVersion` means the
 * app was downgraded relative to whatever last wrote the shared storage, or
 * a future `WidgetSnapshotV2` (etc.) was written by a newer build — either
 * way, the safe behavior is to keep showing the last known-good rendered
 * state (or an empty/neutral placeholder), never to read fields that may
 * not exist on an unknown version.
 */
export function isSupportedWidgetSnapshotVersion(schemaVersion: number): boolean {
  return SUPPORTED_WIDGET_SNAPSHOT_SCHEMA_VERSIONS.has(schemaVersion);
}

export interface WidgetMonthlyCalendar {
  year: number;
  /** 1-12. */
  month: number;
  daysInMonth: number;
  /** Weekday of day 1 — lets native lay out a grid without computing a weekday from a date itself. */
  startWeekday: Weekday;
  /** Completed local dates within this calendar month only — binary "has activity", same model as `frequencyHeatmap.ts` (no REST/MISSED semantics here; see module doc). */
  completedLocalDates: LocalDate[];
}

export interface WidgetFrequencyWindow {
  startLocalDate: LocalDate;
  endLocalDate: LocalDate;
  /** Weekday of `startLocalDate` — same reasoning as `WidgetMonthlyCalendar.startWeekday`. */
  startWeekday: Weekday;
  /** Completed local dates within the window — binary, mirrors `buildFrequencyWindow`'s own model exactly. */
  completedLocalDates: LocalDate[];
}

/** The per-date fields shared by the current (top-level) entry and every `futureEntries` entry — see `buildReadyEntryFields`. */
interface WidgetReadyEntryFields {
  streak: Streak;
  /** Exactly 7 entries, Monday through Sunday — same shape `buildWeekOverview` already produces for Home's "esta semana". */
  weeklyActivity: WeekDayViewModel[];
  monthlyActivity: WidgetMonthlyCalendar;
  frequencyWindow: WidgetFrequencyWindow;
}

/**
 * A PRE-COMPUTED future day's worth of widget content — see the Phase 2.5
 * report §B/§C for the full derivation. Only ever contains dates whose
 * entire content was ALREADY DETERMINISTICALLY KNOWABLE at the moment the
 * snapshot was generated (see `determineTimelineHorizonLocalDates`); it
 * never guesses whether a still-pending obligation will end up completed
 * or missed.
 */
export interface WidgetTimelineEntry extends WidgetReadyEntryFields {
  effectiveLocalDate: LocalDate;
  /**
   * UTC epoch ms of local midnight for `effectiveLocalDate`, already
   * resolved against the user's timezone (DST-correct — see
   * `localDateStartOfDayMs`). Native selects the LAST entry (across the
   * top-level "current" fields and `futureEntries`, treated as one
   * ascending-by-date list) whose own effective instant is `<= now`; it
   * never computes `effectiveAtMs` itself and never derives a weekday or
   * calendar date from a raw timestamp.
   */
  effectiveAtMs: number;
}

/**
 * Discriminated, versioned, and intentionally free of any identifier beyond
 * what rendering needs — no `uid`, email, name, Firebase/App Check token,
 * entitlement, or `programId`. Logout/account-switch is handled upstream
 * (the whole stored blob is deleted, not a field inside it — same pattern
 * `homePresentationSnapshot.ts` already uses).
 *
 * `status` separates "we have nothing to say yet" from "we checked, and the
 * real answer is zero" — never conflate the two:
 *   - `UNAUTHENTICATED`: no signed-in user. Widget shows a sign-in prompt.
 *   - `NO_PROGRAM`: signed in, no active program. Widget shows an "activate
 *     a program" prompt — never a zeroed-out calendar/streak, since there
 *     is no schedule to project one from.
 *   - `READY`: signed in, active program, snapshot fully resolved. A brand
 *     new program with zero completions yet is ALSO `READY` — streak is
 *     legitimately `{ current: 0, complete: true }`, `weeklyActivity` is a
 *     real week of REST/UPCOMING/TODAY_PENDING days, `monthlyActivity`/
 *     `frequencyWindow` have empty `completedLocalDates`. That is real,
 *     resolved data, not a missing-data state.
 *
 * There is deliberately no `LOADING` or `STALE` variant: a pure builder
 * cannot be "mid-fetch" (that is the caller/bridge's concern, not this
 * function's — see `buildWidgetSnapshot`'s doc comment), and staleness is
 * only observable after time passes on the native side by comparing
 * `effectiveAtMs`/`generatedAtMs` against the device's own current date —
 * this module cannot know that about itself at build time.
 */
export type WidgetSnapshotV1 =
  | { schemaVersion: 1; status: 'UNAUTHENTICATED' }
  | { schemaVersion: 1; status: 'NO_PROGRAM'; localDate: LocalDate; generatedAtMs: number }
  | ({
      schemaVersion: 1;
      status: 'READY';
      /** Already resolved in the user's timezone — see `buildWidgetSnapshot`'s doc comment. */
      localDate: LocalDate;
      /** Caller-supplied wall-clock time this snapshot was built, for native-side staleness checks/debug presentation — not used for entry selection (see `effectiveAtMs`). */
      generatedAtMs: number;
      /** UTC ms of local midnight for `localDate` — the current entry's own `effectiveAtMs`, always `<= generatedAtMs` by construction, so native always has a safe floor entry even if `futureEntries` is empty. */
      effectiveAtMs: number;
      /**
       * Zero or more PRE-COMPUTED future days, nearest first, for
       * `effectiveLocalDate > localDate`. Length varies 0-3 depending on
       * how many consecutive days were already deterministically settled
       * at generation time (often 0 — see the Phase 2.5 report's worked
       * example: a pending, not-yet-trained "today" yields an empty array,
       * which is the CORRECT, honest answer, not a bug). Regenerated from
       * scratch on every sync (login, program change, finalize, foreground)
       * — there is no separate invalidation mechanism, because the whole
       * snapshot is always one atomic replacement (see the Phase 2.5
       * report §C).
       */
      futureEntries: WidgetTimelineEntry[];
    } & WidgetReadyEntryFields);

/** V2 adds the app-resolved Próximo Treino projection without changing V1. */
export type WidgetSnapshotV2 =
  | { schemaVersion: 2; status: 'UNAUTHENTICATED' }
  | { schemaVersion: 2; status: 'NO_PROGRAM'; localDate: LocalDate; generatedAtMs: number }
  | ({
      schemaVersion: 2;
      status: 'READY';
      localDate: LocalDate;
      generatedAtMs: number;
      effectiveAtMs: number;
      futureEntries: WidgetTimelineEntry[];
      /** Null means the schedule/program is in transition and no honest workout can be shown. */
      workout: WorkoutWidgetData | null;
    } & WidgetReadyEntryFields);

export type WidgetSnapshot = WidgetSnapshotV1 | WidgetSnapshotV2;

export interface WidgetSnapshotBuilderInput {
  isAuthenticated: boolean;
  hasActiveProgram: boolean;
  /** Already resolved via `localDateInTimezone` by the caller — this builder never decides what day "today" is. */
  todayLocalDate: LocalDate;
  /**
   * The user's IANA timezone, needed ONLY to resolve `effectiveAtMs`
   * (`localDateStartOfDayMs`) for the current entry and each
   * `futureEntries` entry — never surfaced in the output, never used for
   * any REST/MISSED/streak decision (those are already timezone-resolved
   * via `todayLocalDate` upstream, same as before Phase 2.5).
   */
  timezone: string;
  /** Caller-supplied clock (e.g. `Date.now()`), kept as an explicit input rather than read internally so the builder stays pure/deterministic and testable without mocking global time or Firebase. */
  generatedAtMs: number;
  scheduleMode?: ScheduleMode;
  /** Weekly target for `flexible` schedules; ignored for `fixed`. */
  prescribedTrainingFrequency?: number;
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
  /**
   * Only affects `weeklyActivity`'s BEFORE_PROGRAM labeling (same contract
   * as `buildWeekOverview`). Deliberately NOT passed into the streak walk —
   * see `computeStreak`'s own doc comment for why a program switch must
   * never reset or reinterpret the streak.
   */
  activatedAtLocalDate: LocalDate | null;
  /**
   * As much completion history as the caller chooses to supply — used to
   * derive the streak number and the three bounded windows below, never
   * echoed back raw. A large input here does NOT make the output grow: see
   * `widgetSnapshot.test.ts`'s size-bound tests.
   */
  completedDates: ReadonlySet<LocalDate>;
  /** All-time fulfilled-early scheduled dates (`fixed` only) — see `classifyDayStatus`. */
  fulfilledScheduledDates?: ReadonlySet<LocalDate>;
  /**
   * Passed straight through to `computeStreak` — see its own doc comment.
   * `null`/omitted asserts `completedDates` is already exhaustive; a real
   * caller fetching a bounded range (see `fetchWidgetStreakHistory`) should
   * always supply the exact `from` bound it used, so `streak.complete`
   * reflects reality instead of silently defaulting to "exact."
   */
  historyAvailableFromLocalDate?: LocalDate | null;
  /**
   * Chama 2.0, already resolved by `fetchWidgetDailyActivityStreak` — the same
   * computation the Home runs, so the two can never disagree. It is NOT
   * derived from `completedDates` here: the streak also counts days backed
   * only by a confirmed food entry, which this builder never sees.
   */
  dailyActivityStreak: { current: number; complete: boolean };
  /** Fully resolved by the app domain; native widgets only render it. */
  workout?: WorkoutWidgetData | null;
}

const SETTLED_DAY_STATUSES: ReadonlySet<WeekDayStatus> = new Set([
  'COMPLETED', 'TODAY_COMPLETED', 'FULFILLED_EARLY', 'REST', 'ACTIVE_RECOVERY', 'BEFORE_PROGRAM', 'MISSED',
]);

/**
 * Horizon cap — see the Phase 2.5 report §Horizon for the full
 * justification. Today plus at most 3 future days: enough to survive a
 * closed-app weekend (Friday generation → Saturday/Sunday/Monday already
 * pre-computed when Friday itself was already settled), small enough to
 * keep the snapshot's size bounded regardless of how many days turn out to
 * be settled in a row.
 */
const MAX_TIMELINE_ENTRIES = 4;

/**
 * The ONLY place that decides how far into the future this snapshot may
 * safely speak. Walks forward from `todayLocalDate`, evaluating each
 * candidate day's status AS KNOWN AT GENERATION TIME (i.e. always with
 * `todayLocalDate` fixed as the reference "today" — never advancing it
 * during this scan). A day is included in the horizon regardless of
 * whether it is settled; the scan simply does not continue PAST the first
 * unsettled (`TODAY_PENDING`/`UPCOMING`) day, because computing anything
 * beyond it would require already knowing its resolution — exactly the
 * assumption Phase 2.5 §C forbids. `todayLocalDate` itself is always the
 * first entry and is never excluded, even when it is `TODAY_PENDING`
 * (that is the honest, correct state for "today" to report).
 */
function determineTimelineHorizonLocalDates(input: {
  todayLocalDate: LocalDate;
  scheduleMode: ScheduleMode;
  trainingSet: ReadonlySet<Weekday>;
  recoverySet: ReadonlySet<Weekday>;
  activatedAtLocalDate: LocalDate | null;
  completedDates: ReadonlySet<LocalDate>;
  fulfilledScheduledDates?: ReadonlySet<LocalDate>;
}): LocalDate[] {
  const horizon: LocalDate[] = [];
  let cursor = input.todayLocalDate;
  for (let i = 0; i < MAX_TIMELINE_ENTRIES; i += 1) {
    horizon.push(cursor);
    const status = classifyDayStatus({
      localDate: cursor,
      weekday: weekdayOfLocalDate(cursor),
      todayLocalDate: input.todayLocalDate,
      scheduleMode: input.scheduleMode,
      trainingSet: input.trainingSet,
      recoverySet: input.recoverySet,
      activatedAtLocalDate: input.activatedAtLocalDate,
      completedDates: input.completedDates,
      fulfilledScheduledDates: input.fulfilledScheduledDates,
    });
    if (!SETTLED_DAY_STATUSES.has(status)) break;
    cursor = addDaysLocal(cursor, 1);
  }
  return horizon;
}

function buildReadyEntryFields(
  input: WidgetSnapshotBuilderInput,
  scheduleMode: ScheduleMode,
  todayLocalDate: LocalDate,
): WidgetReadyEntryFields {
  const week = buildWeekOverview({
    todayLocalDate,
    scheduleMode,
    prescribedTrainingFrequency: input.prescribedTrainingFrequency,
    trainingDays: input.trainingDays,
    activeRecoveryDays: input.activeRecoveryDays,
    activatedAtLocalDate: input.activatedAtLocalDate,
    completedDates: input.completedDates,
    fulfilledScheduledDates: input.fulfilledScheduledDates,
  });

  // Chama 2.0 — the SAME number, colour and break rule the Home shows.
  //
  // `computeStreak` (training obligations / goal-met weeks) no longer feeds
  // this field: it answered a different question and would show a different
  // number than the app, which is exactly what the integration had to fix.
  // The adherence data the widget also renders (`weeklyActivity`,
  // `frequencyWindow`, `monthlyActivity`) is untouched and still derived from
  // completions — the two are deliberately not mixed.
  //
  // `unit: 'days'` is new. The Android label map (`AJFitWidgetSnapshot.kt`'s
  // `unitLabel`) has no `days` case yet and would fall through to
  // "TREINO/TREINOS"; the number and colour are already correct, only the
  // label needs the native one-liner. See the hand-off report §15.
  const streak: Streak = {
    scheduleMode: 'fixed',
    unit: 'days',
    current: input.dailyActivityStreak.current,
    complete: input.dailyActivityStreak.complete,
  } as unknown as Streak;

  const month = monthBounds(todayLocalDate);
  const monthlyCompletedLocalDates: LocalDate[] = [];
  for (let day = 1; day <= month.daysInMonth; day += 1) {
    const localDate = `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (input.completedDates.has(localDate)) monthlyCompletedLocalDates.push(localDate);
  }

  const frequency = buildFrequencyWindow({
    todayLocalDate,
    offsetWindows: 0,
    completedDates: input.completedDates,
  });

  return {
    streak,
    weeklyActivity: week.days,
    monthlyActivity: {
      year: month.year,
      month: month.month,
      daysInMonth: month.daysInMonth,
      startWeekday: month.startWeekday,
      completedLocalDates: monthlyCompletedLocalDates,
    },
    frequencyWindow: {
      startLocalDate: frequency.startLocalDate,
      endLocalDate: frequency.endLocalDate,
      startWeekday: weekdayOfLocalDate(frequency.startLocalDate),
      completedLocalDates: frequency.days.filter((day) => day.completed).map((day) => day.localDate),
    },
  };
}

/**
 * Pure. No Firebase, no `Date.now()`/`Intl`-timezone-resolution-of-"now" —
 * every time-dependent decision is either an input (`todayLocalDate`,
 * `timezone`, `generatedAtMs`) or delegated to the existing Home domain
 * functions (`buildWeekOverview`, `buildFrequencyWindow`, `computeStreak`,
 * `classifyDayStatus`), never reimplemented here. `localDateStartOfDayMs`
 * (DST-aware) is the only timezone MATH performed, and only to resolve
 * `effectiveAtMs` values — never to decide what day anything is. Calling
 * this twice with identical input always produces deeply-equal output.
 */
export function buildWidgetSnapshot(input: WidgetSnapshotBuilderInput): WidgetSnapshotV2 {
  if (!input.isAuthenticated) {
    return { schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION, status: 'UNAUTHENTICATED' };
  }

  if (!input.hasActiveProgram) {
    return {
      schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
      status: 'NO_PROGRAM',
      localDate: input.todayLocalDate,
      generatedAtMs: input.generatedAtMs,
    };
  }

  const scheduleMode = input.scheduleMode ?? 'fixed';
  const trainingSet = new Set(input.trainingDays);
  const recoverySet = new Set(input.activeRecoveryDays);

  const horizonDates = determineTimelineHorizonLocalDates({
    todayLocalDate: input.todayLocalDate,
    scheduleMode,
    trainingSet,
    recoverySet,
    activatedAtLocalDate: input.activatedAtLocalDate,
    completedDates: input.completedDates,
    fulfilledScheduledDates: input.fulfilledScheduledDates,
  });

  const futureEntries: WidgetTimelineEntry[] = horizonDates
    .filter((localDate) => localDate !== input.todayLocalDate)
    .map((effectiveLocalDate) => ({
      effectiveLocalDate,
      effectiveAtMs: localDateStartOfDayMs(effectiveLocalDate, input.timezone),
      ...buildReadyEntryFields(input, scheduleMode, effectiveLocalDate),
    }));

  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    status: 'READY',
    localDate: input.todayLocalDate,
    generatedAtMs: input.generatedAtMs,
    effectiveAtMs: localDateStartOfDayMs(input.todayLocalDate, input.timezone),
    futureEntries,
    workout: input.workout ?? null,
    ...buildReadyEntryFields(input, scheduleMode, input.todayLocalDate),
  };
}
