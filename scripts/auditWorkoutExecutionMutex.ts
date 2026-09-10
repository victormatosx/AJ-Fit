#!/usr/bin/env -S node --import tsx
/**
 * READ-ONLY audit (P0 integrity fix, 2026-09 — docs/workout-lifecycle/):
 * finds every user with an inconsistent WorkoutExecution mutex state —
 * either predating `workoutExecutionState/current` (legacy data) or
 * otherwise diverging from the invariant
 * `count(IN_PROGRESS executions) <= 1`, and that the one that exists (if
 * any) is exactly what `current` points to.
 *
 * NEVER writes anything. This is strictly for locating affected accounts
 * before any decision is made about fixing them — see
 * `scripts/regularizeOrphanWorkoutExecution.ts` for the (also-gated,
 * one-shot, per-uid) mutation script that a human operator runs AFTER
 * reviewing this report.
 *
 * Usage:
 *   npx tsx scripts/auditWorkoutExecutionMutex.ts --project <firebase-project-id> [--out <path>]
 *
 * Requires a collection-group index on `workoutExecutions.status` (single
 * field, collection-group scope) — Firestore does not enable collection-group
 * queries by default even for a single equality filter. If the query below
 * fails with a "requires an index" error, create it (Firebase Console will
 * link directly to the exact index to create) before re-running.
 */
import { writeFileSync } from 'node:fs';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface ExecutionRecord {
  uid: string;
  executionId: string;
  programId: string | null;
  programInstanceId: string | null;
  sessionIndex: number | null;
  scheduledLocalDate: string | null;
  startedAtMs: number | null;
  ageDays: number | null;
  /** P0-C protocol marker (docs/workout-lifecycle/ hardening plan) — absent means a pre-P0-C client produced this write. */
  mutexProtocolVersion: number | null;
}

interface UserFinding {
  uid: string;
  kind: 'NO_CURRENT_POINTER' | 'MULTIPLE_IN_PROGRESS' | 'DANGLING_POINTER' | 'POINTER_MISMATCH';
  inProgressExecutions: ExecutionRecord[];
  currentPointer: { executionId: string; sessionIndex: number; scheduledLocalDate: string } | null;
}

async function main(): Promise<void> {
  const projectId = valueAfter('--project');
  const outPath = valueAfter('--out');
  if (!projectId) throw new Error('Usage: --project <firebase-project-id> [--out <path>]');

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const inProgressSnapshot = await db
    .collectionGroup('workoutExecutions')
    .where('status', '==', 'IN_PROGRESS')
    .get();

  const now = Date.now();
  const byUid = new Map<string, ExecutionRecord[]>();
  for (const document of inProgressSnapshot.docs) {
    // Path shape: users/{uid}/workoutExecutions/{executionId}
    const uid = document.ref.parent.parent?.id;
    if (!uid) continue;
    const data = document.data();
    const startedAt = data.startedAt instanceof Timestamp ? data.startedAt.toMillis() : null;
    const record: ExecutionRecord = {
      uid,
      executionId: document.id,
      programId: typeof data.programId === 'string' ? data.programId : null,
      programInstanceId: typeof data.programInstanceId === 'string' ? data.programInstanceId : null,
      sessionIndex: typeof data.sessionIndex === 'number' ? data.sessionIndex : null,
      scheduledLocalDate: typeof data.scheduledLocalDate === 'string' ? data.scheduledLocalDate : null,
      startedAtMs: startedAt,
      ageDays: startedAt ? Math.floor((now - startedAt) / 86_400_000) : null,
      mutexProtocolVersion: typeof data.mutexProtocolVersion === 'number' ? data.mutexProtocolVersion : null,
    };
    const existing = byUid.get(uid) ?? [];
    existing.push(record);
    byUid.set(uid, existing);
  }

  const findings: UserFinding[] = [];
  let usersWithHealthyState = 0;

  for (const [uid, executions] of byUid) {
    const currentSnapshot = await db.collection('users').doc(uid).collection('workoutExecutionState').doc('current').get();
    const currentData = currentSnapshot.exists ? currentSnapshot.data() : null;
    const currentPointer = currentData
      ? {
        executionId: String(currentData.executionId ?? ''),
        sessionIndex: Number(currentData.sessionIndex ?? -1),
        scheduledLocalDate: String(currentData.scheduledLocalDate ?? ''),
      }
      : null;

    if (executions.length > 1) {
      findings.push({ uid, kind: 'MULTIPLE_IN_PROGRESS', inProgressExecutions: executions, currentPointer });
      continue;
    }

    const [only] = executions;
    if (!currentPointer) {
      findings.push({ uid, kind: 'NO_CURRENT_POINTER', inProgressExecutions: executions, currentPointer });
      continue;
    }
    if (currentPointer.executionId !== only.executionId) {
      findings.push({ uid, kind: 'POINTER_MISMATCH', inProgressExecutions: executions, currentPointer });
      continue;
    }
    usersWithHealthyState += 1;
  }

  // Dangling pointers: `current` exists but points at an execution that is
  // no longer IN_PROGRESS (or doesn't exist) — a separate scan since these
  // users have ZERO IN_PROGRESS executions, so they were never visited above.
  const allCurrentSnapshot = await db.collectionGroup('workoutExecutionState').get();
  for (const document of allCurrentSnapshot.docs) {
    if (document.id !== 'current') continue;
    const uid = document.ref.parent.parent?.id;
    if (!uid || byUid.has(uid)) continue; // already covered above
    const data = document.data();
    const executionId = String(data.executionId ?? '');
    const executionSnapshot = executionId
      ? await db.collection('users').doc(uid).collection('workoutExecutions').doc(executionId).get()
      : null;
    const executionStatus = executionSnapshot?.exists ? executionSnapshot.data()?.status : null;
    if (executionStatus !== 'IN_PROGRESS') {
      findings.push({
        uid,
        kind: 'DANGLING_POINTER',
        inProgressExecutions: [],
        currentPointer: {
          executionId,
          sessionIndex: Number(data.sessionIndex ?? -1),
          scheduledLocalDate: String(data.scheduledLocalDate ?? ''),
        },
      });
    }
  }

  // Observability signal for the P0-C hardening rollout (docs/workout-lifecycle/
  // hardening plan §10/§12) — how much of CURRENT IN_PROGRESS traffic is
  // still coming from a pre-P0-C client (no mutexProtocolVersion at all).
  // This is the READ side of the phase-transition criterion; it does not by
  // itself decide when hardening is safe to enable — see the rollout report.
  const allInProgress = [...byUid.values()].flat();
  const protocolBreakdown = {
    total: allInProgress.length,
    withMutexProtocolVersion: allInProgress.filter((item) => item.mutexProtocolVersion === 1).length,
    withoutMutexProtocolVersion: allInProgress.filter((item) => item.mutexProtocolVersion !== 1).length,
  };

  const summary = {
    projectId,
    generatedAt: new Date().toISOString(),
    totalUsersWithInProgressExecution: byUid.size,
    usersWithHealthyMutexState: usersWithHealthyState,
    inconsistentUserCount: findings.length,
    protocolBreakdown,
    byKind: {
      NO_CURRENT_POINTER: findings.filter((item) => item.kind === 'NO_CURRENT_POINTER').length,
      MULTIPLE_IN_PROGRESS: findings.filter((item) => item.kind === 'MULTIPLE_IN_PROGRESS').length,
      DANGLING_POINTER: findings.filter((item) => item.kind === 'DANGLING_POINTER').length,
      POINTER_MISMATCH: findings.filter((item) => item.kind === 'POINTER_MISMATCH').length,
    },
    findings,
  };

  const output = JSON.stringify(summary, null, 2);
  if (outPath) {
    writeFileSync(outPath, output);
    console.log(`Wrote report to ${outPath}`);
    console.log(JSON.stringify({ ...summary, findings: `(${findings.length} entries — see file)` }, null, 2));
  } else {
    console.log(output);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
