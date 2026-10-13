import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (path: string) => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const feedbackSource = strip('src/screens/nutrition/MealFeedbackSheet.tsx');
const alternativeSource = strip('src/screens/nutrition/MealAlternativeResultScreen.tsx');
const detailsSource = strip('src/screens/nutrition/MealDetailsScreen.tsx');
const shellSource = strip('src/screens/nutrition/NutritionShell.tsx');

/**
 * Regression for the exact production sequence:
 *   1. Home "Próxima refeição" -> "Ver refeição" (opens MealDetailsScreen)
 *   2. "Trocar esta refeição" (opens MealFeedbackSheet)
 *   3. Close the feedback sheet via X
 *   4. "Ver refeição" again -> screen stops responding
 *   5. Switching tabs pops "Por que você quer trocar?" open unprompted
 *
 * Root cause: MealDetailsScreen and MealFeedbackSheet (and
 * MealAlternativeResultScreen) were each their OWN independent native
 * `<Modal presentationStyle="pageSheet">`, mounted as siblings and both
 * `visible` at once once "Trocar" was tapped. Stacking two independent
 * native Modals is unreliable — dismissing the inner one (the X on the
 * feedback sheet) can leave the outer one's native presentation/touch
 * chain corrupted (the "frozen" screen), and a later unrelated re-render
 * (switching tabs) can flush that stale native state and re-present the
 * "already closed" inner modal on its own — with NO React state actually
 * saying it should be visible at that point. This is the same category of
 * bug the codebase already worked around once, in RegisterMealScreen's
 * grams step (see its "unreliable... nested Modal" comment) — it just
 * hadn't been applied here yet.
 *
 * Fix: MealFeedbackSheet and MealAlternativeResultScreen no longer render
 * their own `<Modal>` — they return `null` while `!visible` and otherwise
 * render a plain absolutely-positioned overlay, hosted inside
 * MealDetailsScreen's single `<Modal>` via its new `overlay` prop. There
 * is now exactly one native Modal for this entire flow, so there is
 * nothing left to stack/corrupt, and returning `null` while closed fully
 * unmounts (not just hides) the feedback sheet's internal state.
 */
describe('meal details / swap feedback: no stacked native Modals, no residual state', () => {
  it('MealFeedbackSheet owns no native Modal and fully unmounts (not just hides) while closed', () => {
    expect(feedbackSource).not.toMatch(/<Modal\b/);
    expect(feedbackSource).not.toMatch(/\bModal\b/);
    expect(feedbackSource).toMatch(/if \(!visible\) return null;/);
  });

  it('MealAlternativeResultScreen owns no native Modal and fully unmounts while closed', () => {
    expect(alternativeSource).not.toMatch(/<Modal\b/);
    expect(alternativeSource).toMatch(/if \(!visible\) return null;/);
  });

  it('MealDetailsScreen hosts the feedback/alternative overlays inside its own single Modal', () => {
    // Exactly one `<Modal` in the whole file — the outer pageSheet.
    expect(detailsSource.match(/<Modal\b/g)?.length).toBe(1);
    // The overlay prop is rendered as a sibling inside that same Modal,
    // not outside it — i.e. between the Modal's JSX open and its closing
    // tag.
    const modalStart = detailsSource.indexOf('<Modal');
    const modalEnd = detailsSource.indexOf('</Modal>');
    const modalBody = detailsSource.slice(modalStart, modalEnd);
    expect(modalBody).toMatch(/\{overlay\}/);
  });

  it('MealDetailsScreen resets its local confirmation text whenever the open meal/slot changes (close or reopen)', () => {
    // Regression: `confirmation` ("Registrado...'/'Adicionado aos
    // favoritos.") is local state in a component that never unmounts
    // (permanent sibling of NutritionShell) — without a reset keyed on
    // the meal actually changing, closing and reopening (the same or a
    // different meal) showed the PREVIOUS session's leftover text.
    expect(detailsSource).toMatch(/useEffect\(\(\) => \{\s*setConfirmation\(null\);\s*\}, \[meal\?\.slot\]\);/);
  });

  it('NutritionShell wires MealFeedbackSheet and MealAlternativeResultScreen through MealDetailsScreen.overlay, not as top-level Modal siblings', () => {
    const mealDetailsAndModalsStart = shellSource.indexOf('const mealDetailsAndModals = plan ?');
    const mealDetailsAndModalsEnd = shellSource.indexOf('\n  ) : null;', mealDetailsAndModalsStart);
    expect(mealDetailsAndModalsStart).toBeGreaterThan(-1);
    expect(mealDetailsAndModalsEnd).toBeGreaterThan(mealDetailsAndModalsStart);
    const body = shellSource.slice(mealDetailsAndModalsStart, mealDetailsAndModalsEnd);

    // Both overlays must appear strictly AFTER `overlay={(` — i.e. they
    // are props/children of the single MealDetailsScreen call, not
    // top-level siblings rendered alongside it.
    const overlayPropStart = body.indexOf('overlay={(');
    expect(overlayPropStart).toBeGreaterThan(-1);
    const feedbackIndex = body.indexOf('<MealFeedbackSheet');
    const alternativeIndex = body.indexOf('<MealAlternativeResultScreen');
    expect(feedbackIndex).toBeGreaterThan(overlayPropStart);
    expect(alternativeIndex).toBeGreaterThan(overlayPropStart);
    // Only ONE `<MealDetailsScreen` call site in the whole file (no
    // second, unguarded copy left over from the old sibling-Modal layout).
    expect(shellSource.match(/<MealDetailsScreen/g)?.length).toBe(1);
  });

  it('closing the feedback sheet never leaves alternativeVisible or feedbackVisible true at the same time as a fresh meal-details open', () => {
    // onSwap only ever sets feedbackVisible true; the X/close path only
    // ever sets it false. Nothing in NutritionShell sets feedbackVisible
    // true from any effect, tab-switch, or route change — the only way
    // it can become true again is the user tapping "Trocar esta
    // refeição" again, which is the explicit-user-action guarantee this
    // bug report requires.
    const setTrueSites = shellSource.match(/setFeedbackVisible\(true\)/g) ?? [];
    expect(setTrueSites).toHaveLength(1);
    expect(shellSource).toContain("onSwap={() => setFeedbackVisible(true)}");
  });
});
