import type { ScheduleMode, Sex } from '../state/AppState';
import type { LocalDate } from '../scheduleEngine/calendar';
import { addDaysLocal } from '../scheduleEngine/calendar';
import { localDateStartOfDayMs } from '../scheduleEngine/localDate';
import type { ScheduleResolution } from '../scheduleEngine/types';
import { deriveSessionMuscles } from '../lib/sessionMuscles';
import type { MuscleId } from '../types/exercise';
import type { FinalWorkoutSession } from '../workoutPrescription/types';

export interface WorkoutWidgetCopy {
  nextWorkout: string;
  inProgress: string;
  today: string;
  exercises: (count: number) => string;
  sets: (count: number) => string;
}

export interface WorkoutWidgetExecution {
  status: 'IN_PROGRESS';
  sessionName: string;
  exercises: readonly { exerciseId: string; sets: readonly unknown[] }[];
}

export interface WorkoutWidgetBodyMap {
  sex: Sex;
  primaryMuscles: MuscleId[];
  secondaryMuscles: MuscleId[];
}

export interface WorkoutWidgetData {
  state: 'NEXT' | 'IN_PROGRESS';
  eyebrow: string;
  workoutName: string;
  exerciseCount: number;
  setCount: number;
  exercisesLabel: string;
  setsLabel: string;
  metricsLabel: string;
  /** Null for flexible schedules and for an execution already in progress. */
  dateLabel: string | null;
  /** App-localized label and instant used by native timelines at midnight. */
  todayLabel: string | null;
  dateBecomesTodayAtMs: number | null;
  /** Exact same read-only exercise→muscle projection used by Home's BodyMap. */
  bodyMap: WorkoutWidgetBodyMap | null;
  /** Lets native hide a date-sensitive projection instead of showing stale data. */
  staleAtMs: number;
}

export interface WorkoutWidgetProjectionInput {
  scheduleMode: ScheduleMode;
  todayLocalDate: LocalDate;
  timezone: string;
  generatedAtMs: number;
  sex: Sex;
  sessions: readonly FinalWorkoutSession[];
  resolution: ScheduleResolution | null;
  activeExecution: WorkoutWidgetExecution | null;
  copy: WorkoutWidgetCopy;
  resolveSessionName: (session: Pick<FinalWorkoutSession, 'name' | 'type' | 'displayName'>) => string;
  formatDate: (localDate: LocalDate) => string;
}

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function bodyMap(sex: Sex, exerciseIds: readonly string[]): WorkoutWidgetBodyMap | null {
  const muscles = deriveSessionMuscles(exerciseIds);
  if (muscles.primary.length === 0) return null;
  return { sex, primaryMuscles: muscles.primary, secondaryMuscles: muscles.secondary };
}

function labels(copy: WorkoutWidgetCopy, exerciseCount: number, setCount: number) {
  const exercisesLabel = copy.exercises(exerciseCount);
  const setsLabel = copy.sets(setCount);
  return { exercisesLabel, setsLabel, metricsLabel: `${exercisesLabel} · ${setsLabel}` };
}

/**
 * Projects only already-authoritative app-domain facts. In particular, it
 * never walks training days or advances the workout rotation: fixed dates
 * and indexes come straight from ScheduleResolution, while IN_PROGRESS
 * always wins and comes from the durable execution mutex/document pair.
 */
export function buildWorkoutWidgetData(input: WorkoutWidgetProjectionInput): WorkoutWidgetData | null {
  const { activeExecution, copy } = input;
  if (activeExecution?.status === 'IN_PROGRESS') {
    const exerciseCount = activeExecution.exercises.length;
    const setCount = activeExecution.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    return {
      state: 'IN_PROGRESS',
      eyebrow: copy.inProgress,
      workoutName: activeExecution.sessionName,
      exerciseCount,
      setCount,
      ...labels(copy, exerciseCount, setCount),
      dateLabel: null,
      todayLabel: null,
      dateBecomesTodayAtMs: null,
      bodyMap: bodyMap(input.sex, activeExecution.exercises.map((exercise) => exercise.exerciseId)),
      staleAtMs: input.generatedAtMs + STALE_AFTER_MS,
    };
  }

  const resolution = input.resolution;
  if (!resolution || input.sessions.length === 0) return null;

  let sessionIndex: number;
  let localDate: LocalDate | null;
  switch (resolution.status) {
    case 'SESSION_READY':
      sessionIndex = resolution.sessionIndex;
      localDate = input.scheduleMode === 'flexible' ? null : input.todayLocalDate;
      break;
    case 'REST_DAY':
    case 'ACTIVE_RECOVERY_DAY':
    case 'TODAY_COMPLETED':
      sessionIndex = resolution.nextSessionIndex;
      localDate = resolution.nextWorkoutDate;
      break;
    default:
      // A pending miss decision has two legitimate session outcomes. Until
      // the user resolves it, there is no single authoritative next workout.
      return null;
  }

  const session = input.sessions[sessionIndex % input.sessions.length];
  if (!session) return null;
  const exerciseCount = session.exercises.length;
  const setCount = session.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? 0), 0);
  const staleAtMs = localDate
    ? localDateStartOfDayMs(addDaysLocal(localDate, 1), input.timezone)
    : input.generatedAtMs + STALE_AFTER_MS;
  const dateBecomesTodayAtMs = localDate
    ? localDateStartOfDayMs(localDate, input.timezone)
    : null;
  return {
    state: 'NEXT',
    eyebrow: copy.nextWorkout,
    workoutName: input.resolveSessionName(session),
    exerciseCount,
    setCount,
    ...labels(copy, exerciseCount, setCount),
    dateLabel: localDate === null ? null : localDate === input.todayLocalDate ? copy.today : input.formatDate(localDate),
    todayLabel: localDate === null ? null : copy.today,
    dateBecomesTodayAtMs,
    bodyMap: bodyMap(input.sex, session.exercises.map((exercise) => exercise.exerciseId)),
    staleAtMs,
  };
}
