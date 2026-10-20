/**
 * Per-uid record of which missed-session notices were already answered.
 *
 * Deliberately local-only (`AsyncStorage`, scoped per uid), mirroring
 * `streakCelebrationStorage.ts`: this is a presentation fact ("did we already
 * ask about this missed day?"), not domain state. The decision's real effect
 * is already durable server-side — `FOLLOW_SCHEDULE` moves the rotation
 * through `selectSession`, and `CONTINUE_SEQUENCE` moves nothing by design —
 * so what is stored here is only "stop asking", never the rotation itself.
 *
 * That choice introduces NO Firestore field, no Rules change and no Cloud
 * Function. It matters concretely: the pilot's Rules and `finalizeWorkoutSession`
 * are already published, and the pilot gate on `scheduleState` selection
 * requires `pendingMissDecision == null`, so persisting the answer in that
 * field would need a Rules change and a redeploy to work at all.
 *
 * Trade-off that choice accepts: signing in on a second device can show the
 * same notice once more there. It is one dismissible question about a day
 * that already passed — nothing about the workout record, the rotation, the
 * daily limit, the weekly frequency or Chama 2.0 is affected either way.
 *
 * Entries are pruned to the most recent `MAX_REMEMBERED` ids: the key space
 * grows one id per missed occurrence forever, and only recent ones can still
 * be detected (detection looks at days after `lastPerformedLocalDate`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { errorClass, errorCode, logWarn } from '../lib/logger';

const MAX_REMEMBERED = 40;

function decidedKey(uid: string): string {
  return `ajfit.schedule.missed-notice-decided.v1:${uid}`;
}

/**
 * Never throws: an unreadable store simply means "nothing answered yet".
 *
 * That degradation is deliberate but NOT free — it is indistinguishable, in
 * this function's own output, from a device that has genuinely answered
 * nothing, and the visible consequence is a missed day the user already
 * dismissed being raised one more time. So the failure is logged rather than
 * swallowed silently: without this line the only evidence left is a notice
 * reappearing with no trace of why, which is not diagnosable after the fact.
 * The uid is never logged — the key is derived from it.
 */
export async function loadDecidedMissedNoticeIds(uid: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(decidedKey(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch (error) {
    logWarn('workout_schedule', 'missed_notice_decided_read_failed', {
      errorCode: errorCode(error),
      errorClass: errorClass(error),
    });
    return [];
  }
}

/**
 * Records one notice as answered. Returns the resulting list so the caller can
 * update its own state without a second read.
 *
 * A write failure is swallowed on purpose: the worst outcome is the notice
 * appearing once more, which is strictly better than failing the decision the
 * user just made.
 */
export async function rememberDecidedMissedNoticeId(uid: string, noticeId: string): Promise<string[]> {
  const current = await loadDecidedMissedNoticeIds(uid);
  if (current.includes(noticeId)) return current;
  const next = [...current, noticeId].slice(-MAX_REMEMBERED);
  try {
    await AsyncStorage.setItem(decidedKey(uid), JSON.stringify(next));
  } catch (error) {
    // The decision itself still stands — only "stop asking" was lost. Logged
    // for the same reason as the read above: this is the other way the same
    // missed day can be raised twice.
    logWarn('workout_schedule', 'missed_notice_decided_write_failed', {
      errorCode: errorCode(error),
      errorClass: errorClass(error),
    });
  }
  return next;
}
