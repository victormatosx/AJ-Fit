import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/NutritionPlanScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const nuKitSource = readFileSync('src/components/nutrition/NuKit.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('NutritionPlanScreen back navigation', () => {
  it('requires an onBack handler in its props', () => {
    expect(source).toMatch(/plan, onOpenMeal, onBack, historical/);
    expect(source).toMatch(/onBack: \(\) => void/);
  });

  it('renders a visible, accessible back control that reuses the same pattern as other Nutrition screens', () => {
    // The redesign factored the header into a shared `NuSheetHeader` (used by
    // every internal Nutrição screen) — the actual Pressable/Icon live there,
    // with accessibilityRole="button" so it reads as a button to assistive
    // tech, not just a bare icon. Standardized to the same close (×) icon
    // "Criar Alimento"/"Criar Receita"/RegisterMealScreen already used,
    // instead of a back-chevron only some screens had.
    expect(source).toMatch(/<NuSheetHeader title=\{.*\} onBack=\{onBack\} \/>/);
    expect(nuKitSource).toMatch(/<Pressable onPress=\{onBack\} accessibilityRole="button"/);
    expect(nuKitSource).toMatch(/<Icon name="x"/);
  });

  it('keeps the back control inside the screen header, not gating the scrollable plan content', () => {
    const headerIndex = source.indexOf('onBack={onBack}');
    const scrollIndex = source.indexOf('<ScrollView');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(scrollIndex).toBeGreaterThan(headerIndex);
  });
});
