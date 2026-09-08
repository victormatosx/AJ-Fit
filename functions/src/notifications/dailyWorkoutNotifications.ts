import { createHash } from 'node:crypto';

import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { weekdayOfLocalDate } from '../workoutLifecycle/scheduleEngine/calendar';
import {
  scheduleEventDocumentId,
  workoutExecutionDocumentId,
} from '../workoutLifecycle/scheduleEngine/identities';
import { canonicalIanaTimezone, localDateInTimezone } from '../workoutLifecycle/scheduleEngine/localDate';
import { detectMissedSessionGap, resolveWorkoutSchedule } from '../workoutLifecycle/scheduleEngine/resolver';
import type { PendingMissDecision, ScheduleConfig } from '../workoutLifecycle/scheduleEngine/types';
import type { Weekday } from '../workoutLifecycle/scheduleEngine/weekday';
import {
  buildMissedWorkoutNotification,
  buildRecoveryDayNotification,
  buildWorkoutDayNotification,
} from './contentPolicy';
import { dailyLocalClock } from './dailyTime';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
  type DailyProductWindowClaim,
} from './dailyProductRateLimit';
import type { NotificationDispatchOutcome, NotificationDispatchRequest } from './schema';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.dailyWorkout';
const WEEKDAYS = new Set<Weekday>(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const DAY_STATES = new Set(['TRAINING', 'ACTIVE_RECOVERY', 'REST']);

interface WeeklyDay {
  weekday: Weekday;
  state: 'TRAINING' | 'ACTIVE_RECOVERY' | 'REST';
}

interface ScheduleStateInput {
  nextSessionIndex: number;
  cursorDate: string;
  pendingMissDecision: PendingMissDecision | null;
  lastCompletedAt: string | null;
}

export interface DailyWorkoutContext {
  status: 'READY';
  timezone: string;
  programId: string;
  programInstanceId: string;
  activatedAtLocalDate: string;
  weeklySchedule: WeeklyDay[];
  sessionCount: number;
  scheduleState: ScheduleStateInput | null;
  resolvedMissScheduledDate: string | null;
}

export type DailyWorkoutContextLoad = DailyWorkoutContext | {
  status:
    | 'USER_NOT_FOUND'
    | 'ACCOUNT_INACTIVE'
    | 'TIMEZONE_UNAVAILABLE'
    | 'PROGRAM_UNAVAILABLE'
    | 'SCHEDULE_UNAVAILABLE';
  timezone?: string;
};

export type DailyWorkoutEvaluation =
  | {
      status: 'DISPATCHED';
      notificationType: 'WORKOUT_DAY' | 'RECOVERY_DAY' | 'MISSED_WORKOUT';
      localDate: string;
      timezone: string;
      outcome: NotificationDispatchOutcome['status'];
    }
  | {
      status: 'SUPPRESSED';
      reason: string;
      localDate?: string;
      timezone?: string;
    }
  | { status: 'FAILED'; timezone?: string; localDate?: string };

export interface DailyWorkoutNotificationDependencies {
  db: Firestore;
  now(): Timestamp;
  loadContext(uid: string, instant: Date): Promise<DailyWorkoutContextLoad>;
  hasFinishedExecution(uid: string, context: DailyWorkoutContext, sessionIndex: number, localDate: string): Promise<boolean>;
  dispatchCandidate: typeof dispatchUserNotificationCandidate;
  claimProductWindow(input: {
    uid: string;
    localDate: string;
    request: NotificationDispatchRequest;
  }, now: Timestamp): Promise<DailyProductWindowClaim>;
  completeProductWindow(input: {
    windowId: string;
    claimToken: string;
    outcome: string;
  }, now: Timestamp): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseWeeklySchedule(value: unknown): WeeklyDay[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const result: WeeklyDay[] = [];
  const seen = new Set<Weekday>();
  for (const item of value) {
    if (!isRecord(item) || !WEEKDAYS.has(item.weekday as Weekday) || !DAY_STATES.has(String(item.state))) {
      return null;
    }
    const weekday = item.weekday as Weekday;
    if (seen.has(weekday)) return null;
    seen.add(weekday);
    result.push({ weekday, state: item.state as WeeklyDay['state'] });
  }
  return result;
}

function legacyWeeklySchedule(value: unknown): WeeklyDay[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const trainingDays = value as unknown[];
  if (
    trainingDays.some((day) => !WEEKDAYS.has(day as Weekday))
    || new Set(trainingDays).size !== trainingDays.length
  ) return null;
  return (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((weekday) => ({
    weekday,
    // This is the same legacy fallback used by `resolveTodaysSchedule`:
    // scheduleConfig can identify training days, but it cannot invent an
    // ACTIVE_RECOVERY day that the program snapshot never prescribed.
    state: trainingDays.includes(weekday) ? 'TRAINING' : 'REST',
  }));
}

function effectiveWeeklySchedule(
  programValue: unknown,
  configuredTrainingDays: unknown,
): WeeklyDay[] | null {
  if (Array.isArray(programValue) && programValue.length === 7) {
    return parseWeeklySchedule(programValue);
  }
  if (programValue == null || (Array.isArray(programValue) && programValue.length === 0)) {
    return legacyWeeklySchedule(configuredTrainingDays);
  }
  return null;
}

function parsePendingMissDecision(value: unknown): PendingMissDecision | null {
  if (!isRecord(value)) return null;
  if (
    !Number.isInteger(value.missedSessionIndex)
    || !Number.isInteger(value.calendarSessionIndex)
    || !validDate(value.missedScheduledDate)
    || !validDate(value.detectedOnDate)
  ) return null;
  return value as unknown as PendingMissDecision;
}

function parseScheduleState(data: DocumentData | undefined): ScheduleStateInput | null {
  if (!data) return null;
  if (!Number.isInteger(data.nextSessionIndex) || !validDate(data.cursorDate)) return null;
  if (data.lastCompletedAt !== null && !validDate(data.lastCompletedAt)) return null;
  const pendingMissDecision = parsePendingMissDecision(data.pendingMissDecision);
  if (data.pendingMissDecision != null && !pendingMissDecision) return null;
  return {
    nextSessionIndex: data.nextSessionIndex,
    cursorDate: data.cursorDate,
    pendingMissDecision,
    lastCompletedAt: data.lastCompletedAt ?? null,
  };
}

function sessionCountFor(program: DocumentData): number {
  for (const value of [program.prescribedTrainingFrequency, program.prescribedStructuredDays]) {
    if (Number.isInteger(value) && value > 0 && value <= 7) return value;
  }
  return Array.isArray(program.sessions) && program.sessions.length > 0
    ? program.sessions.length
    : 0;
}

export async function loadDailyWorkoutContext(
  db: Firestore,
  uid: string,
  instant: Date,
): Promise<DailyWorkoutContextLoad> {
  const userRef = db.collection('users').doc(uid);
  const [user, deletionLock, lifecycle, scheduleConfig] = await Promise.all([
    userRef.get(),
    db.collection('accountDeletionLocks').doc(uid).get(),
    userRef.collection('workoutLifecycleState').doc('current').get(),
    userRef.collection('workoutProgramState').doc('scheduleConfig').get(),
  ]);
  if (!user.exists) return { status: 'USER_NOT_FOUND' };
  if (deletionLock.exists) return { status: 'ACCOUNT_INACTIVE' };

  const timezone = canonicalIanaTimezone(scheduleConfig.data()?.timezone);
  if (!timezone) return { status: 'TIMEZONE_UNAVAILABLE' };

  const lifecycleData = lifecycle.data();
  const programId = typeof lifecycleData?.activeContentIdentity === 'string'
    ? lifecycleData.activeContentIdentity
    : null;
  const programInstanceId = typeof lifecycleData?.activeProgramInstanceId === 'string'
    ? lifecycleData.activeProgramInstanceId
    : null;
  if (!programId || !programInstanceId) return { status: 'PROGRAM_UNAVAILABLE', timezone };

  const instanceRef = userRef.collection('programInstances').doc(programInstanceId);
  const programRef = userRef.collection('workoutPrograms').doc(programId);
  const stateRef = programRef.collection('scheduleState').doc(programInstanceId);
  const [instance, program, state] = await Promise.all([
    instanceRef.get(),
    programRef.get(),
    stateRef.get(),
  ]);
  const instanceData = instance.data();
  const programData = program.data();
  if (
    !instance.exists
    || !program.exists
    || !instanceData?.activatedAt
    || typeof instanceData.activatedAt.toDate !== 'function'
    || instanceData.contentIdentity !== programId
    || instanceData.supersededAt !== null
    || programData?.status !== 'active'
  ) return { status: 'PROGRAM_UNAVAILABLE', timezone };

  const weeklySchedule = effectiveWeeklySchedule(
    programData.weeklySchedule,
    scheduleConfig.data()?.trainingDays,
  );
  if (!weeklySchedule) return { status: 'SCHEDULE_UNAVAILABLE', timezone };
  const trainingDays = weeklySchedule
    .filter((day) => day.state === 'TRAINING')
    .map((day) => day.weekday);
  const activeRecoveryDays = weeklySchedule
    .filter((day) => day.state === 'ACTIVE_RECOVERY')
    .map((day) => day.weekday);
  const sessionCount = sessionCountFor(programData);
  if (trainingDays.length === 0 || sessionCount === 0) {
    return { status: 'SCHEDULE_UNAVAILABLE', timezone };
  }

  const scheduleState = state.exists ? parseScheduleState(state.data()) : null;
  if (state.exists && !scheduleState) return { status: 'SCHEDULE_UNAVAILABLE', timezone };
  const activatedAtLocalDate = localDateInTimezone(instanceData.activatedAt.toDate(), timezone);
  const todayLocalDate = localDateInTimezone(instant, timezone);
  const config: ScheduleConfig = {
    trainingDays,
    activeRecoveryDays,
    timezone,
    scheduleVersion: 1,
  };
  const gap = detectMissedSessionGap({
    hasActiveProgram: true,
    sessionCount,
    config,
    state: scheduleState,
    activatedAtLocalDate,
    todayLocalDate,
  });
  let resolvedMissScheduledDate: string | null = null;
  if (gap) {
    const eventId = scheduleEventDocumentId({
      type: 'MISS_RESOLVED',
      sessionIndex: gap.missedSessionIndex,
      scheduledDate: gap.missedScheduledDate,
      programInstanceId,
    });
    const event = await programRef.collection('scheduleEvents').doc(eventId).get();
    const eventData = event.data();
    if (
      event.exists
      && eventData?.type === 'MISS_RESOLVED'
      && eventData.programInstanceId === programInstanceId
      && eventData.sessionIndex === gap.missedSessionIndex
      && eventData.scheduledDate === gap.missedScheduledDate
    ) resolvedMissScheduledDate = gap.missedScheduledDate;
  }

  return {
    status: 'READY',
    timezone,
    programId,
    programInstanceId,
    activatedAtLocalDate,
    weeklySchedule,
    sessionCount,
    scheduleState,
    resolvedMissScheduledDate,
  };
}

export async function hasFinishedWorkoutExecution(
  db: Firestore,
  uid: string,
  context: DailyWorkoutContext,
  sessionIndex: number,
  localDate: string,
): Promise<boolean> {
  const executionId = workoutExecutionDocumentId(context.programInstanceId, sessionIndex, localDate);
  const execution = await db.collection('users').doc(uid).collection('workoutExecutions').doc(executionId).get();
  const data = execution.data();
  return execution.exists
    && data?.programInstanceId === context.programInstanceId
    && data?.sessionIndex === sessionIndex
    && data?.scheduledLocalDate === localDate
    && ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(String(data?.status));
}

function sourceHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function defaultDependencies(): DailyWorkoutNotificationDependencies {
  return {
    db: defaultDb,
    now: Timestamp.now,
    loadContext: (uid, instant) => loadDailyWorkoutContext(defaultDb, uid, instant),
    hasFinishedExecution: (uid, context, sessionIndex, localDate) =>
      hasFinishedWorkoutExecution(defaultDb, uid, context, sessionIndex, localDate),
    dispatchCandidate: dispatchUserNotificationCandidate,
    claimProductWindow: (input, now) => claimDailyProductWindow(defaultDb, input, now),
    completeProductWindow: (input, now) => completeDailyProductWindow(defaultDb, input, now),
  };
}

function suppress(
  reason: string,
  input: { timezone?: string; localDate?: string } = {},
): DailyWorkoutEvaluation {
  logInfo(SCOPE, 'candidate_suppressed', { reason, ...input });
  return { status: 'SUPPRESSED', reason, ...input };
}

export async function evaluateDailyWorkoutNotification(
  uid: string,
  dependencies: DailyWorkoutNotificationDependencies = defaultDependencies(),
): Promise<DailyWorkoutEvaluation> {
  const now = dependencies.now();
  let timezone: string | undefined;
  let localDate: string | undefined;
  try {
    const context = await dependencies.loadContext(uid, now.toDate());
    if (context.status !== 'READY') {
      return suppress(context.status, { timezone: context.timezone });
    }
    timezone = context.timezone;
    const clock = dailyLocalClock(now.toDate(), context.timezone);
    if (!clock) return suppress('TIMEZONE_INVALID', { timezone: context.timezone });
    localDate = clock.localDate;
    if (!clock.withinWindow) {
      return suppress('OUTSIDE_LOCAL_WINDOW', { timezone, localDate });
    }

    const trainingDays = context.weeklySchedule
      .filter((day) => day.state === 'TRAINING')
      .map((day) => day.weekday);
    const activeRecoveryDays = context.weeklySchedule
      .filter((day) => day.state === 'ACTIVE_RECOVERY')
      .map((day) => day.weekday);
    const config: ScheduleConfig = {
      trainingDays,
      activeRecoveryDays,
      timezone,
      scheduleVersion: 1,
    };
    const input = {
      hasActiveProgram: true,
      sessionCount: context.sessionCount,
      config,
      state: context.scheduleState,
      activatedAtLocalDate: context.activatedAtLocalDate,
      todayLocalDate: localDate,
      resolvedMissScheduledDate: context.resolvedMissScheduledDate,
    };
    const resolution = resolveWorkoutSchedule(input);
    const gap = detectMissedSessionGap(input);
    let build: ((locale: 'pt-BR' | 'en' | 'es') => NotificationDispatchRequest) | null = null;

    if (resolution.status === 'MISSED_SESSION_DECISION_REQUIRED') {
      const pending = context.scheduleState?.pendingMissDecision;
      const missedDate = pending?.missedScheduledDate ?? gap?.missedScheduledDate;
      if (!missedDate) return suppress('MISSED_IDENTITY_UNAVAILABLE', { timezone, localDate });
      const plannedSessionIdentity = [context.programInstanceId, missedDate, resolution.missedSessionIndex].join(':');
      build = (locale) => buildMissedWorkoutNotification({ uid, plannedSessionIdentity, locale });
    } else if (resolution.status === 'SESSION_READY') {
      if (!trainingDays.includes(weekdayOfLocalDate(localDate))) {
        return suppress('NO_WORKOUT_TODAY', { timezone, localDate });
      }
      if (await dependencies.hasFinishedExecution(uid, context, resolution.sessionIndex, localDate)) {
        return suppress('ALREADY_COMPLETED', { timezone, localDate });
      }
      build = (locale) => buildWorkoutDayNotification({ uid, localDate: localDate!, locale });
    } else if (resolution.status === 'ACTIVE_RECOVERY_DAY') {
      build = (locale) => buildRecoveryDayNotification({ uid, localDate: localDate!, locale });
    } else {
      return suppress(resolution.status, { timezone, localDate });
    }

    const sample = build('pt-BR');
    const productWindow = await dependencies.claimProductWindow({
      uid,
      localDate,
      request: sample,
    }, now);
    if (productWindow.outcome !== 'CLAIMED') {
      return suppress(productWindow.outcome === 'RATE_LIMITED' ? 'PRODUCT_RATE_LIMIT' : 'DAILY_DUPLICATE', {
        timezone,
        localDate,
      });
    }

    const outcome = await dependencies.dispatchCandidate({
      uid,
      category: 'WORKOUTS_AND_REMINDERS',
      build,
    });
    await dependencies.completeProductWindow({
      windowId: productWindow.windowId,
      claimToken: productWindow.claimToken,
      outcome: outcome.status,
    }, now);
    logInfo(SCOPE, 'candidate_outcome', {
      notificationType: sample.type,
      localDate,
      timezone,
      outcome: outcome.status,
      sourceEventHash: sourceHash(sample.sourceIdentity),
    });
    return {
      status: 'DISPATCHED',
      notificationType: sample.type as 'WORKOUT_DAY' | 'RECOVERY_DAY' | 'MISSED_WORKOUT',
      localDate,
      timezone,
      outcome: outcome.status,
    };
  } catch (error) {
    logFunctionError(SCOPE, error, { uid, operation: 'daily_evaluation', timezone, localDate });
    return { status: 'FAILED', timezone, localDate };
  }
}
