import {
  calculateNutritionTargets,
  resolveGoalCategory,
} from '../../nutrition/engine';
import { isProfileDraftComplete, type ProfileDraft } from '../../nutrition/ui/profileSteps';
import type {
  NutritionGoal,
  NutritionGoalCategory,
  NutritionMealSlot,
  NutritionProfile,
} from '../../types/nutrition';
import type { Sex } from '../../state/AppState';

/**
 * What the Plan screen is allowed to say about the diet.
 *
 * The rule the prompt sets for this panel (§5.4) is that calories and macros
 * may only be shown if a pure function already computes them from the
 * onboarding answers **and is the same one the automatic diet generation
 * uses**. It is: `calculateNutritionTargets` in `src/nutrition/engine`, and
 * `functions/src/nutrition/shared/nutrition/engine` — the copy the Cloud
 * Function calls — is generated from it (identical but for a "do not edit"
 * banner). So the numbers here are the real targets, not a preview
 * approximation of them.
 *
 * Nothing in this module decides a nutrition rule. It assembles the engine's
 * documented input from answers already recorded, calls the engine, and
 * reports either the result or nothing at all. Every reason the engine might
 * refuse — an incomplete profile, a missing birth date, an ambiguous goal
 * without its category, a value outside the validator's bounds — resolves to
 * `targets: null`, and the panel then omits calories and macros entirely
 * rather than inventing a stand-in.
 */

export interface PlanDietPreview {
  /** The resolved nutrition category, or null when it cannot be resolved. */
  goalCategory: NutritionGoalCategory | null;
  mealSlots: NutritionMealSlot[];
  /** Real engine output, or null when the engine could not or would not run. */
  targets: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    /** Per-meal calorie targets, aligned to `mealSlots`. */
    mealKcal: { slot: NutritionMealSlot; kcal: number }[];
  } | null;
}

export interface PlanDietPreviewInput {
  goal: NutritionGoal | null | undefined;
  sex: Sex | null | undefined;
  heightCm: number | null | undefined;
  weightKg: number | null | undefined;
  birthDate: Date | null | undefined;
  /** Weekly training frequency, as already resolved by the prescription. */
  weeklyTrainingFrequency: number | null | undefined;
  draft: ProfileDraft;
}

/** Whole years, counted the same way the rest of the app counts them. */
function ageYearsAt(birthDate: Date, now: Date): number {
  const hadBirthday =
    now.getMonth() > birthDate.getMonth()
    || (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
  return now.getFullYear() - birthDate.getFullYear() - (hadBirthday ? 0 : 1);
}

export function resolvePlanDietPreview(
  input: PlanDietPreviewInput,
  now: Date = new Date(),
): PlanDietPreview {
  const { goal, draft } = input;
  const mealSlots = draft.mealSlots ?? [];

  // The category is cheap and independent of the physical context, so it can
  // still be shown when the full engine run is impossible.
  let goalCategory: NutritionGoalCategory | null = null;
  if (goal) {
    try {
      goalCategory = resolveGoalCategory(goal, draft);
    } catch {
      goalCategory = null;
    }
  }

  const empty: PlanDietPreview = { goalCategory, mealSlots, targets: null };

  if (!goal || !input.sex || !input.birthDate) return empty;
  if (!input.heightCm || !input.weightKg || !input.weeklyTrainingFrequency) return empty;
  // The questionnaire's own completeness rule, reused rather than restated.
  if (!isProfileDraftComplete(goal, draft)) return empty;

  const ageYears = ageYearsAt(input.birthDate, now);

  try {
    const output = calculateNutritionTargets({
      inherited: {
        sex: input.sex,
        ageYears,
        heightCm: input.heightCm,
        currentWeightKg: input.weightKg,
        goal,
      },
      workout: { weeklyTrainingFrequency: input.weeklyTrainingFrequency },
      // Complete by `isProfileDraftComplete` above; the engine's own
      // validator is still the final word and throws if it disagrees.
      nutritionProfile: draft as NutritionProfile,
    });

    return {
      goalCategory,
      mealSlots,
      targets: {
        kcal: Math.round(output.energy.targetKcal),
        proteinG: Math.round(output.macros.proteinG),
        carbsG: Math.round(output.macros.carbsG),
        fatG: Math.round(output.macros.fatG),
        mealKcal: output.mealTargets.map((meal) => ({
          slot: meal.slot,
          kcal: Math.round(meal.kcal.target),
        })),
      },
    };
  } catch {
    // The engine refusing is a real answer: show the panel without numbers.
    return empty;
  }
}

/**
 * Share of total calories each macro accounts for, for the three proportional
 * bars. Returns null when the macros do not add up to a usable total, so the
 * bars are omitted rather than drawn at an arbitrary length.
 */
export function macroCalorieShares(targets: {
  proteinG: number;
  carbsG: number;
  fatG: number;
}): { protein: number; carbs: number; fat: number } | null {
  // Atwater factors — the same 4/4/9 the engine's own allocation is built on.
  const proteinKcal = targets.proteinG * 4;
  const carbsKcal = targets.carbsG * 4;
  const fatKcal = targets.fatG * 9;
  const total = proteinKcal + carbsKcal + fatKcal;
  if (!Number.isFinite(total) || total <= 0) return null;
  return {
    protein: proteinKcal / total,
    carbs: carbsKcal / total,
    fat: fatKcal / total,
  };
}
