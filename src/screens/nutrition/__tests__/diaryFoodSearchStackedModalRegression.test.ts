import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (path: string) => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const shellSource = strip('src/screens/nutrition/NutritionShell.tsx');

// The Diary now hosts search as a plain sheet, so it stays visible without a second native Modal.
describe('diary food-search flow: no stacked native Modals between NutritionDiaryScreen and FoodSearchScreen', () => {
  it('openDiaryFoodSearch keeps the Diary mounted while opening its search sheet', () => {
    const start = shellSource.indexOf('const openDiaryFoodSearch = ');
    const end = shellSource.indexOf('};', start);
    expect(start).toBeGreaterThan(-1);
    const body = shellSource.slice(start, end);
    expect(body).not.toMatch(/setDiaryVisible/);
    expect(body).toMatch(/setDiaryFoodTarget\(slot\)/);
  });

  it('closeDiaryFoodSearch clears search state without reopening the already-visible Diary', () => {
    const start = shellSource.indexOf('const closeDiaryFoodSearch = ');
    const end = shellSource.indexOf('};', start);
    expect(start).toBeGreaterThan(-1);
    const body = shellSource.slice(start, end);
    expect(body).toMatch(/setDiaryFoodTarget\(null\)/);
    expect(body).toMatch(/setRecipeQuantityPick\(null\)/);
    expect(body).toMatch(/setFoodQuantityPick\(null\)/);
    expect(body).not.toMatch(/setDiaryVisible/);
  });

  it('hosts a sheet inside the Diary and returns quantity cancellation to search', () => {
    const foodSearchStart = shellSource.indexOf('<FoodSearchScreen');
    const foodSearchEnd = shellSource.indexOf('<RegisterMealScreen', foodSearchStart);
    const body = shellSource.slice(foodSearchStart, foodSearchEnd);
    expect(body).not.toMatch(/setDiaryFoodTarget\(null\)/);
    expect(body).toContain('presentation="sheet"');
    expect(body).toContain('setFoodQuantityPick(null)');
    expect(body).toContain('setRecipeQuantityPick(null)');
    const diaryBody = shellSource.slice(shellSource.indexOf('<NutritionDiaryScreen'), foodSearchEnd);
    expect(diaryBody).toMatch(/overlay=\{\(\s*<FoodSearchScreen/);
  });

  it('the Diary\'s onAddFood routes through openDiaryFoodSearch, not a bare setDiaryFoodTarget', () => {
    const diaryCallStart = shellSource.indexOf('<NutritionDiaryScreen');
    const diaryCallEnd = shellSource.indexOf('<FoodSearchScreen', diaryCallStart);
    const body = shellSource.slice(diaryCallStart, diaryCallEnd);
    expect(body).toMatch(/onAddFood=\{\(slot\) => openDiaryFoodSearch\(slot\)\}/);
  });
  it('uses NuPanel for sheet presentation, with bounded height and keyboard handling', () => {
    const search = strip('src/screens/nutrition/FoodSearchScreen.tsx');
    const sheet = search.slice(search.indexOf("if (presentation === 'sheet')"), search.lastIndexOf('<Modal'));
    expect(sheet).toContain('<NuPanel visible={visible} onClose={searchExpanded ? dismissSearchKeyboard : onClose} avoidKeyboard');
    expect(sheet).toContain("outputRange: ['45%', '90%']");
    expect(search).toContain("Animated.timing(sheetHeight");
    expect(search).toContain("duration: 320");
    expect(search).toContain("keyboardWillHide");
    expect(search).toContain("keyboardDidHide");
    expect(search).toContain("autoFocus={presentation !== 'sheet'}");
    expect(search).toContain("onFocus={() => setSearchExpanded(true)}");
    expect(sheet).not.toMatch(/<Modal/);
    expect(sheet).toContain('{visible ? overlay : null}');
  });

});
