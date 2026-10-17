/** Generates a public-data-only snapshot. Never reads credentials or writes Firestore. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCatalogImportFile, prepareCatalogImport } from '../../src/nutrition/catalog/import';

const root = resolve(__dirname, '../..');
const source = parseCatalogImportFile(readFileSync(resolve(root,
  'scripts/nutrition/sources/taco-4a-edicao-2011-curated.json'), 'utf8'));
const foods = prepareCatalogImport(source).filter((food) => food.generationStatus === 'approved')
  .map(({ id, name, aliases, nutritionPer100g, source, searchPrefixes }) =>
    ({ id, name, aliases, nutritionPer100g, source, searchPrefixes }));
const output = JSON.stringify({ version: source.catalogVersion, foods }) + '\n';
const target = resolve(root, 'src/nutrition/catalog/onboardingCatalog.json');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('STALE_ONBOARDING_CATALOG');
} else writeFileSync(target, output);
console.log(`Onboarding catalog: ${foods.length} approved foods, ${Buffer.byteLength(output)} bytes`);
