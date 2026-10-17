import type { User } from 'firebase/auth';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, deleteDoc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
const mocks = vi.hoisted(() => ({ db: null as unknown, auth: { currentUser: { uid: 'onboarding-alice' } }, store: new Map<string, string>() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'stable-new-session' }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; }, auth: mocks.auth }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => mocks.store.get(key) ?? null,
  setItem: async (key: string, value: string) => { mocks.store.set(key, value); },
  removeItem: async (key: string) => { mocks.store.delete(key); },
} }));
import { provisionNewUser } from '../userProfile';
import { captureOnboardingNutrition, bindNutritionSnapshot, recoverOnboardingNutritionProvisioning, transferOnboardingNutrition } from '../onboardingNutritionHandoff';
import { buildDraft, writeOnboardingDraft, readOnboardingDraft } from '../../onboarding/draftStorage';
import { emptyOnboardingNutrition } from '../../onboarding/nutritionDraft';
import { defaultQuiz } from '../../state/AppState';
let env: RulesTestEnvironment;
const uid = 'onboarding-alice';
describe.skipIf(!process.env.ONBOARDING_NUTRITION_INTEGRATION)('nutrition handoff (real rules)', () => {
  beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'ajfit-rules-test', firestore: { rules: readFileSync(resolve('firestore.rules'), 'utf8') } }); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore(); mocks.store.clear(); mocks.auth.currentUser = { uid };
    mocks.db = env.authenticatedContext(uid).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), { metadata: { createdAt: Timestamp.now() } });
      await setDoc(doc(ctx.firestore(), 'users', uid, 'onboardingNutritionState', 'current'), { sessionId: 'session-123' });
    });
    const nutrition = emptyOnboardingNutrition();
    nutrition.completed = true;
    nutrition.customFoods = [{ id: 'custom_stable', name: 'Arroz pessoal', nutritionPer100g: { kcal: 100, proteinG: 2, carbsG: 20, fatG: 1, fiberG: 1 } }];
    nutrition.answers = { ...nutrition.answers, nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'], varietyPreference: 'variety', preferredFoodIds: ['custom_stable'] };
    const draft = buildDraft({ currentStepId: 'plan', name: null, healthIntegrationChoice: 'skip', quiz: { ...defaultQuiz, goal: 'health' }, nutrition });
    draft.sessionId = 'session-123'; await writeOnboardingDraft(draft);
  });
  it('atomically transfers private foods and profile, with idempotent concurrent retries', async () => {
    const result = await Promise.all([transferOnboardingNutrition(uid), transferOnboardingNutrition(uid)]);
    expect(result).toContain('transferred');
    const db = env.authenticatedContext(uid).firestore();
    expect((await getDoc(doc(db, 'users', uid, 'nutritionProfile', 'current'))).data()?.preferredFoodIds).toEqual(['custom_stable']);
    expect((await getDoc(doc(db, 'users', uid, 'nutritionFoods', 'custom_stable'))).data()?.name).toBe('Arroz pessoal');
    expect(await transferOnboardingNutrition(uid)).toBe('existing');
    expect((await readOnboardingDraft())?.transfer?.uid).toBe(uid);
  });
  it('preserves created then deselected foods and repairs an identical profile without duplicating IDs', async () => {
    const draft = (await readOnboardingDraft())!;
    draft.nutrition.customFoods.push({ ...draft.nutrition.customFoods[0], id: 'custom_unselected', name: 'Biblioteca' });
    await writeOnboardingDraft(draft);
    await transferOnboardingNutrition(uid);
    const db = env.authenticatedContext(uid).firestore();
    expect((await getDoc(doc(db, 'users', uid, 'nutritionFoods', 'custom_unselected'))).data()?.name).toBe('Biblioteca');
    expect(await transferOnboardingNutrition(uid)).toBe('existing');
    expect((await getDoc(doc(db, 'users', uid, 'nutritionProfile', 'current'))).data()?.preferredFoodIds).toEqual(['custom_stable']);
    // A post-commit interruption must remain recoverable, including all library records.
    expect((await readOnboardingDraft())?.transfer?.uid).toBe(uid);
  });
  it('recaptures the same bound session, recovers interrupted provisioning and refuses a different UID', async () => {
    const draft = (await readOnboardingDraft())!;
    draft.answers = buildDraft({ currentStepId: 'plan', quiz: completeAnswers({ goal: 'health', birthDate: new Date('1995-01-01') }), name: 'Ana', healthIntegrationChoice: 'skip' }).answers;
    draft.registration = { legalAccepted: true };
    await writeOnboardingDraft(draft);
    const captured = await captureOnboardingNutrition(true);
    await bindNutritionSnapshot(uid, captured);
    expect((await captureOnboardingNutrition(true))?.sessionId).toBe('session-123');
    await expect(bindNutritionSnapshot('wrong-uid', captured)).rejects.toThrow('ONBOARDING_IDENTITY_MISMATCH');
    const email = 'recovery@example.test';
    mocks.db = env.authenticatedContext(uid, { email }).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'users', uid, 'onboardingNutritionState', 'current'));
      await deleteDoc(doc(ctx.firestore(), 'users', uid));
    });
    const user = { uid, email, displayName: 'Ana' } as User;
    await recoverOnboardingNutritionProvisioning({ ...user, uid: 'wrong-uid' });
    expect((await getDoc(doc(env.authenticatedContext(uid, { email }).firestore(), 'users', uid))).exists()).toBe(false);
    await Promise.all([recoverOnboardingNutritionProvisioning(user), recoverOnboardingNutritionProvisioning(user)]);
    const first = await getDoc(doc(env.authenticatedContext(uid, { email }).firestore(), 'users', uid));
    await recoverOnboardingNutritionProvisioning(user);
    expect((await getDoc(doc(env.authenticatedContext(uid, { email }).firestore(), 'users', uid))).data()?.metadata.createdAt).toEqual(first.data()?.metadata.createdAt);
    expect((await readOnboardingDraft())?.sessionId).toBe('session-123');
    expect((await getDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid, 'onboardingNutritionState', 'current'))).data()?.sessionId).toBe('session-123');
    await transferOnboardingNutrition(uid);
    expect((await readOnboardingDraft())?.transfer?.uid).toBe(uid);
  });
  it('recovers an older bound v2 plan snapshot without adding authorization to partial or v1 drafts', async () => {
    const draft = (await readOnboardingDraft())!;
    draft.answers = buildDraft({ currentStepId: 'plan', quiz: completeAnswers({ goal: 'health', birthDate: new Date('1995-01-01') }), name: 'Ana', healthIntegrationChoice: 'skip' }).answers;
    delete draft.registration;
    await writeOnboardingDraft(draft);
    await bindNutritionSnapshot(uid, await captureOnboardingNutrition());
    expect((await readOnboardingDraft())?.registration).toBeUndefined();
    const email = 'legacy-recovery@example.test';
    mocks.db = env.authenticatedContext(uid, { email }).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'users', uid, 'onboardingNutritionState', 'current'));
      await deleteDoc(doc(ctx.firestore(), 'users', uid));
    });
    await recoverOnboardingNutritionProvisioning({ uid, email } as User);
    expect((await getDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid, 'onboardingNutritionState', 'current'))).data()?.sessionId).toBe('session-123');
  });
  it('rejects missing catalog IDs without partial writes and preserves the draft', async () => {
    const draft = (await readOnboardingDraft())!;
    draft.nutrition.answers.excludedFoodIds = ['nf_missing'];
    await writeOnboardingDraft(draft);
    await expect(transferOnboardingNutrition(uid)).rejects.toThrow('ONBOARDING_CATALOG_CHANGED');
    const db = env.authenticatedContext(uid).firestore();
    expect((await getDoc(doc(db, 'users', uid, 'nutritionProfile', 'current'))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'users', uid, 'nutritionFoods', 'custom_stable'))).exists()).toBe(false);
    expect((await readOnboardingDraft())?.nutrition.answers.excludedFoodIds).toEqual(['nf_missing']);
  });
  it('never imports into an unrelated account or overwrites an existing profile', async () => {
    expect(await transferOnboardingNutrition('someone-else')).toBe('foreign');
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users', uid, 'nutritionProfile', 'current'), { marker: 'keep-existing' }); });
    await expect(transferOnboardingNutrition(uid)).rejects.toThrow('NUTRITION_PROFILE_CONFLICT');
    expect((await getDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid, 'nutritionProfile', 'current'))).data()).toEqual({ marker: 'keep-existing' });
  });
  it('enrolls only in the original account-creation batch, never on an established account', async () => {
    const fresh = 'nutrition-new-email';
    const email = 'nutrition@example.test';
    mocks.db = env.authenticatedContext(fresh, { email }).firestore();
    await provisionNewUser({ uid: fresh, email, displayName: 'Ana' } as User,
      { name: 'Ana', answers: completeAnswers({ birthDate: new Date('1995-01-01') }), legalAccepted: true, nutritionSessionId: 'new-session-123' });
    expect((await getDoc(doc(env.authenticatedContext(fresh, { email }).firestore(),
      'users', fresh, 'onboardingNutritionState', 'current'))).data()?.sessionId).toBe('new-session-123');
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'users', uid, 'onboardingNutritionState', 'current')); });
    await assertFails(setDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid, 'onboardingNutritionState', 'current'),
      { sessionId: 'retroactive-session', createdAt: Timestamp.now() }));
  });

});
