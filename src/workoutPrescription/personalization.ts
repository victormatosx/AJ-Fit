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

export function beginnerKeepFactor(stage: AdaptationStage): number {
  if (stage === 1) return 0.50;
  if (stage === 2) return 0.70;
  return 1;
}

export function durationKeepFactor(duration: QuestionnaireAnswers['duration']): number {
  if (duration === '30') return 0.60;
  if (duration === '45') return 0.80;
  return 1;
}
