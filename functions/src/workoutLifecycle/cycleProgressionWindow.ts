import { Timestamp, type DocumentData, type DocumentReference, type Query } from 'firebase-admin/firestore';

import type {
  CycleInstanceProgressionWindow,
} from './prescriptionEngine/progressionEngineV2/cycleProgression';

/**
 * THE server-side reader for a TrainingCycle's progression window.
 *
 * Every authoritative surface must see the SAME window, or they disagree
 * about the same account. Before this module existed the EARN authority read
 * the whole cycle while the evolution-approaching observer still read only
 * the active ProgramInstance — so after an ADAPT the observer reported 0%
 * adherence (every execution belonged to the superseded instance) for a user
 * the authority was simultaneously promoting. One reader, one window.
 *
 * Deliberately generic over HOW documents are read: the authority reads
 * directly, the notification observer reads inside a Firestore transaction.
 * Both pass their own getters, and neither reimplements the selection,
 * chunking or de-duplication rules.
 *
 * Nothing here computes a progression figure — that is
 * `computeCycleProgression`'s job, and this module only assembles its inputs
 * from authoritative documents. No request payload influences any of it.
 */

/**
 * Hard ceiling on ProgramInstances per TrainingCycle for one evaluation. A
 * cycle is one Beginner/Intermediate/Advanced window; even a user who
 * re-adapts monthly stays far below this. Exceeding it is reported, never
 * silently truncated — a truncated `limit()` without `orderBy` would select
 * an ARBITRARY subset (Firestore returns `__name__` order), which could drop
 * the cycle's first instance and silently shift `cycleStartLocalDate`.
 */
export const MAXIMUM_CYCLE_PROGRAM_INSTANCES = 40;

/** Firestore's `in` cap — the cycle-wide execution read is chunked to it. */
export const EXECUTION_INSTANCE_IN_CHUNK = 30;

/**
 * Upper bound on history per evaluation, mirroring the notification
 * observer's existing `APPROACHING_HISTORY_LIMIT`. Exceeding it denies the
 * evaluation rather than scoring a partial history.
 */
export const CYCLE_HISTORY_LIMIT = 2048;

export type CycleProgressionWindowOutcome =
  | {
    status: 'OK';
    windows: CycleInstanceProgressionWindow[];
    executions: DocumentData[];
    scheduleEvents: DocumentData[];
  }
  /** More ProgramInstances in this cycle than one evaluation may consider. */
  | { status: 'TOO_LARGE' }
  /** More executions/ledger entries than one evaluation may consider. */
  | { status: 'HISTORY_LIMIT' }
  /** No instance of the cycle could be resolved into a usable window. */
  | { status: 'UNAVAILABLE' };

export interface CycleProgressionWindowReader {
  root: DocumentReference;
  readDoc: (ref: DocumentReference) => Promise<{ data: () => DocumentData | undefined }>;
  readQuery: (query: Query) => Promise<{ docs: { id: string; ref: { path: string }; data: () => DocumentData }[] }>;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}`;
}

/** The sealed sessions in the shape `isValidProgressionSessionAgainstPrescription` expects. */
export function sealedSessions(
  program: DocumentData,
): { exercises: { exerciseId: string; setCount: number }[] }[] | null {
  if (!Array.isArray(program.sessions) || program.sessions.length === 0) return null;
  const sessions: { exercises: { exerciseId: string; setCount: number }[] }[] = [];
  for (const session of program.sessions) {
    if (!plainObject(session) || !Array.isArray(session.exercises) || session.exercises.length === 0) return null;
    const exercises: { exerciseId: string; setCount: number }[] = [];
    for (const exercise of session.exercises) {
      if (!plainObject(exercise) || typeof exercise.exerciseId !== 'string') return null;
      const setCount = Number.isInteger(exercise.sets) ? exercise.sets as number : 1;
      if (setCount < 1) return null;
      exercises.push({ exerciseId: exercise.exerciseId, setCount });
    }
    sessions.push({ exercises });
  }
  return sessions;
}

/**
 * The sealed weekly goal, with the same degradation chain every other reader
 * uses (`src/scheduleEngine/useWorkoutSchedule.ts`): the sealed field, the
 * legacy field, then the session count — so a pre-field legacy program keeps
 * a reconstructable goal instead of losing its ability to earn.
 */
export function sealedWeeklyGoal(program: DocumentData, sessionCount: number): number {
  if (Number.isInteger(program.prescribedTrainingFrequency)) return program.prescribedTrainingFrequency as number;
  if (Number.isInteger(program.prescribedStructuredDays)) return program.prescribedStructuredDays as number;
  return sessionCount;
}

export async function loadCycleProgressionWindow(input: {
  reader: CycleProgressionWindowReader;
  currentCycleId: string;
  activeProgramInstanceId: string;
  activeContentIdentity: string;
  /** Already-read active instance/program, reused instead of re-fetched. */
  activeInstance: DocumentData;
  activeProgram: DocumentData;
  timezone: string;
}): Promise<CycleProgressionWindowOutcome> {
  const { reader } = input;
  const instancesSnapshot = await reader.readQuery(
    reader.root.collection('programInstances')
      .where('cycleId', '==', input.currentCycleId)
      .limit(MAXIMUM_CYCLE_PROGRAM_INSTANCES + 1),
  );
  if (instancesSnapshot.docs.length > MAXIMUM_CYCLE_PROGRAM_INSTANCES) return { status: 'TOO_LARGE' };

  const instances = instancesSnapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
  // The active instance is always part of the window, even when the `cycleId`
  // query cannot see it (legacy instances predating the field). That makes
  // this degrade to the previous single-instance behaviour rather than to
  // zero progress.
  if (!instances.some((item) => item.id === input.activeProgramInstanceId)) {
    instances.push({ id: input.activeProgramInstanceId, data: input.activeInstance });
  }

  const resolved = await Promise.all(instances.map(async (instance) => {
    const contentIdentity = typeof instance.data.contentIdentity === 'string' ? instance.data.contentIdentity : null;
    if (!contentIdentity || !(instance.data.activatedAt instanceof Timestamp)) return null;
    const program = contentIdentity === input.activeContentIdentity
      ? input.activeProgram
      : (await reader.readDoc(reader.root.collection('workoutPrograms').doc(contentIdentity))).data();
    if (!program) return null;
    const sessions = sealedSessions(program);
    if (!sessions) return null;
    return {
      contentIdentity,
      window: {
        programInstanceId: instance.id,
        activatedAtLocalDate: localDate((instance.data.activatedAt as Timestamp).toDate(), input.timezone),
        // Inclusive, matching `weeklyGoalForWeek`'s window contract: the day
        // an instance was superseded is still a day it covered.
        supersededAtLocalDate: instance.data.supersededAt instanceof Timestamp
          ? localDate((instance.data.supersededAt as Timestamp).toDate(), input.timezone)
          : null,
        prescribedTrainingFrequency: sealedWeeklyGoal(program, sessions.length),
        prescribedSessions: sessions,
      } satisfies CycleInstanceProgressionWindow,
    };
  }));
  const usable = resolved.filter((item): item is NonNullable<typeof item> => item !== null);
  if (usable.length === 0) return { status: 'UNAVAILABLE' };

  const instanceIds = usable.map((item) => item.window.programInstanceId);
  const chunks: string[][] = [];
  for (let index = 0; index < instanceIds.length; index += EXECUTION_INSTANCE_IN_CHUNK) {
    chunks.push(instanceIds.slice(index, index + EXECUTION_INSTANCE_IN_CHUNK));
  }
  // Events live under `workoutPrograms/{contentIdentity}/scheduleEvents`, so a
  // cycle that adapted has its ledger split across content identities. Each
  // (contentIdentity, instanceId) pair is read explicitly.
  const ledgerPairs = [...new Map(usable.map((item) =>
    [`${item.contentIdentity}:${item.window.programInstanceId}`, item])).values()];

  const [executionSnapshots, eventSnapshots] = await Promise.all([
    Promise.all(chunks.map((chunk) => reader.readQuery(
      reader.root.collection('workoutExecutions')
        .where('programInstanceId', 'in', chunk)
        .limit(CYCLE_HISTORY_LIMIT + 1),
    ))),
    Promise.all(ledgerPairs.map((pair) => reader.readQuery(
      reader.root.collection('workoutPrograms').doc(pair.contentIdentity)
        .collection('scheduleEvents')
        .where('programInstanceId', '==', pair.window.programInstanceId)
        .limit(CYCLE_HISTORY_LIMIT + 1),
    ))),
  ]);

  const executions = new Map<string, DocumentData>();
  for (const snapshot of executionSnapshots) {
    for (const item of snapshot.docs) executions.set(item.ref.path, item.data());
  }
  const scheduleEvents = new Map<string, DocumentData>();
  for (const snapshot of eventSnapshots) {
    for (const item of snapshot.docs) scheduleEvents.set(item.ref.path, item.data());
  }
  if (executions.size > CYCLE_HISTORY_LIMIT || scheduleEvents.size > CYCLE_HISTORY_LIMIT) {
    return { status: 'HISTORY_LIMIT' };
  }

  return {
    status: 'OK',
    windows: usable.map((item) => item.window),
    executions: [...executions.values()],
    scheduleEvents: [...scheduleEvents.values()],
  };
}
