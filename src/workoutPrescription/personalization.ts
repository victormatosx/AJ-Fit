import type { QuestionnaireAnswers } from './types';
import { normalizeExperience } from './input';

export type AdaptationStage = 1 | 2 | 3;

export function keepCount(total: number, factor: number): number {
  const normalizedTotal = Math.max(0, Math.trunc(total));
  if (normalizedTotal === 0) return 0;
  return Math.min(normalizedTotal, Math.max(1, Math.ceil(normalizedTotal * factor)));
}

export function adaptationStage(week: number | undefined): AdaptationStage {
  const normalizedWeek = Number.isFinite(week) ? Math.max(1, Math.trunc(week as number)) : 1;
  return normalizedWeek >= 3 ? 3 : normalizedWeek as AdaptationStage;
}

export function isBeginnerExperience(answers: QuestionnaireAnswers): boolean {
  return ['never_or_starting', 'beginner'].includes(normalizeExperience(answers.level) ?? '');
}

/**
 * Beginner adaptation reduces working-set volume, not exercise coverage.
 * Stage 1 caps each exercise at 2 working sets, stage 2 at 3, stage 3+
 * converges to the template's base volume. This deliberately never touches
 * exercise count — see composition.ts, which no longer derives a
 * beginner-specific `target` slot count.
 */
export function beginnerAdjustedSets(baseSets: number | undefined, stage: AdaptationStage): number | undefined {
  if (baseSets == null) return baseSets;
  if (stage === 1) return Math.min(baseSets, 2);
  if (stage === 2) return Math.min(baseSets, 3);
  return baseSets;
}

export function durationKeepFactor(duration: QuestionnaireAnswers['duration']): number {
  if (duration === '30') return 0.60;
  if (duration === '45') return 0.80;
  return 1;
}
