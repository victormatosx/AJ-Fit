#!/usr/bin/env -S node --import tsx
/**
 * Fase C7 ("serving units", completion round) — backfills the
 * reviewed-generic natural units (`genericServingRules.ts`) onto TACO/TBCA
 * `foodLogCatalog` docs imported BEFORE that table existed. Same dry-run
 * (default) / `--confirm` (write) shape as `backfillC3Metadata.ts`.
 *
 * Why this is needed: `normalizeFoodLogRecord` only computes `servings`
 * at NORMALIZE time — re-running `importTaco.ts` would pick them up, but
 * a document already sitting in Firestore from an earlier import never
 * gets re-normalized on its own. This is the other half of "ovo/mussarela
 * ainda aparecem em 100 g" (the other half is the UI fix in
 * `FoodSearchScreen.tsx`/`RegisterMealScreen.tsx`).
 *
 * Only ever ADDS `servings`/`defaultServingId` to a doc that has none yet
 * and whose name matches a reviewed-generic rule — never touches
 * nutrient values, never overwrites a provider-declared/already-backfilled
 * serving, never touches OFF/FatSecret docs (those get their official
 * serving from the importer/materializer itself, not this generic table).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genericServingUnitsFor } from '../../../src/nutrition/foodLog/genericServingRules';
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

  const snapshot = await db.collection('foodLogCatalog')
    .where('source.type', 'in', ['taco', 'tbca']).get();
  const planned: { ref: FirebaseFirestore.DocumentReference; servings: ReturnType<typeof genericServingUnitsFor>; defaultServingId: string }[] = [];
  let skippedAlreadyHasServings = 0;
  let skippedNoRuleMatch = 0;
  for (const document of snapshot.docs) {
    const food = document.data() as FoodLogEntry;
    if (food.servings && food.servings.length > 0) { skippedAlreadyHasServings += 1; continue; }
    const servings = genericServingUnitsFor(food.name);
    if (servings.length === 0) { skippedNoRuleMatch += 1; continue; }
    planned.push({ ref: document.ref, servings, defaultServingId: servings[0].id });
  }

  process.stdout.write(`${JSON.stringify({
    mode: args.includes('--confirm') ? 'WRITE' : 'DRY_RUN',
    scanned: snapshot.size, toUpdate: planned.length, skippedAlreadyHasServings, skippedNoRuleMatch,
  })}\n`);
  if (!args.includes('--confirm')) return;

  for (let offset = 0; offset < planned.length; offset += 400) {
    const batch = db.batch();
    for (const item of planned.slice(offset, offset + 400)) {
      batch.update(item.ref, { servings: item.servings, defaultServingId: item.defaultServingId, updatedAt: FieldValue.serverTimestamp() });
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
