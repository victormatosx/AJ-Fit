import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/screens/nutrition/NutritionShell.tsx', 'utf8');
const home = readFileSync('src/screens/nutrition/NutritionHomeScreen.tsx', 'utf8');
const weekly = readFileSync('src/screens/nutrition/NutritionWeeklySummaryScreen.tsx', 'utf8');
const diaryService = readFileSync('src/services/nutritionDiary.ts', 'utf8');
const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');

describe('Nutrition weekly summary wiring', () => {
  it('uses one bounded week listener instead of seven daily listeners', () => {
    expect(shell).toContain('subscribeToDiaryWeek(');
    expect(diaryService).toContain('orderBy(documentId())');
    expect(diaryService).toContain('startAt(weekStartLocalDate)');
    expect(diaryService).toContain('endAt(weekEndLocalDate)');
  });

  it('replaces the Home placeholder with the real compact weekly card and CTA', () => {
    expect(home).toContain('<WeeklySummaryCard');
    expect(home).toContain('summary={state.weeklySummary}');
    expect(home).toContain('onPress={state.onOpenWeekly}');
  });

  it('renders weekly calories, macros, no-data days and the existing weight chart', () => {
    expect(weekly).toContain('<CaloriesSection summary={summary} />');
    expect(weekly).toContain('<MacrosSection summary={summary} />');
    expect(weekly).toContain('day.hasLog && day.totals');
    expect(weekly).toContain('<EvolutionAreaChart');
  });

  it('routes deep weight details to the existing Progress tab', () => {
    const nutritionShell = appShell.slice(appShell.indexOf('<NutritionShell'), appShell.indexOf('/>', appShell.indexOf('<NutritionShell')));
    expect(nutritionShell).toContain("onOpenProgress={() => setTab('progress')}");
  });
});
