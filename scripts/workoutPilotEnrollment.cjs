#!/usr/bin/env node

/**
 * Controlled pilot enrolment for the new training architecture.
 *
 * Writes (or clears) `workoutPilotEnrollment/{uid}`, the single server-side
 * fact that all three enforcement surfaces read: the Firestore Rules, the
 * `finalizeWorkoutSession` callable, and the app. See
 * `src/scheduleEngine/workoutPilot.ts` for why it is one document per UID
 * rather than a list.
 *
 * Follows `workoutLifecycleRollout.cjs`: dry-run by default, `--apply` to
 * actually write. Enrolment is Admin-SDK-only — clients are denied write
 * access to this collection by the Rules.
 *
 *   node scripts/workoutPilotEnrollment.cjs --project <id> --uid <uid> --read
 *   node scripts/workoutPilotEnrollment.cjs --project <id> --uid <uid> --on  [--apply]
 *   node scripts/workoutPilotEnrollment.cjs --project <id> --uid <uid> --off [--apply]
 *
 * `--off` sets `enabled: false` rather than deleting, so the rollback is a
 * single-field flip that leaves an audit trail (`disabledAt`). Deleting the
 * document is equally safe — absent means legacy — but loses that trail.
 */

const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const projectId = valueAfter('--project');
  const uid = valueAfter('--uid');
  const readOnly = process.argv.includes('--read');
  const turnOn = process.argv.includes('--on');
  const turnOff = process.argv.includes('--off');
  const apply = process.argv.includes('--apply');

  if (!projectId || !uid || (!readOnly && !turnOn && !turnOff)) {
    throw new Error('Usage: --project <id> --uid <uid> (--read | --on | --off) [--apply]');
  }
  if (turnOn && turnOff) throw new Error('Pass either --on or --off, not both.');

  initializeApp({ credential: applicationDefault(), projectId });
  const ref = getFirestore().collection('workoutPilotEnrollment').doc(uid);

  if (readOnly) {
    const snapshot = await ref.get();
    // The uid is already an explicit argument here, so echoing it back adds
    // no exposure. The Function and the client never log it.
    console.log(JSON.stringify({
      projectId, uid, exists: snapshot.exists, document: snapshot.data() ?? null,
    }, null, 2));
    return;
  }

  const document = turnOn
    ? { enabled: true, enrolledAt: FieldValue.serverTimestamp() }
    : { enabled: false, disabledAt: FieldValue.serverTimestamp() };

  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true, projectId, uid, path: ref.path, document: { ...document, enabled: turnOn },
    }, null, 2));
    return;
  }
  // `merge` so re-enrolling keeps the original `enrolledAt`.
  await ref.set(document, { merge: true });
  console.log(JSON.stringify({ applied: true, projectId, uid, path: ref.path, enabled: turnOn }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
