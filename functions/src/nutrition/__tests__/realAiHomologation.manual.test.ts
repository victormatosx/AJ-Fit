import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { OpenAiNutritionProvider } from '../ai/provider';
import { MAX_AI_CALLS } from '../ai/config';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import { candidateDigest, type NutritionReviewRequest } from '../ai/review';
import type { AiResult, AiUsage, NutritionAiProfile } from '../ai/provider';
import { generateValidatedPlan } from '../generation/attempts';

// Manual, explicit opt-in only (never runs in CI/regular suites): exercises the
// REAL OpenAI gpt-6-luna endpoint for both creator and reviewer roles, inside the
// $2 aggregate homologation budget authorized for 2026-10-20. All profile/job/plan
// writes stay in the Firestore emulator (NUTRITION_REAL_AI_SMOKE's pre-existing
// safety contract) — no production user/plan data is read or written.
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST
  && process.env.NUTRITION_REAL_AI_SMOKE === '1' && process.env.NUTRITION_REAL_AI_HOMOLOGATION === '1'
  && process.env.OPENAI_API_KEY);

// Standard tier gpt-6-luna pricing confirmed in docs/nutrition/dual-ai-generation-2026-10-20/REPORT.md §8.
const PRICE_PER_INPUT_TOKEN_USD = 0.10 / 1_000_000;
const PRICE_PER_OUTPUT_TOKEN_USD = 0.50 / 1_000_000;
const BUDGET_CEILING_USD = 2.00;

interface ScenarioRecord {
  scenario: string; status: string; failureCode: string | null; calls: number;
  inputTokens: number; outputTokens: number; estimatedCostUsd: number; latencyMsTotal: number;
  note?: string;
}
const records: ScenarioRecord[] = [];
let cumulativeCostUsd = 0;

function costOf(usage: AiUsage): number {
  return (usage.inputTokens ?? 0) * PRICE_PER_INPUT_TOKEN_USD + (usage.outputTokens ?? 0) * PRICE_PER_OUTPUT_TOKEN_USD;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// A rapid run of scenarios 1-2 (several real calls within ~2 minutes) was
// observed to be followed by every subsequent scenario failing near-instantly
// (durationMs ~2) with the generic AI_PROVIDER_ERROR fallback in
// classifyAttemptError — consistent with a transient rate limit rather than a
// per-scenario bug (an isolated rerun of the exact same failing scenario
// minutes later succeeded normally). This retry-with-backoff is a harness-only
// mitigation for that transient condition; it does not change production code.
async function withBackoff<T>(label: string, op: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } catch (error) {
    process.stderr.write(`[homologation] ${label} ${op} FAILED after ${Date.now() - t0}ms (retrying once after backoff): name=${(error as Error)?.name} code=${(error as { code?: unknown })?.code} message=${(error as Error)?.message}\n`);
    await sleep(20_000);
    return fn();
  }
}

function budgetedProvider(label: string) {
  const real = new OpenAiNutritionProvider(process.env.OPENAI_API_KEY!);
  let calls = 0; let inputTokens = 0; let outputTokens = 0; let latencyMsTotal = 0;
  const account = (r: AiResult) => {
    calls++; inputTokens += r.usage.inputTokens ?? 0; outputTokens += r.usage.outputTokens ?? 0;
    latencyMsTotal += r.latencyMs; cumulativeCostUsd += costOf(r.usage);
    if (cumulativeCostUsd > BUDGET_CEILING_USD) {
      throw new Error(`Homologation budget ceiling exceeded during ${label}: $${cumulativeCostUsd.toFixed(4)}`);
    }
    return r;
  };
  return {
    provider: {
      generatePlan: async (request: Parameters<typeof real.generatePlan>[0]) => {
        process.stderr.write(`[homologation] ${label} generatePlan call starting at +0ms\n`);
        const t0 = Date.now();
        const r = await withBackoff(label, 'generatePlan', () => real.generatePlan(request));
        process.stderr.write(`[homologation] ${label} generatePlan call finished after ${Date.now() - t0}ms\n`);
        return account(r);
      },
      reviewPlan: async (request: Parameters<NonNullable<typeof real.reviewPlan>>[0]) => {
        process.stderr.write(`[homologation] ${label} reviewPlan call starting\n`);
        const t0 = Date.now();
        const r = await withBackoff(label, 'reviewPlan', () => real.reviewPlan!(request));
        process.stderr.write(`[homologation] ${label} reviewPlan call finished after ${Date.now() - t0}ms\n`);
        return account(r);
      },
    },
    stats: () => ({ calls, inputTokens, outputTokens, latencyMsTotal }),
  };
}

async function seedScenarioUser(uid: string, nutritionProfile: Record<string, unknown>, answers: Record<string, unknown>) {
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
    answers: { birthDate: Timestamp.fromDate(new Date('1992-04-10')), height: 170, weight: 68, sex: 'f', goal: 'health', days: 3, ...answers },
  });
  await db.collection('nutritionRolloutConfig').doc('active').set({
    nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
  });
}

async function runFullPipelineScenario(
  scenario: string, nutritionProfile: Record<string, unknown>, answers: Record<string, unknown> = {},
) {
  // Spacing calls out across scenarios avoids the rate-limit pattern
  // described in withBackoff's comment above.
  await sleep(10_000);
  const uid = `synthetic-homologation-${randomUUID()}`;
  await seedScenarioUser(uid, nutritionProfile, answers);
  const user = db.collection('users').doc(uid);
  const { generationId } = await requestNutritionPlanGenerationHandler({
    auth: { uid }, data: { requestId: randomUUID() },
  } as unknown as CallableRequest, db);
  const jobRef = user.collection('nutritionGenerationJobs').doc(generationId);
  const { provider, stats } = budgetedProvider(scenario);
  const success = await processNutritionGenerationJob(uid, generationId, provider, db);
  const job = await jobRef.get();
  const s = stats();
  const record: ScenarioRecord = {
    scenario, status: job.get('status'), failureCode: job.get('errorCode') ?? null,
    calls: s.calls, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
    estimatedCostUsd: Number((s.inputTokens * PRICE_PER_INPUT_TOKEN_USD + s.outputTokens * PRICE_PER_OUTPUT_TOKEN_USD).toFixed(6)),
    latencyMsTotal: s.latencyMsTotal,
  };
  records.push(record);
  // Never log the generated diet/profile content — operational facts only.
  console.info(JSON.stringify({ synthetic: true, ...record }));
  return { uid, generationId, success, job, record };
}

afterAll(() => {
  if (!enabled || records.length === 0) return;
  const summary = { generatedAt: new Date().toISOString(), budgetCeilingUsd: BUDGET_CEILING_USD,
    totalEstimatedCostUsd: Number(cumulativeCostUsd.toFixed(6)), scenarios: records };
  writeFileSync('/tmp/nutrition-homologation-results.json', JSON.stringify(summary, null, 2));
  console.info(JSON.stringify({ homologationSummary: true, totalEstimatedCostUsd: summary.totalEstimatedCostUsd }));
});

describe.skipIf(!enabled)('dual-AI real homologation (2026-10-20, <=$2 budget)', () => {
  it('Scenario 1 — no restrictions', async () => {
    const { success, record } = await runFullPipelineScenario('1_no_restrictions', { dietaryPattern: 'omnivore' });
    expect(success).toBe(true);
    expect(record.calls).toBeGreaterThanOrEqual(2);
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  it('Scenario 2 — lactose intolerance', async () => {
    const { record } = await runFullPipelineScenario('2_lactose_intolerant',
      { dietaryPattern: 'omnivore', excludedSubstances: ['lactose'] });
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  it('Scenario 3 — vegetarian', async () => {
    const { record } = await runFullPipelineScenario('3_vegetarian', { dietaryPattern: 'vegetarian' });
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  it('Scenario 4 — vegetarian + lactose intolerance', async () => {
    const { record } = await runFullPipelineScenario('4_vegetarian_lactose',
      { dietaryPattern: 'vegetarian', excludedSubstances: ['lactose'] });
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  it('Scenario 5 — vegetarian + lactose + mandioca preference', async () => {
    await db.collection('nutritionFoods').doc('synthetic_mandioca').set({ name: 'Mandioca cozida', status: 'active' });
    const { record } = await runFullPipelineScenario('5_vegetarian_lactose_mandioca',
      { dietaryPattern: 'vegetarian', excludedSubstances: ['lactose'], preferredFoodIds: ['synthetic_mandioca'] });
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  it('Scenario 6 — protein supplementation accepted (whey or vegetal)', async () => {
    const { record } = await runFullPipelineScenario('6_protein_supplement',
      { dietaryPattern: 'omnivore', supplements: ['whey_or_protein'] });
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  it('Scenario 7 — legacy milk allergy (excludedAllergens: milk)', async () => {
    const { record } = await runFullPipelineScenario('7_legacy_milk_allergy',
      { dietaryPattern: 'omnivore', excludedAllergens: ['milk'], supplements: ['whey_or_protein'] });
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  it('Scenario 8 — gluten exclusion', async () => {
    const { record } = await runFullPipelineScenario('8_gluten_exclusion',
      { dietaryPattern: 'omnivore', excludedSubstances: ['gluten'] });
    expect(record.calls).toBeLessThanOrEqual(MAX_AI_CALLS);
  }, 300_000);

  // Scenario 9 — the deterministic backend gate blocks an obviously
  // mislabeled candidate (e.g. meat declared as plant) BEFORE it ever
  // reaches the reviewer (see independentReview.test.ts's "blocks meat
  // misdeclared as plant before even consulting a permissive reviewer") —
  // so a real rejection by the REVIEWER specifically must bypass the
  // creator/deterministic gate entirely and call reviewPlan directly, per
  // the task brief's own instruction ("forneça um candidato sintético...
  // à revisão real"). Never activated as a plan — this calls the reviewer
  // in isolation, no job/plan is created.
  it('Scenario 9 — independent reviewer rejects an incompatible synthetic candidate', async () => {
    await sleep(10_000);
    const profile = { mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'vegan', excludedAllergens: [],
      excludedSubstances: [], excludedFoodIds: [], preferredFoodIds: [], usualFoodIds: [],
      supplements: [], varietyPreference: 'indifferent' } as unknown as NutritionAiProfile;
    const target = { slot: 'lunch', kcal: { target: 600, min: 570, max: 630 }, proteinG: { target: 30, min: 28, max: 32 },
      carbsG: { target: 70, min: 66, max: 74 }, fatG: { target: 18, min: 17, max: 19 }, fiberG: { target: 8, min: 7, max: 9 } };
    const candidate = { meals: [{ slot: 'breakfast', foods: [{ name: 'Mingau de aveia', quantity: 200, unit: 'g',
      preparationNote: '', ingredients: [{ name: 'Aveia', origin: 'plant' }], allergens: [],
      estimatedNutrition: { kcal: 300, proteinG: 10, carbsG: 50, fatG: 6, fiberG: 5 } }] },
      { slot: 'lunch', foods: [{ name: 'Frango grelhado', quantity: 150, unit: 'g', preparationNote: 'grelhado',
        ingredients: [{ name: 'Peito de frango', origin: 'terrestrial_animal' }], allergens: [],
        estimatedNutrition: { kcal: 300, proteinG: 20, carbsG: 20, fatG: 12, fiberG: 3 } }] }] };
    const digest = candidateDigest(candidate);
    const request: NutritionReviewRequest = {
      profile, goal: 'health', targets: [target], foodNames: { preferred: [], usual: [], excluded: [] },
      candidate, candidateDigest: digest, evidence: [],
    };
    const real = new OpenAiNutritionProvider(process.env.OPENAI_API_KEY!);
    const started = Date.now();
    const result = await withBackoff('9_reviewer_rejects_incompatible_candidate', 'reviewPlan', () => real.reviewPlan!(request));
    cumulativeCostUsd += costOf(result.usage);
    const parsed = result.output as { status: string; checks: Record<string, boolean>; requiresRegeneration: boolean };
    const record: ScenarioRecord = {
      scenario: '9_reviewer_rejects_incompatible_candidate', status: parsed.status, failureCode: null, calls: 1,
      inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0,
      estimatedCostUsd: Number(costOf(result.usage).toFixed(6)), latencyMsTotal: Date.now() - started,
      note: `checks.dietaryPattern=${parsed.checks.dietaryPattern} requiresRegeneration=${parsed.requiresRegeneration}`,
    };
    records.push(record);
    console.info(JSON.stringify({ synthetic: true, ...record }));
    expect(['rejected', 'insufficient_information']).toContain(parsed.status);
    expect(parsed.checks.dietaryPattern).toBe(false);
    expect(parsed.requiresRegeneration).toBe(true);
  }, 60_000);

  // Scenario 10 — automatic correction loop: attempt 1 is a fixed-cost-free
  // synthetic candidate that is deterministically SHAPE-valid (passes the
  // backend's ingredient/allergen gate, so it legitimately reaches the real
  // reviewer) but semantically wrong for a gluten-excluded profile (wheat
  // bread) in a way only the independent reviewer is positioned to catch
  // before persistence. The real reviewer rejects it (real call), feedback
  // flows to a REAL creator retry (real call), and the real reviewer
  // evaluates the correction (real call) — exercising rejection -> feedback
  // -> new creation -> new review end to end with real judgment on every
  // step except the deliberately-fixed first draft.
  it('Scenario 10 — rejection, feedback, automatic correction, final approval', async () => {
    await sleep(10_000);
    const uid = `synthetic-homologation-${randomUUID()}`;
    await seedScenarioUser(uid, { dietaryPattern: 'omnivore', excludedSubstances: ['gluten'] }, {});
    const user = db.collection('users').doc(uid);
    const { generationId } = await requestNutritionPlanGenerationHandler({
      auth: { uid }, data: { requestId: randomUUID() },
    } as unknown as CallableRequest, db);
    const jobRef = user.collection('nutritionGenerationJobs').doc(generationId);
    const real = new OpenAiNutritionProvider(process.env.OPENAI_API_KEY!);
    let creatorCalls = 0;
    const badFirstDraft = { meals: [
      { slot: 'breakfast', foods: [{ name: 'Pão de trigo integral', quantity: 80, unit: 'g', preparationNote: '',
        ingredients: [{ name: 'Farinha de trigo', origin: 'plant' }], allergens: ['wheat'],
        estimatedNutrition: { kcal: 220, proteinG: 8, carbsG: 40, fatG: 3, fiberG: 4 } }] },
      { slot: 'lunch', foods: [{ name: 'Arroz com feijão', quantity: 300, unit: 'g', preparationNote: '',
        ingredients: [{ name: 'Arroz', origin: 'plant' }, { name: 'Feijão', origin: 'plant' }], allergens: [],
        estimatedNutrition: { kcal: 400, proteinG: 15, carbsG: 70, fatG: 5, fiberG: 10 } }] },
      { slot: 'afternoon_snack', foods: [{ name: 'Banana', quantity: 120, unit: 'g', preparationNote: '',
        ingredients: [{ name: 'Banana', origin: 'plant' }], allergens: [],
        estimatedNutrition: { kcal: 110, proteinG: 1, carbsG: 28, fatG: 0, fiberG: 3 } }] },
      { slot: 'dinner', foods: [{ name: 'Omelete de legumes', quantity: 200, unit: 'g', preparationNote: '',
        ingredients: [{ name: 'Ovo', origin: 'egg' }, { name: 'Legumes', origin: 'plant' }], allergens: ['egg'],
        estimatedNutrition: { kcal: 260, proteinG: 18, carbsG: 10, fatG: 16, fiberG: 4 } }] },
    ] };
    const { provider, stats } = budgetedProvider('10_correction');
    const wrapped = {
      generatePlan: async (request: Parameters<typeof real.generatePlan>[0]) => {
        creatorCalls++;
        if (creatorCalls === 1) {
          return { output: badFirstDraft, model: 'synthetic-fixture-attempt-1', usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, latencyMs: 1 };
        }
        return provider.generatePlan(request);
      },
      reviewPlan: provider.reviewPlan,
    };
    const success = await processNutritionGenerationJob(uid, generationId, wrapped, db);
    const job = await jobRef.get();
    const s = stats();
    const record: ScenarioRecord = {
      scenario: '10_rejection_feedback_correction', status: job.get('status'), failureCode: job.get('errorCode') ?? null,
      calls: s.calls + 1, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
      estimatedCostUsd: Number((s.inputTokens * PRICE_PER_INPUT_TOKEN_USD + s.outputTokens * PRICE_PER_OUTPUT_TOKEN_USD).toFixed(6)),
      latencyMsTotal: s.latencyMsTotal, note: `creatorCalls=${creatorCalls} (attempt 1 synthetic/free, rest real)`,
    };
    records.push(record);
    console.info(JSON.stringify({ synthetic: true, ...record }));
    // Whatever the outcome, the gluten-excluded first draft must never be the
    // one activated — either it was rejected and corrected (success, 2nd
    // draft active) or the whole job failed honestly (no plan activated).
    if (success) {
      const plan = await user.collection('nutritionPlans').doc(generationId).get();
      expect(plan.get('status')).toBe('active');
      const hasWheat = (plan.get('meals') as Array<{ options: Array<{ foods: Array<{ allergens: string[] }> }> }>)
        .some(m => m.options.some(o => o.foods.some(f => f.allergens.includes('wheat'))));
      expect(hasWheat).toBe(false);
    } else {
      expect((await user.collection('nutritionPlans').where('status', '==', 'active').get()).size).toBe(0);
    }
  }, 300_000);

  it('Scenario 11/12 — macro tolerances respected and only reviewed/approved plans are ever active', async () => {
    const { uid, generationId, success } = await runFullPipelineScenario('11_12_macros_and_persistence_safety', { dietaryPattern: 'omnivore' });
    expect(success).toBe(true);
    const user = db.collection('users').doc(uid);
    const activePlans = await user.collection('nutritionPlans').where('status', '==', 'active').get();
    expect(activePlans.size).toBe(1);
    expect(activePlans.docs[0].id).toBe(generationId);
    const review = activePlans.docs[0].get('generationMetadata.review');
    expect(review?.calls).toBeGreaterThanOrEqual(2);
  }, 300_000);

  // Debug-only (not one of the 12 required scenarios): characterizes WHY
  // restricted-diet scenarios (2-5, 7, 8, 10) exhausted all 3 creator
  // attempts with AI_RETRY_EXHAUSTED while every omnivore scenario (1, 6,
  // 11/12) succeeded, by calling generateValidatedPlan directly against the
  // real provider and printing each attempt's exact failure category.
  it('Debug — root cause of vegetarian scenario exhaustion', async () => {
    await sleep(10_000);
    const real = new OpenAiNutritionProvider(process.env.OPENAI_API_KEY!);
    const profile = { mealSlots: ['breakfast', 'lunch', 'afternoon_snack', 'dinner'], dietaryPattern: 'vegetarian',
      excludedAllergens: [], excludedSubstances: [], excludedFoodIds: [], preferredFoodIds: [], usualFoodIds: [],
      nonTrainingActivityLevel: 'active', supplements: [], varietyPreference: 'indifferent',
    } as unknown as Parameters<typeof generateValidatedPlan>[1];
    const n = (kcal: number, proteinG: number, carbsG: number, fatG: number, fiberG: number) => {
      const r = (t: number) => ({ target: t, min: t * 0.9, max: t * 1.1 });
      return { kcal: r(kcal), proteinG: r(proteinG), carbsG: r(carbsG), fatG: r(fatG), fiberG: r(fiberG) };
    };
    const engine = {
      mealTargets: [
        { slot: 'breakfast', ...n(500, 20, 60, 15, 6) }, { slot: 'lunch', ...n(700, 30, 80, 20, 8) },
        { slot: 'afternoon_snack', ...n(300, 12, 35, 8, 4) }, { slot: 'dinner', ...n(600, 25, 70, 18, 7) },
      ],
      energy: { targetKcal: 2100 }, macros: { proteinG: 87, carbsG: 245, fatG: 61, fiberG: 25 },
    } as unknown as Parameters<typeof generateValidatedPlan>[2];
    const foodNames = { preferred: [], usual: [], excluded: [] };
    try {
      await generateValidatedPlan(real, profile, engine, 'health', foodNames, async (audit) => {
        process.stderr.write(`[homologation-debug] attempt=${audit.attempt} role=${audit.role} code=${audit.code} `
          + `issue=${JSON.stringify(audit.validationIssue)} diagnostics=${JSON.stringify(audit.validationDiagnostics)}\n`);
      });
    } catch (error) {
      process.stderr.write(`[homologation-debug] final error: code=${(error as { code?: unknown })?.code} `
        + `lastFailureCode=${(error as { lastFailureCode?: unknown })?.lastFailureCode}\n`);
    }
  }, 300_000);
});
