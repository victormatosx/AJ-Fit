import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The displayed adherence and the EARN decision must answer the same
 * question. They are computed by two different modules — the client's
 * `evaluateProgressionV2ForUserFull` and this file's
 * `authoritativeEarnedFactWithCycleHistory` — so nothing but a test keeps
 * them from drifting apart.
 *
 * Source inspection rather than execution: the authority is a Firestore
 * transaction inside a callable, and what needs pinning here is which rule it
 * applies, not arithmetic (that is covered exhaustively, and executably, in
 * `src/progressionEngineV2/__tests__/pilotWeeklyGoalAdherence.test.ts`).
 */
const AUTHORITY = readFileSync('src/workoutLifecycle/authorizeMutation.ts', 'utf8');
const CLIENT = readFileSync('../src/services/workoutProgressionV2.ts', 'utf8');

describe('the weekly goal has exactly one definition', () => {
  it('the authority imports it instead of inlining its own copy', () => {
    expect(AUTHORITY).toContain(
      "import { buildFlexibleWeeklyTargets } from './prescriptionEngine/progressionEngineV2/prescribedOpportunities';",
    );
    // The hand-inlined `min(prescribedFrequency, activeDays)` this file used
    // to carry is gone — that duplicate is what allowed the two sides to
    // disagree in the first place.
    expect(AUTHORITY).not.toContain('flexibleExpectedByWeek');
    expect(AUTHORITY).not.toContain('Math.min(prescribedFrequency, activeDays)');
  });

  it('the client reads the same function from the same module', () => {
    expect(CLIENT).toContain("from '../progressionEngineV2/prescribedOpportunities'");
    expect(CLIENT).toContain('buildFlexibleWeeklyTargets({');
  });

  it('both sides apply it to enrolled accounts regardless of scheduleMode', () => {
    expect(AUTHORITY).toContain("scheduleMode === 'flexible' || pilotEnrolled");
    expect(CLIENT).toContain("scheduleMode === 'flexible' || pilotEnrolled");
  });
});

describe('enrolment changes the question, never the rigour', () => {
  it('the recommended-weekday filter is skipped only for enrolled accounts', () => {
    expect(AUTHORITY).toContain(
      "if (scheduleMode === 'fixed' && !pilotEnrolled && !opportunityDates.has(execution.scheduledLocalDate)) continue;",
    );
  });

  it('the ledger and qualification guards still gate every counted day', () => {
    const loop = AUTHORITY.slice(
      AUTHORITY.indexOf('const fulfilled = new Set<string>();'),
      AUTHORITY.indexOf('const prescribedFrequency'),
    );
    expect(loop).toContain('completedLedger.has(key)');
    expect(loop).toContain('qualifyingExecution(execution, session, state.activeProgramInstanceId)');
  });

  it('counts DISTINCT DAYS for the pilot and leaves the legacy unit alone', () => {
    const block = AUTHORITY.slice(
      AUTHORITY.indexOf('let fulfilledCount = fulfilled.size;'),
      AUTHORITY.indexOf('const ratioBp'),
    );
    // A Set per week, so two sessions in one day collapse to one.
    expect(block).toContain('const countedByWeek = new Map<string, Set<string>>();');
    expect(block).toContain('const unit = pilotEnrolled ? trainedDay : key;');
    expect(block).toContain('mondayOf(pilotEnrolled ? trainedDay : scheduledDay)');
  });

  it('uses the day the effort happened, falling back to the scheduled day', () => {
    expect(AUTHORITY).toContain("typeof execution.performedLocalDate === 'string'");
  });
});

describe('enrolment is read safely', () => {
  it('is keyed by the authenticated uid and fails closed', () => {
    const read = AUTHORITY.slice(
      AUTHORITY.indexOf('firestore.collection(WORKOUT_PILOT_ENROLLMENT_COLLECTION)'),
      AUTHORITY.indexOf('const config = resolveProgressionV2Config'),
    );
    expect(read).toContain('.doc(uid).get()');
    expect(read).toContain('isWorkoutPilotEnrolled(');
    expect(read).toContain('.catch(() => false)');
  });

  it('shares the one predicate with every other enforcement surface', () => {
    expect(AUTHORITY).toContain(
      "import { WORKOUT_PILOT_ENROLLMENT_COLLECTION, isWorkoutPilotEnrolled } from './scheduleEngine/workoutPilot';",
    );
  });
});

describe('the progression contract is untouched', () => {
  it('the 70% earning threshold and the quality bands still come from config', () => {
    expect(AUTHORITY).toContain('ratioBp >= config.adherenceEarnedThresholdBp');
    expect(AUTHORITY).toContain('ratioBp >= config.adherenceHighThresholdBp');
    // No literal threshold was introduced alongside the change.
    expect(AUTHORITY).not.toContain('>= 7000');
  });

  it('the ratio is still fulfilled/expected in basis points, capped at 100%', () => {
    expect(AUTHORITY).toContain(
      'const ratioBp = expected === 0 ? 0 : Math.min(10_000, Math.floor(fulfilledCount * 10_000 / expected));',
    );
  });
});
