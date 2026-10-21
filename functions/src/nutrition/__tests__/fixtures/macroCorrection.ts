import type { NutritionEngineOutput, NutritionProfile } from '../../shared/types/nutrition';
import type { FoodRestrictions, ParsedAiMealPlanOutput, RawAiFoodItem } from '../../generation/domain';
import { distributeMeals } from '../../shared/nutrition/engine/distributeMeals';

export const macroProfile: NutritionProfile = {
  questionnaireVersion: 1, nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'],
  dietaryPattern: 'omnivore', preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [],
  supplements: [], pregnant: false, breastfeeding: false, varietyPreference: 'indifferent', updatedAt: null,
};
export const macroDaily = { kcal: 1000, proteinG: 50, carbsG: 110, fatG: 40, fiberG: 14 };
export const macroEngine: NutritionEngineOutput = {
  eligible: true, blockers: [], energy: { rmrKcal: 900, tdeeKcal: 1100, targetKcal: 1000, safetyClampApplied: false },
  macros: { proteinG: 50, carbsG: 110, fatG: 40, fiberG: 14 },
  mealTargets: distributeMeals(macroProfile.mealSlots, macroDaily), calculationTrace: {},
  versions: { nutritionEngineVersion: '1.0.0', energyRulesVersion: '1.0.0', macroRulesVersion: '1.0.0',
    mealDistributionVersion: '1.0.0', questionnaireVersion: 1, foodCatalogVersion: 'unused' },
};
export function macroFood(scale = 1): RawAiFoodItem {
  return { name: 'Alimento sintético', ingredients: [{ name: 'Ingrediente sintético', origin: 'plant' }],
    quantity: 100, unit: 'g', preparationNote: '', allergens: [],
    estimatedNutrition: { kcal: 500 * scale, proteinG: 25 * scale, carbsG: 55 * scale,
      fatG: 20 * scale, fiberG: 7 * scale } };
}
export function macroPlan(): ParsedAiMealPlanOutput {
  return { meals: macroProfile.mealSlots.map((slot) => ({ slot, foods: [macroFood()] })) };
}
export interface MacroCase {
  name: string; plan: ParsedAiMealPlanOutput; allergens?: NutritionProfile['excludedAllergens']; restrictions?: FoodRestrictions;
}
export function macroCases(): MacroCase[] {
  const make = (name: string, mutate: (plan: ParsedAiMealPlanOutput) => void): MacroCase => {
    const plan = macroPlan(); mutate(plan); return { name, plan };
  };
  return [
    { name: 'already_valid', plan: macroPlan() },
    make('uniform_half', (p) => { p.meals.forEach((m) => { m.foods = [macroFood(0.5)]; }); }),
    make('non_calorie_factor', (p) => { p.meals[0].foods[0].estimatedNutrition.proteinG = 28; }),
    make('impossible_intersection', (p) => { p.meals[0].foods[0].estimatedNutrition.proteinG = 100; }),
    make('zero_protein', (p) => { p.meals[0].foods[0].estimatedNutrition.proteinG = 0; }),
    make('rounds_to_zero', (p) => { p.meals[0].foods = [{ ...macroFood(0.5), quantity: 0.001 }]; }),
    make('quantity_over_max', (p) => { p.meals[0].foods = [{ ...macroFood(0.5), quantity: 4000 }]; }),
    make('discrete_unrepresentable', (p) => { p.meals[0].foods = [{ ...macroFood(0.6), quantity: 1, unit: 'unidade' }]; }),
    make('ambiguous_unit', (p) => { p.meals[0].foods = [{ ...macroFood(0.5), unit: 'pacote especial' }]; }),
    { ...make('later_allergy', (p) => { p.meals[0].foods[0].estimatedNutrition.proteinG = 100;
      p.meals[1].foods[0].allergens = ['milk']; }), allergens: ['milk'] },
    { ...make('later_exclusion', (p) => { p.meals[0].foods[0].estimatedNutrition.proteinG = 100;
      p.meals[1].foods[0].name = 'Amendoim'; }), restrictions: { dietaryPattern: 'omnivore', excludedFoodNames: ['Amendoim'] } },
    { ...make('later_diet', (p) => { p.meals[0].foods[0].estimatedNutrition.proteinG = 100;
      p.meals[1].foods[0].ingredients[0].origin = 'dairy'; }), restrictions: { dietaryPattern: 'vegan', excludedFoodNames: [] } },
  ];
}
