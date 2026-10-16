#!/usr/bin/env -S node --import tsx
/**
 * One-time backfill: adds `servings`/`defaultServingId` to existing OFF
 * `foodLogCatalog` docs that were imported before the Fase C6 serving-units
 * pipeline existed (see docs/nutrition/catalog-expansion — OFF serving
 * coverage audit, 2026-10). Field-level `update()` only — never a full
 * document `set()` — so this is structurally incapable of touching any
 * other field (macros, id, name, barcode, status, provenance, ...).
 *
 * Safety gates, checked in a read-only PLAN pass before any write:
 *   - target doc must exist (never creates)
 *   - target doc's status must be 'active' (never touches deprecated/hidden)
 *   - target doc's source.type must be 'off' (never touches TACO/TBCA/FatSecret)
 *   - the only keys allowed to differ are `servings`/`defaultServingId`
 *     (computed via a full-object diff against the current doc) — any
 *     other diff is an ANOMALY and aborts the whole run before any writes.
 *
 * Writes are chunked (400/batch, Firestore's limit) and checkpointed after
 * every successful batch commit (`--checkpoint`), so a crash or Ctrl-C
 * loses at most one in-flight batch and a `--resume` rerun skips
 * already-written IDs rather than re-touching them.
 *
 * Usage (dry run / plan only, default):
 *   node --import tsx scripts/nutrition/foodLog/backfillOffServings.ts \
 *     --project ajfit-2f321
 * Usage (write):
 *   node --import tsx scripts/nutrition/foodLog/backfillOffServings.ts \
 *     --project ajfit-2f321 --allow-current-test-project ajfit-2f321 --confirm [--resume]
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { processOffBatch } from '../../../src/nutrition/foodLog/offMapper';
import type { RawOffProduct } from '../../../src/nutrition/foodLog/offQualityFilter';
import { prepareFoodLogImport } from '../../../src/nutrition/foodLog/import';
import { assertNotProductionProject } from '../../../src/nutrition/catalog/projectGuard';
import { flagValue } from './writeFoodLogImport';

const CATALOG_VERSION = 'food-log-off-bulk-brazil-v1';
const BATCH_SIZE = 400;

interface PlannedUpdate { id: string; servings: unknown; defaultServingId: unknown }
interface Anomaly { id: string; issue: string; detail?: unknown }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectId = flagValue(args, '--project');
  if (!projectId) throw new Error('USAGE: --project <firebase-project-id> [--confirm] [--resume]');
  const shouldWrite = args.includes('--confirm');
  const inputPath = resolve(flagValue(args, '--input') ?? 'scripts/nutrition/sources/off-brazil-csv.jsonl');
  const checkpointPath = resolve(flagValue(args, '--checkpoint') ?? `${inputPath}.backfill-servings.checkpoint.json`);
  const failureLogPath = resolve(flagValue(args, '--failure-log') ?? `${inputPath}.backfill-servings.failures.json`);

  if (shouldWrite) {
    const rcPath = resolve(__dirname, '../../../.firebaserc');
    if (existsSync(rcPath)) assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'),
      flagValue(args, '--allow-current-test-project') ?? undefined);
  }

  const seenBarcodes = new Set<string>();
  const rl = createInterface({ input: createReadStream(inputPath, 'utf8'), crlfDelay: Infinity });
  const buffer: RawOffProduct[] = [];
  for await (const line of rl) { if (line.trim()) buffer.push(JSON.parse(line) as RawOffProduct); }
  const { accepted } = processOffBatch(buffer, CATALOG_VERSION, seenBarcodes, 0);
  const foods = [];
  for (let i = 0; i < accepted.length; i += 1000) {
    const prepared = prepareFoodLogImport({ schemaVersion: 1, catalogVersion: CATALOG_VERSION, records: accepted.slice(i, i + 1000) });
    foods.push(...prepared.foods);
  }

  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  // PLAN pass — strictly read-only, decides the full write set before any write happens.
  const planned: PlannedUpdate[] = [];
  const anomalies: Anomaly[] = [];
  let unchanged = 0;
  let missing = 0;
  for (let i = 0; i < foods.length; i += BATCH_SIZE) {
    const chunk = foods.slice(i, i + BATCH_SIZE);
    const refs = chunk.map((food) => db.collection('foodLogCatalog').doc(food.id));
    // eslint-disable-next-line no-await-in-loop -- bounded sequential read, same shape as every other script here.
    const snaps = await db.getAll(...refs);
    chunk.forEach((food, idx) => {
      const existing = snaps[idx];
      if (!existing.exists) { missing += 1; anomalies.push({ id: food.id, issue: 'MISSING_DOC' }); return; }
      const data = existing.data() as Record<string, unknown>;
      if (data.status !== 'active') { anomalies.push({ id: food.id, issue: 'NOT_ACTIVE', detail: data.status }); return; }
      if ((data.source as { type?: string } | undefined)?.type !== 'off') { anomalies.push({ id: food.id, issue: 'WRONG_SOURCE_TYPE' }); return; }
      const current: Record<string, unknown> = { ...data };
      delete current.createdAt; delete current.updatedAt;
      const foodRecord = food as unknown as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(current), ...Object.keys(foodRecord)]);
      const diffKeys = [...allKeys].filter((key) => !isDeepStrictEqual(current[key], foodRecord[key]));
      if (diffKeys.length === 0) { unchanged += 1; return; }
      if (!diffKeys.every((key) => key === 'servings' || key === 'defaultServingId')) {
        anomalies.push({ id: food.id, issue: 'UNEXPECTED_FIELD_DIFF', detail: diffKeys }); return;
      }
      planned.push({ id: food.id, servings: foodRecord.servings, defaultServingId: foodRecord.defaultServingId });
    });
  }

  const report = {
    mode: shouldWrite ? 'WRITE' : 'PLAN_ONLY', projectId, inputPath,
    totalFoods: foods.length, plannedUpdates: planned.length, unchanged, missing, anomalyCount: anomalies.length,
    anomalySample: anomalies.slice(0, 20),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (anomalies.length > 0) {
    writeFileSync(failureLogPath, `${JSON.stringify({ anomalies }, null, 2)}\n`, 'utf8');
    throw new Error(`ABORTING: ${anomalies.length} unexpected difference(s) found — nothing written. See ${failureLogPath}`);
  }
  if (!shouldWrite) return;

  let resumeIds = new Set<string>();
  if (args.includes('--resume') && existsSync(checkpointPath)) {
    resumeIds = new Set<string>(JSON.parse(readFileSync(checkpointPath, 'utf8')) as string[]);
  }
  const remaining = planned.filter((item) => !resumeIds.has(item.id));
  const doneIds = [...resumeIds];
  const failures: { id: string; error: string }[] = [];
  let updated = 0;

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const chunk = remaining.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const item of chunk) {
      batch.update(db.collection('foodLogCatalog').doc(item.id),
        { servings: item.servings, defaultServingId: item.defaultServingId, updatedAt: FieldValue.serverTimestamp() });
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential, checkpointed batches; intentional.
      await batch.commit();
      updated += chunk.length;
      doneIds.push(...chunk.map((item) => item.id));
      writeFileSync(checkpointPath, JSON.stringify(doneIds), 'utf8');
      process.stdout.write(`progress: updated=${updated}/${remaining.length}\n`);
    } catch (error) {
      failures.push(...chunk.map((item) => ({ id: item.id, error: error instanceof Error ? error.message : String(error) })));
      writeFileSync(failureLogPath, `${JSON.stringify({ failures }, null, 2)}\n`, 'utf8');
      throw new Error(`STOPPED at batch starting index ${i}: ${failures.length} failure(s) logged to ${failureLogPath}. `
        + `Checkpoint has ${doneIds.length} confirmed writes — rerun with --resume to continue.`);
    }
  }
  process.stdout.write(`${JSON.stringify({ applied: true, updated, skippedAlreadyDone: resumeIds.size })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
