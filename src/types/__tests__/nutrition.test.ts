import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { NutritionGoalCategory, NutritionProfile } from '../nutrition';
import {
  DIETARY_PATTERNS,
  NON_TRAINING_ACTIVITY_LEVELS,
  NUTRITION_AMBIGUOUS_GOALS,
  NUTRITION_ELIGIBILITY_BLOCKERS,
  NUTRITION_GENERATION_OPERATION_TYPES,
  NUTRITION_GOAL_CATEGORIES,
  NUTRITION_GOAL_CATEGORY_MAP,
  NUTRITION_LOGGED_FOOD_SOURCES,
  NUTRITION_MEAL_SLOTS,
  NUTRITION_PROGRESSION_PACES,
  NUTRITION_SUPPLEMENT_IDS,
  VARIETY_PREFERENCES,
} from '../nutrition';

/**
 * Regression guard against the TS unions silently drifting from
 * `canonical/questionnaire.json` / `canonical/nutrition_constraints.json` —
 * the whole point of `src/types/nutrition.ts` following canonical enums
 * exactly. Reads the real JSON files rather than hardcoding a second copy
 * of their values, so a future edit to canonical that isn't mirrored here
 * fails loudly instead of silently diverging.
 */

type QuestionnaireQuestion = { id: string; options?: string[] };
type QuestionnaireFile = { questions: QuestionnaireQuestion[] };
type ConstraintsFile = {
  eligibility: { blockingGates: string[] };
  diary: { loggedItemSources: string[] };
};
type RulesFile = {
  goals: {
    allowed: string[];
    normalization: {
      mapping: Record<string, string>;
      ambiguous: { status: string; values: string[] };
    };
  };
  generation: { operationTypes: string[] };
};

const questionnaire: QuestionnaireFile = JSON.parse(
  readFileSync('docs/nutrition/canonical/questionnaire.json', 'utf8'),
);
const constraints: ConstraintsFile = JSON.parse(
  readFileSync('docs/nutrition/canonical/nutrition_constraints.json', 'utf8'),
);
const rules: RulesFile = JSON.parse(
  readFileSync('docs/nutrition/canonical/nutrition_rules.json', 'utf8'),
);

function optionsFor(questionId: string): string[] {
  const question = questionnaire.questions.find((q) => q.id === questionId);
  if (!question?.options) {
    throw new Error(`questionnaire.json has no options for "${questionId}" — check the fixture, not just this test`);
  }
  return question.options;
}

describe('nutrition.ts enums match canonical/*.json exactly', () => {
  it('NUTRITION_PROGRESSION_PACES === questionnaire.json progressionPace options', () => {
    expect([...NUTRITION_PROGRESSION_PACES]).toEqual(optionsFor('progressionPace'));
  });

  it('NON_TRAINING_ACTIVITY_LEVELS === questionnaire.json nonTrainingActivityLevel options', () => {
    expect([...NON_TRAINING_ACTIVITY_LEVELS]).toEqual(optionsFor('nonTrainingActivityLevel'));
  });

  it('DIETARY_PATTERNS === questionnaire.json dietaryPattern options', () => {
    expect([...DIETARY_PATTERNS]).toEqual(optionsFor('dietaryPattern'));
  });

  it('NUTRITION_MEAL_SLOTS === questionnaire.json mealSlots options', () => {
    expect([...NUTRITION_MEAL_SLOTS]).toEqual(optionsFor('mealSlots'));
  });

  it('VARIETY_PREFERENCES === questionnaire.json varietyPreference options', () => {
    expect([...VARIETY_PREFERENCES]).toEqual(optionsFor('varietyPreference'));
  });

  it('NUTRITION_SUPPLEMENT_IDS === questionnaire.json supplements options', () => {
    expect([...NUTRITION_SUPPLEMENT_IDS]).toEqual(optionsFor('supplements'));
  });

  it('NUTRITION_ELIGIBILITY_BLOCKERS === nutrition_constraints.json eligibility.blockingGates', () => {
    expect([...NUTRITION_ELIGIBILITY_BLOCKERS]).toEqual(constraints.eligibility.blockingGates);
  });

  it('NUTRITION_LOGGED_FOOD_SOURCES === nutrition_constraints.json diary.loggedItemSources', () => {
    expect([...NUTRITION_LOGGED_FOOD_SOURCES]).toEqual(constraints.diary.loggedItemSources);
  });

  it('NUTRITION_GENERATION_OPERATION_TYPES === nutrition_rules.json generation.operationTypes', () => {
    expect([...NUTRITION_GENERATION_OPERATION_TYPES]).toEqual(rules.generation.operationTypes);
  });

  it('NUTRITION_GOAL_CATEGORIES === nutrition_rules.json goals.allowed', () => {
    expect([...NUTRITION_GOAL_CATEGORIES]).toEqual(rules.goals.allowed);
  });

  it('questionnaire.json nutritionGoalCategory question accepts exactly the 4 NUTRITION_GOAL_CATEGORIES (same set, UI copy order may differ from goals.allowed order)', () => {
    expect(optionsFor('nutritionGoalCategory').slice().sort()).toEqual([...NUTRITION_GOAL_CATEGORIES].sort());
  });
});

describe('NUTRITION_GOAL_CATEGORY_MAP matches canonical/nutrition_rules.json goals.normalization exactly', () => {
  it('every closed mapping entry in nutrition_rules.json matches the TS map', () => {
    for (const [goal, category] of Object.entries(rules.goals.normalization.mapping)) {
      expect(NUTRITION_GOAL_CATEGORY_MAP[goal as keyof typeof NUTRITION_GOAL_CATEGORY_MAP]).toBe(category);
    }
  });

  it('every value nutrition_rules.json marks ambiguous is null in the TS map — never guessed', () => {
    for (const goal of rules.goals.normalization.ambiguous.values) {
      expect(NUTRITION_GOAL_CATEGORY_MAP[goal as keyof typeof NUTRITION_GOAL_CATEGORY_MAP]).toBeNull();
    }
  });

  it('closed + ambiguous together cover every key of the TS map, with no leftovers', () => {
    const closedKeys = Object.keys(rules.goals.normalization.mapping);
    const ambiguousKeys = rules.goals.normalization.ambiguous.values;
    expect([...closedKeys, ...ambiguousKeys].sort()).toEqual(Object.keys(NUTRITION_GOAL_CATEGORY_MAP).sort());
  });

  it('none of the 5 ambiguous goals were silently given a default category (the exact wrong defaults called out in the task)', () => {
    expect(NUTRITION_GOAL_CATEGORY_MAP.strength).not.toBe('maintenance');
    expect(NUTRITION_GOAL_CATEGORY_MAP.conditioning).not.toBe('maintenance');
    expect(NUTRITION_GOAL_CATEGORY_MAP.perf).not.toBe('maintenance');
    expect(NUTRITION_GOAL_CATEGORY_MAP.return_to_training).not.toBe('maintenance');
    expect(NUTRITION_GOAL_CATEGORY_MAP.recon).not.toBe('body_recomposition');
    for (const goal of NUTRITION_AMBIGUOUS_GOALS) {
      expect(NUTRITION_GOAL_CATEGORY_MAP[goal]).toBeNull();
    }
  });
});

describe('NUTRITION_AMBIGUOUS_GOALS matches canonical/nutrition_rules.json goals.normalization.ambiguous.values exactly', () => {
  it('same 5 values, same order', () => {
    expect([...NUTRITION_AMBIGUOUS_GOALS]).toEqual(rules.goals.normalization.ambiguous.values);
  });

  it('status is resolved via a Perfil Nutricional question, not left pending', () => {
    expect(rules.goals.normalization.ambiguous.status).toBe('RESOLVED_VIA_NUTRITION_PROFILE_QUESTION');
  });
});

describe('NutritionProfile.nutritionGoalCategory is aligned with NutritionGoalCategory', () => {
  it('type-level: assigning any NutritionGoalCategory value to nutritionGoalCategory compiles', () => {
    const assignable = (value: NutritionGoalCategory): Pick<NutritionProfile, 'nutritionGoalCategory'> => (
      { nutritionGoalCategory: value }
    );
    expect(typeof assignable).toBe('function');
  });

  it('type-level: the field is optional — omitting it compiles (no silent required-by-default)', () => {
    const withoutField: Pick<NutritionProfile, 'nutritionGoalCategory'> = {};
    expect(withoutField.nutritionGoalCategory).toBeUndefined();
  });
});
