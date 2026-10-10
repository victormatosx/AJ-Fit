import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/NutritionShell.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('NutritionShell integration regressions', () => {
  it('requests the first plan exactly once after creating an eligible profile', () => {
    const start = source.indexOf('const handleSubmitProfile');
    const end = source.indexOf('const openDiary', start);
    const body = source.slice(start, end);
    expect(body.match(/await handleRequestGeneration\(\)/g)).toHaveLength(1);
  });

  it('leaves the profile route when the first-generation request fails, so requestError becomes visible', () => {
    // Regression: `handleRequestGeneration` never throws (it catches into
    // `requestError` state and returns false) — if `handleSubmitProfile`
    // ignores that return value, `route` stays stuck at 'profile' (the
    // only success-path `setRoute` lives inside `handleRequestGeneration`
    // itself) and the `requestError` banner — only rendered in the 'home'
    // branch — never shows. The button then silently does nothing.
    const start = source.indexOf('const handleSubmitProfile');
    const end = source.indexOf('const openDiary', start);
    const body = source.slice(start, end);
    expect(body).toMatch(/const started = await handleRequestGeneration\(\);\s*if \(!started\) setRoute\(\{ name: 'home' \}\);/);
  });

  it('wires a back handler into both the live and historical plan screens, returning to Home without losing the plan', () => {
    // Regression: NutritionPlanScreen had no way back (no header, no back
    // button) — the only exit from "Nutrição → Ver plano" was whatever
    // chrome wrapped NutritionShell outside this component, which wasn't
    // discoverable. `onBack` must be passed at both call sites; the
    // handler only flips `route` back to 'home' (and, for the historical
    // case, reopens the history list) — `plan`/`route.plan` themselves
    // live in state outside the route, so going back never unmounts or
    // refetches the plan.
    const planCallSite = source.match(/<NutritionPlanScreen\s+plan=\{plan\}[^/]*\/>/);
    expect(planCallSite?.[0]).toMatch(/onBack=\{\(\) => setRoute\(\{ name: 'home' \}\)\}/);

    const historicalCallSite = source.match(/<NutritionPlanScreen[^/]*plan=\{route\.plan\}[^/]*\/>/);
    expect(historicalCallSite?.[0]).toMatch(/onBack=\{\(\) => \{ setRoute\(\{ name: 'home' \}\); setHistoryVisible\(true\); \}\}/);
  });

  it('opens the single-screen RegisterMealScreen from the home FAB, fed by the live todayDiary subscription', () => {
    // FAB tap -> onRegisterMeal -> setRegisteringMealVisible(true) -> modal
    // visible, reading `day={todayDiary}` — the SAME live subscription
    // Home's own summary already uses. RegisterMealScreen holds no local
    // copy of the meal's items, so every add/edit/remove below reflects
    // back into the open screen without any extra wiring.
    expect(source).toMatch(/onRegisterMeal: \(\) => setRegisteringMealVisible\(true\)/);
    const callSite = source.match(/<RegisterMealScreen[\s\S]*?\/>/)?.[0];
    expect(callSite).toMatch(/visible=\{registeringMealVisible\}/);
    expect(callSite).toMatch(/day=\{todayDiary\}/);
    expect(callSite).toMatch(/onAddFood=\{handleRegisterMealAdd\}/);
    expect(callSite).toMatch(/onEditGrams=\{handleRegisterMealEditGrams\}/);
    expect(callSite).toMatch(/onRemove=\{handleRegisterMealRemove\}/);
    expect(callSite).toMatch(/recentFoodIds=\{recentFoodIds\}/);
  });

  it('derives recent logging ids from the already-loaded weekly diary instead of reading on each search', () => {
    expect(source).toMatch(/const recentFoodIds = useMemo\(\(\) => recentFoodLogIds\(weeklyLogs, 20\), \[weeklyLogs\]\)/);
  });

  it('adds through the existing addDiaryFood, never setting followedRecommendedOptionId for a manual log', () => {
    // Round brief: recommendedPlan != actualIntake — a manually registered
    // meal must never be mistaken for having followed the plan.
    const addFnStart = source.indexOf('const handleRegisterMealAdd');
    const addFnEnd = source.indexOf('}, [uid]);', addFnStart);
    const addFnBody = source.slice(addFnStart, addFnEnd);
    expect(addFnBody).toMatch(/await addDiaryFood\(uid, todayLocalDate\(\), slot, source, foodId, grams\)/);
    expect(addFnBody).not.toMatch(/followedOptionId|followedRecommendedOptionId/);
  });

  it('edits and removes register-meal items through the existing diary write functions, always for today', () => {
    const editFnStart = source.indexOf('const handleRegisterMealEditGrams');
    const editFnEnd = source.indexOf('}, [uid]);', editFnStart);
    expect(source.slice(editFnStart, editFnEnd)).toMatch(
      /await updateDiaryEntryGrams\(uid, todayLocalDate\(\), slot, item\.id, item\.source, item\.foodId, grams\)/,
    );
    const removeFnStart = source.indexOf('const handleRegisterMealRemove');
    const removeFnEnd = source.indexOf('}, [uid]);', removeFnStart);
    expect(source.slice(removeFnStart, removeFnEnd)).toMatch(/await removeDiaryEntry\(uid, todayLocalDate\(\), slot, itemId\)/);
  });

  it('logs a recipe picked from the diary by grams or by portion, through a resolved-grams RecipeQuantityModal', () => {
    // Round brief §9: a recipe can be logged by grams OR, when it has
    // `servings`, by portion. `RecipeQuantityModal` resolves the actual
    // gram amount (via `recipePortionToGrams`) BEFORE the normal
    // `addDiaryFood` call runs — same write path as every other diary entry.
    expect(source).toMatch(/if \(food\.origin === 'recipe'\) \{/);
    expect(source).toMatch(/setRecipeQuantityPick\(food\);/);
    expect(source).toMatch(/void loadNutritionRecipe\(uid, food\.foodId\)\.then\(setRecipeQuantityRecipe\);/);
    const confirmStart = source.indexOf('onConfirm={(grams) => {');
    const confirmEnd = source.indexOf('}}', confirmStart);
    const confirmBody = source.slice(confirmStart, confirmEnd);
    expect(confirmBody).toMatch(/void addDiaryFood\(uid, diaryDate, diaryFoodTarget, 'recipe', recipeQuantityPick\.foodId, grams\)/);
  });

  it('routes notification intents to plan, weekly summary and diary without accepting arbitrary routes', () => {
    expect(source).toContain("navigationRequest.destination === 'plan'");
    expect(source).toContain("navigationRequest.destination === 'weekly'");
    expect(source).toContain('setDiaryVisible(true)');
    expect(source).not.toContain('setRoute(navigationRequest');
  });
});
