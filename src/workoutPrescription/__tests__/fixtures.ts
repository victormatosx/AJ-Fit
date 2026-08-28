import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { defaultQuiz, type Quiz } from '../../state/AppState';
import type { LimitationCatalogExercise } from '../limitationResolver';
import type { CanonicalTemplate } from '../types';

type TechnicalArtifact = {
  profiles: Array<{ exerciseId: string; limitationProfile: unknown }>;
};

const technicalArtifact = JSON.parse(readFileSync(join(
  process.cwd(),
  'docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json',
), 'utf8')) as TechnicalArtifact;
const limitationProfileById = new Map(
  technicalArtifact.profiles.map((entry) => [entry.exerciseId, entry.limitationProfile]),
);

export function realLimitationCatalogFixture(): LimitationCatalogExercise[] {
  return EXERCISES_SEED.map((exercise) => ({
    ...exercise,
    limitationProfile: limitationProfileById.get(exercise.id),
  }));
}

export function completeAnswers(overrides: Partial<Quiz> = {}): Quiz {
  return {
    ...defaultQuiz,
    sex: 'm',
    goal: 'gain_muscle',
    level: 'intermediate',
    days: 4,
    duration: '60',
    place: 'gym',
    specialConditions: ['none'],
    ...overrides,
  };
}

export function answersForTemplate(template: CanonicalTemplate): Quiz {
  const goal = template.profile.primary_goal === 'strength'
    ? 'strength'
    : template.profile.primary_goal === 'conditioning'
      ? 'conditioning'
      : 'gain_muscle';
  const specialConditions: Quiz['specialConditions'] =
    template.profile.special_population === 'pregnancy' ? ['pregnancy']
      : template.profile.special_population === 'postpartum' ? ['postpartum']
        : template.profile.special_population === 'frailty' ? ['functional_limitation']
          : ['none'];
  return completeAnswers({
    sex: template.profile.sex === 'male' ? 'm' : 'f',
    goal,
    level: template.profile.days_per_week >= 6 ? 'advanced' : 'intermediate',
    days: template.profile.days_per_week,
    place: template.profile.environment,
    equipment: template.profile.environment === 'home'
      ? ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell']
      : [],
    specialConditions,
    pregnancyScreening: template.profile.special_population === 'pregnancy'
      ? { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] }
      : null,
    postpartumScreening: template.profile.special_population === 'postpartum'
      ? { timeSinceBirth: '3_6_months', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'yes' }
      : null,
    functionalScreening: template.profile.special_population === 'frailty'
      ? { situations: ['stairs_difficulty'] }
      : null,
  });
}
