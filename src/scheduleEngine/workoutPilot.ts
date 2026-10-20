/**
 * Controlled pilot enrolment for the new training architecture.
 *
 * The new model (free session selection, training on any day, one credited
 * workout per day) is a product change for the whole account base. During the
 * pilot it must reach exactly ONE account, so every surface that can grant it
 * is gated on the same single fact:
 *
 *     workoutPilotEnrollment/{uid}   { enabled: true, enrolledAt }
 *
 * ## Why one document per UID, and not a list
 *
 * A single config document holding an array of UIDs would have to be readable
 * by every signed-in client (that is how `workoutExecutionProtocolConfig`
 * works), which would publish the pilot's membership to the entire base. One
 * document per UID, readable only by its owner, tells each client whether IT
 * is enrolled and nothing about anyone else.
 *
 * ## Why Firestore and not an environment variable
 *
 * It is the only shape all three enforcement surfaces can read:
 *
 *  - Firestore Rules (`exists(...)`) — gates the one new client capability;
 *  - `finalizeWorkoutSession` — gates the new completion behaviour;
 *  - the app — decides which experience to render, from a fact it cannot forge.
 *
 * An env var would cover only the Function, leaving the Rules and the client
 * needing a second, separately-maintained source. It also makes activation and
 * rollback a one-document write instead of a redeploy.
 *
 * ## Fail-safe direction
 *
 * ABSENT OR UNREADABLE ALWAYS MEANS LEGACY. Every reader below treats any
 * error as "not enrolled", so a Rules change, an outage or a typo can only
 * ever leave an account on the behaviour it already had — never grant it the
 * new one. Write access is denied to clients outright: enrolment is an
 * Admin-SDK-only act.
 */

export const WORKOUT_PILOT_ENROLLMENT_COLLECTION = 'workoutPilotEnrollment';

/** Shape of the enrolment document. `enabled !== true` is NOT enrolled. */
export interface WorkoutPilotEnrollment {
  enabled: boolean;
}

/**
 * Pure predicate over an already-fetched document, shared by the client and
 * the callable so neither can read the flag differently. `null` (absent),
 * a missing `enabled`, or anything other than boolean `true` is not enrolled.
 */
export function isWorkoutPilotEnrolled(document: { enabled?: unknown } | null | undefined): boolean {
  return document?.enabled === true;
}
