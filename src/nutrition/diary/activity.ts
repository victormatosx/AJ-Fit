/**
 * Nutrition activity provenance for the daily activity streak (Chama 2.0).
 *
 * The streak asks one question per calendar day: "was at least one food
 * registration CONFIRMED on this day, and does it still exist?" Neither half
 * can be answered by the diary date in the document path — that is the day
 * the user says they ate, chosen freely by the client — nor by an immutable
 * operation receipt, which survives the deletion of the food it recorded.
 *
 * So two facts are persisted instead:
 *
 *  1. `activityLocalDate` on each item — the day the server confirmed it,
 *     frozen in the user's canonical timezone, stable across edits and moves.
 *  2. `users/{uid}/streakNutritionDays/{localDate}.activeItemCount` — how
 *     many items confirmed on that day STILL EXIST. The day counts while it
 *     is `> 0`, so deleting the last surviving food revokes the day while
 *     deleting one of three leaves it standing.
 *
 * Both are written only by `mutateNutritionDiaryV1`, inside the very same
 * transaction as the item itself, which is what makes the counter and the
 * items it counts impossible to observe out of step.
 *
 * This module is pure (no Firebase imports) and is synchronized into
 * `functions/` by `scripts/syncNutritionToFunctions.cjs`, so the backend that
 * maintains the counter and the client that reads it can never drift.
 */

/** Bumped only when a reader must treat older aggregate documents differently. */
export const NUTRITION_ACTIVITY_SCHEMA_VERSION = 1;

export const STREAK_NUTRITION_DAYS_COLLECTION = 'streakNutritionDays';
export const STREAK_SETTINGS_COLLECTION = 'streakSettings';
export const STREAK_SETTINGS_DOC_ID = 'current';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deliberately a local copy of the `en-CA` formatter trick rather than an
 * import of `src/scheduleEngine/localDate.ts`: that module belongs to the
 * workout domain, is not part of the nutrition sync manifest, and pulls in
 * `./calendar` (which needs the `AppState` weekday shim). The two are pinned
 * to identical output by `activityLocalDate.test.ts`, which compares them
 * across timezones and DST boundaries.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  FORMATTERS.set(timezone, formatter);
  return formatter;
}

/** Named IANA zones only (plus UTC); fixed offsets like `-03:00` are rejected. */
export function canonicalStreakTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  if (/^[+-]\d{2}:?\d{2}$/.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The activity day an instant falls on, in the user's canonical timezone. */
export function nutritionActivityLocalDate(instant: Date, timezone: string): string {
  const values = Object.fromEntries(
    formatterFor(timezone).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function isStreakLocalDate(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_DATE_PATTERN.test(value);
}

/** Minimal shape both the client and the Admin SDK `Timestamp` satisfy. */
interface InstantLike { toDate: () => Date }

function instantLike(value: unknown): value is InstantLike {
  return !!value && typeof (value as InstantLike).toDate === 'function';
}

/**
 * The activity day credited to an already-persisted item.
 *
 * Prefers the frozen `activityLocalDate`. Falls back to converting
 * `loggedAt`, which is what every item written before this field existed
 * has — a server instant for anything the callable wrote, and the device
 * clock for a legacy pre-enrollment write. The fallback is deliberately
 * tolerated rather than treated as "no activity": refusing to credit a
 * historical item would under-count real engagement, while the worst a
 * forged legacy `loggedAt` can do is move a day the same client could
 * already have created outright under the legacy Rules.
 *
 * Returns `null` only when neither fact is readable, so callers never
 * fabricate a date (and therefore never fabricate or revoke a day).
 */
export function activityLocalDateForItem(
  item: { activityLocalDate?: unknown; loggedAt?: unknown },
  timezone: string,
): string | null {
  if (isStreakLocalDate(item.activityLocalDate)) return item.activityLocalDate;
  if (instantLike(item.loggedAt)) {
    try {
      return nutritionActivityLocalDate(item.loggedAt.toDate(), timezone);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Collapses per-item changes into one signed delta per activity day.
 *
 * Creations contribute `+1` to the day being confirmed now; deletions `-1`
 * to the day the deleted item originally earned, which may be far in the
 * past (deleting Monday's only food on Wednesday revokes MONDAY). An edit or
 * a move contributes nothing at all, because the stored item keeps both its
 * identity and its `activityLocalDate`.
 *
 * Days whose delta cancels out are dropped, so an operation that adds and
 * removes within the same day writes nothing.
 */
export function nutritionActivityDeltas(input: {
  created: readonly { activityLocalDate?: unknown; loggedAt?: unknown }[];
  removed: readonly { activityLocalDate?: unknown; loggedAt?: unknown }[];
  timezone: string;
}): Map<string, number> {
  const deltas = new Map<string, number>();
  const apply = (localDate: string | null, amount: number): void => {
    if (localDate === null) return;
    const next = (deltas.get(localDate) ?? 0) + amount;
    if (next === 0) deltas.delete(localDate);
    else deltas.set(localDate, next);
  };
  for (const item of input.created) apply(activityLocalDateForItem(item, input.timezone), 1);
  for (const item of input.removed) apply(activityLocalDateForItem(item, input.timezone), -1);
  return deltas;
}

/**
 * Counter arithmetic, with every abnormal case named instead of clamped.
 *
 * An earlier version of this used `Math.max(0, …)`, which is wrong: it makes a
 * duplicated decrement, a vanished aggregate and a corrupted stored value all
 * look exactly like the one case that IS legitimate — the last evidence of a
 * day being deleted. Silently absorbing the other three would either invent
 * credit (a later increment rebuilding from a wrong base) or erase it
 * (overwriting a day that still has surviving items), and neither is
 * acceptable for a counter the streak trusts.
 *
 * The only genuine ambiguity is a decrement with nothing to decrement, and it
 * is resolved by the coverage floor rather than by guessing:
 *
 *  - BELOW the floor the aggregate never tracked that day, so an item created
 *    before the counter existed has no credit to remove. Skipping is provably
 *    correct, not a repair.
 *  - AT or ABOVE the floor every surviving item was counted on creation, so
 *    "nothing to decrement" can only be a real defect. The mutation stops with
 *    a controlled `DIARY_INCONSISTENT`, matching the no-silent-repair policy
 *    the surrounding transaction already applies to diary aggregates.
 */
export type ActivityDayWriteOutcome =
  /** Persist `activeItemCount`. */
  | { status: 'WRITE'; activeItemCount: number }
  /** Provably nothing to do — the day predates the counter. */
  | { status: 'SKIP'; reason: 'BELOW_EVIDENCE_FLOOR' }
  /** Real data defect; the caller must abort rather than guess. */
  | {
      status: 'INCONSISTENT';
      reason: 'CORRUPT_STORED_COUNT' | 'DECREMENT_BELOW_ZERO' | 'MISSING_AGGREGATE';
    };

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function resolveActivityDayWrite(input: {
  /** Whether the aggregate document for this activity day exists. */
  exists: boolean;
  /** Its stored `activeItemCount`, whatever it actually holds. */
  storedCount: unknown;
  /** Signed change for this day; never zero (callers drop cancelled days). */
  delta: number;
  /** The activity day being changed. */
  localDate: string;
  /** `streakSettings.nutritionEvidenceFrom`; `null` means the counter never ran. */
  evidenceFrom: string | null;
}): ActivityDayWriteOutcome {
  const belowFloor = input.evidenceFrom === null || input.localDate < input.evidenceFrom;

  if (!input.exists) {
    // A creation legitimately opens the day's counter at exactly its own size.
    if (input.delta > 0) return { status: 'WRITE', activeItemCount: input.delta };
    return belowFloor
      ? { status: 'SKIP', reason: 'BELOW_EVIDENCE_FLOOR' }
      : { status: 'INCONSISTENT', reason: 'MISSING_AGGREGATE' };
  }

  // Never rebuild from a value we cannot trust: writing `delta` over a corrupt
  // count would erase every other surviving item's credit for that day.
  if (!isNonNegativeInteger(input.storedCount)) {
    return { status: 'INCONSISTENT', reason: 'CORRUPT_STORED_COUNT' };
  }

  const next = input.storedCount + input.delta;
  if (next < 0) {
    return belowFloor
      ? { status: 'SKIP', reason: 'BELOW_EVIDENCE_FLOOR' }
      : { status: 'INCONSISTENT', reason: 'DECREMENT_BELOW_ZERO' };
  }
  // `next === 0` is the legitimate zero: the day's last surviving evidence was
  // just deleted. It is persisted, not skipped, so the revocation is durable.
  return { status: 'WRITE', activeItemCount: next };
}

/** A day is backed by nutrition only while at least one confirmed item survives. */
export function nutritionDayIsActive(document: { activeItemCount?: unknown } | null | undefined): boolean {
  return !!document && Number.isInteger(document.activeItemCount) && (document.activeItemCount as number) > 0;
}
