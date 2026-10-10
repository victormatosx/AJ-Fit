#!/usr/bin/env -S node --import tsx
/**
 * Fase 33 round brief §11: catalog coverage audit CLI.
 *
 * Usage:
 *   npm run nutrition:catalog:audit -- --input path/to/foods.json
 *
 * `--input` accepts either the `{ catalogVersion, foods }` shape that
 * `importCatalog.ts --output` writes, or a raw array of food bodies.
 * The actual report logic lives in `src/nutrition/catalog/audit.ts` (it
 * reuses the real candidate-selection logic in
 * `functions/src/nutrition/generation/domain.ts` rather than
 * reimplementing eligibility rules) so it's covered by the normal test
 * suite; this file is just the thin CLI wrapper.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCatalogAuditReport } from '../../src/nutrition/catalog/audit';
import type { NutritionFood } from '../../src/types/nutrition';

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function loadFoods(path: string): NutritionFood[] {
  const parsed: unknown = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const foods = Array.isArray(parsed) ? parsed : (parsed as { foods?: unknown }).foods;
  if (!Array.isArray(foods)) throw new Error('INVALID_AUDIT_INPUT: expected an array or { foods: [...] }');
  return foods as NutritionFood[];
}

function main(): void {
  const args = process.argv.slice(2);
  const input = flagValue(args, '--input');
  if (!input) throw new Error('USAGE: --input path/to/foods.json');
  const report = buildCatalogAuditReport(loadFoods(input));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
