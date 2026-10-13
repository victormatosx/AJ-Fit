#!/usr/bin/env -S node --import tsx
/**
 * Fase 33 round brief §16-18: sets `nutritionRolloutConfig/active` to
 * `{ enabled: true, percentage: 100 }` for both flags — "every user of
 * this test build sees Nutrition", WITHOUT touching the rollout mechanism
 * itself (`nutritionFlagEnabled`/bucket hashing/fail-safe-on-missing-config
 * all stay exactly as implemented; this just writes one config document a
 * project admin could equally write by hand in the Firebase console).
 *
 * Same production guard as `importCatalog.ts` — refuses to run against
 * whatever `.firebaserc` calls "production".
 *
 * Usage:
 *   node --import tsx scripts/nutrition/setTestRollout.ts --project <test-project-id> --confirm
 *
 * Without --confirm, prints the exact document it WOULD write and exits —
 * same dry-run-by-default posture as importCatalog.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNotProductionProject } from '../../src/nutrition/catalog/projectGuard';

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

const TEST_CONFIG = {
  nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
  nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectId = flagValue(args, '--project');
  if (!projectId) throw new Error('USAGE: --project <test-project-id> [--confirm]');
  const rcPath = resolve(__dirname, '../../.firebaserc');
  if (existsSync(rcPath)) {
    assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'), flagValue(args, '--allow-current-test-project') ?? undefined);
  }

  process.stdout.write(`Target doc: nutritionRolloutConfig/active (project ${projectId})\n`
    + `${JSON.stringify(TEST_CONFIG, null, 2)}\n`);
  if (!args.includes('--confirm')) {
    process.stdout.write('\nDRY_RUN — re-run with --confirm to write this document.\n');
    return;
  }
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  await db.collection('nutritionRolloutConfig').doc('active').set(TEST_CONFIG);
  process.stdout.write('\nWRITE complete.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
