import { describe, expect, it } from 'vitest';
import { buildLevelPromotionAnswers } from '../../prescriptionEvolution/levelPromotion';
import { availableFrequenciesForLevel } from '../../onboarding/weeklyScheduleSelection';
import type { Weekday } from '../../state/AppState';
import { generateWorkoutPrescriptionRouted } from '../../workoutPrescription/generatePrescription';
import { buildPrescriptionInputSnapshot, effectivePrescriptionInputsFromAnswers } from '../prescriptionInputs';
import type { CurrentTrainingLevel } from '../types';

const WEEK: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Promotions the lifecycle can actually produce, and the level they start from. */
const PROMOTIONS = [
  { from: 'beginner', fromLevel: 'BEGINNER', to: 'INTERMEDIATE' },
  { from: 'intermediate', fromLevel: 'INTERMEDIATE', to: 'ADVANCED' },
] as const;

function answersFor(level: string, days: number) {
  return {
    sex: 'm', goal: 'gain_muscle', level, days, trainingDays: WEEK.slice(0, days),
    duration: '60', place: 'gym', equipment: [], style: [], muscleFocus: [],
    specialConditions: ['none'], scheduleMode: 'fixed',
    pregnancyScreening: null, postpartumScreening: null, functionalScreening: null,
    lipedemaScreening: null, dizzinessScreening: null, postSurgicalScreening: null,
    medicalRestrictionScreening: null,
  };
}

/** `currentLevelInput` in functions/src/workoutLifecycle/authorizeMutation.ts. */
function questionnaireLevelFor(level: CurrentTrainingLevel): string {
  return level.toLowerCase();
}

/**
 * Composes the REAL client PREPARE snapshot and the REAL shape the backend's
 * `assertSnapshot` rebuilds for LEVEL_PROMOTION, and compares them field by
 * field — the exact comparison that decides
 * `target_prescription_inputs_not_authoritative`.
 *
 * `evolvePrescription` pins the promoted plan to the active plan's
 * `prescribedTrainingFrequency` and its TRAINING weekdays, while the backend
 * rebuilds from the stored availability. Those two agree only while
 * availability and prescribed frequency are the same number — which is
 * precisely what the weekly-day bounds now guarantee for every selectable
 * schedule. This test is what proves the guarantee holds across the whole
 * reachable range, and would fail the moment a bound let them diverge again.
 */
describe('LEVEL_PROMOTION — the prepared snapshot matches the backend’s own', () => {
  it.each(PROMOTIONS)('$from -> $to, across every selectable frequency', ({ from, fromLevel, to }) => {
    const frequencies = availableFrequenciesForLevel(from as never);
    expect(frequencies.length).toBeGreaterThan(0);

    for (const days of frequencies) {
      const answers = answersFor(from, days);

      // INITIALIZE: what the ProgramInstance's prescriptionInputSnapshot holds.
      const sourceInputs = effectivePrescriptionInputsFromAnswers(
        answers as never, fromLevel as CurrentTrainingLevel,
      ) as unknown as Record<string, unknown>;

      // The active plan the promotion pins itself to.
      const plan = (generateWorkoutPrescriptionRouted(
        answers as never, fromLevel as never, {}, 'v1.27',
      ) as { plan?: { prescribedTrainingFrequency?: number; weeklySchedule?: { weekday: string; state: string }[] } }).plan!;
      const pinnedFrequency = plan.prescribedTrainingFrequency!;
      const pinnedTrainingDays = plan.weeklySchedule!
        .filter((entry) => entry.state === 'TRAINING').map((entry) => entry.weekday);

      // CLIENT (src/services/prescriptionEvolution.ts, LEVEL_PROMOTION branch).
      const clientInputs = buildPrescriptionInputSnapshot({
        answers: buildLevelPromotionAnswers({
          currentAnswers: answers as never,
          targetLevel: to as never,
          pinnedFrequency,
          pinnedTrainingDays: pinnedTrainingDays as never,
          scheduleMode: 'fixed',
        }),
        currentTrainingLevel: to as CurrentTrainingLevel,
        source: 'LEVEL_PROMOTION',
      }).inputs as unknown as Record<string, unknown>;

      // BACKEND (`assertSnapshot`): source inputs with only the level moved.
      const serverInputs: Record<string, unknown> = {
        ...sourceInputs,
        level: questionnaireLevelFor(to as CurrentTrainingLevel),
      };

      const keys = [...new Set([...Object.keys(serverInputs), ...Object.keys(clientInputs)])].sort();
      const divergent = keys.filter((key) =>
        JSON.stringify(serverInputs[key]) !== JSON.stringify(clientInputs[key]));
      expect(divergent, `${from}->${to} com ${days} dias divergiu em: ${divergent.join(', ')}`).toEqual([]);

      // And the reason it matches: the two numbers are the same.
      expect(pinnedFrequency).toBe(days);
      expect(pinnedTrainingDays).toHaveLength(days);
    }
  });
});
