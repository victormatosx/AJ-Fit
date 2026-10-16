import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (path: string) => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const shellSource = strip('src/screens/nutrition/NutritionShell.tsx');
const barcodeSource = strip('src/screens/nutrition/BarcodeScannerModal.tsx');
const registerSource = strip('src/screens/nutrition/RegisterMealScreen.tsx');

/**
 * Regression for the exact production sequence:
 *   1. Home "Ver refeição" -> MealDetailsScreen opens
 *   2. "Registrar esta opção" -> "Registrado no seu diário hoje." shows,
 *      RegisterMealScreen ALSO opens (both stayed mounted/visible)
 *   3. Tapping back on MealDetailsScreen -> screen stops responding
 *   4. Switching tabs pops RegisterMealScreen ("Registrar refeição") open
 *      on its own
 *
 * Root cause: MealDetailsScreen and RegisterMealScreen are each their OWN
 * independent native `<Modal presentationStyle="pageSheet">`.
 * `openRegisterMealForOption` (reached from MealDetailsScreen's "Registrar
 * esta opção" and from its MealAlternativeResultScreen overlay's
 * "Registrar") used to only set `registeringMealVisible` true without ever
 * closing `mealDetailsSlot` — leaving both Modals mounted/visible at once.
 * Stacking two independent native Modals is unreliable (same category as
 * the already-fixed MealDetailsScreen/MealFeedbackSheet bug): dismissing
 * the inner one corrupts the outer one's native presentation/touch chain,
 * and a later unrelated re-render (switching tabs) flushes that stale
 * native state and re-presents the "already closed" inner modal on its
 * own, with no React state actually saying it should be visible.
 *
 * `NutritionFavoritesScreen`'s `onUse` already closed its own Modal
 * (`setMealFavoritesVisible(false)`) before calling
 * `openRegisterMealForOption` — the fix mirrors that by closing
 * MealDetailsScreen's state INSIDE `openRegisterMealForOption` itself, so
 * every call site gets it for free and at most one of these two Modals is
 * ever visible.
 *
 * Separately, `RegisterMealScreen` nested `BarcodeScannerModal` (its own
 * `fullScreen` Modal) as a child inside its own `pageSheet` Modal — the
 * same stacked-Modal anti-pattern, just one level deeper. Fixed the same
 * way as `MealFeedbackSheet`/`CreateCustomFoodScreen`: no own Modal,
 * returns null while `!visible`, otherwise a plain absolutely-positioned
 * overlay.
 */
describe('register-meal flow: no stacked native Modals with MealDetailsScreen or inside RegisterMealScreen', () => {
  it('openRegisterMealForOption always closes MealDetailsScreen (and its swap overlays) before opening RegisterMealScreen', () => {
    const start = shellSource.indexOf('const openRegisterMealForOption = useCallback(');
    const end = shellSource.indexOf('}, []);', start);
    expect(start).toBeGreaterThan(-1);
    const body = shellSource.slice(start, end);
    expect(body).toMatch(/setMealDetailsSlot\(null\)/);
    expect(body).toMatch(/setFeedbackVisible\(false\)/);
    expect(body).toMatch(/setAlternativeVisible\(false\)/);
    expect(body).toMatch(/setAlternativeState\(null\)/);
    expect(body).toMatch(/setRegisteringMealVisible\(true\)/);
  });

  it('BarcodeScannerModal owns no native Modal and fully unmounts while closed', () => {
    expect(barcodeSource).not.toMatch(/<Modal\b/);
    expect(barcodeSource).toMatch(/if \(!visible\) return null;/);
  });

  it('RegisterMealScreen has exactly one native Modal; BarcodeScannerModal/CreateCustomFoodScreen render as plain overlays inside it', () => {
    expect(registerSource.match(/<Modal\b/g)?.length).toBe(1);
    const modalStart = registerSource.indexOf('<Modal');
    const modalEnd = registerSource.indexOf('</Modal>');
    const modalBody = registerSource.slice(modalStart, modalEnd);
    expect(modalBody).toMatch(/<BarcodeScannerModal/);
    expect(modalBody).toMatch(/<CreateCustomFoodScreen/);
  });
});
