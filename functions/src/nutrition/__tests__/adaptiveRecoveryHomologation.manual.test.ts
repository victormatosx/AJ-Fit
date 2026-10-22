import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { OpenAiNutritionProvider, type AiResult } from '../ai/provider';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import { stageReservedUsd } from '../generation/attempts';
import { estimateOpenAiCost } from '../observability/modelPricing';

// One observed job per invocation. No transport retries, no reset of task spend.
const enabled = process.env.AJFIT_ADAPTIVE_REAL === '1' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.GCLOUD_PROJECT === 'demo-ajfit-dual-ai';
const ledgerPath = process.env.AJFIT_ADAPTIVE_LEDGER ?? '/tmp/ajfit-adaptive-final-real-ledger.json';
const profiles: Record<string, Record<string, unknown>> = {
  vegetarian: { dietaryPattern: 'vegetarian' },
  milk: { dietaryPattern: 'omnivore', excludedAllergens: ['milk'], supplements: ['whey_or_protein'] },
  gluten: { dietaryPattern: 'omnivore', excludedSubstances: ['gluten'] },
  vegan: { dietaryPattern: 'vegan' },
  multiple: { dietaryPattern: 'vegetarian', excludedAllergens: ['milk'], excludedSubstances: ['gluten'] },
  unrestricted: { dietaryPattern: 'omnivore' },
};
interface PaidCall { role: 'creator' | 'reviewer'; reservedUsd: number; state: string; estimatedCostUsd: number | null; latencyMs: number | null }
interface RealRun { scenario: string; uid: string; generationId: string; startedAt: string; calls: PaidCall[]; result?: unknown }
interface Ledger { claudeUpperBoundUsd: number; ceilingUsd: number; runs: RealRun[] }
describe.skipIf(!enabled)('adaptive recovery final real homologation', () => {
  it('runs one synthetic profile with a durable aggregate financial ceiling', async () => {
    const scenario = process.env.AJFIT_ADAPTIVE_SCENARIO!;
    if (!profiles[scenario]) throw new Error('Specify a known AJFIT_ADAPTIVE_SCENARIO');
    const ledger: Ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
      : { claudeUpperBoundUsd: .8191, ceilingUsd: 2, runs: [] };
    const save = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
    const uid = `synthetic-adaptive-codex-${randomUUID()}`;
    const now = Timestamp.now(); const user = db.collection('users').doc(uid);
    await user.set({ profile: { birthDate: Timestamp.fromDate(new Date('1992-04-10')), height: 170 } });
    await user.collection('questionnaires').doc('synthetic').set({ createdAt: now, version: 1,
      answers: { birthDate: Timestamp.fromDate(new Date('1992-04-10')), height: 170, weight: 68, sex: 'f', goal: 'health', days: 3 } });
    await user.collection('nutritionProfile').doc('current').set({ questionnaireVersion: 1, nonTrainingActivityLevel: 'active',
      mealSlots: ['breakfast', 'lunch', 'afternoon_snack', 'dinner'], preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [],
      excludedAllergens: [], excludedSubstances: [], supplements: [], pregnant: false, breastfeeding: false,
      varietyPreference: 'indifferent', updatedAt: now, ...profiles[scenario] });
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 } });
    const { generationId } = await requestNutritionPlanGenerationHandler({ auth: { uid }, data: { requestId: randomUUID() } } as CallableRequest, db);
    const run: RealRun = { scenario, uid, generationId, startedAt: new Date().toISOString(), calls: [] };
    ledger.runs.push(run); save();
    const key = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret=OPENAI_API_KEY', '--project=ajfit-2f321'], { encoding: 'utf8' }).trim();
    const real = new OpenAiNutritionProvider(key);
    const call = async (role: PaidCall['role'], invoke: () => Promise<AiResult>) => {
      const reservedUsd = stageReservedUsd(role);
      const total = ledger.claudeUpperBoundUsd + ledger.runs.flatMap(r => r.calls).reduce((sum, c) => sum + c.reservedUsd, 0);
      if (total + reservedUsd > ledger.ceilingUsd) throw new Error('TASK_BUDGET_EXHAUSTED');
      const record: PaidCall = { role, reservedUsd, state: 'pending', estimatedCostUsd: null, latencyMs: null };
      run.calls.push(record); save(); const start = Date.now();
      try {
        const response = await invoke(); record.state = 'responded';
        record.estimatedCostUsd = estimateOpenAiCost({ model: response.model, ...response.usage })?.estimatedCostUsd ?? null;
        return response;
      } catch (error) { record.state = 'failed_unknown_cost'; throw error; }
      finally { record.latencyMs = Date.now() - start; save(); }
    };
    const success = await processNutritionGenerationJob(uid, generationId, {
      generatePlan: request => call('creator', () => real.generatePlan(request)),
      reviewPlan: request => call('reviewer', () => real.reviewPlan(request)),
    }, db);
    const job = await user.collection('nutritionGenerationJobs').doc(generationId).get();
    const plan = await user.collection('nutritionPlans').doc(generationId).get();
    const operations = await db.collection('nutritionAiOperations').where('generationId', '==', generationId).get();
    run.result = { success, status: job.get('status'), failureCode: job.get('errorCode'), lastFailureCode: job.get('lastFailureCode') ?? null,
      aiCallCount: job.get('aiCallCount'), aiReservedUsd: job.get('aiReservedUsd'),
      creditUsed: job.get('aiRecoveryCreditUsed') ?? false, history: job.get('aiRecoveryHistory') ?? [],
      operations: operations.docs.map(d => ({ id: d.id, ...d.data() })),
      planExists: plan.exists, review: plan.get('generationMetadata.review') ?? null,
      durationMs: Date.now() - Date.parse(run.startedAt) }; save();
    expect(job.get('aiCallCount')).toBe(run.calls.length);
    expect(job.get('aiCallCount')).toBeLessThanOrEqual(5);
    expect(job.get('aiReservedUsd')).toBeLessThanOrEqual(.04);
    expect(plan.exists).toBe(success);
    if (success) expect(plan.get('generationMetadata.review.candidateDigest')).toMatch(/^[a-f0-9]{64}$/);
    console.info(JSON.stringify({ scenario, generationId, success, calls: run.calls.length, creditUsed: job.get('aiRecoveryCreditUsed') ?? false }));
  }, 450_000);
});
