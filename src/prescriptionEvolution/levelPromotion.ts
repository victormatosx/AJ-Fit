import type { Weekday } from '../state/AppState';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';
import type { QuestionnaireAnswers } from '../workoutPrescription/types';

export type LevelPromotionTarget = Extract<CurrentTrainingLevel, 'INTERMEDIATE' | 'ADVANCED'>;

function targetLevelToAnswersLevel(level: LevelPromotionTarget): NonNullable<QuestionnaireAnswers['level']> {
  return level === 'INTERMEDIATE' ? 'intermediate' : 'advanced';
}

/**
 * Builds a synthetic answers object for Level Promotion re-prescription —
 * a pure data transformation, never persisted back to the immutable
 * questionnaire (docs prescription/01 — the original `experienceLevel`
 * response is never overwritten; docs §10/§11).
 *
 * `pinnedFrequency`/`pinnedTrainingDays` MUST come from the CURRENT active
 * prescription's actual `prescribedTrainingFrequency`/availability, never
 * from raw questionnaire availability — promoting a level must never
 * silently increase weekly frequency (docs §12/§68/§69). Every other answer
 * (goal, place, equipment, duration, limitations, ...) is preserved as-is.
 */
export function buildLevelPromotionAnswers(input: {
  currentAnswers: QuestionnaireAnswers;
  targetLevel: LevelPromotionTarget;
  pinnedFrequency: number;
  pinnedTrainingDays: readonly Weekday[];
}): QuestionnaireAnswers {
  return {
    ...input.currentAnswers,
    level: targetLevelToAnswersLevel(input.targetLevel),
    days: input.pinnedFrequency,
    trainingDays: [...input.pinnedTrainingDays],
  };
}
