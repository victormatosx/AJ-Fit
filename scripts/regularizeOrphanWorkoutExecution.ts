#!/usr/bin/env -S node --import tsx
/**
 * ONE-SHOT, idempotent, condition-gated regularization of a single orphan
 * WorkoutExecution (P0 integrity fix, 2026-09 — docs/workout-lifecycle/).
 *
 * Terminalizes exactly one `IN_PROGRESS` execution as `ABANDONED`
 * (status/finishedAt/updatedAt only — no other field is touched) IF AND
 * ONLY IF every precondition below still holds at run time. Never runs
 * automatically; never chooses a target on its own. Defaults to a DRY RUN
 * (prints the intended change, writes nothing) — pass `--apply` to commit.
 *
 * Preconditions checked (all must hold, or the script refuses and writes
 * nothing):
 *   1. The orphan execution exists and is still `IN_PROGRESS` (no
 *      `finishedAt`).
 *   2. The superseding execution exists, is `COMPLETED` or
 *      `PARTIALLY_COMPLETED`, is for the SAME `programInstanceId` and
 *      `sessionIndex`, and has a `scheduledLocalDate` strictly after the
 *      orphan's.
 *   3. A `COMPLETED` schedule event exists for the superseding execution's
 *      `sessionIndex`/`scheduledLocalDate` (the schedule already advanced
 *      because of it — this script never advances the schedule itself).
 *   4. `workoutExecutionState/current` does NOT currently point at the
 *      orphan execution — i.e., this really is a stale, already-superseded
 *      record, not a session someone is (or believes they are) actively in.
 *
 * Usage (dry run — always safe, the default):
 *   npx tsx scripts/regularizeOrphanWorkoutExecution.ts \
 *     --project <firebase-project-id> --uid <uid> \
 *     --orphanExecutionId <execId> --supersedingExecutionId <execId>
 *
 * Usage (apply — only after a human has reviewed the dry-run output and
 * explicitly authorized it):
 *   ...same as above, plus --apply
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const projectId = valueAfter('--project');
  const uid = valueAfter('--uid');
  const orphanExecutionId = valueAfter('--orphanExecutionId');
  const supersedingExecutionId = valueAfter('--supersedingExecutionId');
  const apply = process.argv.includes('--apply');

  if (!projectId || !uid || !orphanExecutionId || !supersedingExecutionId) {
    throw new Error('Usage: --project <id> --uid <uid> --orphanExecutionId <execId> --supersedingExecutionId <execId> [--apply]');
  }

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const root = db.collection('users').doc(uid);

  const [orphanSnapshot, supersedingSnapshot, currentSnapshot] = await Promise.all([
    root.collection('workoutExecutions').doc(orphanExecutionId).get(),
    root.collection('workoutExecutions').doc(supersedingExecutionId).get(),
    root.collection('workoutExecutionState').doc('current').get(),
  ]);

  const problems: string[] = [];

  if (!orphanSnapshot.exists) problems.push(`orphan execution ${orphanExecutionId} does not exist`);
  const orphan = orphanSnapshot.data();
  if (orphan && orphan.status === 'ABANDONED') {
    console.log(JSON.stringify({ alreadyRegularized: true, uid, orphanExecutionId, status: orphan.status }, null, 2));
    return; // idempotent: nothing to do, not an error.
  }
  if (orphan && orphan.status !== 'IN_PROGRESS') problems.push(`orphan execution status is '${orphan.status}', expected 'IN_PROGRESS'`);
  if (orphan && orphan.finishedAt != null) problems.push('orphan execution already has finishedAt set');

  if (!supersedingSnapshot.exists) problems.push(`superseding execution ${supersedingExecutionId} does not exist`);
  const superseding = supersedingSnapshot.data();
  if (superseding && !['COMPLETED', 'PARTIALLY_COMPLETED'].includes(superseding.status)) {
    problems.push(`superseding execution status is '${superseding.status}', expected COMPLETED or PARTIALLY_COMPLETED`);
  }
  if (orphan && superseding) {
    if (orphan.programInstanceId !== superseding.programInstanceId) {
      problems.push('orphan and superseding executions are not the same programInstanceId');
    }
    if (orphan.sessionIndex !== superseding.sessionIndex) {
      problems.push('orphan and superseding executions are not the same sessionIndex');
    }
    if (!(typeof orphan.scheduledLocalDate === 'string' && typeof superseding.scheduledLocalDate === 'string'
      && superseding.scheduledLocalDate > orphan.scheduledLocalDate)) {
      problems.push('superseding execution scheduledLocalDate is not strictly after the orphan\'s');
    }
  }

  if (orphan && superseding && typeof orphan.programInstanceId === 'string') {
    const contentIdentity = superseding.programId;
    // Mirrors `scheduleEventId()` in src/services/workoutSchedule.ts: V2
    // (programInstanceId present) events are prefixed with the instance id;
    // only legacy V1 events use the bare `completed_{sessionIndex}_{date}` form.
    const scheduleEventId = `${superseding.programInstanceId}_completed_${superseding.sessionIndex}_${superseding.scheduledLocalDate}`;
    const eventSnapshot = typeof contentIdentity === 'string'
      ? await root.collection('workoutPrograms').doc(contentIdentity).collection('scheduleEvents').doc(scheduleEventId).get()
      : null;
    if (!eventSnapshot?.exists) {
      problems.push(`no COMPLETED schedule event found at workoutPrograms/${contentIdentity}/scheduleEvents/${scheduleEventId}`);
    }
  }

  if (currentSnapshot.exists && currentSnapshot.data()?.executionId === orphanExecutionId) {
    problems.push('workoutExecutionState/current currently points at the orphan execution — it is not actually orphaned, refusing to touch it');
  }

  if (problems.length > 0) {
    console.error(JSON.stringify({ refused: true, uid, orphanExecutionId, supersedingExecutionId, problems }, null, 2));
    process.exit(1);
  }

  const patch = {
    status: 'ABANDONED' as const,
    finishedAt: apply ? FieldValue.serverTimestamp() : '<serverTimestamp>',
    updatedAt: apply ? FieldValue.serverTimestamp() : '<serverTimestamp>',
  };

  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true, projectId, uid, orphanExecutionId, supersedingExecutionId,
      preconditionsSatisfied: true,
      path: `users/${uid}/workoutExecutions/${orphanExecutionId}`,
      patch,
    }, null, 2));
    return;
  }

  await root.collection('workoutExecutions').doc(orphanExecutionId).update({
    status: 'ABANDONED',
    finishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(JSON.stringify({
    applied: true, projectId, uid, orphanExecutionId, supersedingExecutionId,
    path: `users/${uid}/workoutExecutions/${orphanExecutionId}`,
    appliedAt: new Date().toISOString(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
