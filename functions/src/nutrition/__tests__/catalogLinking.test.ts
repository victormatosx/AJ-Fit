import { approveReview, rejectReview } from './reviewFixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeFoodRecord } from '../shared/nutrition/catalog/normalize';
import { normalizeFoodLogRecord } from '../shared/nutrition/foodLog/normalize';
import { catalogNutritionRevision, isCatalogLinkedOption } from '../shared/nutrition/catalog/binding';
import type { NutritionProfile, NutritionEngineOutput, NutritionFoodNutritionValues } from '../shared/types/nutrition';
import { CatalogSearchSession, type CatalogCandidate, type CatalogReader } from '../catalogLinking/search';
import { equivalenceScore, resolveIntent, restrictionFailure } from '../catalogLinking/resolver';
import { correctCatalogPortions, linkAndValidatePlan, linkAndValidateAlternative } from '../catalogLinking/pipeline';
import { catalogLinkingEnabled } from '../catalogLinking/config';
import { generateValidatedPlan } from '../generation/attempts';
import type { RawAiFoodItem } from '../generation/domain';

const n = { kcal: 124, proteinG: 2.6, carbsG: 25.8, fatG: 1, fiberG: 2.7 };
const names = { preferred: [], usual: [], excluded: [] };
const profile = { mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'omnivore', excludedAllergens: [], excludedFoodIds: [], supplements: [] } as unknown as NutritionProfile;
function taco(name = 'Arroz, integral, cozido', id = '1', nutrients: NutritionFoodNutritionValues = n): CatalogCandidate {
  return { collection: 'nutritionFoods', food: normalizeFoodRecord({ source: { type: 'taco', sourceId: id, sourceName: 'TACO' },
    name, category: 'cereal', nutritionPer100g: nutrients, generationStatus: 'pending_review' }, 'test-v1') as CatalogCandidate['food'] };
}
function off(name: string, brand: string, nutrients: NutritionFoodNutritionValues = n): CatalogCandidate {
  return { collection: 'foodLogCatalog', food: normalizeFoodLogRecord({ source: { type: 'off', sourceId: '12345678', sourceName: 'OFF' },
    name, brand: { name: brand }, category: 'other', status: 'active', nutritionPer100g: nutrients,
    provenance: { license: 'odbl_share_alike', attributionRequired: true, attributionText: 'OFF test attribution' } }, 'test-v1') as CatalogCandidate['food'] };
}
function intention(name = 'Arroz, integral, cozido', grams = 100): RawAiFoodItem {
  return { name, quantity: grams, unit: 'g', preparationNote: '', estimatedNutrition: { ...n }, allergens: [], ingredients: [{ name, origin: 'plant' }] };
}
function reader(foods: CatalogCandidate[]): CatalogReader {
  return { async page(collection, term, cursor, size) {
    const pool = foods.filter(c => c.collection === collection && c.food.searchPrefixes.includes(term) && (!cursor || c.food.id > cursor)).sort((a, b) => a.food.id < b.food.id ? -1 : a.food.id > b.food.id ? 1 : 0);
    const candidates = pool.slice(0, size);
    return { candidates, nextCursor: pool.length >= size ? candidates.at(-1)!.food.id : null };
  }, async get(collection, id) { return foods.find(c => c.collection === collection && c.food.id === id) ?? null; } };
}
const session = (a: CatalogCandidate[], maxReads?: number) => new CatalogSearchSession(reader(a), Date.now() + 20_000, maxReads);
function engine(value: NutritionFoodNutritionValues = n): NutritionEngineOutput {
  const range = (target: number, tolerance: number) => ({ target, min: target * (1 - tolerance), max: target * (1 + tolerance) });
  const target = { kcal: range(value.kcal, .05), proteinG: range(value.proteinG, .1), carbsG: range(value.carbsG, .1), fatG: range(value.fatG, .1), fiberG: range(value.fiberG!, .2) };
  return { mealTargets: profile.mealSlots.map(slot => ({ slot, ...target })), energy: { targetKcal: value.kcal * 2 },
    macros: { proteinG: value.proteinG * 2, carbsG: value.carbsG * 2, fatG: value.fatG * 2, fiberG: value.fiberG! * 2 } } as NutritionEngineOutput;
}
afterEach(() => vi.unstubAllEnvs());

describe('catalog linking identity and retrieval', () => {
  it('is OFF by default; only explicit backend true enables it', () => {
    vi.stubEnv('NUTRITION_CATALOG_LINKING_ENABLED', ''); expect(catalogLinkingEnabled()).toBe(false);
    vi.stubEnv('NUTRITION_CATALOG_LINKING_ENABLED', 'true'); expect(catalogLinkingEnabled()).toBe(true);
  });
  it('links pending TACO, ignores model nutrition and retains collection', async () => {
    const food = taco(); const intent = intention(); intent.estimatedNutrition.kcal = 900;
    const result = await resolveIntent(intent, session([food]), profile, names);
    expect(result.binding.collection).toBe('nutritionFoods'); expect(result.binding.nutritionPer100g.kcal).toBe(124);
  });
  it.each([['Arroz integral cozido', 'Arroz, integral, cozido'], ['Arroz branco cozido', 'Arroz, tipo 1, cozido'],
    ['Queijo mussarela', 'Queijo, muçarela'], ['Maçã crua', 'Maçã, crua']])('normalizes %s', async (requested, actual) => {
    expect((await resolveIntent(intention(requested), session([taco(actual)]), profile, names)).binding.foodId).toMatch(/^nf_/);
  });
  it.each([['Arroz branco cozido', 'Arroz, tipo 1, cru'], ['Frango grelhado', 'Frango empanado'],
    ['Leite sem lactose', 'Leite integral'], ['Iogurte proteico', 'Iogurte natural'], ['Pão sem glúten', 'Pão francês'],
    ['Feijão cozido', 'Feijão cru'], ['Banana', 'Biscoito sabor banana']])('rejects false equivalence %s', (wanted, actual) => {
    expect(equivalenceScore(intention(wanted), taco(actual))).toBe(-1);
  });
  it('requires explicit brand/full formulation; resolves OFF without approval metadata', async () => {
    const food = off('Iogurte proteico', 'Marca');
    expect(equivalenceScore(intention('Iogurte proteico'), food)).toBe(-1);
    expect((await resolveIntent(intention('Iogurte proteico Marca'), session([food]), profile, names)).binding.source.type).toBe('off');
  });
  it('rejects ambiguous exact names with different identities', async () => {
    await expect(resolveIntent(intention(), session([taco(undefined, '1'), taco(undefined, '2')]), profile, names)).rejects.toThrow('CATALOG_AMBIGUOUS');
  });
  it('preserves every page candidate and enforces a read budget without claiming absence', async () => {
    const foods = Array.from({ length: 90 }, (_, i) => taco(`Arroz ${i}`, String(i)));
    const s = session(foods); const got = [];
    for await (const c of s.candidates('arroz', true)) got.push(c.food.id);
    expect(new Set(got).size).toBe(90); expect(s.metrics.pages).toBeGreaterThan(2);
    const bounded = session(foods, 20);
    await expect((async () => { for await (const _ of bounded.candidates('arroz', true)) void _; })()).rejects.toThrow('CATALOG_BUDGET');
  });
  it('does not switch nf to flc or infer missing fiber', async () => {
    const nf = taco(); const flc = { collection: 'foodLogCatalog', food: normalizeFoodLogRecord({ source: nf.food.source,
      name: nf.food.name, category: 'cereal', nutritionPer100g: { ...n, fiberG: null },
      provenance: { license: 'public_domain', attributionRequired: false } }, 'v1') } as CatalogCandidate;
    const result = await resolveIntent(intention(), session([nf, flc]), profile, names);
    expect(result.binding.foodId).toBe(nf.food.id); expect(result.binding.nutritionPer100g.fiberG).toBe(2.7);
    await expect(resolveIntent(intention(), session([flc]), profile, names)).rejects.toThrow('CATALOG_NUTRITION');
  });
  it('fails on unavailable catalogs, timeout, missing and changed documents', async () => {
    await expect(resolveIntent(intention(), session([]), profile, names)).rejects.toThrow('CATALOG_NOT_FOUND');
    const s = new CatalogSearchSession({ ...reader([]), page: async () => { throw new Error('private backend error'); } });
    await expect(resolveIntent(intention(), s, profile, names)).rejects.toThrow('CATALOG_UNAVAILABLE');
    await expect(resolveIntent(intention(), new CatalogSearchSession(reader([]), Date.now() - 1), profile, names)).rejects.toThrow('CATALOG_TIMEOUT');
    const broken = { ...reader([taco()]), get: async () => null };
    await expect(resolveIntent(intention(), new CatalogSearchSession(broken), profile, names)).rejects.toThrow('CATALOG_CHANGED');
  });
});

describe('catalog restriction evidence is independent of model claims', () => {
  it.each(['milk', 'egg', 'soy', 'wheat', 'fish', 'shellfish', 'peanut', 'tree_nuts', 'other'] as const)('does not treat missing allergens as absence of %s', a => {
    expect(restrictionFailure(taco(), { ...profile, excludedAllergens: [a] }, names)).toBe('restriction');
  });
  it.each(['lactose', 'gluten'] as const)('requires explicit evidence for %s, even with reviewed empty allergens', a => {
    const c = taco(); Object.assign(c.food, { allergens: [] });
    expect(restrictionFailure(c, { ...profile, excludedSubstances: [a] }, names)).toBe('restriction');
    c.food.safetyEvidence = { schemaVersion: 1, reference: 'synthetic verified label', nutritionRevision: catalogNutritionRevision(c.food),
      absentSubstances: [a], dietaryPatterns: [], compositionReviewed: true };
    expect(restrictionFailure(c, { ...profile, excludedSubstances: [a] }, names)).toBeNull();
    c.food.nutritionPer100g.fatG++;
    expect(restrictionFailure(c, { ...profile, excludedSubstances: [a] }, names)).toBe('restriction');
  });
  it('allows deterministic simple TACO plant identity, rejects unknown commercial composition and explicit contradictions', () => {
    expect(restrictionFailure(taco(), { ...profile, dietaryPattern: 'vegan' }, names)).toBeNull();
    expect(restrictionFailure(off('Arroz', 'Marca'), { ...profile, dietaryPattern: 'vegetarian' }, names)).toBe('restriction');
    const cheese = taco('Queijo de leite'); Object.assign(cheese.food, { dietaryFlags: { vegan: true } });
    expect(restrictionFailure(cheese, { ...profile, dietaryPattern: 'vegan' }, names)).toBe('restriction');
  });
  it('excludes soy and milk across preparations and rejects unknown mixtures under exclusions', () => {
    expect(restrictionFailure(taco('Soja, farinha'), profile, { ...names, excluded: ['Soja'] })).toBe('restriction');
    expect(restrictionFailure(off('Mistura vegetariana', 'Marca'), profile, { ...names, excluded: ['Leite', 'Soja'] })).toBe('restriction');
  });
});

describe('catalog nutrition pipeline and compatibility', () => {
  it('recalculates fractions, rounds each item, validates meals/day and persists links', async () => {
    const p = { meals: profile.mealSlots.map(slot => ({ slot, foods: [intention(undefined, 100.25)] })) };
    const result = await linkAndValidatePlan(p, session([taco()]), profile, engine(), names);
    expect(isCatalogLinkedOption(result.meals[0].options[0].foods)).toBe(true);
    expect(result.meals[0].options[0].foods[0].estimatedNutrition!.kcal).toBe(124.31);
    expect(result.dailyTotals.kcal).toBe(248.62);
  });
  it('corrects grams using catalog composition; refuses absurd portions and impossible ratios', async () => {
    const resolved = await resolveIntent(intention(undefined, 80), session([taco()]), profile, names);
    expect(correctCatalogPortions([resolved], engine().mealTargets[0])).toBe(true);
    expect(resolved.binding.grams).toBeGreaterThan(80);
    await expect(resolveIntent(intention(undefined, 601), session([taco()]), profile, names)).rejects.toThrow('CATALOG_QUANTITY');
    const proteinTarget = engine(); proteinTarget.mealTargets[0].proteinG = { min: 30, target: 35, max: 40 };
    await expect(linkAndValidatePlan({ meals: profile.mealSlots.map(slot => ({ slot, foods: [intention()] })) }, session([taco()]), profile, proteinTarget, names)).rejects.toMatchObject({ code: 'AI_MACRO_VALIDATION_FAILED' });
  });
  it('links every alternative option with the same calculation authority', async () => {
    const result = await linkAndValidateAlternative({ recommendedOptionIndex: 0, options: [{ foods: [intention()] }, { foods: [intention(undefined, 101)] }] },
      session([taco()]), profile, 'breakfast', engine().mealTargets[0], names);
    expect(result.options.every(o => isCatalogLinkedOption(o.foods))).toBe(true);
  });
  it('repairs a reviewer-rejected unidentified food without restricting generation to the catalog', async () => {
    const provider = { reviewPlan: vi.fn().mockImplementationOnce(rejectReview).mockImplementation(approveReview), generatePlan: vi.fn().mockResolvedValueOnce({ output: { meals: profile.mealSlots.map(slot => ({ slot, foods: [intention('Unknown')] })) } })
      .mockResolvedValue({ output: { meals: profile.mealSlots.map(slot => ({ slot, foods: [intention()] })) }, model: 'fake', usage: {}, latencyMs: 1 }) };
    const result = await generateValidatedPlan(provider, profile, engine(), 'health', names, undefined, undefined, { catalogSession: session([taco()]), deadline: Date.now() + 20_000 });
    expect(result.attempt).toBe(2); expect(provider.generatePlan.mock.calls[0][0].catalogMode).toBeUndefined();
    expect(result.validated.meals[0].options[0].foods[0].catalogBinding).toBeUndefined();
    expect(result.review.version).toBeDefined();
  });
  it('keeps legacy free-form generation unchanged when no catalog session is supplied', async () => {
    const p = { reviewPlan: approveReview, generatePlan: vi.fn().mockResolvedValue({ output: { meals: profile.mealSlots.map(slot => ({ slot, foods: [intention('Comida livre')] })) }, model: 'fake' }) };
    const result = await generateValidatedPlan(p, profile, engine(), 'health', names);
    expect(result.validated.meals[0].options[0].foods[0].catalogBinding).toBeUndefined();
    expect(p.generatePlan.mock.calls[0][0].catalogMode).toBeUndefined();
  });
});

describe('additional safety boundaries', () => {
  it('does not persist an unknown allergen review as an empty reviewed list', async () => {
    const output = { meals: profile.mealSlots.map(slot => ({ slot, foods: [intention()] })) };
    const result = await linkAndValidatePlan(output, session([taco()]), profile, engine(), names);
    expect(result.meals[0].options[0].foods[0]).not.toHaveProperty('allergens');
  });
  it('rejects raw animal foods, implicit ingredients and hidden/deprecated records', async () => {
    const raw = taco('Frango, cru'); raw.food.category = 'protein_source';
    await expect(resolveIntent(intention('Frango, cru'), session([raw]), profile, names)).rejects.toThrow('CATALOG_PREPARATION');
    const mixed = intention(); mixed.ingredients.push({ name: 'Óleo', origin: 'plant' });
    await expect(resolveIntent(mixed, session([taco()]), profile, names)).rejects.toThrow('CATALOG_IDENTITY');
    for (const status of ['hidden', 'deprecated'] as const) {
      const food = off('Iogurte', 'Marca'); if ('status' in food.food) food.food.status = status;
      await expect(resolveIntent(intention('Iogurte Marca'), session([food]), profile, names)).rejects.toThrow('CATALOG_IDENTITY');
    }
  });
  it('allows well identified ordinary foods with critical exclusions without mandatory catalog records', async () => {
    const provider = { reviewPlan: vi.fn(approveReview), generatePlan: vi.fn().mockResolvedValue({ output: { meals: profile.mealSlots.map(slot => ({ slot, foods: [intention()] })) }, model: 'fake', usage: {}, latencyMs: 1 }) };
    await expect(generateValidatedPlan(provider, { ...profile, excludedSubstances: ['gluten'] }, engine(), 'health', names)).resolves.toBeTruthy();
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
    expect(provider.reviewPlan).toHaveBeenCalledTimes(1);
  });
  it('keeps dietary contradiction checks independent of a positive flag', () => {
    const c = taco('Frango grelhado'); Object.assign(c.food, { dietaryFlags: { vegetarian: true, vegan: true, pescatarian: true } });
    expect(restrictionFailure(c, { ...profile, dietaryPattern: 'vegetarian' }, names)).toBe('restriction');
    expect(restrictionFailure(taco('Arroz com camarão'), { ...profile, dietaryPattern: 'vegan' }, names)).toBe('restriction');
  });
});

describe('critical presence overrides an inconsistent absence attestation', () => {
  it('does not equate lactose-free milk to milk-allergy safety', () => {
    const c = off('Leite sem lactose', 'Marca');
    c.food.safetyEvidence = { schemaVersion: 1, reference: 'test evidence', nutritionRevision: catalogNutritionRevision(c.food),
      absentSubstances: ['milk', 'lactose'], dietaryPatterns: [], compositionReviewed: true };
    expect(restrictionFailure(c, { ...profile, excludedAllergens: ['milk'] }, names)).toBe('restriction');
    expect(restrictionFailure(c, { ...profile, excludedSubstances: ['lactose'] }, names)).toBeNull();
  });
});

describe('lactose intolerance distinguishes whey/dairy variants and plant protein', () => {
  const lactoseIntolerant = { ...profile, excludedSubstances: ['lactose'], supplements: ['whey_or_protein'] } as NutritionProfile;
  it('links verified zero-lactose whey for a vegetarian who selects supplements and prefers cassava', async () => {
    const whey = off('Whey protein isolado sem lactose', 'Marca');
    whey.food.safetyEvidence = { schemaVersion: 1, reference: 'synthetic reviewed label',
      nutritionRevision: catalogNutritionRevision(whey.food), absentSubstances: ['lactose'],
      dietaryPatterns: ['vegetarian'], compositionReviewed: true };
    const cassava = taco('Mandioca, cozida', 'cassava-verified');
    cassava.food.safetyEvidence = { schemaVersion: 1, reference: 'synthetic composition review',
      nutritionRevision: catalogNutritionRevision(cassava.food), absentSubstances: ['lactose'],
      dietaryPatterns: ['vegetarian'], compositionReviewed: true };
    const p = { ...lactoseIntolerant, dietaryPattern: 'vegetarian' as const,
      supplements: ['whey_or_protein' as const], preferredFoodIds: [cassava.food.id] };
    const requestedNames = { ...names, preferred: ['Mandioca, cozida'] };
    const items = [intention('Whey protein isolado sem lactose Marca'), intention('Mandioca, cozida')];
    items[0].ingredients = [{ name: items[0].name, origin: 'dairy' }];
    const provider = { reviewPlan: approveReview, generatePlan: vi.fn().mockResolvedValue({ output: {
      meals: p.mealSlots.map(slot => ({ slot, foods: items })) }, model: 'fake', usage: {}, latencyMs: 1 }) };
    const doubled = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v * 2])) as typeof n;
    const result = await generateValidatedPlan(provider, p, engine(doubled), 'health', requestedNames,
      undefined, undefined, { catalogSession: session([whey, cassava]) });
    expect(result.attempt).toBe(1);
    expect(result.review.evidence.map(e => e.foodId)).toContain(whey.food.id);
    expect(result.validated.meals[0].options[0].foods.map(f => f.name)).toEqual(items.map(i => i.name));
    expect(provider.generatePlan.mock.calls[0][0].catalogMode).toBeUndefined();
  });
  it('exhausts the existing budget when AI invents a lactose-free claim without catalog evidence', async () => {
    const whey = off('Whey protein isolado sem lactose', 'Marca');
    const item = intention('Whey protein isolado sem lactose Marca');
    const provider = { reviewPlan: approveReview, generatePlan: vi.fn().mockResolvedValue({ output: {
      meals: profile.mealSlots.map(slot => ({ slot, foods: [item] })) }, model: 'fake', usage: {}, latencyMs: 1 }) };
    await expect(generateValidatedPlan(provider, lactoseIntolerant, engine(), 'health', names,
      undefined, undefined, { catalogSession: session([whey]) })).rejects.toMatchObject({ code: 'AI_RETRY_EXHAUSTED', lastFailureCode: 'AI_EVIDENCE_INSUFFICIENT' });
    expect(provider.generatePlan).toHaveBeenCalledTimes(3);
  });
  it('rejects a generic whey product with no lactose-free confirmation', () => {
    const whey = off('Whey protein concentrado', 'Marca');
    expect(restrictionFailure(whey, lactoseIntolerant, names)).toBe('restriction');
  });
  it('rejects whey isolate/hydrolyzate too — the variant name alone is never treated as lactose-free', () => {
    for (const name of ['Whey protein isolado', 'Whey protein hidrolisado']) {
      const whey = off(name, 'Marca');
      expect(restrictionFailure(whey, lactoseIntolerant, names)).toBe('restriction');
    }
  });
  it('accepts whey explicitly confirmed lactose-free by reviewed catalog evidence', () => {
    const whey = off('Whey protein isolado sem lactose', 'Marca');
    whey.food.safetyEvidence = { schemaVersion: 1, reference: 'brand label, lactose-free certified', nutritionRevision: catalogNutritionRevision(whey.food),
      absentSubstances: ['lactose'], dietaryPatterns: [], compositionReviewed: true };
    expect(restrictionFailure(whey, lactoseIntolerant, names)).toBeNull();
  });
  it('plant protein is never classified as dairy, but still needs the same reviewed evidence bar as any other food under an active critical restriction', () => {
    const peaProtein = off('Proteina de ervilha isolada', 'Marca');
    // Unreviewed — the generic "any critical restriction requires evidence" rule applies
    // uniformly; a plant name is never a shortcut around it.
    expect(restrictionFailure(peaProtein, lactoseIntolerant, names)).toBe('restriction');
    peaProtein.food.safetyEvidence = { schemaVersion: 1, reference: 'plant-origin single ingredient', nutritionRevision: catalogNutritionRevision(peaProtein.food),
      absentSubstances: ['lactose'], dietaryPatterns: [], compositionReviewed: true };
    // Once reviewed, it passes without ever being routed through the dairy-presence check — unlike whey, its name never matches the dairy keyword regex.
    expect(restrictionFailure(peaProtein, lactoseIntolerant, names)).toBeNull();
  });
  it('leaves non-lactose-intolerant users unaffected by any of the above', () => {
    const whey = off('Whey protein concentrado', 'Marca');
    expect(restrictionFailure(whey, profile, names)).toBeNull();
  });
  it('still enforces the independent milk-allergy exclusion when only excludedAllergens is set (legacy accounts)', () => {
    const whey = off('Whey protein isolado sem lactose', 'Marca');
    whey.food.safetyEvidence = { schemaVersion: 1, reference: 'brand label', nutritionRevision: catalogNutritionRevision(whey.food),
      absentSubstances: ['lactose'], dietaryPatterns: [], compositionReviewed: true };
    // Evidence only ever attests substance absence, never allergen safety —
    // a legacy 'milk' allergy account must stay fully conservative regardless.
    expect(restrictionFailure(whey, { ...profile, excludedAllergens: ['milk'] }, names)).toBe('restriction');
  });
  it('combines with vegetarian/vegan dietary patterns independently', () => {
    const confirmedWhey = off('Whey protein isolado sem lactose', 'Marca');
    confirmedWhey.food.safetyEvidence = { schemaVersion: 1, reference: 'brand label', nutritionRevision: catalogNutritionRevision(confirmedWhey.food),
      absentSubstances: ['lactose'], dietaryPatterns: ['vegetarian'], compositionReviewed: true };
    expect(restrictionFailure(confirmedWhey, { ...lactoseIntolerant, dietaryPattern: 'vegetarian' }, names)).toBeNull();
    const peaProtein = off('Proteina de ervilha isolada', 'Marca');
    peaProtein.food.safetyEvidence = { schemaVersion: 1, reference: 'plant-origin single ingredient', nutritionRevision: catalogNutritionRevision(peaProtein.food),
      absentSubstances: ['lactose'], dietaryPatterns: ['vegan'], compositionReviewed: true };
    expect(restrictionFailure(peaProtein, { ...lactoseIntolerant, dietaryPattern: 'vegan' }, names)).toBeNull();
    const genericWhey = off('Whey protein concentrado', 'Marca');
    expect(restrictionFailure(genericWhey, { ...lactoseIntolerant, dietaryPattern: 'vegetarian' }, names)).toBe('restriction');
  });
  it('resolves a lactose-aware catalog plan end to end, retrying away from an unconfirmed whey toward a plant protein', async () => {
    // Distinct TACO ids — `off()`'s source id is fixed, and two different OFF
    // records sharing one id/collision defeats the catalog's identity check.
    const unconfirmedWhey = taco('Whey protein concentrado', 'whey-1');
    const peaProtein = taco('Proteina de ervilha isolada', 'pea-1');
    peaProtein.food.safetyEvidence = { schemaVersion: 1, reference: 'plant-origin single ingredient', nutritionRevision: catalogNutritionRevision(peaProtein.food),
      absentSubstances: ['lactose'], dietaryPatterns: [], compositionReviewed: true };
    const wheyIntent = () => ({ name: 'Whey protein concentrado', quantity: 100, unit: 'g', preparationNote: '',
      estimatedNutrition: { ...n }, allergens: ['milk'], ingredients: [{ name: 'Whey protein concentrado', origin: 'dairy' as const }] });
    const peaIntent = () => ({ name: 'Proteina de ervilha isolada', quantity: 100, unit: 'g', preparationNote: '',
      estimatedNutrition: { ...n }, allergens: [], ingredients: [{ name: 'Proteina de ervilha isolada', origin: 'plant' as const }] });
    const provider = { reviewPlan: approveReview, generatePlan: vi.fn()
      .mockResolvedValueOnce({ output: { meals: lactoseIntolerant.mealSlots.map(slot => ({ slot, foods: [wheyIntent()] })) } })
      .mockResolvedValue({ output: { meals: lactoseIntolerant.mealSlots.map(slot => ({ slot, foods: [peaIntent()] })) }, model: 'fake', usage: {}, latencyMs: 1 }) };
    const result = await generateValidatedPlan(provider, lactoseIntolerant, engine(), 'health', names, undefined, undefined,
      { catalogSession: session([unconfirmedWhey, peaProtein]), deadline: Date.now() + 20_000 });
    expect(result.attempt).toBe(2);
    expect(result.validated.meals[0].options[0].foods[0].catalogBinding).toBeUndefined();
    expect(result.review.version).toBeDefined();
  });
});
