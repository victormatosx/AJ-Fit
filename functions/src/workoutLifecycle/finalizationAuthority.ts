import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import type { PendingMissDecision, ScheduleConfig } from './scheduleEngine/types';
import type { Weekday } from './scheduleEngine/weekday';

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

export interface ScheduleAuthorityContext {
  config: ScheduleConfig;
  state: { nextSessionIndex: number; cursorDate: string; pendingMissDecision: PendingMissDecision | null; lastCompletedAt: string | null } | null;
  activatedAtLocalDate: string;
  sessionCount: number;
}

/** Lean shared authority core; intentionally has no prescription-generator imports. */
export function buildScheduleAuthorityContext(input: {
  scheduleConfigData: DocumentData;
  stateData: DocumentData | null;
  instance: DocumentData;
  program: DocumentData;
}): ScheduleAuthorityContext {
  const snapshotInputs = plainObject(input.instance.prescriptionInputSnapshot?.inputs)
    ? input.instance.prescriptionInputSnapshot.inputs as Record<string, unknown> : {};
  const prescribedTrainingDays = Array.isArray(input.program.weeklySchedule)
    ? input.program.weeklySchedule.flatMap((item: unknown) =>
      plainObject(item) && item.state === 'TRAINING' && typeof item.weekday === 'string'
        ? [item.weekday] : []) : [];
  const configuredDays = prescribedTrainingDays.length > 0 ? prescribedTrainingDays
    : Array.isArray(snapshotInputs.trainingDays) && snapshotInputs.trainingDays.length > 0
      ? snapshotInputs.trainingDays
      : Array.isArray(input.scheduleConfigData.trainingDays) ? input.scheduleConfigData.trainingDays : [];
  const trainingDays = configuredDays.filter((item): item is Weekday => typeof item === 'string');
  const timezone = typeof input.scheduleConfigData.timezone === 'string' ? input.scheduleConfigData.timezone : 'UTC';
  if (!(input.instance.activatedAt instanceof Timestamp)) {
    throw new HttpsError('failed-precondition', 'program_instance_activation_missing');
  }
  const sessionCount = Number.isInteger(input.program.prescribedTrainingFrequency) && input.program.prescribedTrainingFrequency > 0
    ? input.program.prescribedTrainingFrequency
    : Number.isInteger(input.program.prescribedStructuredDays) && input.program.prescribedStructuredDays > 0
      ? input.program.prescribedStructuredDays
      : Array.isArray(input.program.sessions) ? input.program.sessions.length : 0;
  return {
    config: { trainingDays, timezone, scheduleVersion: 1 },
    state: input.stateData ? {
      nextSessionIndex: input.stateData.nextSessionIndex,
      cursorDate: input.stateData.cursorDate,
      pendingMissDecision: input.stateData.pendingMissDecision ?? null,
      lastCompletedAt: input.stateData.lastCompletedAt ?? null,
    } : null,
    activatedAtLocalDate: localDate(input.instance.activatedAt.toDate(), timezone),
    sessionCount,
  };
}

export function prescribedExecutionCounts(
  execution: DocumentData,
  session: DocumentData,
  expectedInstanceId: string,
): { completed: number; prescribed: number } | null {
  if (execution.programInstanceId !== expectedInstanceId || !Number.isInteger(execution.sessionIndex)) return null;
  if (!Array.isArray(session?.exercises) || !Array.isArray(execution.exercises)) return null;
  if (execution.exercises.length !== session.exercises.length || session.exercises.length === 0) return null;
  let completed = 0;
  let prescribed = 0;
  const seenExercises = new Set<number>();
  for (const record of execution.exercises) {
    if (!plainObject(record) || !Number.isInteger(record.exerciseIndex) || seenExercises.has(record.exerciseIndex as number)) return null;
    const index = record.exerciseIndex as number;
    const expected = session.exercises[index];
    const prescribedExerciseId = typeof record.prescribedExerciseId === 'string' ? record.prescribedExerciseId : record.exerciseId;
    if (!expected || prescribedExerciseId !== expected.exerciseId || !Array.isArray(record.sets)) return null;
    seenExercises.add(index);
    const setCount = Number.isInteger(expected.sets) ? expected.sets : 1;
    if (record.sets.length !== setCount) return null;
    prescribed += setCount;
    const seenSets = new Set<number>();
    for (const set of record.sets) {
      if (!plainObject(set) || !Number.isInteger(set.setIndex) || seenSets.has(set.setIndex as number)) return null;
      const setIndex = set.setIndex as number;
      if (setIndex < 0 || setIndex >= setCount || !['PENDING', 'COMPLETED', 'SKIPPED'].includes(String(set.status))) return null;
      seenSets.add(setIndex);
      if (set.status === 'COMPLETED') completed += 1;
    }
  }
  return prescribed > 0 ? { completed, prescribed } : null;
}
