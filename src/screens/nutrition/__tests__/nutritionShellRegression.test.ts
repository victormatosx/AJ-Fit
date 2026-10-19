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
      /await updateDiaryItemQuantity\(uid, todayLocalDate\(\), slot, item, grams\)/,
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

  it('assigns every route-specific screen to routeContent instead of returning early, so overlay modals never unmount on navigation', () => {
    // Regression: `profile`/`generating`/`historicalPlan`/`weekly` used to
    // `return` their screen directly. That unmounted every sibling modal
    // (MealFeedbackSheet, RegisterMealScreen, ...) without ever calling the
    // modal's own `onClose` — their `visible` flag stayed `true` in this
    // component's state. The next time navigation landed back on a branch
    // that renders that modal, React Native's `Modal` mounted
    // already-open, popping up "Por que você quer trocar?" or "Registrar
    // alimento" with no new tap from the user. Assigning to `routeContent`
    // (rendered as a sibling of every modal in the single return below)
    // instead of `return`-ing keeps the modals mounted across every route,
    // so their own `visible` prop is always what controls them.
    const start = source.indexOf('let routeContent: React.ReactNode;');
    const end = source.indexOf('const currentMeal =', start);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end);
    expect(body).not.toMatch(/\breturn\s*[(<]/);
    expect(body).toContain('resolveInitialNutritionRequestPresentation');
    expect(body.match(/routeContent = /g)?.length).toBe(5);
  });

  it('renders routeContent together with every overlay modal in one return, so none of them can unmount independently of its own visible flag', () => {
    const finalReturnStart = source.lastIndexOf('return (');
    const body = source.slice(finalReturnStart);
    expect(body).toMatch(/\{routeContent\}/);
    expect(body).toMatch(/\{mealDetailsAndModals\}/);
    for (const tag of [
      '<RegisterMealScreen', '<NutritionDiaryScreen', '<FoodSearchScreen', '<RecipeQuantityModal',
      '<NutritionPlanHistoryScreen', '<NutritionFoodFavoritesScreen', '<NutritionFavoritesScreen',
      '<CreateCustomFoodScreen', '<CreateRecipeScreen',
    ]) {
      expect(body).toContain(tag);
    }
    // `mealDetailsAndModals` (MealDetailsScreen/MealFeedbackSheet/
    // MealAlternativeResultScreen) must itself be built unconditionally on
    // `plan`, never on `route.name` — otherwise it would still vanish on
    // routes other than 'home'/'plan'.
    const modalsStart = source.indexOf('const mealDetailsAndModals = plan ?');
    expect(modalsStart).toBeGreaterThan(-1);
    expect(modalsStart).toBeLessThan(finalReturnStart);
  });

  it('never re-shows "automatic generation disabled" once a job has been observed this session, even if generationId/activeJob momentarily clear back to null', () => {
    // Regression: the job flipping to 'completed' and the plan becoming
    // 'active' commit in the same backend transaction, but the client
    // observes them through two independent `onSnapshot` listeners that
    // do not necessarily deliver in the same tick. The instant the job
    // listener's 'completed' update lands, `generationId` is nulled and
    // `activeJob`'s query already excludes a completed job — for that one
    // frame, `!plan && !generationId && !activeJob` can be true even
    // though a plan was just produced, which must not resurrect the
    // onboardingAutomatic-disabled copy (a job existing makes that message
    // wrong regardless of the rollout flag).
    expect(source).toMatch(/if \(activeJob \|\| job \|\| generationId\) sawGenerationActivityRef\.current = true;/);
    const gateMatch = source.match(/else if \(initialPending[^)]*\)\s*\{/);
    expect(gateMatch?.[0]).toContain('!activeJob');
    expect(gateMatch?.[0]).toContain('!sawGenerationActivityRef.current');
  });

  it('keeps tracking an active or just-finished job even when the onboardingAutomatic rollout flag is off, since that flag only gates the first automatic attempt — not a manual retry', () => {
    // The manual retry path (`handleRequestGeneration`, used by the
    // "Tentar novamente" button on the disabled-copy branch) calls
    // `requestNutritionPlanGeneration` with no `intent`, so the backend's
    // `onboardingAutomatic` gate (which only applies when
    // `intent === 'initial_onboarding'`) never blocks it. The UI must keep
    // following that job via the plain `activeJob`/`generationId`
    // subscriptions, not via any onboardingAutomatic-derived state.
    const activeJobEffectStart = source.indexOf('subscribeToActiveNutritionGenerationJob(uid');
    const activeJobEffectEnd = source.indexOf('}, [uid]);', activeJobEffectStart);
    const activeJobEffectBody = source.slice(activeJobEffectStart, activeJobEffectEnd);
    expect(activeJobEffectBody).not.toMatch(/onboardingAutomatic|generationEnabled/);
    expect(activeJobEffectBody).toMatch(/setActiveJob\(next\)/);
  });
});
