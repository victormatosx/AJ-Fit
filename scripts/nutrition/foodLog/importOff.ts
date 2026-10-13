#!/usr/bin/env -S node --import tsx
/**
 * Fase C2 — turns the raw products fetched by `fetchOff.ts`
 * (`scripts/nutrition/sources/off-brazil-raw.json`) into `foodLogCatalog`
 * entries. Quality gate (`evaluateOffProductQuality`) and mapping
 * (`processOffBatch`, shared with Fase C3's `importOffBulk.ts`) are both
 * deterministic, pure functions — every rejection is reported with a
 * reason, nothing is silently dropped (round brief C2 Part 6/14).
 *
 * Respects the ODbL/share-alike conclusion from
 * `docs/nutrition/catalog-expansion/05_licensing_and_storage.md`:
 * every record keeps `source.type: 'off'` + full provenance/attribution,
 * is never merged into TACO records, and the `license: 'odbl_share_alike'`
 * flag travels with each document so a future UI/legal review can audit
 * attribution coverage directly from Firestore.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { processOffBatch } from '../../../src/nutrition/foodLog/offMapper';
import type { RawOffProduct } from '../../../src/nutrition/foodLog/offQualityFilter';
import { prepareFoodLogImport, type FoodLogImportFile } from '../../../src/nutrition/foodLog/import';
import { runFoodLogImport, flagValue } from './writeFoodLogImport';

const FOOD_LOG_CATALOG_VERSION = 'food-log-off-brazil-v1';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputPath = resolve(flagValue(args, '--input') ?? 'scripts/nutrition/sources/off-brazil-raw.json');
  const products = JSON.parse(readFileSync(inputPath, 'utf8')) as RawOffProduct[];

  const { accepted, rejected: qualityRejected } = processOffBatch(products, FOOD_LOG_CATALOG_VERSION, new Set());

  const file: FoodLogImportFile = { schemaVersion: 1, catalogVersion: FOOD_LOG_CATALOG_VERSION, records: accepted };
  const { foods, rejected: normalizeRejected } = prepareFoodLogImport(file);
  const rejected = [...qualityRejected, ...normalizeRejected];
  process.stdout.write(JSON.stringify({ fetched: products.length, qualityRejected: qualityRejected.length,
    normalizeRejected: normalizeRejected.length, accepted: foods.length }) + '\n');
  await runFoodLogImport(args, 'off', FOOD_LOG_CATALOG_VERSION, foods, rejected);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
