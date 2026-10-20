import { Timestamp, collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

import { db } from '../lib/firebase';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import type { LocalDate } from '../scheduleEngine/calendar';
import {
  NUTRITION_ACTIVITY_SCHEMA_VERSION,
  STREAK_NUTRITION_DAYS_COLLECTION,
  STREAK_SETTINGS_COLLECTION,
  STREAK_SETTINGS_DOC_ID,
  canonicalStreakTimezone,
  isStreakLocalDate,
  nutritionDayIsActive,
} from '../nutrition/diary/activity';

/**
 * Nutrition evidence for the daily activity streak.
 *
 * ## Why an aggregate and not the diary documents
 *
 * Two product rules make the diary itself the wrong source:
 *
 *  - A food logged today into YESTERDAY's diary earns TODAY. The diary date
 *    lives in the document path and is chosen freely by the client, so it is
 *    never temporal authority.
 *  - Deleting the last surviving food of a day REVOKES that day. An immutable
 *    operation receipt cannot express that, because it outlives the item it
 *    recorded.
 *
 * `mutateNutritionDiaryV1` therefore maintains
 * `users/{uid}/streakNutritionDays/{activityLocalDate}.activeItemCount` in the
 * same transaction as the item: `+1` per created item on the day the server
 * confirmed it, `-1` on the day a deleted item originally earned, and nothing
 * at all for an edit or a move. A day is backed by nutrition exactly while
 * that count is `> 0` — which is why three foods minus two still counts, and
 * one food minus one does not.
 *
 * Reading it costs ONE range query returning at most one document per day
 * that actually has surviving nutrition activity, instead of walking six
 * meals of every day in the window.
 *
 * ## Coverage floor (never invent, never revoke retroactively)
 *
 * The counter only exists from the first mutation the callable handled for
 * this account (`streakSettings.nutritionEvidenceFrom`). For activity days
 * BEFORE that floor — and for accounts that never enrolled in the
 * transactional protocol at all — a missing aggregate document is not
 * evidence of an empty day, so this module falls back to the legacy
 * day-document heuristic below instead of fabricating either outcome.
 */

/** Shape read from `streakSettings/current`. */
export interface StreakSettings {
  /** Canonical, immutable once written. */
  timezone: string;
  /** Earliest activity day the aggregate is authoritative for; `null` when it never ran. */
  nutritionEvidenceFrom: LocalDate | null;
  /**
   * Monotonic count of aggregate DECREMENTS. Deletions are the only operation
   * that can retroactively break a past day, so a cached streak stays valid
   * exactly while this is unchanged — a cross-device-correct invalidation
   * token, never a local time-to-live.
   */
  nutritionRevocations: number;
}

function settingsRef(uid: string) {
  return doc(db, 'users', uid, STREAK_SETTINGS_COLLECTION, STREAK_SETTINGS_DOC_ID);
}

export async function loadStreakSettings(uid: string): Promise<StreakSettings | null> {
  const snapshot = await getDoc(settingsRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const timezone = canonicalStreakTimezone(data.timezone);
  if (!timezone) return null;
  return {
    timezone,
    nutritionEvidenceFrom: isStreakLocalDate(data.nutritionEvidenceFrom) ? data.nutritionEvidenceFrom : null,
    nutritionRevocations: Number.isInteger(data.nutritionRevocations) ? data.nutritionRevocations as number : 0,
  };
}

/**
 * Resolves the canonical streak timezone, pinning it on first use.
 *
 * `fallbackTimezone` is what the caller already resolved (the schedule's
 * persisted zone, with a device fallback) and is used ONLY to create the
 * document. Rules make this create-only, so two devices initializing at the
 * same moment converge: the loser's write is rejected and it re-reads the
 * winner's value. Afterwards the zone never changes again — not when the
 * training schedule is edited, not when the user travels.
 */
export async function ensureStreakTimezone(uid: string, fallbackTimezone: string): Promise<StreakSettings> {
  const existing = await loadStreakSettings(uid);
  if (existing) return existing;
  const timezone = canonicalStreakTimezone(fallbackTimezone) ?? 'UTC';
  try {
    await setDoc(settingsRef(uid), {
      timezone,
      schemaVersion: NUTRITION_ACTIVITY_SCHEMA_VERSION,
      createdAt: Timestamp.now(),
    });
  } catch {
    // Lost the create race (or offline). Re-read: the winner's zone is the
    // canonical one, and a transient failure must never pin a different zone.
    const reread = await loadStreakSettings(uid);
    if (reread) return reread;
  }
  return { timezone, nutritionEvidenceFrom: null, nutritionRevocations: 0 };
}

/**
 * Activity days proven by the aggregate, within `[fromLocalDate, today]`.
 *
 * One query. `activeItemCount` is filtered client-side so the query stays a
 * single inequality on one field and needs no composite index.
 */
async function listAggregateActivityDays(
  uid: string, fromLocalDate: LocalDate,
): Promise<Set<LocalDate>> {
  const snapshot = await getDocs(query(
    collection(db, 'users', uid, STREAK_NUTRITION_DAYS_COLLECTION),
    where('localDate', '>=', fromLocalDate),
  ));
  const days = new Set<LocalDate>();
  for (const document of snapshot.docs) {
    const data = document.data();
    if (!nutritionDayIsActive(data)) continue;
    if (isStreakLocalDate(data.localDate)) days.add(data.localDate);
  }
  return days;
}

/**
 * Legacy heuristic, used only below the aggregate's coverage floor.
 *
 * `users/{uid}/nutritionDailyLogs/{localDate}` is keyed by the DIARY date,
 * so the day document's immutable, server-set `createdAt` is read instead —
 * "when did the user first log anything for that diary date". Rules pin it to
 * `request.time` on create and forbid changing it on update.
 *
 * Known, bounded limitation (it UNDER-counts, never over-counts, so it can
 * never violate the no-retroactive-restore rule): appending to a diary date
 * whose document already existed is not provable this way, and a deletion is
 * only reflected once `loggedItemCount` reaches 0 for the whole diary date.
 * This is precisely the gap the aggregate closes going forward.
 */
async function listLegacyActivityDays(
  uid: string, fromInstant: Date, timezone: string,
): Promise<Set<LocalDate>> {
  const snapshot = await getDocs(query(
    collection(db, 'users', uid, 'nutritionDailyLogs'),
    where('createdAt', '>=', Timestamp.fromDate(fromInstant)),
  ));
  const days = new Set<LocalDate>();
  for (const document of snapshot.docs) {
    const data = document.data() as { createdAt?: Timestamp; loggedItemCount?: number };
    // No surviving evidence -> the diary date no longer counts.
    if (!data.loggedItemCount || data.loggedItemCount <= 0) continue;
    // A write whose server timestamp has not resolved yet proves nothing.
    if (!data.createdAt) continue;
    days.add(localDateInTimezone(data.createdAt.toDate(), timezone));
  }
  return days;
}

export interface NutritionActivityDaysInput {
  uid: string;
  /** Inclusive lower bound, as an ACTIVITY local date. */
  fromLocalDate: LocalDate;
  /** Canonical timezone (`StreakSettings.timezone`). */
  timezone: string;
  /** `StreakSettings.nutritionEvidenceFrom`; `null` disables the aggregate entirely. */
  evidenceFrom: LocalDate | null;
}

/**
 * Union of both sources, each applied only where it is authoritative.
 *
 * Above the floor the aggregate answers exactly (including revocation by
 * deletion). Below it — or for an account the callable never handled — the
 * legacy heuristic fills in, and the caller is told nothing more than it can
 * prove. The two never both decide the same day, so a day can never be
 * double-counted (and `Set` would collapse it anyway).
 */
export async function listNutritionActivityDays(
  input: NutritionActivityDaysInput,
): Promise<Set<LocalDate>> {
  const aggregateCovers = input.evidenceFrom !== null;
  const aggregateFrom = aggregateCovers && input.evidenceFrom! > input.fromLocalDate
    ? input.evidenceFrom!
    : input.fromLocalDate;
  const needsLegacy = !aggregateCovers || input.evidenceFrom! > input.fromLocalDate;

  // The legacy side filters on the registration INSTANT, so the window start
  // is turned back into a Date. One extra day of slack absorbs the offset
  // between the local-date boundary and UTC.
  const legacyFrom = new Date(`${input.fromLocalDate}T00:00:00Z`);
  legacyFrom.setUTCDate(legacyFrom.getUTCDate() - 1);

  const [aggregate, legacy] = await Promise.all([
    aggregateCovers ? listAggregateActivityDays(input.uid, aggregateFrom) : Promise.resolve(new Set<LocalDate>()),
    needsLegacy ? listLegacyActivityDays(input.uid, legacyFrom, input.timezone) : Promise.resolve(new Set<LocalDate>()),
  ]);

  const days = new Set<LocalDate>(aggregate);
  for (const day of legacy) {
    // Never let the legacy heuristic re-add a day the aggregate deliberately
    // revoked: above the floor, the aggregate is the only authority.
    if (aggregateCovers && day >= input.evidenceFrom!) continue;
    days.add(day);
  }
  return days;
}
