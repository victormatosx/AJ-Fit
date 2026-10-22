import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { OpenAiNutritionProvider } from '../ai/provider';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import type { AiUsage } from '../ai/provider';

// Manual, explicit opt-in only (never runs in CI/regular suites): repeats the
// three scenarios that failed in the prior homologation (vegetarian, legacy
// milk allergy, auto-correction-after-rejection) multiple times against the
// REAL OpenAI gpt-6-luna endpoint, to distinguish occasional vs systematic
// failure. All profile/job/plan writes stay in the Firestore emulator. Shares
// the $2 aggregate ceiling authorized for this homologation task.
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST
  && process.env.NUTRITION_REAL_AI_SMOKE === '1' && process.env.NUTRITION_REAL_AI_HOMOLOGATION === '1'
  && process.env.OPENAI_API_KEY);

const PRICE_PER_INPUT_TOKEN_USD = 0.10 / 1_000_000;
const PRICE_PER_OUTPUT_TOKEN_USD = 0.50 / 1_000_000;
const BUDGET_CEILING_USD = 2.00;

interface AttemptRecord {
  scenario: string; run: number; attempt: number; role: string; code: string | null;
  validationIssue: unknown; nutrientDeviations: unknown; reviewStatus: string | null; issueCategories: string[] | null;
}
interface RunRecord {
  scenario: string; run: number; status: string; failureCode: string | null; calls: number;
  estimatedCostUsd: number; latencyMsTotal: number;
}
const attemptLog: AttemptRecord[] = [];
const runRecords: RunRecord[] = [];
let cumulativeCostUsd = 0;

function costOf(usage: AiUsage): number {
  return (usage.inputTokens ?? 0) * PRICE_PER_INPUT_TOKEN_USD + (usage.outputTokens ?? 0) * PRICE_PER_OUTPUT_TOKEN_USD;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withBackoff<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (error) {
    process.stderr.write(`[stability-repeat] ${label} FAILED (retrying once after backoff): ${(error as Error)?.message}\n`);
    await sleep(20_000);
    return fn();
  }
}

function budgetedProvider(label: string) {
  const real = new OpenAiNutritionProvider(process.env.OPENAI_API_KEY!);
  let calls = 0; let inputTokens = 0; let outputTokens = 0; let latencyMsTotal = 0;
  const account = (r: Awaited<ReturnType<typeof real.generatePlan>>) => {
    calls++; inputTokens += r.usage.inputTokens ?? 0; outputTokens += r.usage.outputTokens ?? 0;
    latencyMsTotal += r.latencyMs; cumulativeCostUsd += costOf(r.usage);
    if (cumulativeCostUsd > BUDGET_CEILING_USD) throw new Error(`Homologation budget ceiling exceeded during ${label}: $${cumulativeCostUsd.toFixed(4)}`);
    return r;
  };
  return {
    provider: {
      generatePlan: async (request: Parameters<typeof real.generatePlan>[0]) =>
        account(await withBackoff(`${label} generatePlan`, () => real.generatePlan(request))),
      reviewPlan: async (request: Parameters<NonNullable<typeof real.reviewPlan>>[0]) =>
        account(await withBackoff(`${label} reviewPlan`, () => real.reviewPlan!(request))),
    },
    stats: () => ({ calls, inputTokens, outputTokens, latencyMsTotal }),
  };
}

async function seedScenarioUser(uid: string, nutritionProfile: Record<string, unknown>) {
  const now = Timestamp.now();
  const user = db.collection('users').doc(uid);
  await user.set({ profile: { birthDate: Timestamp.fromDate(new Date('1992-04-10')), height: 170 } });
  await user.collection('nutritionProfile').doc('current').set({
    questionnaireVersion: 1, nonTrainingActivityLevel: 'active',
    mealSlots: ['breakfast', 'lunch', 'afternoon_snack', 'dinner'],
    preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], supplements: [],
    pregnant: false, breastfeeding: false, varietyPreference: 'indifferent', updatedAt: now,
    ...nutritionProfile,
  });
  await user.collection('questionnaires').doc('synthetic').set({
    createdAt: now, version: 1,
    answers: { birthDate: Timestamp.fromDate(new Date('1992-04-10')), height: 170, weight: 68, sex: 'f', goal: 'health', days: 3 },
  });
  await db.collection('nutritionRolloutConfig').doc('active').set({
    nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
  });
}

async function runOnce(scenario: string, run: number, nutritionProfile: Record<string, unknown>) {
  await sleep(8_000);
  const uid = `synthetic-stability-${randomUUID()}`;
  await seedScenarioUser(uid, nutritionProfile);
  const user = db.collection('users').doc(uid);
  const { generationId } = await requestNutritionPlanGenerationHandler({
    auth: { uid }, data: { requestId: randomUUID() },
  } as unknown as CallableRequest, db);
  const jobRef = user.collection('nutritionGenerationJobs').doc(generationId);
  const { provider, stats } = budgetedProvider(`${scenario}#${run}`);
  const success = await processNutritionGenerationJob(uid, generationId, provider, db);
  // `recordAiOperation` (worker.ts's single write path, `06_ai/ai_observability.md`
  // §4) already persists one document per attempt/role/call with role, failure
  // code, review status, and issue categories — read it back instead of
  // reconstructing audit data via log spying.
  const ops = await db.collection('nutritionAiOperations').where('generationId', '==', generationId).get();
  for (const doc of ops.docs) {
    const d = doc.data();
    attemptLog.push({
      scenario, run, attempt: Number(d.attempt ?? d.attemptNumber ?? 0), role: String(d.agentRole ?? ''),
      code: (d.failureCode as string | null) ?? null, validationIssue: null, nutrientDeviations: null,
      reviewStatus: (d.reviewStatus as string | null) ?? null, issueCategories: (d.issueCategories as string[] | null) ?? null,
    });
  }
  const job = await jobRef.get();
  const s = stats();
  const record: RunRecord = {
    scenario, run, status: job.get('status'), failureCode: job.get('errorCode') ?? null, calls: s.calls,
    estimatedCostUsd: Number((s.inputTokens * PRICE_PER_INPUT_TOKEN_USD + s.outputTokens * PRICE_PER_OUTPUT_TOKEN_USD).toFixed(6)),
    latencyMsTotal: s.latencyMsTotal,
  };
  runRecords.push(record);
  console.info(JSON.stringify({ synthetic: true, ...record }));
  return { uid, generationId, success, job, record };
}

afterAll(() => {
  if (!enabled) return;
  const summary = { generatedAt: new Date().toISOString(), budgetCeilingUsd: BUDGET_CEILING_USD,
    totalEstimatedCostUsd: Number(cumulativeCostUsd.toFixed(6)), runs: runRecords, attempts: attemptLog };
  writeFileSync('/tmp/nutrition-stability-repeat-results.json', JSON.stringify(summary, null, 2));
  console.info(JSON.stringify({ stabilitySummary: true, totalEstimatedCostUsd: summary.totalEstimatedCostUsd, runCount: runRecords.length }));
});

const REPEATS = 8;

describe.skipIf(!enabled)('stability repeat homologation — scenarios 3, 7, 10', () => {
  for (let run = 1; run <= REPEATS; run++) {
    it(`Scenario 3 (vegetarian) run ${run}/${REPEATS}`, async () => {
      const { record } = await runOnce('3_vegetarian', run, { dietaryPattern: 'vegetarian' });
      expect(record.calls).toBeGreaterThan(0);
    }, 300_000);
  }
  for (let run = 1; run <= REPEATS; run++) {
    it(`Scenario 7 (legacy milk allergy) run ${run}/${REPEATS}`, async () => {
      const { record } = await runOnce('7_legacy_milk_allergy', run,
        { dietaryPattern: 'omnivore', excludedAllergens: ['milk'], supplements: ['whey_or_protein'] });
      expect(record.calls).toBeGreaterThan(0);
    }, 300_000);
  }
  for (let run = 1; run <= REPEATS; run++) {
    it(`Scenario 10-analog (gluten exclusion, natural reviewer path) run ${run}/${REPEATS}`, async () => {
      // Unlike the original scenario 10 (synthetic first draft), this repeats
      // the NATURAL end-to-end path for a gluten-excluded profile so any
      // rejection/correction loop that occurs is organically triggered by the
      // real creator, not scripted — a closer analog to production traffic.
      const { record } = await runOnce('10_gluten_natural', run, { dietaryPattern: 'omnivore', excludedSubstances: ['gluten'] });
      expect(record.calls).toBeGreaterThan(0);
    }, 300_000);
  }
});
