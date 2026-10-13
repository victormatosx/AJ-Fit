#!/usr/bin/env -S node --import tsx
/** JSON adapter -> canonical validation -> dedupe -> dry-run or explicit Admin write. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCatalogImportFile, prepareCatalogImport } from '../../src/nutrition/catalog/import';
import { assertNotProductionProject } from '../../src/nutrition/catalog/projectGuard';

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = flagValue(args, '--input');
  if (!input) throw new Error('USAGE: --input path.json [--output canonical.json] [--confirm --project project-id]');
  const file = parseCatalogImportFile(readFileSync(resolve(input), 'utf8'));
  const foods = prepareCatalogImport(file);
  const output = flagValue(args, '--output');
  if (output) writeFileSync(resolve(output), JSON.stringify({ catalogVersion: file.catalogVersion, foods }, null, 2) + '\n');
  const counts = foods.reduce<Record<string, number>>((result, food) => {
    result[food.source.type] = (result[food.source.type] ?? 0) + 1;
    return result;
  }, {});
  const statusCounts = foods.reduce<Record<string, number>>((result, food) => {
    result[food.generationStatus] = (result[food.generationStatus] ?? 0) + 1;
    return result;
  }, {});
  process.stdout.write(JSON.stringify({ mode: args.includes('--confirm') ? 'WRITE' : 'DRY_RUN',
    catalogVersion: file.catalogVersion, count: foods.length, counts, statusCounts, output: output ?? null }) + '\n');
  if (!args.includes('--confirm')) return;
  const projectId = flagValue(args, '--project');
  if (!projectId) throw new Error('--confirm requires explicit --project');
  const rcPath = resolve(__dirname, '../../.firebaserc');
  if (existsSync(rcPath)) {
    assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'), flagValue(args, '--allow-current-test-project') ?? undefined);
  }
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const food of foods) {
    const ref = db.collection('nutritionFoods').doc(food.id);
    const result = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        const data = existing.data();
        if (data?.source?.type !== food.source.type || data?.source?.sourceId !== food.source.sourceId) throw new Error(`FOOD_ID_COLLISION:${food.id}`);
        const current = { ...data };
        delete current.createdAt;
        delete current.updatedAt;
        if (JSON.stringify(current) === JSON.stringify(food)) return 'unchanged';
        tx.set(ref, { ...food, createdAt: data?.createdAt, updatedAt: FieldValue.serverTimestamp() });
        return 'updated';
      }
      tx.create(ref, { ...food, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return 'created';
    });
    if (result === 'created') created += 1;
    else if (result === 'updated') updated += 1;
    else unchanged += 1;
  }
  const sourceVersions = Object.fromEntries([...new Set(foods.map((food) => food.source.type))].map((type) => [type,
    [...new Set(foods.filter((food) => food.source.type === type).map((food) => food.source.sourceVersion ?? 'unspecified'))].sort()]));
  await db.collection('nutritionCatalogMeta').doc('current').set({ schemaVersion: 1,
    catalogVersion: file.catalogVersion, importedAt: FieldValue.serverTimestamp(),
    sourceVersions, sourceCounts: counts, statusCounts, importedRecordCount: foods.length });
  process.stdout.write(JSON.stringify({ created, updated, unchanged }) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
