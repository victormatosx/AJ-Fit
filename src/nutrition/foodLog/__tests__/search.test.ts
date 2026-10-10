import { describe, expect, it } from 'vitest';
import { buildFoodLogSearchPlan, matchesRefineWords } from '../search';
import type { FoodLogEntry } from '../../../types/nutrition';

function entry(name: string, aliases: string[] = []): FoodLogEntry {
  return { id: 'x', name, aliases, source: { type: 'taco', sourceId: '1', sourceName: 'TACO' },
    locale: 'pt-BR', category: 'protein_source',
    nutritionPer100g: { kcal: 100, proteinG: 10, carbsG: 0, fatG: 5, fiberG: null },
    status: 'active', provenance: { license: 'public_domain', attributionRequired: false },
    catalogVersion: 'v1', searchPrefixes: [], searchSourcePriority: 0, createdAt: null, updatedAt: null } as FoodLogEntry;
}

describe('buildFoodLogSearchPlan', () => {
  it('picks the longest non-stopword word as the anchor, others as refine words', () => {
    expect(buildFoodLogSearchPlan('peito de frango')).toMatchObject({ anchorWord: 'frango', refineWords: ['peito'] });
    expect(buildFoodLogSearchPlan('coxa de frango')).toMatchObject({ anchorWord: 'frango', refineWords: ['coxa'] });
  });

  it('drops Portuguese stopwords entirely from both anchor and refine', () => {
    const plan = buildFoodLogSearchPlan('arroz com feijao');
    expect(plan.anchorWord).toBe('feijao');
    expect(plan.refineWords).toEqual(['arroz']);
    expect(plan.refineWords).not.toContain('com');
  });

  it('falls back to the whole normalized text as the anchor for a single word or only-stopword input', () => {
    expect(buildFoodLogSearchPlan('frango')).toMatchObject({ anchorWord: 'frango', refineWords: [] });
  });

  it('expands the anchor into its synonym group (Fase C3), capped at 10 Firestore array-contains-any terms', () => {
    const plan = buildFoodLogSearchPlan('mussarela');
    expect(plan.anchorWord).toBe('mussarela');
    expect(plan.anchorTerms).toEqual(expect.arrayContaining(['mussarela', 'mucarela']));
    expect(plan.anchorTerms.length).toBeLessThanOrEqual(10);
  });

  it('anchorTerms is just [anchorWord] when the anchor belongs to no synonym group', () => {
    expect(buildFoodLogSearchPlan('frango').anchorTerms).toEqual(['frango']);
  });

  it('expands multivitamínico to the English prefix present in the OFF corpus', () => {
    expect(buildFoodLogSearchPlan('multivitamínico').anchorTerms)
      .toEqual(expect.arrayContaining(['multivitaminico', 'multivitamin', 'multivitamins']));
  });

  it('returns a safe empty plan for empty/stopword-only input (the service rejects it before Firestore)', () => {
    expect(buildFoodLogSearchPlan('')).toEqual({ anchorWord: '', anchorTerms: [], refineWords: [] });
    expect(buildFoodLogSearchPlan('de com')).toEqual({ anchorWord: 'de com', anchorTerms: ['de com'], refineWords: [] });
  });

  it.each([
    ['contrafilé', ['contrafile', 'contra file']], ['contra filé', ['contra']],
    ['muçarela', ['mucarela', 'mussarela']], ['mussarela', ['mussarela', 'mucarela']],
    ['tilápia', ['tilapia']], ['estrogonofe', ['estrogonofe', 'strogonoff']],
    ['strogonoff', ['strogonoff', 'estrogonofe']],
  ])('normalizes and expands mandatory C2 gap query %s', (query, expectedTerms) => {
    expect(buildFoodLogSearchPlan(query).anchorTerms).toEqual(expect.arrayContaining(expectedTerms));
  });
});

describe('matchesRefineWords', () => {
  it('is vacuously true when there are no refine words', () => {
    expect(matchesRefineWords(entry('Arroz'), [])).toBe(true);
  });

  it('matches when every refine word is a substring of the name', () => {
    expect(matchesRefineWords(entry('Frango, peito, sem pele, cru'), ['peito'])).toBe(true);
    expect(matchesRefineWords(entry('Frango, coxa, com pele, crua'), ['coxa'])).toBe(true);
  });

  it('matches via alias when the name alone does not contain the refine word', () => {
    expect(matchesRefineWords(entry('Mandioca', ['Aipim']), ['aipim'])).toBe(true);
  });

  it('requires ALL refine words to match, not just one', () => {
    expect(matchesRefineWords(entry('Frango, peito, sem pele, cru'), ['peito', 'grelhado'])).toBe(false);
  });

  it('is accent-insensitive', () => {
    expect(matchesRefineWords(entry('Muçarela'), ['mucarela'])).toBe(true);
  });

  it('covers the mandatory multi-word C2 gaps during client refinement', () => {
    expect(matchesRefineWords(entry('Peito de frango desfiado'), buildFoodLogSearchPlan('frango desfiado').refineWords)).toBe(true);
    expect(matchesRefineWords(entry('Estrogonofe de frango'), ['strogonoff'])).toBe(true);
  });
});
