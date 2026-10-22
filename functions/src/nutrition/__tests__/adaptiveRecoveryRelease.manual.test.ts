import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { OpenAiNutritionProvider, type AiResult } from '../ai/provider';
import { candidateDigest, parseNutritionReview, type NutritionReviewRequest } from '../ai/review';
import { MAX_AI_CALLS, MAX_JOB_RESERVED_USD, NUTRITION_AI_MODELS } from '../ai/config';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import { loadGenerationContext } from '../generation/context';
import { validateAndBuildPlan } from '../generation/domain';
import { recoveryEligible } from '../generation/adaptiveRecovery';
import { stageReservedUsd } from '../generation/attempts';
import { estimateOpenAiCost } from '../observability/modelPricing';

// Manual observation only. No response, prompt, eligibility or production-code changes.
const enabled = process.env.AJFIT_RELEASE_REAL === '1' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.GCLOUD_PROJECT === 'demo-ajfit-dual-ai';
const folder = '../docs/nutrition/adaptive-ai-recovery-final/release-homologation';
const profiles: Record<string, Record<string, unknown>> = {
  milk: { dietaryPattern: 'omnivore', excludedAllergens: ['milk'], supplements: ['whey_or_protein'] },
  vegetarian: { dietaryPattern: 'vegetarian' },
  gluten: { dietaryPattern: 'omnivore', excludedSubstances: ['gluten'] },
};
interface CallFact {
  role: 'creator' | 'reviewer'; reservedUsd: number; state: string; startedAt: string;
  httpStartedAt?: string; requestSha256?: string; requestModel?: string;
  reviewRequest?: NutritionReviewRequest; response?: AiResult; estimatedCostUsd?: number | null;
  latencyMs?: number; errorCode?: string; checkpoint: Record<string, unknown>;
}
interface RunFact { index: number; scenario: string; uid: string; generationId: string; startedAt: string; calls: CallFact[]; result?: Record<string, unknown> }
interface Ledger { priorConsumedUpperUsd: number; ceilingUsd: number; runs: RunFact[]; stopped?: string }
const checkpoint = (d: FirebaseFirestore.DocumentSnapshot): Record<string, unknown> => ({
  status: d.get('status'), aiCallCount: d.get('aiCallCount'), aiAttemptCount: d.get('aiAttemptCount'),
  aiReservedUsd: d.get('aiReservedUsd'), history: d.get('aiRecoveryHistory') ?? [],
  creditUsed: d.get('aiRecoveryCreditUsed') ?? false, grantedAtCall: d.get('aiRecoveryGrantedAtCall') ?? null,
});
describe.skipIf(!enabled)('final release homologation — unmodified real AI responses', () => {
  it('observes the next job in the immutable bounded plan', async () => {
    const lockPath = `${folder}/ledger.lock`;
    const lock = openSync(lockPath, 'wx');
    try {
      const plan = JSON.parse(readFileSync(`${folder}/PLAN.json`, 'utf8')) as { maxJobs: number; scenarios: string[]; priorConsumedUpperUsd: number };
      const ledgerPath = `${folder}/ledger.json`;
      const ledger: Ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
        : { priorConsumedUpperUsd: plan.priorConsumedUpperUsd, ceilingUsd: 2, runs: [] };
      const save = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
      if (ledger.stopped || ledger.runs.some(r => !r.result)) throw new Error('BATCH_STOPPED_OR_UNRESOLVED_JOB');
      if (ledger.runs.length >= plan.maxJobs || plan.maxJobs !== 9 || ledger.ceilingUsd !== 2
        || ledger.priorConsumedUpperUsd !== 1.02755) throw new Error('INVALID_OR_EXHAUSTED_PLAN');
      expect(MAX_AI_CALLS).toBe(5); expect(MAX_JOB_RESERVED_USD).toBe(.04);
      expect(NUTRITION_AI_MODELS.fullPlan).toBe('gpt-6-luna'); expect(NUTRITION_AI_MODELS.reviewer).toBe('gpt-6-luna');
      const scenario = plan.scenarios[ledger.runs.length];
      if (!profiles[scenario]) throw new Error('INVALID_SCENARIO');
      const totalReserved = () => ledger.priorConsumedUpperUsd + ledger.runs.flatMap(r => r.calls).reduce((s, c) => s + c.reservedUsd, 0);
      if (totalReserved() + .04 > 2) { ledger.stopped = 'insufficient_capacity_for_one_job'; save(); throw new Error('TASK_BUDGET_EXHAUSTED'); }
      const uid = `synthetic-adaptive-release-${randomUUID()}`;
      const user = db.collection('users').doc(uid); const now = Timestamp.now();
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
      // Fixture proves prior-plan preservation; never seeds adaptive state or AI output.
      const priorRef = user.collection('nutritionPlans').doc('synthetic-prior');
      const priorData = { planId: 'synthetic-prior', status: 'active', marker: 'release-preservation-fixture' };
      await priorRef.set(priorData);
      await db.collection('nutritionRateLimits').doc(uid).set({ ownerUid: uid, activePlanId: 'synthetic-prior' });
      const context = await loadGenerationContext(db, uid);
      const { generationId } = await requestNutritionPlanGenerationHandler({ auth: { uid }, data: { requestId: randomUUID() } } as CallableRequest, db);
      const jobRef = user.collection('nutritionGenerationJobs').doc(generationId);
      const run: RunFact = { index: ledger.runs.length + 1, scenario, uid, generationId, startedAt: new Date().toISOString(), calls: [] };
      ledger.runs.push(run); save();
      const key = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret=OPENAI_API_KEY', '--project=ajfit-2f321'], { encoding: 'utf8' }).trim();
      let currentCall: CallFact | undefined;
      const real = new OpenAiNutritionProvider(key, async (url, init) => {
        if (!currentCall || currentCall.httpStartedAt) throw new Error('DUPLICATE_OR_UNRESERVED_HTTP');
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('gpt-6-luna'); expect(body.previous_response_id).toBeUndefined();
        currentCall.httpStartedAt = new Date().toISOString(); currentCall.requestModel = body.model;
        currentCall.requestSha256 = createHash('sha256').update(String(init?.body)).digest('hex'); save();
        return fetch(url, init); // Exact URL, headers, payload and abort signal; no retry.
      });
      const call = async (role: CallFact['role'], invoke: () => Promise<AiResult>, reviewRequest?: NutritionReviewRequest) => {
        const reservedUsd = stageReservedUsd(role);
        if (run.calls.length >= 5 || totalReserved() + reservedUsd > 2
          || run.calls.reduce((s, c) => s + c.reservedUsd, 0) + reservedUsd > .04) throw new Error('TASK_OR_JOB_BUDGET_EXHAUSTED');
        const state = checkpoint(await jobRef.get());
        expect(state.aiCallCount).toBe(run.calls.length + 1);
        expect(state.aiReservedUsd).toBeCloseTo(run.calls.reduce((s, c) => s + c.reservedUsd, 0) + reservedUsd, 8);
        if (role === 'creator') expect(Number(state.aiReservedUsd) + stageReservedUsd('reviewer')).toBeLessThanOrEqual(.04);
        if (reviewRequest) expect(candidateDigest(reviewRequest.candidate)).toBe(reviewRequest.candidateDigest);
        const fact: CallFact = { role, reservedUsd, state: 'pending', startedAt: new Date().toISOString(), checkpoint: state,
          ...(reviewRequest ? { reviewRequest: structuredClone(reviewRequest) } : {}) };
        run.calls.push(fact); currentCall = fact; save(); const start = Date.now();
        try {
          const response = await invoke(); fact.state = 'responded'; fact.response = response;
          fact.estimatedCostUsd = estimateOpenAiCost({ model: response.model, ...response.usage })?.estimatedCostUsd ?? null;
          return response; // Original result object, with no changes.
        } catch (error) { fact.state = 'failed_unknown_cost'; fact.errorCode = error instanceof Error ? error.message : 'unknown'; throw error; }
        finally { fact.latencyMs = Date.now() - start; currentCall = undefined; save(); }
      };
      const success = await processNutritionGenerationJob(uid, generationId, {
        generatePlan: request => call('creator', () => real.generatePlan(request)),
        reviewPlan: request => call('reviewer', () => real.reviewPlan(request), request),
      }, db);
      const job = await jobRef.get(); const storedPlan = await user.collection('nutritionPlans').doc(generationId).get();
      const prior = await priorRef.get(); const rate = await db.collection('nutritionRateLimits').doc(uid).get();
      const ops = await db.collection('nutritionAiOperations').where('generationId', '==', generationId).get();
      const last = run.calls[run.calls.length - 1];
      const history = job.get('aiRecoveryHistory') ?? [];
      const eligible = recoveryEligible(history.slice(0, 3));
      const pathD = success && run.calls.length === 5 && eligible && job.get('aiRecoveryCreditUsed') === true;
      let digestVerified = false; let candidatePersistedExactly = false;
      if (success && last.reviewRequest && last.response) {
        const review = parseNutritionReview(last.response.output, candidateDigest(last.reviewRequest.candidate));
        digestVerified = review.status === 'approved' && storedPlan.get('generationMetadata.review.candidateDigest') === review.candidateDigest;
        const validated = validateAndBuildPlan(last.reviewRequest.candidate, context.profile.mealSlots, context.engine,
          context.profile.excludedAllergens, false, { dietaryPattern: context.profile.dietaryPattern, excludedFoodNames: last.reviewRequest.foodNames.excluded });
        candidatePersistedExactly = isDeepStrictEqual(validated.meals, storedPlan.get('meals'))
          && isDeepStrictEqual(validated.dailyTotals, storedPlan.get('dailyTotals'));
      }
      const priorPreserved = !success && isDeepStrictEqual(prior.data(), priorData) && rate.get('activePlanId') === 'synthetic-prior';
      run.result = { success, ...checkpoint(job), failureCode: job.get('errorCode') ?? null,
        lastFailureCode: job.get('lastFailureCode') ?? null, eligible, pathD, digestVerified, candidatePersistedExactly,
        planExists: storedPlan.exists, priorPreserved, priorStatus: prior.get('status'), activePlanId: rate.get('activePlanId'),
        review: storedPlan.get('generationMetadata.review') ?? null, operations: ops.docs.map(d => ({ id: d.id, ...d.data() })),
        durationMs: Date.now() - Date.parse(run.startedAt) }; save();
      try {
        expect(run.calls.filter(c => c.httpStartedAt).length).toBe(run.calls.length);
        expect(job.get('aiCallCount')).toBe(run.calls.length); expect(ops.size).toBe(run.calls.length);
        expect(job.get('aiCallCount')).toBeLessThanOrEqual(5); expect(job.get('aiReservedUsd')).toBeLessThanOrEqual(.04);
        expect(storedPlan.exists).toBe(success); expect(['completed', 'failed']).toContain(job.get('status'));
        if (job.get('aiRecoveryCreditUsed')) {
          expect(eligible).toBe(true); expect(job.get('aiRecoveryGrantedAtCall')).toBe(4);
          expect(run.calls[3].checkpoint.creditUsed).toBe(true);
          expect(run.calls[3].checkpoint.history).toHaveLength(3);
        }
        if (success) {
          expect(digestVerified).toBe(true); expect(candidatePersistedExactly).toBe(true);
          expect(prior.get('status')).toBe('archived'); expect(rate.get('activePlanId')).toBe(generationId);
          expect(last.role).toBe('reviewer'); expect(last.response).toBeDefined();
        } else expect(priorPreserved).toBe(true);
        if (pathD) { ledger.stopped = 'successful_real_path_D_verified'; save(); }
      } catch (error) { ledger.stopped = 'critical_verification_failure'; save(); throw error; }
      console.info(JSON.stringify({ index: run.index, scenario, generationId, success, calls: run.calls.length, pathD }));
    } finally { closeSync(lock); unlinkSync(lockPath); }
  }, 450_000);
});
