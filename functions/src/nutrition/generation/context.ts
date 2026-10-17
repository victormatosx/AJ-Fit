import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  DIETARY_PATTERNS, NON_TRAINING_ACTIVITY_LEVELS, NUTRITION_MEAL_SLOTS, NUTRITION_FOOD_ALLERGENS,
  NUTRITION_SUPPLEMENT_IDS, NUTRITION_PROGRESSION_PACES, NUTRITION_GOAL_CATEGORIES,
  VARIETY_PREFERENCES, type NutritionEngineInput, type NutritionProfile,
  type NutritionPhysicalContext,
} from '../shared/types/nutrition';
import { calculateNutritionTargets } from '../shared/nutrition/engine';

function validProfile(value: unknown): value is NutritionProfile<Timestamp> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  const required = ['questionnaireVersion', 'nonTrainingActivityLevel', 'mealSlots', 'dietaryPattern',
    'preferredFoodIds', 'usualFoodIds', 'excludedFoodIds', 'supplements', 'pregnant',
    'breastfeeding', 'varietyPreference', 'updatedAt'];
  const optional = ['progressionPace', 'targetWeightKg', 'nutritionGoalCategory', 'excludedAllergens'];
  return required.every((key) => key in p)
    && Object.keys(p).every((key) => [...required, ...optional].includes(key))
    && typeof p.pregnant === 'boolean' && typeof p.breastfeeding === 'boolean'
    && Number.isInteger(p.questionnaireVersion) && (p.questionnaireVersion as number) >= 1
    && (p.questionnaireVersion as number) <= 100 && p.updatedAt instanceof Timestamp
    && NON_TRAINING_ACTIVITY_LEVELS.includes(p.nonTrainingActivityLevel as typeof NON_TRAINING_ACTIVITY_LEVELS[number])
    && DIETARY_PATTERNS.includes(p.dietaryPattern as typeof DIETARY_PATTERNS[number])
    && VARIETY_PREFERENCES.includes(p.varietyPreference as typeof VARIETY_PREFERENCES[number])
    && Array.isArray(p.mealSlots) && p.mealSlots.length >= 2 && p.mealSlots.length <= 6
    && new Set(p.mealSlots).size === p.mealSlots.length
    && p.mealSlots.every((slot: unknown) => NUTRITION_MEAL_SLOTS.includes(slot as typeof NUTRITION_MEAL_SLOTS[number]))
    && Array.isArray(p.supplements) && p.supplements.length <= NUTRITION_SUPPLEMENT_IDS.length
    && new Set(p.supplements).size === p.supplements.length
    && p.supplements.every((item: unknown) => NUTRITION_SUPPLEMENT_IDS.includes(item as typeof NUTRITION_SUPPLEMENT_IDS[number]))
    && (p.progressionPace === undefined || NUTRITION_PROGRESSION_PACES.includes(p.progressionPace as typeof NUTRITION_PROGRESSION_PACES[number]))
    && (p.nutritionGoalCategory === undefined || NUTRITION_GOAL_CATEGORIES.includes(p.nutritionGoalCategory as typeof NUTRITION_GOAL_CATEGORIES[number]))
    && (p.targetWeightKg === undefined || p.targetWeightKg === null
      || (typeof p.targetWeightKg === 'number' && Number.isFinite(p.targetWeightKg)
        && p.targetWeightKg > 0 && p.targetWeightKg <= 500))
    && (p.excludedAllergens === undefined || (Array.isArray(p.excludedAllergens)
      && p.excludedAllergens.length <= NUTRITION_FOOD_ALLERGENS.length
      && new Set(p.excludedAllergens).size === p.excludedAllergens.length
      && p.excludedAllergens.every((item: unknown) => NUTRITION_FOOD_ALLERGENS.includes(item as typeof NUTRITION_FOOD_ALLERGENS[number]))))
    && ['preferredFoodIds', 'usualFoodIds', 'excludedFoodIds'].every((key) => Array.isArray(p[key])
      && (p[key] as unknown[]).length <= 10
      && new Set(p[key] as unknown[]).size === (p[key] as unknown[]).length
      && (p[key] as unknown[]).every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120));
}
function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}
function validFrequency(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7;
}
export function resolveBackendWorkoutFrequency(
  program: Record<string, unknown> | null, quizDays: unknown,
): number {
  if (program) {
    if (validFrequency(program.prescribedTrainingFrequency)) return program.prescribedTrainingFrequency;
    if (validFrequency(program.prescribedStructuredDays)) return program.prescribedStructuredDays;
    return 0;
  }
  return validFrequency(quizDays) ? quizDays : 0;
}
function validWeightKg(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
/**
 * Weight source priority for Nutrition — fixes a brand-new account with no
 * physical assessment yet being blocked despite having already answered
 * weight in the initial questionnaire. The most recent assessment always
 * wins when present and valid; the questionnaire's own weight is only a
 * read-only fallback (never copied back into `assessments`) when no
 * assessment exists or its value fails the exact same validity check used
 * for the final resolved value — this function changes nothing about the
 * Engine/targets/macros, it only decides which raw number reaches them.
 */
export function resolveNutritionWeightKg(
  assessmentWeightKg: unknown, questionnaireWeightKg: unknown,
): { weightKg: unknown; source: 'assessment' | 'questionnaire' } {
  if (validWeightKg(assessmentWeightKg)) return { weightKg: assessmentWeightKg, source: 'assessment' };
  return { weightKg: questionnaireWeightKg, source: 'questionnaire' };
}

export async function loadGenerationContext(db: Firestore, uid: string, now = new Date()) {
  const user = db.collection('users').doc(uid);
  const [profileDoc, nutritionDoc, questionnaireQuery, assessmentQuery, lifecycleDoc] = await Promise.all([
    user.get(), user.collection('nutritionProfile').doc('current').get(),
    user.collection('questionnaires').orderBy('createdAt', 'desc').limit(1).get(),
    user.collection('assessments').orderBy('measuredAt', 'desc').orderBy('createdAt', 'desc').limit(1).get(),
    user.collection('workoutLifecycleState').doc('current').get(),
  ]);
  const profile = nutritionDoc.data();
  if (!validProfile(profile)) throw new HttpsError('failed-precondition', 'INVALID_NUTRITION_PROFILE');
  const quizDoc = questionnaireQuery.docs[0];
  const quiz = quizDoc?.data().answers as Record<string, unknown> | undefined;
  const userProfile = profileDoc.data()?.profile as Record<string, unknown> | undefined;
  const birthDate = asDate(userProfile?.birthDate) ?? asDate(quiz?.birthDate);
  const heightCm = typeof userProfile?.height === 'number' && userProfile.height > 0 ? userProfile.height : quiz?.height;
  const { weightKg, source: weightSource } = resolveNutritionWeightKg(assessmentQuery.docs[0]?.data().weight, quiz?.weight);
  const ageYears = birthDate ? now.getFullYear() - birthDate.getFullYear()
    - (now.getMonth() < birthDate.getMonth() || (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate()) ? 1 : 0) : NaN;
  if (!birthDate || !Number.isFinite(ageYears) || ageYears < 18 || ageYears > 100
    || typeof heightCm !== 'number' || !Number.isFinite(heightCm) || heightCm <= 0
    || typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0
    || (quiz?.sex !== 'm' && quiz?.sex !== 'f') || typeof quiz.goal !== 'string') {
    throw new HttpsError('failed-precondition', 'INVALID_PHYSICAL_CONTEXT');
  }
  const physical: NutritionPhysicalContext<Timestamp> = {
    sex: quiz.sex, birthDate: Timestamp.fromDate(birthDate), ageYears, heightCm, weightKg,
    goal: quiz.goal as NutritionPhysicalContext['goal'],
    sources: { birthDate: asDate(userProfile?.birthDate) ? 'profile' : 'questionnaire',
      height: typeof userProfile?.height === 'number' && userProfile.height > 0 ? 'profile' : 'questionnaire',
      weight: weightSource, sex: 'questionnaire', goal: 'questionnaire' },
  };
  const lifecycleIdentity = lifecycleDoc.data()?.lifecycle?.activeContentIdentity
    ?? lifecycleDoc.data()?.activeContentIdentity;
  const pointer = lifecycleDoc.exists ? null : await user.collection('workoutProgramState').doc('active').get();
  const programId = typeof lifecycleIdentity === 'string' ? lifecycleIdentity : pointer?.data()?.programId;
  const program = typeof programId === 'string' && programId
    ? await user.collection('workoutPrograms').doc(programId).get() : null;
  if (program && !program.exists) throw new HttpsError('failed-precondition', 'INVALID_WORKOUT_CONTEXT');
  const input: NutritionEngineInput = {
    inherited: { sex: physical.sex, ageYears, heightCm, currentWeightKg: weightKg, goal: physical.goal },
    workout: { weeklyTrainingFrequency: resolveBackendWorkoutFrequency(program?.data() ?? null, quiz?.days) },
    nutritionProfile: profile,
  };
  let engine;
  try { engine = calculateNutritionTargets(input); }
  catch { throw new HttpsError('failed-precondition', 'INVALID_NUTRITION_CONTEXT'); }
  return { profile, physical, input, engine, questionnaireVersion: profile.questionnaireVersion };
}
