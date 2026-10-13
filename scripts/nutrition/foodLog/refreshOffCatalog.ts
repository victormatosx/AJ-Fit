#!/usr/bin/env -S node --import tsx
/**
 * Operational OFF refresh: stream a complete Brazil JSONL snapshot, stage
 * a deterministic diff against Firestore, print it, and write only after
 * explicit --confirm --full-snapshot. Products are never deleted: active
 * rows missing from (or rejected in) the full source become deprecated so
 * historical diary snapshots and references remain intact.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { processOffBatch } from '../../../src/nutrition/foodLog/offMapper';
import type { RawOffProduct } from '../../../src/nutrition/foodLog/offQualityFilter';
import { foodLogId, type FoodLogEntryBody } from '../../../src/nutrition/foodLog/normalize';
import { prepareFoodLogImport } from '../../../src/nutrition/foodLog/import';
import { diffFoodLogRefresh } from '../../../src/nutrition/foodLog/refresh';
import { assertNotProductionProject } from '../../../src/nutrition/catalog/projectGuard';
import type { FoodLogEntry } from '../../../src/types/nutrition';
import { flagValue, writeFoodLogCatalogMeta, writeFoodLogDocs } from './writeFoodLogImport';

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectId = flagValue(args, '--project');
  if (!projectId) throw new Error('USAGE: --project <id> [--input file] [--full-snapshot] [--confirm]');
  const inputPath = resolve(flagValue(args, '--input') ?? 'scripts/nutrition/sources/off-brazil-csv.jsonl');
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
  const catalogVersion = flagValue(args, '--catalog-version') ?? `food-log-off-refresh-${localDate}`;
  const minimumSnapshotLines = Number(flagValue(args, '--minimum-snapshot-lines') ?? '30000');
  const fullSnapshot = args.includes('--full-snapshot');
  const shouldWrite = args.includes('--confirm');
  if (!Number.isInteger(minimumSnapshotLines) || minimumSnapshotLines < 1) throw new Error('INVALID_MINIMUM_SNAPSHOT_LINES');
  if (shouldWrite && !fullSnapshot) throw new Error('--confirm requires --full-snapshot');
  if (!existsSync(inputPath)) throw new Error(`INPUT_NOT_FOUND:${inputPath}`);
  if (shouldWrite) {
    const rcPath = resolve(__dirname, '../../../.firebaserc');
    if (existsSync(rcPath)) assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'),
      flagValue(args, '--allow-current-test-project') ?? undefined);
  }

  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const incoming: FoodLogEntryBody[] = [];
  const rejectedIds = new Set<string>();
  const seenBarcodes = new Set<string>();
  const rejectedByReason: Record<string, number> = {};
  let totalLines = 0;
  let parseErrors = 0;
  const rl = createInterface({ input: createReadStream(inputPath, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const index = totalLines++;
    let raw: RawOffProduct;
    try { raw = JSON.parse(line) as RawOffProduct; }
    catch { parseErrors += 1; increment(rejectedByReason, 'INVALID_JSON'); continue; }
    const processed = processOffBatch([raw], catalogVersion, seenBarcodes, index);
    if (processed.rejected.length > 0) {
      const reason = processed.rejected[0].reason;
      increment(rejectedByReason, reason);
      const sourceId = raw.code?.trim();
      if (sourceId && /^[0-9]{8,14}$/u.test(sourceId)) rejectedIds.add(foodLogId('off', sourceId));
      continue;
    }
    const prepared = prepareFoodLogImport({ schemaVersion: 1, catalogVersion, records: processed.accepted });
    if (prepared.foods.length === 1) incoming.push(prepared.foods[0]);
    else {
      const reason = prepared.rejected[0]?.reason ?? 'NORMALIZATION_REJECTED';
      increment(rejectedByReason, reason);
      const sourceId = raw.code?.trim();
      if (sourceId && /^[0-9]{8,14}$/u.test(sourceId)) rejectedIds.add(foodLogId('off', sourceId));
    }
  }
  for (const entry of incoming) rejectedIds.delete(entry.id);
  if (fullSnapshot && totalLines < minimumSnapshotLines) {
    throw new Error(`INCOMPLETE_OFF_SNAPSHOT:${totalLines}<${minimumSnapshotLines}`);
  }

  const currentSnap = await db.collection('foodLogCatalog').where('source.type', '==', 'off').get();
  const current = currentSnap.docs.map((snapshot) => snapshot.data() as FoodLogEntry);
  const diff = diffFoodLogRefresh(current, incoming, rejectedIds, fullSnapshot);
  const report = {
    mode: shouldWrite ? 'WRITE' : 'DRY_RUN', projectId, inputPath,
    inputBytes: statSync(inputPath).size, catalogVersion, fullSnapshot, totalLines,
    accepted: incoming.length, rejected: Object.values(rejectedByReason).reduce((sum, count) => sum + count, 0),
    parseErrors, rejectedByReason,
    currentOffDocuments: current.length,
    new: diff.newEntries.length, changed: diff.changedEntries.length, unchanged: diff.unchangedIds.length,
    removedToDeprecated: diff.deprecations.filter((item) => item.reason === 'missing_from_source').length,
    rejectedToDeprecated: diff.deprecations.filter((item) => item.reason === 'source_record_rejected').length,
    alreadyInactive: diff.alreadyInactiveIds.length,
    samples: {
      new: diff.newEntries.slice(0, 10).map((item) => ({ id: item.id, name: item.name })),
      changed: diff.changedEntries.slice(0, 10).map((item) => ({ id: item.id, name: item.name })),
      deprecated: diff.deprecations.slice(0, 10),
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!shouldWrite) return;

  const writeCounts = await writeFoodLogDocs(args, [...diff.newEntries, ...diff.changedEntries]);
  for (let index = 0; index < diff.deprecations.length; index += 400) {
    const batch = db.batch();
    for (const deprecation of diff.deprecations.slice(index, index + 400)) {
      batch.update(db.collection('foodLogCatalog').doc(deprecation.id), {
        status: 'deprecated',
        deprecation: { reason: deprecation.reason, sourceVersion: catalogVersion },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    // eslint-disable-next-line no-await-in-loop -- bounded Firestore batches, safe rerun.
    await batch.commit();
  }
  await writeFoodLogCatalogMeta(args, 'off', catalogVersion, current.length + diff.newEntries.length,
    report.rejected, [catalogVersion]);
  process.stdout.write(`${JSON.stringify({ applied: true, writeCounts, deprecated: diff.deprecations.length })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
