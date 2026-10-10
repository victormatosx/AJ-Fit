#!/usr/bin/env -S node --import tsx
/**
 * Fase 33 round brief §21-24: MANUAL, OPT-IN smoke test of a single real
 * full-plan generation against the real OpenAI API. Never runs in CI
 * (nothing here is wired into any test command), and does nothing at all
 * unless explicitly armed — see the guards below.
 *
 * Prerequisites this script does NOT set up for you (by design — it must
 * never silently provision any of these):
 *   - a Firebase project that is genuinely NOT production (`.firebaserc`'s
 *     "production" alias is refused, same guard as `importCatalog.ts`);
 *   - that project's `nutritionFoods` collection actually has `approved`
 *     foods with enough category/slot coverage (`nutrition:catalog:audit`
 *     tells you if it doesn't — generation will otherwise fail closed with
 *     CATALOG_INSUFFICIENT, which is correct behavior, not a bug);
 *   - `nutritionRolloutConfig/active` with both flags enabled for the test
 *     uid (see `setTestRollout.ts`);
 *   - a real test user (`--uid`) with an existing, eligible
 *     `nutritionProfile/current`, questionnaire answers and a recent
 *     assessment — this script does not create or mutate any of that;
 *   - `OPENAI_API_KEY` in this shell's environment (NOT the Firebase
 *     Functions secret mechanism, since this runs standalone, outside the
 *     deployed Functions runtime).
 *
 * Usage:
 *   NUTRITION_REAL_AI_SMOKE=1 OPENAI_API_KEY=sk-... \
 *     node --import tsx scripts/nutrition/realAiSmokeTest.ts \
 *     --project <test-project-id> --uid <existing-test-uid>
 *
 * Omitting NUTRITION_REAL_AI_SMOKE leaves this a no-op (prints SKIP, exits
 * 0) — exactly the behavior a CI run or an accidental invocation gets.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  if (process.env.NUTRITION_REAL_AI_SMOKE !== '1') {
    process.stdout.write('SKIP: set NUTRITION_REAL_AI_SMOKE=1 to opt in. This never runs automatically or in CI.\n');
    return;
  }
  const args = process.argv.slice(2);
  const projectId = flagValue(args, '--project');
  const uid = flagValue(args, '--uid');
  if (!projectId || !uid) throw new Error('USAGE: --project <test-project-id> --uid <existing-test-uid>');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set in this shell. Refusing to proceed without it.');

  const { assertNotProductionProject } = await import('../../src/nutrition/catalog/projectGuard');
  const rcPath = resolve(__dirname, '../../.firebaserc');
  if (existsSync(rcPath)) assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'), flagValue(args, '--allow-current-test-project') ?? undefined);

  // `functions/` has its OWN `node_modules/firebase-admin`, separate from
  // this repo root's copy. Creating our own `db` here via the root copy
  // and passing it into functions/src code would make every `instanceof
  // Timestamp` check inside that code (e.g. `context.ts`'s `validProfile`)
  // compare against the WRONG Timestamp class and silently fail closed —
  // discovered the hard way debugging this exact script. Importing
  // `functions/src/lib/firebaseAdmin` instead reuses the SAME
  // firebase-admin instance the production code already uses, which is
  // also the only correct way to target a specific project id locally
  // (that module's own `initializeApp()` takes no args, relying on
  // `GCLOUD_PROJECT`/ADC auto-detection).
  process.env.GCLOUD_PROJECT = projectId;
  const { db } = await import('../../functions/src/lib/firebaseAdmin');

  const { requestNutritionPlanGenerationHandler } = await import('../../functions/src/nutrition/generation/request');
  const { processNutritionGenerationJob } = await import('../../functions/src/nutrition/generation/worker');
  const { OpenAiNutritionProvider } = await import('../../functions/src/nutrition/ai/provider');

  process.stdout.write(`Project: ${projectId}\nUID: ${uid}\nModel config: see functions/src/nutrition/ai/config.ts (NUTRITION_AI_MODELS)\n`);
  process.stdout.write('Requesting exactly ONE full-plan generation job...\n');

  const request = { auth: { uid, token: {} as never }, data: {}, rawRequest: {} as never } as unknown as Parameters<typeof requestNutritionPlanGenerationHandler>[0];
  const { generationId } = await requestNutritionPlanGenerationHandler(request, db);
  process.stdout.write(`Job queued: ${generationId}\n`);

  const provider = new OpenAiNutritionProvider(apiKey);
  const completed = await processNutritionGenerationJob(uid, generationId, provider, db);

  const jobDoc = await db.collection('users').doc(uid).collection('nutritionGenerationJobs').doc(generationId).get();
  const job = jobDoc.data();
  process.stdout.write(`\nJob finished. completed=${completed} status=${job?.status} errorCode=${job?.errorCode ?? null} `
    + `retryCount=${job?.retryCount ?? 0}\n`);

  if (job?.status === 'completed' && job?.planId) {
    const opsSnapshot = await db.collection('nutritionAiOperations')
      .where('generationId', '==', generationId).orderBy('attempt').get();
    process.stdout.write('\nAI operation metadata (no prompt/output/PII — see round brief §22):\n');
    for (const opDoc of opsSnapshot.docs) {
      const op = opDoc.data();
      process.stdout.write(`  attempt=${op.attempt} model=${op.model} resultStatus=${op.resultStatus} `
        + `inputTokens=${op.inputTokens ?? 'n/a'} outputTokens=${op.outputTokens ?? 'n/a'} `
        + `estimatedCostUsd=${op.estimatedCostUsd ?? 'n/a'} failureCode=${op.failureCode ?? null}\n`);
    }
    process.stdout.write(`\nPlan created: users/${uid}/nutritionPlans/${job.planId}\n`
      + 'Inspect it manually in the Firebase console for the human quality checklist '
      + '(round brief §25-26) — this script intentionally does not dump plan contents to stdout.\n');
  } else {
    process.stdout.write('\nGeneration did not complete successfully — this is expected and correct if the catalog '
      + 'has no approved foods yet (CATALOG_INSUFFICIENT), not a smoke-test bug.\n');
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
