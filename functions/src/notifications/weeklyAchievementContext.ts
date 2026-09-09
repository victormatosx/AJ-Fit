import { createHash } from 'node:crypto';

import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import { isValidProgressionSessionAgainstPrescription } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/sessionQualification';
import { addDaysLocal, weekdayOfLocalDate } from '../workoutLifecycle/prescriptionEngine/scheduleEngine/calendar';
import { canonicalIanaTimezone, localDateInTimezone } from '../workoutLifecycle/prescriptionEngine/scheduleEngine/localDate';
import type { Weekday } from '../workoutLifecycle/prescriptionEngine/state/AppState';
import type { WeekStreakMilestone } from './contentPolicy';
import { isWeekStreakMilestone } from './contentPolicy';
import { dailyLocalClock } from './dailyTime';

const MAX_INSTANCES = 128;
const MAX_EXECUTIONS = 4096;
const MAX_EVENTS_PER_PROGRAM = 4096;
// One look-behind week prevents a 52+ streak from re-emitting the 52 marker
// with a shifted sequence identity on every subsequent perfect week.
const MAX_STREAK_HISTORY_WEEKS = 53;
const WEEKDAYS = new Set<Weekday>(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const TERMINAL_EVOLUTION_EVENTS = new Set(['EVOLUTION_EARNED', 'MOTIVATIONAL_RENEWAL_OFFERED']);

interface WeeklyOpportunityFact {
  localDate: string;
  programInstanceId: string;
  prescriptionIdentity: string;
  fulfilled: boolean;
}

export interface PerfectWeekFact {
  weekStart: string;
  weekEnd: string;
  opportunityCount: number;
  fulfilledCount: number;
  perfect: boolean;
  prescriptionIdentity: string;
}

export type WeeklyAchievementCandidate = {
  notificationType: 'WEEK_COMPLETED';
  achievementIdentity: string;
  week: PerfectWeekFact;
} | {
  notificationType: 'WEEK_STREAK';
  achievementIdentity: string;
  week: PerfectWeekFact;
  weeks: WeekStreakMilestone;
  sequenceStartWeek: string;
};

export type WeeklyAchievementContext = {
  allowed: true;
  timezone: string;
  localDate: string;
  candidate: WeeklyAchievementCandidate;
} | {
  allowed: false;
  reason: string;
  timezone?: string;
  localDate?: string;
};

interface ParsedInstance {
  programInstanceId: string;
  prescriptionIdentity: string;
  contentIdentity: string;
  activatedAtMs: number;
  supersededAtMs: number | null;
  previousProgramInstanceId: string | null;
  activatedDate: string;
  supersededDate: string | null;
  trainingDays: ReadonlySet<Weekday>;
  sessions: readonly { exercises: readonly { exerciseId: string; setCount: number }[] }[];
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
}

function mondayOf(localDate: string): string {
  const weekday = weekdayOfLocalDate(localDate);
  const index = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].indexOf(weekday);
  return addDaysLocal(localDate, -index);
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function perfectWeekFacts(
  opportunities: readonly WeeklyOpportunityFact[],
  currentLocalDate: string,
  earliestKnownLocalDate: string,
): PerfectWeekFact[] {
  const currentWeek = mondayOf(currentLocalDate);
  const earliestWeek = mondayOf(earliestKnownLocalDate);
  const facts: PerfectWeekFact[] = [];
  for (let offset = 0; offset < MAX_STREAK_HISTORY_WEEKS; offset += 1) {
    const weekStart = addDaysLocal(currentWeek, -7 * offset);
    if (weekStart < earliestWeek) break;
    const weekEnd = addDaysLocal(weekStart, 6);
    const own = opportunities.filter((item) => item.localDate >= weekStart && item.localDate <= weekEnd);
    const fulfilledCount = own.filter((item) => item.fulfilled).length;
    const prescriptionIdentity = hash(own
      .map((item) => `${item.localDate}:${item.programInstanceId}:${item.prescriptionIdentity}`)
      .sort().join('|'));
    facts.push({
      weekStart,
      weekEnd,
      opportunityCount: own.length,
      fulfilledCount,
      perfect: own.length > 0 && fulfilledCount === own.length,
      prescriptionIdentity,
    });
  }
  return facts;
}

/** Zero-training and imperfect weeks both break continuity: only the shared perfect-week fact continues a streak. */
export function selectWeeklyAchievementCandidate(
  weeksNewestFirst: readonly PerfectWeekFact[],
): WeeklyAchievementCandidate | null {
  const current = weeksNewestFirst[0];
  if (!current?.perfect) return null;
  let streak = 0;
  for (const week of weeksNewestFirst) {
    if (!week.perfect) break;
    streak += 1;
  }
  const base = `${current.weekStart}:${current.prescriptionIdentity}`;
  if (isWeekStreakMilestone(streak)) {
    const sequenceStartWeek = weeksNewestFirst[streak - 1].weekStart;
    return {
      notificationType: 'WEEK_STREAK',
      achievementIdentity: `streak:${sequenceStartWeek}:${current.weekStart}:${streak}`,
      week: current,
      weeks: streak,
      sequenceStartWeek,
    };
  }
  return {
    notificationType: 'WEEK_COMPLETED',
    achievementIdentity: `week:${base}`,
    week: current,
  };
}

function parseTrainingDays(instance: DocumentData, program: DocumentData): ReadonlySet<Weekday> | null {
  const snapshotDays = instance.prescriptionInputSnapshot?.inputs?.trainingDays;
  if (!Array.isArray(snapshotDays) || snapshotDays.length === 0
    || snapshotDays.some((day: unknown) => !WEEKDAYS.has(day as Weekday))) return null;
  // A legacy plan without the explicit seven-day prescription cannot prove
  // which available days were TRAINING versus ACTIVE_RECOVERY, so it fails
  // closed instead of treating questionnaire availability as prescription.
  if (!Array.isArray(program.weeklySchedule) || program.weeklySchedule.length !== 7) return null;
  const seen = new Set<Weekday>();
  const training = new Set<Weekday>();
  for (const item of program.weeklySchedule) {
    if (!item || !WEEKDAYS.has(item.weekday as Weekday)
      || !['TRAINING', 'ACTIVE_RECOVERY', 'REST'].includes(String(item.state))
      || seen.has(item.weekday as Weekday)) return null;
    seen.add(item.weekday as Weekday);
    if (item.state === 'TRAINING') training.add(item.weekday as Weekday);
  }
  if (training.size === 0 || [...training].some((day) => !snapshotDays.includes(day))) return null;
  return training;
}

function parseSessions(program: DocumentData): ParsedInstance['sessions'] | null {
  if (!Array.isArray(program.sessions) || program.sessions.length === 0) return null;
  const sessions: { exercises: { exerciseId: string; setCount: number }[] }[] = [];
  for (const session of program.sessions) {
    if (!session || !Array.isArray(session.exercises) || session.exercises.length === 0) return null;
    const exercises: { exerciseId: string; setCount: number }[] = [];
    for (const exercise of session.exercises) {
      const setCount = Number.isInteger(exercise?.sets) ? exercise.sets : 1;
      if (!exercise || typeof exercise.exerciseId !== 'string' || setCount < 1) return null;
      exercises.push({ exerciseId: exercise.exerciseId, setCount });
    }
    sessions.push({ exercises });
  }
  return sessions;
}

function fulfilledOn(
  instance: ParsedInstance,
  localDate: string,
  events: readonly DocumentData[],
  executions: readonly DocumentData[],
): boolean {
  return events.some((event) => {
    if (event.type !== 'COMPLETED' || event.programInstanceId !== instance.programInstanceId
      || event.scheduledDate !== localDate || !Number.isInteger(event.sessionIndex)) return false;
    return executions.some((execution) => execution.programInstanceId === instance.programInstanceId
      && execution.scheduledLocalDate === localDate
      && execution.sessionIndex === event.sessionIndex
      && isValidProgressionSessionAgainstPrescription({
        execution: execution as Parameters<typeof isValidProgressionSessionAgainstPrescription>[0]['execution'],
        prescribedSession: instance.sessions[event.sessionIndex],
        expectedProgramInstanceId: instance.programInstanceId,
        expectedSessionIndex: event.sessionIndex,
      }));
  });
}

function effectiveInstance(
  instances: readonly ParsedInstance[],
  localDate: string,
  events: readonly DocumentData[],
): ParsedInstance | null {
  const overlapping = instances.filter((instance) => instance.activatedDate <= localDate
    && (instance.supersededDate === null || localDate <= instance.supersededDate));
  if (overlapping.length === 0) return null;
  const completedOwner = overlapping
    .filter((instance) => events.some((event) => event.type === 'COMPLETED'
      && event.programInstanceId === instance.programInstanceId && event.scheduledDate === localDate))
    .sort((a, b) => b.activatedAtMs - a.activatedAtMs)[0];
  return completedOwner ?? overlapping.sort((a, b) => b.activatedAtMs - a.activatedAtMs)[0];
}

export async function readWeeklyAchievementContext(
  db: Firestore,
  uid: string,
  now: Timestamp,
  options: { requireDailyWindow?: boolean } = {},
): Promise<WeeklyAchievementContext> {
  const root = db.collection('users').doc(uid);
  const [user, lock, lifecycle, schedule, pending] = await Promise.all([
    root.get(),
    db.collection('accountDeletionLocks').doc(uid).get(),
    root.collection('workoutLifecycleState').doc('current').get(),
    root.collection('workoutProgramState').doc('scheduleConfig').get(),
    root.collection('pendingEvolutions').doc('current').get(),
  ]);
  const deny = (reason: string, timezone?: string, localDate?: string): WeeklyAchievementContext => ({
    allowed: false, reason, ...(timezone ? { timezone } : {}), ...(localDate ? { localDate } : {}),
  });
  if (!user.exists) return deny('USER_NOT_FOUND');
  if (lock.exists) return deny('ACCOUNT_INACTIVE');
  const metadata = user.data()?.metadata;
  if (metadata?.workoutLifecycleQaMode === 'ACCELERATED'
    || metadata?.workoutLifecycleQaMode === 'TRANSITION'
    || metadata?.workoutLifecycleQaAccelerated === true) return deny('QA_POLICY');
  const timezone = canonicalIanaTimezone(schedule.data()?.timezone);
  const clock = timezone ? dailyLocalClock(now.toDate(), timezone) : null;
  if (!clock) return deny('TIMEZONE_UNAVAILABLE');
  if (options.requireDailyWindow !== false && !clock.withinWindow) {
    return deny('OUTSIDE_LOCAL_WINDOW', clock.timezone, clock.localDate);
  }
  const state = lifecycle.data();
  if (!state || state.initializationOrigin !== 'V2_NATIVE'
    || !validId(state.activeProgramInstanceId)
    || !(state.historyCompleteFrom instanceof Timestamp)
    || !(state.updatedAt instanceof Timestamp)
    || !(schedule.data()?.updatedAt instanceof Timestamp)) {
    return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
  }
  if (pending.exists) return deny('EVOLUTION_UNLOCKED_PRIORITY', clock.timezone, clock.localDate);
  const earliestKnownMs = Math.max(
    state.historyCompleteFrom.toMillis(),
    schedule.data()!.updatedAt.toMillis(),
  );

  const [instanceSnapshot, executionSnapshot, lifecycleEvents] = await Promise.all([
    root.collection('programInstances').limit(MAX_INSTANCES + 1).get(),
    root.collection('workoutExecutions').limit(MAX_EXECUTIONS + 1).get(),
    root.collection('workoutLifecycleEvents').limit(MAX_EVENTS_PER_PROGRAM + 1).get(),
  ]);
  if (instanceSnapshot.size > MAX_INSTANCES || executionSnapshot.size > MAX_EXECUTIONS
    || lifecycleEvents.size > MAX_EVENTS_PER_PROGRAM) return deny('HISTORY_LIMIT', clock.timezone, clock.localDate);
  const rawInstances = instanceSnapshot.docs.map((document) => document.data());
  const contentIdentities = [...new Set(rawInstances.map((instance) => instance.contentIdentity))];
  if (contentIdentities.some((value) => !validId(value))) {
    return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
  }
  const programs = await Promise.all(contentIdentities.map((identity) => root.collection('workoutPrograms').doc(identity).get()));
  if (programs.some((program) => !program.exists)) return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
  const programById = new Map(programs.map((program, index) => [contentIdentities[index], program.data()!]));
  const eventSnapshots = await Promise.all(contentIdentities.map((identity) => root.collection('workoutPrograms')
    .doc(identity).collection('scheduleEvents').limit(MAX_EVENTS_PER_PROGRAM + 1).get()));
  if (eventSnapshots.some((snapshot) => snapshot.size > MAX_EVENTS_PER_PROGRAM)) {
    return deny('HISTORY_LIMIT', clock.timezone, clock.localDate);
  }
  const events = eventSnapshots.flatMap((snapshot) => snapshot.docs.map((document) => document.data()));
  if (events.length > MAX_EVENTS_PER_PROGRAM) return deny('HISTORY_LIMIT', clock.timezone, clock.localDate);
  if (events.some((event) => event.type === 'COMPLETED' && (!(event.occurredAt instanceof Timestamp)
    || !validId(event.programInstanceId) || typeof event.scheduledDate !== 'string'
    || !Number.isInteger(event.sessionIndex)))) {
    return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
  }
  const relevantEvents = events.filter((event) => event.type !== 'COMPLETED'
    || event.occurredAt.toMillis() >= earliestKnownMs);
  const executions = executionSnapshot.docs.map((document) => document.data());
  const instances: ParsedInstance[] = [];
  for (const instance of rawInstances) {
    const program = programById.get(instance.contentIdentity);
    const trainingDays = program ? parseTrainingDays(instance, program) : null;
    const sessions = program ? parseSessions(program) : null;
    if (!validId(instance.programInstanceId) || !validId(instance.prescriptionIdentity)
      || !(instance.activatedAt instanceof Timestamp)
      || (instance.supersededAt !== null && !(instance.supersededAt instanceof Timestamp))
      || (instance.previousProgramInstanceId !== null && !validId(instance.previousProgramInstanceId))
      || !trainingDays || !sessions) return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
    instances.push({
      programInstanceId: instance.programInstanceId,
      prescriptionIdentity: instance.prescriptionIdentity,
      contentIdentity: instance.contentIdentity,
      activatedAtMs: instance.activatedAt.toMillis(),
      supersededAtMs: instance.supersededAt?.toMillis() ?? null,
      previousProgramInstanceId: instance.previousProgramInstanceId,
      activatedDate: localDateInTimezone(instance.activatedAt.toDate(), clock.timezone),
      supersededDate: instance.supersededAt
        ? localDateInTimezone(instance.supersededAt.toDate(), clock.timezone) : null,
      trainingDays,
      sessions,
    });
  }
  instances.sort((left, right) => left.activatedAtMs - right.activatedAtMs);
  if (instances[0]?.previousProgramInstanceId !== null) {
    return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
  }
  const activeInstances = instances.filter((instance) => instance.supersededAtMs === null);
  if (activeInstances.length !== 1 || activeInstances[0].programInstanceId !== state.activeProgramInstanceId) {
    return deny('PROGRAM_UNAVAILABLE', clock.timezone, clock.localDate);
  }
  for (let index = 1; index < instances.length; index += 1) {
    const previous = instances[index - 1];
    const current = instances[index];
    if (current.previousProgramInstanceId !== previous.programInstanceId
      || previous.supersededAtMs !== current.activatedAtMs) {
      return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
    }
  }

  const earliestKnownLocalDate = localDateInTimezone(new Date(earliestKnownMs), clock.timezone);
  const rangeStart = [addDaysLocal(mondayOf(clock.localDate), -7 * (MAX_STREAK_HISTORY_WEEKS - 1)), earliestKnownLocalDate]
    .sort().at(-1)!;
  const rangeEnd = addDaysLocal(mondayOf(clock.localDate), 6);
  const opportunities: WeeklyOpportunityFact[] = [];
  for (let date = rangeStart; date <= rangeEnd; date = addDaysLocal(date, 1)) {
    const instance = effectiveInstance(instances, date, relevantEvents);
    if (!instance || !instance.trainingDays.has(weekdayOfLocalDate(date))) continue;
    opportunities.push({
      localDate: date,
      programInstanceId: instance.programInstanceId,
      prescriptionIdentity: instance.prescriptionIdentity,
      fulfilled: fulfilledOn(instance, date, relevantEvents, executions),
    });
  }
  const weeks = perfectWeekFacts(opportunities, clock.localDate, earliestKnownLocalDate);
  let candidate = selectWeeklyAchievementCandidate(weeks);
  if (!candidate) {
    const currentWeek = weeks[0];
    const currentHasExpiredMiss = opportunities.some((opportunity) =>
      opportunity.localDate >= currentWeek?.weekStart
      && opportunity.localDate <= currentWeek?.weekEnd
      && opportunity.localDate < clock.localDate
      && !opportunity.fulfilled);
    // Catch a Sunday completion after the 08:00-10:00 window on the next
    // local day, but never celebrate an old streak after the new week has
    // already accumulated a real miss.
    if (!currentHasExpiredMiss) candidate = selectWeeklyAchievementCandidate(weeks.slice(1));
  }
  if (!candidate) return deny('NO_WEEKLY_ACHIEVEMENT', clock.timezone, clock.localDate);

  for (const event of lifecycleEvents.docs) {
    const data = event.data();
    if (!TERMINAL_EVOLUTION_EVENTS.has(String(data.type)) && data.type !== 'PROGRAM_ADAPTED') continue;
    if (!(data.occurredAt instanceof Timestamp)) {
      return deny('HISTORY_UNAVAILABLE', clock.timezone, clock.localDate);
    }
    const eventLocalDate = localDateInTimezone(data.occurredAt.toDate(), clock.timezone);
    if (TERMINAL_EVOLUTION_EVENTS.has(String(data.type))
      && eventLocalDate >= candidate.week.weekStart && eventLocalDate <= candidate.week.weekEnd) {
      return deny('EVOLUTION_UNLOCKED_PRIORITY', clock.timezone, clock.localDate);
    }
    if (data.type === 'PROGRAM_ADAPTED' && eventLocalDate === clock.localDate) {
      return deny('PROGRAM_UPDATED_PRIORITY', clock.timezone, clock.localDate);
    }
  }

  const latestLifecycle = await root.collection('workoutLifecycleState').doc('current').get();
  if (latestLifecycle.data()?.activeProgramInstanceId !== state.activeProgramInstanceId
    || latestLifecycle.data()?.updatedAt?.toMillis?.() !== state.updatedAt?.toMillis?.()) {
    return deny('LIFECYCLE_CHANGED', clock.timezone, clock.localDate);
  }
  return { allowed: true, timezone: clock.timezone, localDate: clock.localDate, candidate };
}
