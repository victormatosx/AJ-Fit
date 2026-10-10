import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/NutritionPlanScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('NutritionPlanScreen back navigation', () => {
  it('requires an onBack handler in its props', () => {
    expect(source).toMatch(/plan, onOpenMeal, onBack, historical/);
    expect(source).toMatch(/onBack: \(\) => void/);
  });

  it('renders a visible, accessible back control that reuses the same pattern as other Nutrition screens', () => {
    // Same shape used by NutritionWeeklySummaryScreen's header: a Pressable
    // wrapping an arrow-left Icon, with accessibilityRole/accessibilityLabel
    // so it reads as a button to assistive tech, not just a bare icon.
    expect(source).toMatch(
      /<Pressable onPress=\{onBack\} accessibilityRole="button" accessibilityLabel=\{t\('plan\.back'\)\} hitSlop=\{10\}/,
    );
    expect(source).toMatch(/<Icon name="arrow-left"/);
  });

  it('keeps the back control inside the screen header, not gating the scrollable plan content', () => {
    const headerIndex = source.indexOf('onPress={onBack}');
    const scrollIndex = source.indexOf('<ScrollView');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(scrollIndex).toBeGreaterThan(headerIndex);
  });
});
