import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/NutritionHomeScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('NutritionHomeScreen register-meal FAB', () => {
  it('renders a circular, accessible FAB that calls onRegisterMeal', () => {
    expect(source).toMatch(/onPress=\{state\.onRegisterMeal\}/);
    expect(source).toMatch(/accessibilityLabel=\{t\('registerMeal\.fab'\)\}/);
    expect(source).toMatch(/borderRadius: theme\.radii\.pill/);
    expect(source).toMatch(/width: 56, height: 56/);
  });

  it('is positioned fixed to the bottom-right, outside the scrollable content, so it stays visible while scrolling', () => {
    const scrollCloseIndex = source.lastIndexOf('</ScrollView>');
    const fabIndex = source.indexOf("accessibilityLabel={t('registerMeal.fab')}");
    expect(scrollCloseIndex).toBeGreaterThan(-1);
    expect(fabIndex).toBeGreaterThan(scrollCloseIndex);
    expect(source).toMatch(/position: 'absolute', bottom: 20, right: 20/);
  });

  it('reuses existing theme tokens (primary color + accent shadow), not hardcoded one-off styling', () => {
    expect(source).toMatch(/backgroundColor: theme\.colors\.primary,/);
    expect(source).toMatch(/\.\.\.theme\.shadows\.accent/);
    expect(source).toMatch(/<Icon name="plus" size=\{24\} color=\{theme\.colors\.primaryForeground\} \/>/);
  });
});
