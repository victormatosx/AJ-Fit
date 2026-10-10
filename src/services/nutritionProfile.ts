import { doc, getDoc, runTransaction, updateDoc, deleteField, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  DIETARY_PATTERNS, NON_TRAINING_ACTIVITY_LEVELS, NUTRITION_GOAL_CATEGORIES,
  NUTRITION_MEAL_SLOTS, NUTRITION_PROGRESSION_PACES, NUTRITION_SUPPLEMENT_IDS, NUTRITION_FOOD_ALLERGENS,
  VARIETY_PREFERENCES, type NutritionProfile,
} from '../types/nutrition';

export type NutritionProfileAnswers = Omit<NutritionProfile<Timestamp>, 'updatedAt'>;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10 && new Set(value).size === value.length
    && value.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 120);
}

/** Mirrors the client-write Rules contract; physical AJ Fit fields are never serialized here. */
export function validateNutritionProfileAnswers(value: unknown): asserts value is NutritionProfileAnswers {
  if (!plainObject(value)) throw new Error('INVALID_NUTRITION_PROFILE');
  const required = ['questionnaireVersion', 'nonTrainingActivityLevel', 'mealSlots', 'dietaryPattern',
    'preferredFoodIds', 'usualFoodIds', 'excludedFoodIds', 'supplements', 'pregnant',
    'breastfeeding', 'varietyPreference'];
  const optional = ['progressionPace', 'targetWeightKg', 'nutritionGoalCategory', 'excludedAllergens'];
  if (!required.every((key) => key in value) || Object.keys(value).some((key) => ![...required, ...optional].includes(key))) throw new Error('INVALID_NUTRITION_PROFILE');
  if (!Number.isInteger(value.questionnaireVersion) || (value.questionnaireVersion as number) < 1 || (value.questionnaireVersion as number) > 100
    || !NON_TRAINING_ACTIVITY_LEVELS.includes(value.nonTrainingActivityLevel as typeof NON_TRAINING_ACTIVITY_LEVELS[number])
    || !DIETARY_PATTERNS.includes(value.dietaryPattern as typeof DIETARY_PATTERNS[number])
    || !VARIETY_PREFERENCES.includes(value.varietyPreference as typeof VARIETY_PREFERENCES[number])
    || typeof value.pregnant !== 'boolean' || typeof value.breastfeeding !== 'boolean') throw new Error('INVALID_NUTRITION_PROFILE');
  if (!Array.isArray(value.mealSlots) || value.mealSlots.length < 2 || value.mealSlots.length > 6
    || new Set(value.mealSlots).size !== value.mealSlots.length
    || !value.mealSlots.every((slot: unknown) => NUTRITION_MEAL_SLOTS.includes(slot as typeof NUTRITION_MEAL_SLOTS[number]))) throw new Error('INVALID_NUTRITION_PROFILE');
  if (!validIds(value.preferredFoodIds) || !validIds(value.usualFoodIds) || !validIds(value.excludedFoodIds)
    || !Array.isArray(value.supplements) || value.supplements.length > NUTRITION_SUPPLEMENT_IDS.length
    || new Set(value.supplements).size !== value.supplements.length
    || !value.supplements.every((id: unknown) => NUTRITION_SUPPLEMENT_IDS.includes(id as typeof NUTRITION_SUPPLEMENT_IDS[number]))) throw new Error('INVALID_NUTRITION_PROFILE');
  if ('progressionPace' in value && !NUTRITION_PROGRESSION_PACES.includes(value.progressionPace as typeof NUTRITION_PROGRESSION_PACES[number])) throw new Error('INVALID_NUTRITION_PROFILE');
  if ('excludedAllergens' in value && (!Array.isArray(value.excludedAllergens)
    || value.excludedAllergens.length > NUTRITION_FOOD_ALLERGENS.length
    || new Set(value.excludedAllergens).size !== value.excludedAllergens.length
    || !value.excludedAllergens.every((item: unknown) => NUTRITION_FOOD_ALLERGENS.includes(item as typeof NUTRITION_FOOD_ALLERGENS[number])))) throw new Error('INVALID_NUTRITION_PROFILE');
  if ('nutritionGoalCategory' in value && !NUTRITION_GOAL_CATEGORIES.includes(value.nutritionGoalCategory as typeof NUTRITION_GOAL_CATEGORIES[number])) throw new Error('INVALID_NUTRITION_PROFILE');
  if ('targetWeightKg' in value && value.targetWeightKg !== null
    && (typeof value.targetWeightKg !== 'number' || !Number.isFinite(value.targetWeightKg) || value.targetWeightKg <= 0 || value.targetWeightKg > 500)) throw new Error('INVALID_NUTRITION_PROFILE');
}

export function serializeNutritionProfileAnswers(answers: NutritionProfileAnswers): Record<string, unknown> {
  validateNutritionProfileAnswers(answers);
  return { ...answers, mealSlots: [...answers.mealSlots], preferredFoodIds: [...answers.preferredFoodIds],
    usualFoodIds: [...answers.usualFoodIds], excludedFoodIds: [...answers.excludedFoodIds],
    supplements: [...answers.supplements],
    ...(answers.excludedAllergens ? { excludedAllergens: [...answers.excludedAllergens] } : {}),
    updatedAt: serverTimestamp() };
}

function profileRef(uid: string) { return doc(db, 'users', uid, 'nutritionProfile', 'current'); }

export async function loadNutritionProfile(uid: string): Promise<NutritionProfile<Timestamp> | null> {
  const snapshot = await getDoc(profileRef(uid));
  return snapshot.exists() ? snapshot.data() as NutritionProfile<Timestamp> : null;
}

export async function createNutritionProfile(uid: string, answers: NutritionProfileAnswers): Promise<void> {
  const serialized = serializeNutritionProfileAnswers(answers);
  await runTransaction(db, async (transaction) => {
    const ref = profileRef(uid);
    if ((await transaction.get(ref)).exists()) throw new Error('NUTRITION_PROFILE_ALREADY_EXISTS');
    transaction.set(ref, serialized);
  });
}

export async function updateNutritionProfile(uid: string, answers: NutritionProfileAnswers): Promise<void> {
  const serialized = serializeNutritionProfileAnswers(answers);
  for (const key of ['progressionPace', 'targetWeightKg', 'nutritionGoalCategory', 'excludedAllergens'] as const) {
    if (!(key in answers)) serialized[key] = deleteField();
  }
  await updateDoc(profileRef(uid), serialized);
}
