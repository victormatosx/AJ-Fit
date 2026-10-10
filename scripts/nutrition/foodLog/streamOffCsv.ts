#!/usr/bin/env -S node --import tsx
/**
 * Streams OFF's official nightly CSV export (tab-separated, gzip), filters
 * the complete file to the Brazil market and writes a compact RawOffProduct
 * JSONL. This is the deterministic C3 fallback when a time-boxed prefix of
 * the much larger JSONL dump is barcode-order biased.
 */
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { evaluateOffProductQuality, offNutrientValue } from '../../../src/nutrition/foodLog/offQualityFilter';
import { isBrazilOffProduct, offCsvRowToProduct, parseOffCsvHeader } from '../../../src/nutrition/foodLog/offCsvMapper';
import { flagValue } from './writeFoodLogImport';

interface Metrics {
  totalRead: number;
  totalBrazil: number;
  totalWithName: number;
  totalWithKcal: number;
  totalWithProtein: number;
  totalWithCarbs: number;
  totalWithFat: number;
  totalWithAllMacros: number;
  totalAccepted: number;
  duplicateBarcodes: number;
  rejectedByReason: Record<string, number>;
}

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputPath = resolve(flagValue(args, '--input') ?? 'scripts/nutrition/sources/openfoodfacts-products.csv.gz');
  const outPath = resolve(flagValue(args, '--out') ?? 'scripts/nutrition/sources/off-brazil-csv.jsonl');
  const input = createReadStream(inputPath).pipe(createGunzip());
  const rl = createInterface({ input, crlfDelay: Infinity });
  const out = createWriteStream(outPath, { flags: 'w' });
  const metrics: Metrics = {
    totalRead: 0, totalBrazil: 0, totalWithName: 0, totalWithKcal: 0,
    totalWithProtein: 0, totalWithCarbs: 0, totalWithFat: 0, totalWithAllMacros: 0,
    totalAccepted: 0, duplicateBarcodes: 0, rejectedByReason: {},
  };
  const seenBarcodes = new Set<string>();
  let layout: ReturnType<typeof parseOffCsvHeader> | null = null;
  const startedAt = Date.now();

  for await (const line of rl) {
    if (!layout) { layout = parseOffCsvHeader(line); continue; }
    metrics.totalRead += 1;
    const product = offCsvRowToProduct(line, layout);
    if (!isBrazilOffProduct(product)) continue;
    metrics.totalBrazil += 1;
    if (product.product_name?.trim()) metrics.totalWithName += 1;
    const kcal = offNutrientValue(product.nutriments, 'energy-kcal_100g');
    const protein = offNutrientValue(product.nutriments, 'proteins_100g');
    const carbs = offNutrientValue(product.nutriments, 'carbohydrates_100g');
    const fat = offNutrientValue(product.nutriments, 'fat_100g');
    if (kcal != null) metrics.totalWithKcal += 1;
    if (protein != null) metrics.totalWithProtein += 1;
    if (carbs != null) metrics.totalWithCarbs += 1;
    if (fat != null) metrics.totalWithFat += 1;
    if ([kcal, protein, carbs, fat].every((value) => value != null)) metrics.totalWithAllMacros += 1;

    const quality = evaluateOffProductQuality(product);
    if (!quality.ok) increment(metrics.rejectedByReason, quality.reason);
    else {
      const barcode = product.code!.trim();
      if (seenBarcodes.has(barcode)) {
        metrics.duplicateBarcodes += 1;
        increment(metrics.rejectedByReason, 'DUPLICATE_BARCODE_IN_EXPORT');
      } else {
        seenBarcodes.add(barcode);
        metrics.totalAccepted += 1;
      }
    }
    if (!out.write(`${JSON.stringify(product)}\n`)) await once(out, 'drain');
    if (metrics.totalRead % 500_000 === 0) {
      process.stdout.write(`checkpoint: read=${metrics.totalRead} brazil=${metrics.totalBrazil} accepted=${metrics.totalAccepted}\n`);
    }
  }
  out.end();
  await once(out, 'finish');
  const rejected = Object.values(metrics.rejectedByReason).reduce((sum, value) => sum + value, 0);
  process.stdout.write(`${JSON.stringify({
    inputPath, outPath, ...metrics, rejected,
    acceptanceRateBrazil: Number((metrics.totalAccepted / Math.max(1, metrics.totalBrazil)).toFixed(4)),
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    inputBytes: existsSync(inputPath) ? statSync(inputPath).size : 0,
    outBytes: existsSync(outPath) ? statSync(outPath).size : 0,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
