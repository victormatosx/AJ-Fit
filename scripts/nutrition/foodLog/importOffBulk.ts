#!/usr/bin/env -S node --import tsx
/**
 * Fase C3 — imports the Brazil-filtered JSONL produced by
 * `streamOffJsonl.ts` (official OFF bulk export, NOT the paginated search
 * API) into `foodLogCatalog`, in bounded-size chunks so the process never
 * holds the whole file in memory (round brief Part 3) — reads line by
 * line via `readline`, accumulates a chunk of `--chunk-size` records,
 * applies the SAME quality gate + mapping as `importOff.ts`
 * (`processOffBatch`, `src/nutrition/foodLog/offMapper.ts`), then writes
 * that chunk to Firestore (`writeFoodLogDocs`) before reading more lines.
 * `foodLogCatalogMeta/current` is written exactly ONCE at the very end
 * with the true cumulative totals (`writeFoodLogCatalogMeta`) — writing
 * it per chunk would overwrite `sourceCounts` with just that chunk's size.
 *
 * Idempotent and safely rerunnable: each per-document transaction only
 * updates a doc when its content actually changed, and barcode dedup is
 * tracked across the WHOLE run via one `Set`, not reset per chunk.
 *
 * Usage:
 *   node --import tsx scripts/nutrition/foodLog/importOffBulk.ts \
 *     --input scripts/nutrition/sources/off-brazil-bulk.jsonl \
 *     --confirm --project ajfit-2f321 --allow-current-test-project ajfit-2f321
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { processOffBatch } from '../../../src/nutrition/foodLog/offMapper';
import type { RawOffProduct } from '../../../src/nutrition/foodLog/offQualityFilter';
import { prepareFoodLogImport, type FoodLogImportFile } from '../../../src/nutrition/foodLog/import';
import { countFoodLogDocsBySource, writeFoodLogDocs, writeFoodLogCatalogMeta, flagValue } from './writeFoodLogImport';

const FOOD_LOG_CATALOG_VERSION = 'food-log-off-bulk-brazil-v1';

interface ImportCheckpoint {
  inputPath: string;
  inputBytes: number;
  inputMtimeMs: number;
  processedLines: number;
  catalogVersion: string;
  completed: boolean;
}

function increment(bucket: Record<string, number>, reason: string, amount = 1): void {
  bucket[reason] = (bucket[reason] ?? 0) + amount;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputPath = resolve(flagValue(args, '--input') ?? 'scripts/nutrition/sources/off-brazil-bulk.jsonl');
  const chunkSize = Number(flagValue(args, '--chunk-size') ?? '1000');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 5000) throw new Error('INVALID_CHUNK_SIZE');
  const checkpointPath = resolve(flagValue(args, '--checkpoint') ?? `${inputPath}.checkpoint.json`);
  const inputStat = statSync(inputPath);
  let resumeLines = 0;
  if (args.includes('--resume') && existsSync(checkpointPath)) {
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as ImportCheckpoint;
    if (checkpoint.inputPath !== inputPath || checkpoint.inputBytes !== inputStat.size
      || checkpoint.inputMtimeMs !== inputStat.mtimeMs || checkpoint.catalogVersion !== FOOD_LOG_CATALOG_VERSION) {
      throw new Error('OFF_IMPORT_CHECKPOINT_MISMATCH');
    }
    resumeLines = checkpoint.processedLines;
  }

  const seenBarcodes = new Set<string>();
  let totalFetched = 0;
  let totalParsed = 0;
  let parseErrors = 0;
  let totalAccepted = 0;
  let totalQualityRejected = 0;
  let totalNormalizeRejected = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const rejectedByReason: Record<string, number> = {};

  const rl = createInterface({ input: createReadStream(inputPath, 'utf8'), crlfDelay: Infinity });
  let buffer: RawOffProduct[] = [];

  async function flush(shouldWrite: boolean): Promise<void> {
    if (buffer.length === 0) return;
    const { accepted, rejected: qualityRejected } = processOffBatch(buffer, FOOD_LOG_CATALOG_VERSION, seenBarcodes, totalFetched - buffer.length);
    const file: FoodLogImportFile = { schemaVersion: 1, catalogVersion: FOOD_LOG_CATALOG_VERSION, records: accepted };
    const { foods, rejected: normalizeRejected } = prepareFoodLogImport(file);
    totalAccepted += foods.length;
    totalQualityRejected += qualityRejected.length;
    totalNormalizeRejected += normalizeRejected.length;
    for (const rejection of qualityRejected) increment(rejectedByReason, rejection.reason);
    for (const rejection of normalizeRejected) increment(rejectedByReason, rejection.reason);
    if (shouldWrite) {
      const counts = await writeFoodLogDocs(args, foods);
      created += counts.created; updated += counts.updated; unchanged += counts.unchanged;
      if (args.includes('--confirm')) {
        const checkpoint: ImportCheckpoint = {
          inputPath, inputBytes: inputStat.size, inputMtimeMs: inputStat.mtimeMs,
          processedLines: totalFetched, catalogVersion: FOOD_LOG_CATALOG_VERSION, completed: false,
        };
        writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
      }
    }
    buffer = [];
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalFetched += 1;
    try {
      buffer.push(JSON.parse(line) as RawOffProduct);
      totalParsed += 1;
    } catch {
      parseErrors += 1;
      increment(rejectedByReason, 'INVALID_JSON');
      continue;
    }
    if (buffer.length >= chunkSize) {
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential: write this chunk before reading the next (bounded memory).
      await flush(totalFetched > resumeLines);
      process.stdout.write(`progress: fetched=${totalFetched} accepted=${totalAccepted} created=${created} updated=${updated} unchanged=${unchanged}\n`);
    }
  }
  await flush(totalFetched > resumeLines);

  const observedSourceCount = await countFoodLogDocsBySource(args, 'off');
  const sourceCount = args.includes('--confirm')
    ? observedSourceCount ?? totalAccepted : observedSourceCount == null ? totalAccepted : observedSourceCount + created;
  await writeFoodLogCatalogMeta(args, 'off', FOOD_LOG_CATALOG_VERSION, sourceCount,
    totalQualityRejected + totalNormalizeRejected + parseErrors, [FOOD_LOG_CATALOG_VERSION]);
  if (args.includes('--confirm')) {
    const checkpoint: ImportCheckpoint = {
      inputPath, inputBytes: inputStat.size, inputMtimeMs: inputStat.mtimeMs,
      processedLines: totalFetched, catalogVersion: FOOD_LOG_CATALOG_VERSION, completed: true,
    };
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(JSON.stringify({
    catalogVersion: FOOD_LOG_CATALOG_VERSION, totalFetched, totalParsed, parseErrors, totalAccepted,
    totalQualityRejected, totalNormalizeRejected, created, updated, unchanged,
    rejectedByReason, sourceCount, resumedFromLine: resumeLines, checkpointPath,
    mode: args.includes('--confirm') ? 'WRITE' : 'DRY_RUN',
  }, null, 2) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
