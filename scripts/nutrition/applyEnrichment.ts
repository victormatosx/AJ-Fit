#!/usr/bin/env -S node --import tsx
/**
 * Fase 33 round brief §7-9: applies a hand-authored, versioned enrichment
 * file (per-item dietaryFlags/allergens with a stated rationale — see
 * `sources/taco-v1-enrichment.json`) on top of the raw TACO import records.
 * Deliberately NOT a classifier — every override is one line in a
 * human-reviewable JSON file, keyed by `sourceId`, never inferred from a
 * keyword function. Foods with no matching enrichment entry are left
 * exactly as the raw source produced them (allergens: null, dietaryFlags
 * all null, generationStatus: pending_review).
 *
 * Usage:
 *   node --import tsx scripts/nutrition/applyEnrichment.ts \
 *     --input sources/taco-4a-edicao-2011-raw.json \
 *     --enrichment sources/taco-v1-enrichment.json \
 *     --output sources/taco-4a-edicao-2011-curated.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NUTRITION_GENERATION_ALLOWED_PREPARATIONS, type NutritionFoodPreparation, type NutritionMealContext } from '../../src/types/nutrition';

interface EnrichmentItem {
  sourceId: string;
  name: string;
  dietaryFlags: { vegetarian: boolean; vegan: boolean; pescatarian: boolean };
  allergens: string[];
  /** `composite` (à milanesa, frito, lasanha, etc.) never resolves to `approved` below, regardless of everything else. */
  preparation: NutritionFoodPreparation;
  mealContexts: NutritionMealContext[];
  /**
   * Fiber-catalog-widening round (2026-10-10) — set ONLY on a per-item,
   * hand-reviewed basis for foods whose class has no dietary fiber by
   * definition (simple animal-source protein/dairy/eggs) and whose raw
   * TACO `fiberG` is null (unmeasured, not a real zero reading). Applied
   * below ONLY when the raw record's fiberG is actually null — never
   * overwrites a real measured value, and never applied generically.
   */
  inferFiberGZero?: true;
  rationale: string;
}

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function main(): void {
  const args = process.argv.slice(2);
  const input = flagValue(args, '--input');
  const enrichmentPath = flagValue(args, '--enrichment');
  const output = flagValue(args, '--output');
  if (!input || !enrichmentPath || !output) throw new Error('USAGE: --input <raw.json> --enrichment <enrichment.json> --output <curated.json>');

  const raw = JSON.parse(readFileSync(resolve(input), 'utf8')) as {
    schemaVersion: 1; catalogVersion: string; records: Array<Record<string, unknown>>;
  };
  const enrichment = JSON.parse(readFileSync(resolve(enrichmentPath), 'utf8')) as { items: EnrichmentItem[] };
  const bySourceId = new Map(enrichment.items.map((item) => [item.sourceId, item]));

  let curatedCount = 0;
  const records = raw.records.map((record) => {
    const source = record.source as { sourceId: string };
    const item = bySourceId.get(source.sourceId);
    if (!item) return record;
    curatedCount += 1;
    const nutritionPer100g = record.nutritionPer100g as { fiberG: number | null };
    const shouldInferFiberZero = item.inferFiberGZero === true && nutritionPer100g.fiberG === null;
    return {
      ...record,
      ...(shouldInferFiberZero
        ? { nutritionPer100g: { ...nutritionPer100g, fiberG: 0 }, fiberGProvenance: 'inferred_zero' as const }
        : {}),
      dietaryFlags: item.dietaryFlags,
      allergens: item.allergens,
      preparation: item.preparation,
      mealContexts: item.mealContexts,
      generationStatus: NUTRITION_GENERATION_ALLOWED_PREPARATIONS.includes(item.preparation) ? 'approved' : 'blocked',
    };
  });

  const matchedSourceIds = new Set(raw.records.map((r) => (r.source as { sourceId: string }).sourceId));
  const unmatched = enrichment.items.filter((item) => !matchedSourceIds.has(item.sourceId));
  if (unmatched.length > 0) {
    throw new Error(`ENRICHMENT_SOURCE_ID_NOT_FOUND: ${unmatched.map((i) => i.sourceId).join(', ')}`);
  }

  writeFileSync(resolve(output), `${JSON.stringify({ ...raw, records }, null, 2)}\n`);
  process.stdout.write(`Applied enrichment to ${curatedCount}/${enrichment.items.length} items `
    + `(${raw.records.length} total records, ${raw.records.length - curatedCount} left pending_review).\n`);
}

main();
