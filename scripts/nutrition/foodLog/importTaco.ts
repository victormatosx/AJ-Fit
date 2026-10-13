#!/usr/bin/env -S node --import tsx
/**
 * Fase C2 — makes the FULL existing TACO dataset (519 records, including the
 * ~461 whose `generationStatus` is `pending_review` for AI-generation
 * purposes) available in the amplo food-log catalog. Round brief: a food
 * missing allergen/dietary review does NOT block logging/search — it only
 * blocks AI generation, which stays gated by `nutritionFoods`'
 * `generationStatus` untouched by this script. This script never writes to
 * `nutritionFoods`/`nutritionCatalogMeta`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareFoodLogImport, type FoodLogImportFile } from '../../../src/nutrition/foodLog/import';
import type { RawFoodLogRecord } from '../../../src/nutrition/foodLog/normalize';
import { runFoodLogImport } from './writeFoodLogImport';

interface TacoGenerationRecord {
  source: { type: string; sourceId: string; sourceName: string; sourceVersion?: string };
  name: string;
  aliases?: string[];
  category: string;
  nutritionPer100g: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number | null };
}

const FOOD_LOG_CATALOG_VERSION = 'food-log-taco-4a-edicao-2011-v1';

function toFoodLogRecord(record: TacoGenerationRecord): RawFoodLogRecord {
  return {
    source: record.source,
    name: record.name,
    aliases: record.aliases,
    category: record.category,
    nutritionPer100g: record.nutritionPer100g,
    locale: 'pt-BR',
    status: 'active',
    // TACO (NEPA/UNICAMP) — public-domain-in-practice government dataset,
    // attribution recommended but not contractually required
    // (`docs/nutrition/catalog-expansion/05_licensing_and_storage.md`).
    provenance: { license: 'public_domain', attributionRequired: false,
      attributionText: 'TACO - Tabela Brasileira de Composicao de Alimentos, NEPA/UNICAMP, 4a edicao revisada e ampliada (2011)' },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputPath = resolve(__dirname, '../sources/taco-4a-edicao-2011-curated.json');
  const source = JSON.parse(readFileSync(inputPath, 'utf8')) as { records: TacoGenerationRecord[] };
  const file: FoodLogImportFile = {
    schemaVersion: 1, catalogVersion: FOOD_LOG_CATALOG_VERSION,
    records: source.records.map(toFoodLogRecord),
  };
  const { foods, rejected } = prepareFoodLogImport(file);
  await runFoodLogImport(args, 'taco', FOOD_LOG_CATALOG_VERSION, foods, rejected);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
