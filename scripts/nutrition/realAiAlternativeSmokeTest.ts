#!/usr/bin/env -S node --import tsx
/**
 * Fase 33 round brief §27: a SEPARATE, equally manual/opt-in smoke test for
 * `meal_alternative` — only run this after the full-plan smoke
 * (`realAiSmokeTest.ts`) has produced a real active plan to request an
 * alternative against. Never runs automatically.
 *
 * Usage:
 *   NUTRITION_REAL_AI_SMOKE=1 OPENAI_API_KEY=sk-... \
 *     node --import tsx scripts/nutrition/realAiAlternativeSmokeTest.ts \
 *     --project <test-project-id> --uid <existing-test-uid> \
 *     --planId <active-plan-id> --slot lunch
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
  const planId = flagValue(args, '--planId');
  const slot = flagValue(args, '--slot');
  if (!projectId || !uid || !planId || !slot) throw new Error('USAGE: --project <id> --uid <uid> --planId <id> --slot <slot>');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set in this shell. Refusing to proceed without it.');

  const { assertNotProductionProject } = await import('../../src/nutrition/catalog/projectGuard');
  const rcPath = resolve(__dirname, '../../.firebaserc');
  if (existsSync(rcPath)) assertNotProductionProject(projectId, readFileSync(rcPath, 'utf8'), flagValue(args, '--allow-current-test-project') ?? undefined);

  // See realAiSmokeTest.ts for why: functions/ has its own separate
  // firebase-admin install, so we must reuse ITS db/Timestamp instance
  // rather than create our own from the repo root's copy.
  process.env.GCLOUD_PROJECT = projectId;
  const { db } = await import('../../functions/src/lib/firebaseAdmin');

  const { requestNutritionMealAlternativeHandler } = await import('../../functions/src/nutrition/generation/mealAlternativeRequest');
  const { OpenAiNutritionProvider } = await import('../../functions/src/nutrition/ai/provider');

  process.stdout.write(`Project: ${projectId}\nUID: ${uid}\nPlan: ${planId}\nSlot: ${slot}\n`);
  process.stdout.write('Requesting exactly ONE meal alternative...\n');

  const request = {
    auth: { uid, token: {} as never },
    data: { requestId: `smoke-${randomUUID()}`, planId, slot },
    rawRequest: {} as never,
  } as unknown as Parameters<typeof requestNutritionMealAlternativeHandler>[0];

  const provider = new OpenAiNutritionProvider(apiKey);
  const result = await requestNutritionMealAlternativeHandler(request, db, provider);

  process.stdout.write(`\nAlternative stored: users/${uid}/nutritionMealAlternatives/${result.alternativeId}\n`
    + 'Inspect it manually in the Firebase console for the human quality checklist — '
    + 'this script intentionally does not dump option contents to stdout.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
