import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/RegisterMealScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('RegisterMealScreen — single screen, no wizard', () => {
  it('never talks to Firestore/the diary service directly — every mutation is delegated', () => {
    // Round brief: "não criar um segundo sistema de diário". The actual
    // addDiaryFood/updateDiaryEntryGrams/removeDiaryEntry calls live in
    // NutritionShell (verified by nutritionShellRegression.test.ts); this
    // screen only reads `day` (a type-only import is fine) and calls its
    // three callback props — it never imports the write functions themselves.
    expect(source).not.toMatch(/\baddDiaryFood\b|\bupdateDiaryEntryGrams\b|\bremoveDiaryEntry\b/);
    expect(source).toMatch(/import type \{ NutritionDailyLogDoc \} from '\.\.\/\.\.\/services\/nutritionDiary'/);
    expect(source).toMatch(/onAddFood: \(slot: NutritionMealSlot, source: NutritionLoggedFoodSource, foodId: string, grams: number\) => Promise<void>/);
    expect(source).toMatch(/onEditGrams: \(slot: NutritionMealSlot, item: NutritionLoggedFoodItem, grams: number\) => Promise<void>/);
    expect(source).toMatch(/onRemove: \(slot: NutritionMealSlot, itemId: string\) => Promise<void>/);
  });

  it('never opens FoodSearchScreen as a separate page — search is embedded inline', () => {
    expect(source).not.toContain('FoodSearchScreen');
    // Fase C2: logging searches the amplo food-log catalog (TACO + Open
    // Food Facts), not the curated generation catalog — same inline
    // pattern as before, different catalog service.
    expect(source).toMatch(/import \{ listCustomFoods \} from '\.\.\/\.\.\/services\/nutritionFoods'/);
    expect(source).toMatch(/import \{ createLocalFoodLogSearchProvider \} from '\.\.\/\.\.\/services\/foodLogCatalog'/);
    expect(source).toMatch(/localFoodLogSearchProvider\.search\(query/);
    expect(source).toMatch(/recentIds: recentIdSet/);
    expect(source).toMatch(/cursor, favoriteIds: favoriteIdSet, recentIds: recentIdSet/);
  });

  it('has no separate "pick a slot first" step — the dropdown and the rest of the screen render together', () => {
    // Everything (dropdown, summary, search, item list) is inside one
    // `<ScrollView>`/header block with no step/stage state machine —
    // unlike the old flow, there is no `step === 'slot' | 'foods'` branch.
    expect(source).not.toMatch(/step === 'slot'|step === 'foods'|setStep\(/);
    expect(source).toMatch(/const \[slot, setSlot\] = useState<NutritionMealSlot>\(initialSlot \?\? NUTRITION_MEAL_SLOTS\[0\]\)/);
  });

  it('renders all six meal slots in a single dropdown', () => {
    expect(source).toMatch(/NUTRITION_MEAL_SLOTS\.map\(\(option\) =>/);
    expect(source).toMatch(/onPress=\{\(\) => \{ setSlot\(option\); setSlotMenuOpen\(false\); \}\}/);
  });

  it('derives the live summary and item list straight from the `day` prop, never from local state', () => {
    // No local mirror of items/totals — switching the dropdown or any
    // Firestore write (reflected back through `day`) updates this
    // derivation on the next render, nothing to resync manually.
    expect(source).toMatch(/const meal = day\?\.meals\.find\(\(item\) => item\.slot === slot\);/);
    expect(source).toMatch(/const items = meal\?\.items \?\? \[\];/);
    expect(source).toMatch(/const totals = meal\?\.totals \?\? emptyTotals\(\);/);
    expect(source).not.toMatch(/setItems\(/);
  });

  it('accepts an arbitrary gram amount for both adding and editing, never a fixed list of presets', () => {
    expect(source).toMatch(/keyboardType="decimal-pad"/);
    expect(source).toMatch(/const gramsValid = isPositiveGrams\(gramsValue\)/);
    expect(source).not.toMatch(/gramsPresets|servingOptions|commonPortions/);
  });

  it('shares one grams step/modal for both "add" and "edit", calling the matching callback prop', () => {
    expect(source).toMatch(/type GramsStep = \{ mode: 'add'; food: FoodPick \} \| \{ mode: 'edit'; item: NutritionLoggedFoodItem \}/);
    const confirmStart = source.indexOf('const confirmGrams');
    const confirmEnd = source.indexOf('};', confirmStart);
    const confirmBody = source.slice(confirmStart, confirmEnd);
    expect(confirmBody).toMatch(/if \(gramsStep\.mode === 'add'\) \{\s*await onAddFood\(slot, foodPickOriginToDiarySource\(gramsStep\.food\.origin\), gramsStep\.food\.foodId, gramsValue\);/);
    expect(confirmBody).toMatch(/await onEditGrams\(slot, gramsStep\.item, gramsValue\);/);
  });

  it('renders the grams step as a plain absolute overlay, not a second nested <Modal>', () => {
    // Regression: a second <Modal> stacked on top of the outer `pageSheet`
    // Modal sometimes failed to paint its own dimming background, leaving
    // the card's text overlapping the real screen behind it with no
    // backdrop. There must be exactly one `<Modal` (the outer one).
    expect(source.match(/<Modal\b/g)).toHaveLength(1);
    expect(source).toMatch(/\{gramsStep \? \(/);
    expect(source).toMatch(/position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme\.colors\.loadingOverlay/);
  });

  it('uses an OPAQUE sheet token for the grams card, never the near-transparent surfaceElevated token', () => {
    // Regression: `surfaceElevated` is only 5% white in the dark theme
    // (`alpha.white05`) — the card read as backgroundless, with the food
    // list bleeding through its own text. `sheetBackground` is solid in
    // both themes (see lightTokens.ts/tokens.ts).
    const cardStart = source.indexOf("gramsStep ? (");
    const cardBody = source.slice(cardStart, source.indexOf(') : null}', cardStart));
    expect(cardBody).not.toMatch(/backgroundColor: theme\.colors\.surfaceElevated/);
    expect(cardBody).toMatch(/backgroundColor: theme\.colors\.sheetBackground/);
    expect(cardBody).toMatch(/borderWidth: 1, borderColor: theme\.colors\.border,\s*padding: 22, gap: 16/);
  });

  it('forces the overlay above every sibling via explicit zIndex/elevation', () => {
    // Android resolves view stacking by `elevation` first, not just render
    // order — a sibling that happens to carry its own elevation could
    // otherwise paint on top of this overlay.
    expect(source).toMatch(/zIndex: 50, elevation: 50/);
  });

  it('renders referenceItems (free-form plan names) raw, never through the catalog-only formatFoodDisplayName', () => {
    // Regression for diet-quality-v3: referenceItems come straight from the
    // recommended option (no foodId/sourceId) — only the diary/catalog
    // lookups below (gramsStep.food.name / item.snapshot.name) go through
    // formatFoodDisplayName.
    const referenceBlockStart = source.indexOf('referenceItems!.map');
    const referenceBlockEnd = source.indexOf('))}', referenceBlockStart);
    const referenceBlock = source.slice(referenceBlockStart, referenceBlockEnd);
    expect(referenceBlock).not.toMatch(/formatFoodDisplayName/);
    expect(referenceBlock).toMatch(/\$\{food\.name\} — \$\{food\.quantity\} \$\{food\.unit\}/);
  });

  it('clears the search field automatically after a food is added', () => {
    const confirmStart = source.indexOf('const confirmGrams');
    const confirmEnd = source.indexOf('};', confirmStart);
    const confirmBody = source.slice(confirmStart, confirmEnd);
    expect(confirmBody).toMatch(/await onAddFood\(slot, foodPickOriginToDiarySource\(gramsStep\.food\.origin\), gramsStep\.food\.foodId, gramsValue\);\s*setSearchText\(''\);/);
    // Only the add branch clears it — editing an existing item's grams has nothing to do with search.
    expect(confirmBody).not.toMatch(/await onEditGrams\(slot, gramsStep\.item, gramsValue\);\s*setSearchText\(''\);/);
  });

  it('shows the full accumulated meal summary (kcal, protein, carbs, fat, fiber)', () => {
    expect(source).toMatch(/key: 'kcal', value: String\(Math\.round\(totals\.kcal\)\)/);
    expect(source).toMatch(/key: 'proteinG', value: totals\.proteinG\.toFixed\(1\)/);
    expect(source).toMatch(/key: 'carbsG', value: totals\.carbsG\.toFixed\(1\)/);
    expect(source).toMatch(/key: 'fatG', value: totals\.fatG\.toFixed\(1\)/);
    expect(source).toMatch(/key: 'fiberG', value: totals\.fiberG\.toFixed\(1\)/);
  });

  it('each listed item exposes an edit-grams and a remove action', () => {
    expect(source).toMatch(/onPress=\{\(\) => openEditGrams\(item\)\}/);
    expect(source).toMatch(/onPress=\{\(\) => confirmRemove\(item\)\}/);
  });

  it('has a clear close action and never breaks layout under the keyboard', () => {
    expect(source).toMatch(/<CtaButton onPress=\{onClose\}>\{t\('registerMeal\.close'\)\}<\/CtaButton>/);
    expect(source).toMatch(/KeyboardAvoidingView style=\{\{ flex: 1 \}\} behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
  });
});
