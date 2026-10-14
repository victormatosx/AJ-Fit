import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/NutritionHomeScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('NutritionHomeScreen register-meal FAB', () => {
  it('renders an accessible, rounded-square FAB that calls onRegisterMeal', () => {
    expect(source).toMatch(/onPress=\{state\.onRegisterMeal\}/);
    expect(source).toMatch(/accessibilityLabel=\{t\('registerMeal\.fab'\)\}/);
    expect(source).toMatch(/borderRadius: 18/);
    expect(source).toMatch(/width: 56, height: 56/);
  });

  it('is positioned fixed to the bottom-right, outside the scrollable content, so it stays visible while scrolling', () => {
    const scrollCloseIndex = source.lastIndexOf('</ScrollView>');
    const fabIndex = source.indexOf("accessibilityLabel={t('registerMeal.fab')}");
    expect(scrollCloseIndex).toBeGreaterThan(-1);
    expect(fabIndex).toBeGreaterThan(scrollCloseIndex);
    expect(source).toMatch(/position: 'absolute', bottom: 20, right: 20/);
  });

  it('uses the Nutrição redesign\'s own fixed gradient tokens (NU.blueHi/NU.blue), not an arbitrary one-off color', () => {
    // Nutrição is a fixed dark "poster" surface regardless of the active
    // theme (same precedent as `EvoRing.tsx`/`HomeEvoTicker.tsx`), so this
    // button intentionally does not pull from `theme.colors.*`.
    expect(source).toMatch(/colors=\{\[NU\.blueHi, NU\.blue\]\}/);
    expect(source).toMatch(/<Icon name="plus" size=\{22\} color="#fff" \/>/);
  });
});
