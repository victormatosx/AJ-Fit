#!/usr/bin/env -S node --import tsx
/**
 * Admin-SDK-only toggle for the P0-C mutex hardening gate (docs/workout-lifecycle/
 * hardening plan, 2026-09) — `workoutExecutionProtocolConfig/active.requireMutexOnCreate`,
 * read by Firestore Rules' `workoutExecutionMutexHardeningEnabled()`
 * (firestore.rules). Same shape/safety pattern as `workoutLifecycleRollout.cjs`:
 * read-only by default, dry-run unless `--apply` is passed, never destructive.
 *
 * Turning this ON makes every NEW `IN_PROGRESS` `workoutExecutions` create
 * require a paired, matching `workoutExecutionState/current` write in the
 * same transaction/batch — see the P0-C rollout report for the exact
 * adoption/observability criteria that must hold before this is safe to
 * flip in production. This script does NOT check those criteria itself; a
 * human operator does, using `scripts/auditWorkoutExecutionMutex.ts`'s
 * `mutexProtocolVersion` breakdown (once added there) plus product
 * telemetry, THEN runs this with `--apply`.
 *
 * Usage (read current state):
 *   npx tsx scripts/toggleWorkoutExecutionMutexHardening.ts --project <id> --read
 *
 * Usage (dry run — always safe, the default):
 *   npx tsx scripts/toggleWorkoutExecutionMutexHardening.ts --project <id> --on
 *   npx tsx scripts/toggleWorkoutExecutionMutexHardening.ts --project <id> --off
 *
 * Usage (apply — only after explicit human authorization):
 *   npx tsx scripts/toggleWorkoutExecutionMutexHardening.ts --project <id> --on --apply
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const projectId = valueAfter('--project');
  const readOnly = process.argv.includes('--read');
  const turnOn = process.argv.includes('--on');
  const turnOff = process.argv.includes('--off');
  const apply = process.argv.includes('--apply');

  if (!projectId || (!readOnly && !turnOn && !turnOff)) {
    throw new Error('Usage: --project <id> (--read | --on | --off) [--apply]');
  }
  if (turnOn && turnOff) throw new Error('Pass only one of --on / --off.');

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const ref = getFirestore().doc('workoutExecutionProtocolConfig/active');

  if (readOnly) {
    const snapshot = await ref.get();
    console.log(JSON.stringify({ projectId, exists: snapshot.exists, config: snapshot.data() ?? null }, null, 2));
    return;
  }

  const config = { schemaVersion: 1, requireMutexOnCreate: turnOn, enabledAt: turnOn ? new Date().toISOString() : null };
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, projectId, path: ref.path, config }, null, 2));
    return;
  }
  await ref.set(config);
  console.log(JSON.stringify({ applied: true, projectId, path: ref.path, config }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
