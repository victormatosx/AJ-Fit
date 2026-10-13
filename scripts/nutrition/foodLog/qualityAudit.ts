#!/usr/bin/env -S node --import tsx
/**
 * Fase C3 Part 13 — read-only quality audit over the real `foodLogCatalog`.
 * Reports flags; never mutates macros. `--apply-hidden <FLAG>` is an
 * explicit, opt-in escape hatch to flip a flag classified as severe by
 * the audited policy to `status: 'hidden'` — still
 * requires `--confirm --project` like every other write script here, and
 * is deliberately NOT run automatically by this script's default
 * (read-only) mode.
 *
 * Usage:
 *   node --import tsx scripts/nutrition/foodLog/qualityAudit.ts --project ajfit-2f321
 *   node --import tsx scripts/nutrition/foodLog/qualityAudit.ts --project ajfit-2f321 \
 *     --apply-hidden ZERO_KCAL_WITH_MACROS --confirm --allow-current-test-project ajfit-2f321
 */
import { isSevereQualityFlag, summarizeQualityAudit, type QualityFlag } from '../../../src/nutrition/foodLog/qualityAudit';
import type { FoodLogEntry } from '../../../src/types/nutrition';
import { flagValue } from './writeFoodLogImport';
import { assertNotProductionProject } from '../../../src/nutrition/catalog/projectGuard';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectId = flagValue(args, '--project');
  if (!projectId) throw new Error('USAGE: --project <firebase-project-id>');
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const entries: FoodLogEntry[] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collection('foodLogCatalog').orderBy('__name__').limit(1000);
    if (last) q = q.startAfter(last);
    // eslint-disable-next-line no-await-in-loop -- sequential pagination over the whole catalog, bounded by its real size.
    const snap = await q.get();
    if (snap.empty) break;
    entries.push(...snap.docs.map((docSnap) => docSnap.data() as FoodLogEntry));
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  }

  const summary = summarizeQualityAudit(entries);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  const applyFlag = flagValue(args, '--apply-hidden') as QualityFlag | null;
  if (!applyFlag) return;
  if (!isSevereQualityFlag(applyFlag)) {
    throw new Error('ONLY_SEVERE_QUALITY_FLAGS_CAN_BE_HIDDEN');
  }
  if (!args.includes('--confirm')) throw new Error('--apply-hidden requires --confirm');
  const rcPath = resolve(__dirname, '../../../.firebaserc');
  if (existsSync(rcPath)) {
    assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'), flagValue(args, '--allow-current-test-project') ?? undefined);
  }
  const ids = (summary.samples[applyFlag] ?? []).map((item) => item.id);
  const fullFlagged = entries.filter((entry) => summarizeQualityAudit([entry]).flagCounts[applyFlag]).map((entry) => entry.id);
  const targetIds = [...new Set([...ids, ...fullFlagged])];
  let hidden = 0;
  for (const id of targetIds) {
    // eslint-disable-next-line no-await-in-loop -- one doc at a time, bounded by the flagged set size.
    await db.collection('foodLogCatalog').doc(id).update({ status: 'hidden' });
    hidden += 1;
  }
  process.stdout.write(JSON.stringify({ appliedFlag: applyFlag, hidden }) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
