import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, enableNetwork, doc, setDoc, writeBatch, getDoc, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { subscribeToActiveNutritionGenerationJob, monitorNutritionGenerationJob } from '../nutritionGeneration';
import { subscribeToActiveNutritionPlan } from '../nutritionPlans';
const mocks = vi.hoisted(() => ({ db: null as unknown, callable: vi.fn() }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.callable }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unused-recovery-request' }));
vi.mock('../../lib/logger', () => ({ logOperationalInfo: vi.fn(), logWarn: vi.fn(), errorCode: () => 'test' }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('generation client recovery (real Firestore network)', () => {
  let env: RulesTestEnvironment;
  const uid = 'nutrition-recovery-only-emulator';
  const stops: Unsubscribe[] = [];
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'ajfit-rules-test',
      firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  });
  afterAll(async () => { stops.forEach((stop) => stop()); await env.cleanup(); });

  it('observes completion after offline/backend commit/reconnect and restores it in a fresh process', async () => {
    const generationId = 'persisted-first-job';
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'users', uid), { metadata: { createdAt: new Date() } });
      await setDoc(doc(admin, 'users', uid, 'onboardingNutritionState', 'current'), { autoGenerationId: generationId });
      await setDoc(doc(admin, 'users', uid, 'nutritionGenerationJobs', generationId), { status: 'running', generationId, planId: null });
    });
    const clientContext = env.authenticatedContext(uid);
    const client = clientContext.firestore() as unknown as Firestore;
    mocks.db = client;
    const active = vi.fn(); const job = vi.fn(); const plan = vi.fn(); const failed = vi.fn();
    stops.push(subscribeToActiveNutritionGenerationJob(uid, active));
    stops.push(monitorNutritionGenerationJob(uid, generationId, job, failed));
    stops.push(subscribeToActiveNutritionPlan(uid, plan));
    await vi.waitFor(() => expect(job).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' })), { timeout: 10000 });
    await vi.waitFor(() => expect(active).toHaveBeenLastCalledWith(expect.objectContaining({ generationId })), { timeout: 10000 });
    await disableNetwork(client);
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      const batch = writeBatch(admin);
      batch.update(doc(admin, 'users', uid, 'nutritionGenerationJobs', generationId), { status: 'completed', planId: generationId });
      batch.set(doc(admin, 'users', uid, 'nutritionPlans', generationId), { status: 'active', generationId, planId: generationId });
      await batch.commit();
    });
    expect(job).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' }));
    await enableNetwork(client);
    await vi.waitFor(() => expect(job).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed', planId: generationId })), { timeout: 10000 });
    await vi.waitFor(() => expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active', planId: generationId })), { timeout: 10000 });
    await vi.waitFor(() => expect(active).toHaveBeenLastCalledWith(null), { timeout: 10000 });
    expect(failed).toHaveBeenLastCalledWith(false);
    stops.splice(0).forEach((stop) => stop());
    await clientContext.firestore().terminate();

    // Fresh SDK/cache: equivalent data recovery to process termination, without any local job id.
    const restarted = env.authenticatedContext(uid).firestore() as unknown as Firestore;
    mocks.db = restarted;
    const marker = await getDoc(doc(restarted, 'users', uid, 'onboardingNutritionState', 'current'));
    expect(marker.data()?.autoGenerationId).toBe(generationId);
    const resumed = vi.fn(); const resumedPlan = vi.fn();
    stops.push(monitorNutritionGenerationJob(uid, marker.data()!.autoGenerationId, resumed, vi.fn()));
    stops.push(subscribeToActiveNutritionPlan(uid, resumedPlan));
    await vi.waitFor(() => expect(resumed).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' })), { timeout: 10000 });
    await vi.waitFor(() => expect(resumedPlan).toHaveBeenLastCalledWith(expect.objectContaining({ planId: generationId })), { timeout: 10000 });
    expect(mocks.callable).not.toHaveBeenCalled();
  }, 30000);
});
