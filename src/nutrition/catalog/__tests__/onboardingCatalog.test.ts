import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCatalogImportFile, prepareCatalogImport } from '../import';
import { onboardingCatalogFoods, searchOnboardingCatalog } from '../onboardingCatalog';
import { normalizeSearchText } from '../normalize';

describe('pre-auth public catalog', () => {
  it('contains exactly the canonical approved IDs, without private or pending entries', () => {
    const source = parseCatalogImportFile(readFileSync(resolve('scripts/nutrition/sources/taco-4a-edicao-2011-curated.json'), 'utf8'));
    expect(onboardingCatalogFoods.map((food) => food.id)).toEqual(prepareCatalogImport(source)
      .filter((food) => food.generationStatus === 'approved').map((food) => food.id));
    expect(onboardingCatalogFoods).toHaveLength(173);
  });
  it('uses the same normalized prefixes and id pagination as authenticated search', async () => {
    const text = 'ÁRROZ';
    const expected = onboardingCatalogFoods.filter((food) => food.searchPrefixes.includes(normalizeSearchText(text)));
    expect((await searchOnboardingCatalog(text)).foods).toEqual(expected.slice(0, 20));
    const page = await searchOnboardingCatalog('co');
    if (page.nextCursor) expect((await searchOnboardingCatalog('co', { cursor: page.nextCursor })).foods
      .every((food) => food.id > page.nextCursor!)).toBe(true);
  });
});
