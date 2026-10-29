import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * One adherence rule, three surfaces.
 *
 * The number the user SEES (`src/services/workoutProgressionV2.ts`), the one
 * the EARN authority enforces (`authorizeMutation.ts`) and the one the
 * evolution-approaching notification gates on
 * (`notifications/evolutionApproachingContext.ts`) are computed by three
 * different orchestrators. Before this change they applied three different
 * rules: enrolled accounts got weekly trained days, flexible accounts got
 * weekly `(date, session)` opportunities, every other fixed account got
 * weekday-identity opportunities — and the notification observer did not even
 * know the pilot existed, so it scored every fixed account on weekday
 * identity regardless.
 *
 * Nothing but a test keeps them from drifting again, so this file pins two
 * things: that each surface IMPORTS the shared rule instead of carrying its
 * own, and that the generated backend copy of that rule is byte-identical to
 * the client source. The arithmetic itself is covered exhaustively (and
 * executably) in `src/progressionEngineV2/__tests__/cycleProgression.test.ts`.
 */

const AUTHORITY = readFileSync('src/workoutLifecycle/authorizeMutation.ts', 'utf8');
const NOTIFICATION = readFileSync('src/notifications/evolutionApproachingContext.ts', 'utf8');
const CLIENT = readFileSync('../src/services/workoutProgressionV2.ts', 'utf8');
const WINDOW_LOADER = readFileSync('src/workoutLifecycle/cycleProgressionWindow.ts', 'utf8');
const EARN_PERSISTENCE = readFileSync('../src/services/workoutLifecycleApplication.ts', 'utf8');
const GENERATED_HEADER_LINES = 3;

/** The synced engine modules the unified rule is made of. */
const SYNCED_MODULES = [
  'cycleProgression', 'activeTime', 'prescribedOpportunities',
  'sessionQualification', 'adherence', 'config', 'resolver',
] as const;

function generatedCopy(module: string): string {
  const raw = readFileSync(`src/workoutLifecycle/prescriptionEngine/progressionEngineV2/${module}.ts`, 'utf8');
  return raw.split('\n').slice(GENERATED_HEADER_LINES).join('\n');
}

describe('the rule has exactly one definition', () => {
  it.each(SYNCED_MODULES)('the backend copy of %s is byte-identical to the client source', (module) => {
    expect(generatedCopy(module)).toBe(
      readFileSync(`../src/progressionEngineV2/${module}.ts`, 'utf8'),
    );
  });

  it.each(['calendarWeek', 'weeklyFrequency'] as const)(
    'the historical weekly-goal reconstruction (%s) is synced, not reimplemented',
    (module) => {
      const raw = readFileSync(`src/workoutLifecycle/prescriptionEngine/home/${module}.ts`, 'utf8');
      expect(raw.split('\n').slice(GENERATED_HEADER_LINES).join('\n')).toBe(
        readFileSync(`../src/home/${module}.ts`, 'utf8'),
      );
    },
  );

  it('every surface imports computeCycleProgression', () => {
    expect(CLIENT).toContain("from '../progressionEngineV2/cycleProgression'");
    expect(CLIENT).toContain('computeCycleProgression({');
    expect(AUTHORITY).toContain("from './prescriptionEngine/progressionEngineV2/cycleProgression'");
    expect(AUTHORITY).toContain('computeCycleProgression({');
    expect(NOTIFICATION).toContain("from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/cycleProgression'");
    expect(NOTIFICATION).toContain('computeCycleProgression({');
  });

  it('no surface still carries an inline active-time walk or weekly-goal copy', () => {
    for (const [name, source] of [['authority', AUTHORITY], ['client', CLIENT], ['notification', NOTIFICATION]] as const) {
      expect(source, name).not.toContain('inactivityMissedOpportunityThreshold');
      expect(source, name).not.toContain('Math.min(prescribedFrequency, activeDays)');
      expect(source, name).not.toContain('flexibleExpectedByWeek');
      expect(source, name).not.toContain('buildFlexibleWeeklyTargets');
      expect(source, name).not.toContain('countFulfilledPrescribedOpportunities');
      expect(source, name).not.toContain('countFulfilledFlexibleWeeklyTargets');
      expect(source, name).not.toContain('buildPrescribedOpportunities');
    }
  });
});

describe('enrolment no longer selects an adherence rule', () => {
  it('neither the authority nor the client reads pilot enrolment to score adherence', () => {
    expect(AUTHORITY).not.toContain('WORKOUT_PILOT_ENROLLMENT_COLLECTION');
    expect(AUTHORITY).not.toContain('pilotEnrolled');
    expect(CLIENT).not.toContain('loadWorkoutPilotEnrollment');
    expect(CLIENT).not.toContain('pilotEnrolled');
  });

  it('keeps the pilot wired where it governs the EXPERIENCE, not the score', () => {
    // Removing enrolment from the adherence choice must not uninstall the
    // feature: session suggestion and finalization still read it.
    const finalize = readFileSync('src/workoutLifecycle/finalizeWorkoutSession.ts', 'utf8');
    expect(finalize).toContain('WORKOUT_PILOT_ENROLLMENT_COLLECTION');
    const schedule = readFileSync('../src/scheduleEngine/useWorkoutSchedule.ts', 'utf8');
    expect(schedule).toContain('loadWorkoutPilotEnrollment');
  });

  it('no surface branches adherence on scheduleMode any more', () => {
    expect(AUTHORITY).not.toContain("scheduleMode === 'flexible' || pilotEnrolled");
    // `scheduleMode` survives in the authority only for SCHEDULING decisions
    // (cursor advance, miss resolution) — never inside the earned fact.
    const earnedFact = AUTHORITY.slice(
      AUTHORITY.indexOf('async function authoritativeEarnedFactWithCycleHistory'),
      AUTHORITY.indexOf('export async function authoritativeEarnedFact('),
    );
    expect(earnedFact).not.toContain("scheduleMode === 'fixed'");
    expect(earnedFact).not.toContain("scheduleMode === 'flexible'");
  });
});

describe('the window is the TrainingCycle, not the active ProgramInstance', () => {
  it('both server surfaces read the window through the ONE shared loader', () => {
    // The query itself lives in exactly one place, so the EARN authority and
    // the evolution-approaching observer can never scope it differently —
    // which is what made the observer report 0% adherence after an ADAPT for
    // a user the authority was promoting.
    expect(WINDOW_LOADER).toContain("where('cycleId', '==', input.currentCycleId)");
    expect(AUTHORITY).toContain("from './cycleProgressionWindow'");
    expect(AUTHORITY).toContain('loadCycleProgressionWindow({');
    expect(NOTIFICATION).toContain("from '../workoutLifecycle/cycleProgressionWindow'");
    expect(NOTIFICATION).toContain('loadCycleProgressionWindow({');
    // Neither surface keeps its own instance query any more.
    expect(AUTHORITY).not.toContain("where('cycleId'");
    expect(NOTIFICATION).not.toContain("where('cycleId'");
    // ...and the authority never anchors the window on the active instance.
    const earnedFact = AUTHORITY.slice(
      AUTHORITY.indexOf('async function authoritativeEarnedFactWithCycleHistory'),
      AUTHORITY.indexOf('export async function authoritativeEarnedFact('),
    );
    expect(earnedFact).not.toContain('instance.activatedAt as Timestamp');
  });

  it('the observer no longer scopes its history to the active instance', () => {
    expect(NOTIFICATION).not.toContain(
      "root.collection('workoutExecutions')\n      .where('programInstanceId', '==', state.activeProgramInstanceId)",
    );
    expect(NOTIFICATION).toContain('windows: cycleWindow.windows');
  });

  it('the client reads every instance of the current cycle', () => {
    expect(CLIENT).toContain('listProgramInstancesForCycle');
    expect(CLIENT).toContain('listExecutionsForProgramInstances');
    expect(CLIENT).toContain('listScheduleEventsForCycle');
  });

  it('an oversized cycle history fails closed instead of earning off a partial window', () => {
    expect(AUTHORITY).toContain('progression_cycle_history_too_large');
    expect(AUTHORITY).toContain('progression_cycle_window_unavailable');
  });
});

describe('the progression contract is untouched', () => {
  it('the 70% earning threshold and the quality bands still come from config', () => {
    expect(AUTHORITY).toContain('ratioBp >= config.adherenceEarnedThresholdBp');
    expect(AUTHORITY).toContain('ratioBp >= config.adherenceHighThresholdBp');
    expect(AUTHORITY).not.toContain('>= 7000');
  });

  it('adherence in basis points has ONE integer definition, used by both sides', () => {
    // The client used to transport `Math.round(ratio * 10000)` from a float
    // division while the authority computed `Math.floor(valid * 10000 /
    // expected)`. They differ by 1 bp on 47.9% of eligible pairs, and the
    // authority rejected the mismatch as a forged fact.
    expect(AUTHORITY).toContain('const ratioBp = progression.adherenceAtEarnBp;');
    const engine = readFileSync('src/workoutLifecycle/prescriptionEngine/progressionEngineV2/adherence.ts', 'utf8');
    expect(engine).toContain('export function adherenceBasisPoints(');
    expect(engine).toContain("Math.min(10_000, Math.floor(validSessionCount * 10_000 / expectedSessions))");
    // No surface re-derives it.
    for (const [name, source] of [
      ['authority', AUTHORITY], ['client', CLIENT],
      ['notification', NOTIFICATION], ['earn persistence', EARN_PERSISTENCE],
    ] as const) {
      expect(source, name).not.toContain('* 10000)');
      expect(source, name).not.toContain('* 10_000)');
      expect(source, name).not.toMatch(/Math\.round\([^)]*ratio/);
    }
  });

  it('an IN_PROGRESS execution still blocks a decision server-side', () => {
    expect(AUTHORITY).toContain('progression_blocked_by_in_progress_execution');
  });

  it('the IN_PROGRESS block stays scoped to the ACTIVE instance on both sides', () => {
    // Widening it to the cycle would let one stale, never-terminalized
    // execution on a superseded instance block progression forever.
    expect(AUTHORITY).toContain("item.status === 'IN_PROGRESS' && item.programInstanceId === state.activeProgramInstanceId");
    expect(CLIENT).toContain("execution.status === 'IN_PROGRESS'");
    expect(CLIENT).toContain('execution.programInstanceId === bundle.programInstance.programInstanceId');
  });

  it('the server never consults a client-supplied adherence figure', () => {
    const earnedFact = AUTHORITY.slice(
      AUTHORITY.indexOf('async function authoritativeEarnedFactWithCycleHistory'),
      AUTHORITY.indexOf('export async function authoritativeEarnedFact('),
    );
    expect(earnedFact).not.toContain('request.');
  });
});

describe('the EARN fact is authored by the server, not validated against the client', () => {
  it('the authority ignores client-sent counters and compares only the transition identity', () => {
    const earnBranch = AUTHORITY.slice(
      AUTHORITY.indexOf("if (request.operation === 'EARN') {"),
      AUTHORITY.indexOf('let contentCanonical'),
    );
    // The byte-for-byte comparison that made two honest builds mutually
    // exclusive is gone...
    expect(earnBranch).not.toContain('canonical(request.earnedFact)');
    expect(earnBranch).not.toContain('forged_earned_fact');
    // ...replaced by an identity-only check.
    expect(earnBranch).toContain("for (const field of ['type', 'fromLevel', 'toLevel'] as const)");
    expect(earnBranch).toContain('earned_fact_transition_mismatch');
    // The decision itself is still a full server recomputation.
    expect(earnBranch).toContain('await authoritativeEarnedFact(uid, firestore, new Date())');
    // And the event identity is still strictly validated when supplied.
    expect(earnBranch).toContain('forged_earned_event_identity');
  });

  it('the client sends no counters at all and persists the grant values', () => {
    const persist = EARN_PERSISTENCE.slice(
      EARN_PERSISTENCE.indexOf('async function persistEarnedFact('),
      EARN_PERSISTENCE.indexOf('export async function prepareEvolution'),
    );
    expect(persist).toContain('earnedFact: { type: input.type }');
    expect(persist).not.toContain('sessionsCompletedAtEarn: input.');
    expect(persist).not.toContain('adherenceAtEarnBp: input.');
    // Everything written to the immutable ledger comes from the grant.
    expect(persist).toContain('const authoritativeFact = earned.fact;');
    expect(persist).toContain('sessionsCompletedAtEarn: authoritativeFact.sessionsCompletedAtEarn');
    expect(persist).toContain('adherenceAtEarnBp: authoritativeFact.adherenceAtEarnBp');
    expect(persist).toContain('eventId: earned.eventId');
    expect(persist).toContain('idempotencyKey: earned.idempotencyKey');
  });

  it('Firestore Rules still bind the persisted payload to the grant', () => {
    // This is what makes ignoring the client's numbers safe: the Rules refuse
    // any ledger payload that disagrees with the server's grant.
    const rules = readFileSync('../firestore.rules', 'utf8');
    for (const field of [
      'type', 'fromLevel', 'toLevel', 'quality', 'sessionsCompletedAtEarn', 'adherenceAtEarnBp',
    ]) {
      expect(rules).toContain(`lifecycleAuthorityGrant(userId).authoritativeEarnedFact.${field}`);
    }
  });
});

describe('the inactivity policy never reinterprets a closed history', () => {
  it('the threshold is resolved per day from the window in force then', () => {
    const engine = readFileSync(
      'src/workoutLifecycle/prescriptionEngine/progressionEngineV2/cycleProgression.ts', 'utf8');
    expect(engine).toContain('export function cycleInactivityDayThresholdAt(');
    // The cycle-wide minimum — which let a later ADAPT un-pause old silence —
    // is gone.
    expect(engine).not.toContain('cycleInactivityDayThreshold(');
    expect(engine).toContain('inactivityDayThresholdAt');
    expect(engine).toContain('windowInForceOn(');
    // The walk must consult the per-day resolver, never a scalar.
    const activeTime = readFileSync(
      'src/workoutLifecycle/prescriptionEngine/progressionEngineV2/activeTime.ts', 'utf8');
    expect(activeTime).toContain('const threshold = thresholdAt(cursor);');
  });

  it('client and authority resolve the same timezone, never device vs UTC', () => {
    const localDate = readFileSync(
      'src/workoutLifecycle/prescriptionEngine/scheduleEngine/localDate.ts', 'utf8');
    expect(localDate).toContain('export function progressionTimezone(');
    expect(CLIENT).toContain('progressionTimezone(config?.timezone)');
    expect(CLIENT).not.toContain('deviceTimezone');
  });

  it('both sides fail closed on an over-long cycle history', () => {
    expect(AUTHORITY).toContain('progression_cycle_history_too_large');
    expect(CLIENT).toContain('cycle_progression_history_too_large');
    expect(CLIENT).toContain('if (cycleInstances.truncated) {');
  });
});
