import { doc, getDoc } from 'firebase/firestore';

import { db } from '../lib/firebase';
import { logWarn } from '../lib/logger';
import {
  WORKOUT_PILOT_ENROLLMENT_COLLECTION,
  isWorkoutPilotEnrolled,
} from '../scheduleEngine/workoutPilot';

/**
 * Reads this account's pilot enrolment.
 *
 * The client's answer decides only which EXPERIENCE to render. It grants
 * nothing: the Rules and `finalizeWorkoutSession` each re-read the same
 * document server-side, so a client that lied (or a stale cached `true`) still
 * cannot write a suggestion or claim a day. What a correct answer here buys is
 * coherence — a non-enrolled account must never be shown an affordance the
 * backend would then refuse.
 *
 * Fail-safe direction: any error, absent document, or offline read resolves to
 * `false` (legacy). The read is cheap and happens once per schedule reload,
 * alongside reads the hook already performs.
 */
export async function loadWorkoutPilotEnrollment(uid: string): Promise<boolean> {
  try {
    const snapshot = await getDoc(doc(db, WORKOUT_PILOT_ENROLLMENT_COLLECTION, uid));
    return isWorkoutPilotEnrolled(snapshot.exists() ? snapshot.data() : null);
  } catch (error) {
    // Deliberately logs no identifier: the event is "this device could not read
    // its own flag", and the uid adds nothing but exposure.
    logWarn('workout_schedule', 'pilot_enrollment_unreadable', {
      errorCode: (error as { code?: string } | null)?.code ?? 'unknown',
    });
    return false;
  }
}
