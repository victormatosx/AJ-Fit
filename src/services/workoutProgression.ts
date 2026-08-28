import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { getQuestionnaireById } from './userProfile';
import { loadActiveWorkoutProgram, generateAndPersistWorkoutProgram, type WorkoutProgramSnapshot } from './workoutPrograms';
import { listExecutionsForProgram } from './workoutExecutions';
import { loadScheduleConfig } from './workoutSchedule';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { evaluateWorkoutProgression } from '../progressionEngine/resolver';
import {
  PROGRESSION_ENGINE_VERSION,
  type AdaptationStage,
  type ProgressionEventType,
  type ProgressionResolution,
} from '../progressionEngine/types';

const USERS = 'users';
const PROGRAMS = 'workoutPrograms';
const PROGRESSION_EVENTS = 'progressionEvents';

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function progressionEventsCollection(uid: string, fromProgramId: string) {
  return collection(db, USERS, uid, PROGRAMS, fromProgramId, PROGRESSION_EVENTS);
}

/** Deterministic per (fromProgramId, type, day) — a same-day double apply/retry converges on the same event; a genuinely later transition (e.g. the next 90-day renewal of the same self-referential program) gets a new one (docs §36/§77/§91, same pattern as `scheduleEvents`). */
function progressionEventId(type: ProgressionEventType, occurredOnLocalDate: string): string {
  return `${type.toLowerCase()}_${occurredOnLocalDate}`;
}

export interface ProgressionEvent {
  type: ProgressionEventType;
  toProgramId: string;
  fromStage: AdaptationStage | null;
  toStage: AdaptationStage | null;
  reason: string;
  occurredAt: Timestamp;
  progressionEngineVersion: number;
}

/**
 * Gathers the real inputs (active program, its executions, schedule config,
 * today) and runs the pure resolver. Read-only — never writes anything
 * (docs §47/§50).
 */
export async function evaluateActiveProgression(uid: string): Promise<{
  resolution: ProgressionResolution;
  program: WorkoutProgramSnapshot | null;
}> {
  const program = await loadActiveWorkoutProgram(uid);
  if (!program) return { resolution: { status: 'INVALID_PROGRAM_STATE' }, program: null };

  const [config, executions] = await Promise.all([
    loadScheduleConfig(uid),
    listExecutionsForProgram(uid, program.programId),
  ]);

  const timezone = config?.timezone ?? deviceTimezone();
  const todayLocalDate = localDateInTimezone(new Date(), timezone);
  const activatedAtLocalDate = program.activatedAt
    ? localDateInTimezone(program.activatedAt.toDate(), timezone)
    : todayLocalDate;

  const resolution = evaluateWorkoutProgression({
    hasValidActiveProgram: true,
    adaptationStage: program.adaptationStage,
    activatedAtLocalDate,
    todayLocalDate,
    trainingDaysPerWeek: program.prescribedTrainingFrequency
      ?? program.prescribedStructuredDays
      ?? config?.trainingDays.length
      ?? 0,
    completedOrPartialSessionCount: executions.filter((e) => e.status === 'COMPLETED' || e.status === 'PARTIALLY_COMPLETED').length,
    hasActiveExecution: executions.some((e) => e.status === 'IN_PROGRESS'),
  });

  return { resolution, program };
}

/**
 * Applies a previously-evaluated transition. Re-validates everything fresh
 * (docs §51) — a stale `resolution` from a caller that's been sitting around
 * can never force a transition that's no longer valid. If the active program
 * has already moved on (e.g. another device already applied this, or the app
 * was reopened after a transition already completed — docs §99), this is a
 * no-op success, not an error.
 */
export async function applyProgression(input: {
  uid: string;
  expectedProgramId: string;
}): Promise<
  | { applied: false; reason: 'ALREADY_APPLIED' | 'NOT_ELIGIBLE' | 'BLOCKED_ACTIVE_EXECUTION' | 'INVALID_PROGRAM_STATE' }
  | { applied: true; program: WorkoutProgramSnapshot; event: ProgressionEvent }
> {
  const { resolution, program } = await evaluateActiveProgression(input.uid);

  if (!program || program.programId !== input.expectedProgramId) {
    // Either no active program at all, or it already moved on from the one
    // the caller thought it was evaluating — nothing to do here.
    return { applied: false, reason: program ? 'ALREADY_APPLIED' : 'INVALID_PROGRAM_STATE' };
  }
  if (resolution.status === 'INVALID_PROGRAM_STATE') return { applied: false, reason: 'INVALID_PROGRAM_STATE' };
  if (resolution.status === 'BLOCKED_ACTIVE_EXECUTION') return { applied: false, reason: 'BLOCKED_ACTIVE_EXECUTION' };
  if (resolution.status === 'NOT_ELIGIBLE') return { applied: false, reason: 'NOT_ELIGIBLE' };

  const questionnaire = await getQuestionnaireById(input.uid, program.questionnaireId);
  if (!questionnaire) return { applied: false, reason: 'INVALID_PROGRAM_STATE' };

  const isBeginnerStageTransition = resolution.status === 'BEGINNER_STAGE_PROGRESSION_AVAILABLE';
  const type: ProgressionEventType = isBeginnerStageTransition ? 'BEGINNER_STAGE_TRANSITION' : 'NORMAL_ROTATION';

  // Stage 3 must be passed explicitly even for a plain renewal — omitting it
  // would make `adaptationStage(undefined)` default back to Stage 1 for a
  // Beginner-origin user who already graduated (regression bug otherwise).
  const adaptationWeek = resolution.status === 'BEGINNER_STAGE_PROGRESSION_AVAILABLE' ? resolution.toStage : 3;

  const result = await generateAndPersistWorkoutProgram({
    uid: input.uid,
    questionnaireId: program.questionnaireId,
    questionnaireVersion: program.questionnaireVersion,
    answers: questionnaire.answers,
    source: 'automatic_progression',
    adaptationWeek,
  });
  if (result.status !== 'SUCCESS') return { applied: false, reason: 'INVALID_PROGRAM_STATE' };

  const config = await loadScheduleConfig(input.uid);
  const todayLocalDate = localDateInTimezone(new Date(), config?.timezone ?? deviceTimezone());
  const eventRef = doc(progressionEventsCollection(input.uid, program.programId), progressionEventId(type, todayLocalDate));

  const event: ProgressionEvent = await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(eventRef);
    if (existing.exists()) return existing.data() as ProgressionEvent;
    const payload: Omit<ProgressionEvent, 'occurredAt'> & { occurredAt: ReturnType<typeof serverTimestamp> } = {
      type,
      toProgramId: result.program.programId,
      fromStage: resolution.status === 'BEGINNER_STAGE_PROGRESSION_AVAILABLE' ? resolution.fromStage : (program.adaptationStage ?? null),
      toStage: resolution.status === 'BEGINNER_STAGE_PROGRESSION_AVAILABLE' ? resolution.toStage : (program.adaptationStage ?? null),
      reason: isBeginnerStageTransition ? 'BEGINNER_STAGE_TIME_AND_SESSIONS_MET' : 'NORMAL_CYCLE_TIME_AND_ADHERENCE_MET',
      occurredAt: serverTimestamp(),
      progressionEngineVersion: PROGRESSION_ENGINE_VERSION,
    };
    transaction.set(eventRef, payload);
    return payload as unknown as ProgressionEvent;
  });

  return { applied: true, program: result.program, event };
}
