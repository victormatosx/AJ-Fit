/**
 * Shared dry-run/confirm Firestore writer for the Fase C2/C3 food-log
 * catalog importers (`importTaco.ts`, `importOff.ts`, `importOffBulk.ts`)
 * — same shape as `scripts/nutrition/importCatalog.ts` (generation
 * catalog), reused instead of duplicated: parse/normalize -> dry-run
 * report -> explicit `--confirm --project` Admin write, with the same
 * `assertNotProductionProject` guard. Writes `foodLogCatalog/{id}` +
 * `foodLogCatalogMeta/current`, never `nutritionFoods`/`nutritionCatalogMeta`
 * (separate collections, `docs/nutrition/catalog-expansion/03_canonical_model.md`).
 *
 * Split into `writeFoodLogDocs` (per-document writes only) and
 * `writeFoodLogCatalogMeta` (the summary doc) so a multi-chunk streamed
 * import (`importOffBulk.ts`) can call the former once per chunk — paying
 * down Firestore writes incrementally, true to round brief C3 Part 3's
 * "batching" requirement — while calling the latter exactly ONCE at the
 * end with the TRUE cumulative total. Calling the old combined function
 * once per chunk would have overwritten `sourceCounts` with just the
 * last chunk's size instead of the cumulative count — this split exists
 * specifically to avoid that bug.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { FoodLogEntryBody } from '../../../src/nutrition/foodLog/normalize';
import { assertNotProductionProject } from '../../../src/nutrition/catalog/projectGuard';

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function resolveProjectId(argv: string[], requireConfirm = true): string | null {
  if (requireConfirm && !argv.includes('--confirm')) return null;
  const projectId = flagValue(argv, '--project');
  if (!projectId) {
    if (argv.includes('--confirm')) throw new Error('--confirm requires explicit --project');
    return null;
  }
  const rcPath = resolve(__dirname, '../../../.firebaserc');
  if (existsSync(rcPath)) {
    assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'), flagValue(argv, '--allow-current-test-project') ?? undefined);
  }
  return projectId;
}

async function getDb(projectId: string) {
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore();
}

export interface WriteCounts { created: number; updated: number; unchanged: number }

/** Writes (or dry-run reports) one batch of `foods` as `foodLogCatalog` documents. Never touches `foodLogCatalogMeta` — call `writeFoodLogCatalogMeta` separately, once, with cumulative totals. */
export async function writeFoodLogDocs(argv: string[], foods: FoodLogEntryBody[]): Promise<WriteCounts> {
  const projectId = resolveProjectId(argv, false);
  if (!projectId) return { created: 0, updated: 0, unchanged: 0 };
  const shouldWrite = argv.includes('--confirm');
  const db = await getDb(projectId);
  const { FieldValue } = await import('firebase-admin/firestore');
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const BATCH_SIZE = 400;
  const MAX_CONCURRENT_BATCHES = 4;
  const chunks: FoodLogEntryBody[][] = [];
  for (let i = 0; i < foods.length; i += BATCH_SIZE) chunks.push(foods.slice(i, i + BATCH_SIZE));
  const processChunk = async (chunk: FoodLogEntryBody[]): Promise<WriteCounts> => {
    let chunkCreated = 0;
    let chunkUpdated = 0;
    let chunkUnchanged = 0;
    const refs = chunk.map((food) => db.collection('foodLogCatalog').doc(food.id));
    const existingSnapshots = await db.getAll(...refs);
    const batch = db.batch();
    let writes = 0;
    chunk.forEach((food, index) => {
      const existing = existingSnapshots[index];
      if (existing.exists) {
        const data = existing.data();
        if (data?.source?.type !== food.source.type || data?.source?.sourceId !== food.source.sourceId) throw new Error(`FOOD_LOG_ID_COLLISION:${food.id}`);
        const current = { ...data };
        delete current.createdAt;
        delete current.updatedAt;
        if (isDeepStrictEqual(current, food)) { chunkUnchanged += 1; return; }
        if (shouldWrite) batch.set(refs[index], { ...food, createdAt: data?.createdAt, updatedAt: FieldValue.serverTimestamp() });
        chunkUpdated += 1;
      } else {
        if (shouldWrite) batch.create(refs[index], { ...food, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        chunkCreated += 1;
      }
      writes += 1;
    });
    if (shouldWrite && writes > 0) await batch.commit();
    return { created: chunkCreated, updated: chunkUpdated, unchanged: chunkUnchanged };
  };
  for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_BATCHES) {
    // eslint-disable-next-line no-await-in-loop -- bounded concurrency prevents an unbounded Admin SDK request burst.
    const counts = await Promise.all(chunks.slice(i, i + MAX_CONCURRENT_BATCHES).map(processChunk));
    for (const count of counts) {
      created += count.created;
      updated += count.updated;
      unchanged += count.unchanged;
    }
  }
  return { created, updated, unchanged };
}

export async function countFoodLogDocsBySource(argv: string[], sourceType: string): Promise<number | null> {
  const projectId = resolveProjectId(argv, false);
  if (!projectId) return null;
  const db = await getDb(projectId);
  const snapshot = await db.collection('foodLogCatalog').where('source.type', '==', sourceType).count().get();
  return snapshot.data().count;
}

/** Writes `foodLogCatalogMeta/current`, merging `sourceType`'s counts into whatever other sources are already recorded there. Call exactly once per import run, with the TRUE cumulative `acceptedCount`/`rejectedCount`/`sourceVersions` for that run — never per-chunk. */
export async function writeFoodLogCatalogMeta(
  argv: string[], sourceType: string, catalogVersion: string,
  acceptedCount: number, rejectedCount: number, sourceVersions: readonly string[],
): Promise<void> {
  const projectId = resolveProjectId(argv);
  if (!projectId) return;
  const db = await getDb(projectId);
  const { FieldValue } = await import('firebase-admin/firestore');
  const metaRef = db.collection('foodLogCatalogMeta').doc('current');
  const metaSnap = await metaRef.get();
  const previous = metaSnap.exists ? metaSnap.data() as {
    sourceVersions?: Record<string, string[]>; sourceCounts?: Record<string, number>;
    rejectedCounts?: Record<string, number>; importedRecordCount?: number;
  } : {};
  const nextSourceVersions = { ...previous.sourceVersions, [sourceType]: [...new Set(sourceVersions)].sort() };
  const sourceCounts = { ...previous.sourceCounts, [sourceType]: acceptedCount };
  const rejectedCounts = { ...previous.rejectedCounts, [sourceType]: rejectedCount };
  const importedRecordCount = Object.values(sourceCounts).reduce((sum: number, value) => sum + (value as number), 0);
  await metaRef.set({ schemaVersion: 1, catalogVersion, importedAt: FieldValue.serverTimestamp(),
    sourceVersions: nextSourceVersions, sourceCounts, rejectedCounts, importedRecordCount });
}

export interface FoodLogImportReport {
  sourceType: string;
  catalogVersion: string;
  accepted: number;
  rejected: number;
  rejectedSample: { index: number; reason: string }[];
}

/** Single-shot import (whole file fits in memory) — `importTaco.ts`/`importOff.ts`. Prints a dry-run/write report, then composes `writeFoodLogDocs` + `writeFoodLogCatalogMeta`. */
export async function runFoodLogImport(
  argv: string[], sourceType: string, catalogVersion: string,
  foods: FoodLogEntryBody[], rejected: { index: number; reason: string }[],
): Promise<void> {
  const report: FoodLogImportReport = {
    sourceType, catalogVersion, accepted: foods.length, rejected: rejected.length,
    rejectedSample: rejected.slice(0, 20),
  };
  process.stdout.write(JSON.stringify({ mode: argv.includes('--confirm') ? 'WRITE' : 'DRY_RUN', ...report }) + '\n');
  const counts = await writeFoodLogDocs(argv, foods);
  process.stdout.write(JSON.stringify(counts) + '\n');
  if (!argv.includes('--confirm')) return;
  await writeFoodLogCatalogMeta(argv, sourceType, catalogVersion, foods.length, rejected.length,
    foods.map((food) => food.source.sourceVersion ?? 'unspecified'));
}

export { flagValue };
