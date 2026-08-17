import type { Question } from '../components/onboarding/QuestionRenderer';
import { MAX_MUSCLE_FOCUS, type OnboardingStepId } from './steps';

/**
 * Question structure/config for every funnel step whose id maps 1:1 to a
 * `Quiz` field. Copy lives in i18n (`quiz:${id}.*`), same lookup convention
 * the legacy QuizScreen used — nothing here is user-visible text.
 */
export const FUNNEL_QUESTIONS: Partial<Record<OnboardingStepId, Question>> = {
  motivation: {
    id: 'motivation',
    kind: 'choice-large',
    options: [
      { v: 'muscle', icon: 'dumbbell' },
      { v: 'leanDown', icon: 'flame' },
      { v: 'strength', icon: 'bolt' },
      { v: 'physique', icon: 'target' },
      { v: 'comeback', icon: 'heart' },
      { v: 'consistency', icon: 'chart' },
    ],
  },
  goal: {
    id: 'goal',
    kind: 'choice-large',
    options: [
      { v: 'hyper', icon: 'dumbbell' },
      { v: 'cut', icon: 'flame' },
      { v: 'perf', icon: 'bolt' },
      { v: 'def', icon: 'target' },
      { v: 'recon', icon: 'heart' },
    ],
  },
  level: {
    id: 'level',
    kind: 'choice-large',
    options: [{ v: 'beg' }, { v: 'int' }, { v: 'adv' }, { v: 'elite' }],
  },
  sex: { id: 'sex', kind: 'choice', options: [{ v: 'm' }, { v: 'f' }] },
  birthDate: { id: 'birthDate', kind: 'date', minAge: 16, maxAge: 75 },
  height: { id: 'height', kind: 'wheel', min: 140, max: 220, default: 178, digits: { min: 3, max: 3 } },
  weight: { id: 'weight', kind: 'wheel', min: 40, max: 180, default: 78, digits: { min: 2, max: 3 } },
  days: { id: 'days', kind: 'wheel', min: 2, max: 7, default: 4, digits: { min: 1, max: 1 } },
  duration: {
    id: 'duration',
    kind: 'choice',
    options: [{ v: '30' }, { v: '45' }, { v: '60' }, { v: '90' }],
  },
  place: {
    id: 'place',
    kind: 'choice-large',
    options: [
      { v: 'gym', icon: 'dumbbell' },
      { v: 'home', icon: 'heart' },
      { v: 'both', icon: 'bolt' },
    ],
  },
  limits: {
    id: 'limits',
    kind: 'multi',
    options: [
      { v: 'none' },
      { v: 'knee' },
      { v: 'back' },
      { v: 'shoulder' },
      { v: 'wrist' },
      { v: 'hip' },
    ],
  },
  muscleFocus: {
    id: 'muscleFocus',
    kind: 'multi',
    maxSelections: MAX_MUSCLE_FOCUS,
    options: [
      { v: 'chest' },
      { v: 'back' },
      { v: 'shoulders' },
      { v: 'arms' },
      { v: 'glutes' },
      { v: 'quads' },
      { v: 'hamstrings' },
      { v: 'calves' },
      { v: 'none' },
    ],
  },
  commitment: {
    id: 'commitment',
    kind: 'choice-large',
    options: [{ v: 'ownPace' }, { v: 'committed' }, { v: 'allIn' }],
  },
};
