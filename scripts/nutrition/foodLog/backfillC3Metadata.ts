#!/usr/bin/env -S node --import tsx
/** Backfills only additive C3 logging-search metadata on legacy C2 OFF docs. Nutrient/source values are never changed. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeAliases, searchPrefixes } from '../../../src/nutrition/catalog/normalize';
import { deriveHyphenCompoundAliases } from '../../../src/nutrition/foodLog/aliases';
import { classifyFoodLogSubCategory } from '../../../src/nutrition/foodLog/subCategory';
import { assertNotProductionProject } from '../../../src/nutrition/catalog/projectGuard';
import type { FoodLogEntry } from '../../../src/types/nutrition';
import { flagValue } from './writeFoodLogImport';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectId = flagValue(args, '--project');
  if (!projectId) throw new Error('USAGE: --project <firebase-project-id> [--confirm]');
  const rcPath = resolve(__dirname, '../../../.firebaserc');
  if (existsSync(rcPath)) assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'), flagValue(args, '--allow-current-test-project') ?? undefined);
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const snapshot = await db.collection('foodLogCatalog').where('catalogVersion', '==', 'food-log-off-brazil-v1').get();
  const planned = snapshot.docs.map((document) => {
    const food = document.data() as FoodLogEntry;
    const aliasCandidates = [...food.aliases, ...(food.brand?.name ? [food.brand.name] : []), ...deriveHyphenCompoundAliases(food.name)];
    const aliases = normalizeAliases(aliasCandidates.slice(0, 12), food.name);
    return { ref: document.ref, aliases, searchPrefixes: searchPrefixes(food.name, aliases), searchSourcePriority: 1 as const,
      subCategory: classifyFoodLogSubCategory(food.name, food.category, food.brand != null) };
  });
  process.stdout.write(`${JSON.stringify({ mode: args.includes('--confirm') ? 'WRITE' : 'DRY_RUN', matched: planned.length })}\n`);
  if (!args.includes('--confirm')) return;
  for (let offset = 0; offset < planned.length; offset += 400) {
    const batch = db.batch();
    for (const item of planned.slice(offset, offset + 400)) {
      batch.update(item.ref, { aliases: item.aliases, searchPrefixes: item.searchPrefixes,
        searchSourcePriority: item.searchSourcePriority, subCategory: item.subCategory, updatedAt: FieldValue.serverTimestamp() });
    }
    // eslint-disable-next-line no-await-in-loop -- bounded Admin batch.
    await batch.commit();
  }
  process.stdout.write(`${JSON.stringify({ updated: planned.length })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
