import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NUTRITION_GOAL_CATEGORIES,
  NUTRITION_MEAL_SLOTS,
  NUTRITION_PROGRESSION_PACES,
} from '../../../types/nutrition';
import en from '../../../i18n/resources/en/nutrition.json';
import es from '../../../i18n/resources/es/nutrition.json';
import ptBR from '../../../i18n/resources/pt-BR/nutrition.json';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const planPanels = read('components/plan/PlanPanels.tsx');
const planReady = read('screens/PlanReadyScreen.tsx');

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Plan sheet list keys', () => {
  /**
   * `PlanStatsLine` used to key its parts by `part.label`, which every caller
   * passes as an empty string — React then logged "two children with the same
   * key, ``" every time the Plan screen rendered. The label is optional copy,
   * never an identity.
   */
  it('never keys a stat part by its optional label', () => {
    expect(stripComments(planPanels)).not.toContain('key={part.label}');
    expect(planPanels).toContain('key={`${index}-${part.value}`}');
  });

  it('keys every other list in the sheet by a value that cannot be empty', () => {
    // The two caller-provided lists are keyed by the caller's explicit `key`,
    // and both call sites build it from a non-empty value.
    expect(planPanels).toContain('key={column.key}');
    expect(planPanels).toContain('key={row.key}');
    expect(planReady).toContain('key: `slot-${index}`');
    expect(planReady).toContain('key: `workout-${index}`');
  });
});

describe('Diet panel content', () => {
  const code = stripComments(planReady);

  /**
   * The diet panel shows what is already answered: every meal the user marked
   * they would have. It is not a three-row teaser, and the rows carry no
   * blurred placeholder bars — the name and its calorie target ARE the row.
   */
  it('lists every meal slot the user marked, uncapped', () => {
    expect(code).toContain('rows={mealSlots.map((slot) => {');
    expect(code).not.toContain('mealSlots.slice(');
  });

  it('renders the meal rows without the locked placeholder bars', () => {
    expect(code).toContain('showPlaceholderBars={false}');
    // The workout preview keeps them: its rows really are unresolved.
    expect(code).toMatch(/PlanLockedPreview\s+rows=\{Array\.from\(\{ length: LOCKED_ROW_COUNT \}/);
  });

  it('omits the card entirely when no meal was marked', () => {
    expect(code).toContain('{mealSlots.length > 0 ? (');
  });

  /**
   * The panel once asked for `profile.questions.mealSlots.options.<slot>`,
   * which does not exist — the raw key was rendered on screen. The meal
   * labels live at the root of the nutrition bundle, where every other
   * nutrition screen reads them from.
   */
  it('reads the meal names from the key that actually exists', () => {
    expect(code).toContain('nutrition:mealSlots.${slot}');
    expect(code).not.toContain('profile.questions.mealSlots.options');
  });

  it.each([['en', en], ['es', es], ['pt-BR', ptBR]] as const)(
    'resolves every label the diet panel asks for in %s',
    (_locale, bundle) => {
      for (const slot of NUTRITION_MEAL_SLOTS) {
        expect(bundle.mealSlots[slot]).toBeTruthy();
      }
      // The panel's other interpolated keys, verified the same way.
      for (const category of NUTRITION_GOAL_CATEGORIES) {
        expect(bundle.profile.questions.nutritionGoalCategory.options[category]).toBeTruthy();
      }
      for (const pace of NUTRITION_PROGRESSION_PACES) {
        expect(bundle.profile.questions.progressionPace.options[pace]).toBeTruthy();
      }
    },
  );

  it('only shows calories and macros when the engine actually produced them', () => {
    expect(code).toContain('{diet.targets ? (');
    expect(code).toContain('{diet.targets.kcal}');
    expect(code).toContain('trailing: mealKcal ? t(\'plan:dietPanel.mealKcal\'');
  });
});
