import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { readOnboardingDraft, writeOnboardingDraft, bindOnboardingDraft, draftToQuiz, type OnboardingDraft } from '../onboarding/draftStorage';
import { nutritionDraftAnswers } from '../onboarding/nutritionDraft';
import { isProfileDraftComplete } from '../nutrition/ui/profileSteps';
import { serializeNutritionProfileAnswers, type NutritionProfileAnswers } from './nutritionProfile';
import { validateCustomFoodInput } from './nutritionFoods';

/** Captured before Firebase changes identity; JSON copy also strips undefined optionals. */
export async function captureOnboardingNutrition(legalAccepted = false): Promise<OnboardingDraft | null> {
  const draft = await readOnboardingDraft(true);
  if (!draft?.nutrition.completed) return null;
  if (draft.transfer) {
    // The UID is checked after provider authentication, before any provisioning.
    return JSON.parse(JSON.stringify({ ...draft, ...(legalAccepted ? { registration: { legalAccepted: true } } : {}) })) as OnboardingDraft;
  }
  const goal = draft.answers.goal;
  if (!goal || !isProfileDraftComplete(goal, nutritionDraftAnswers(draft.nutrition))) throw new Error('INCOMPLETE_NUTRITION');
  const { randomUUID } = await import('expo-crypto');
  const snapshot: OnboardingDraft = JSON.parse(JSON.stringify({ ...draft, sessionId: draft.sessionId ?? randomUUID(), ...(legalAccepted ? { registration: { legalAccepted: true } } : {}) }));
  await writeOnboardingDraft(snapshot);
  return snapshot;
}
export async function bindNutritionSnapshot(uid: string, snapshot: OnboardingDraft | null): Promise<void> {
  if (snapshot?.sessionId) await bindOnboardingDraft(uid, snapshot.sessionId, snapshot.registration?.legalAccepted);
}

/** Identity is proven by the enrollment written atomically with this account's creation. */
export async function transferOnboardingNutrition(uid: string): Promise<'none' | 'transferred' | 'existing' | 'foreign'> {
  const draft = await readOnboardingDraft(true);
  if (!draft) return 'none';
  if (!draft.nutrition.completed || !draft.sessionId) {
    if (draft.transfer) throw new Error('INCOMPLETE_NUTRITION');
    return 'foreign'; // Login never silently discards an anonymous partial filling.
  }
  if (draft.transfer && draft.transfer.uid !== uid) return 'foreign';
  if (auth.currentUser?.uid !== uid) return 'foreign';
  const marker = await getDoc(doc(db, 'users', uid, 'onboardingNutritionState', 'current'));
  if (marker.data()?.sessionId !== draft.sessionId) return 'foreign';
  if (auth.currentUser?.uid !== uid) throw new Error('ONBOARDING_IDENTITY_CHANGED');
  await bindOnboardingDraft(uid, draft.sessionId);
  const answers = JSON.parse(JSON.stringify(nutritionDraftAnswers(draft.nutrition))) as NutritionProfileAnswers;
  if (!draft.answers.goal || !isProfileDraftComplete(draft.answers.goal, answers)) throw new Error('INCOMPLETE_NUTRITION');
  const serialized = serializeNutritionProfileAnswers(answers);
  return runTransaction(db, async (tx) => {
    if (auth.currentUser?.uid !== uid) throw new Error('ONBOARDING_IDENTITY_CHANGED');
    const profile = doc(db, 'users', uid, 'nutritionProfile', 'current');
    const saved = await tx.get(profile);
    if (saved.exists()) {
      const previous = saved.data();
      const keys = Object.keys(previous).filter((key) => key !== 'updatedAt');
      if (keys.length !== Object.keys(answers).length || keys.some((key) =>
        JSON.stringify(previous[key]) !== JSON.stringify((answers as unknown as Record<string, unknown>)[key]))) {
        throw new Error('NUTRITION_PROFILE_CONFLICT');
      }
    }
    // Library ownership is independent of the current profile selections.
    const localFoods = draft.nutrition.customFoods;
    for (const food of localFoods) {
      if (!/^custom_[A-Za-z0-9_-]+$/.test(food.id)) throw new Error('INVALID_CUSTOM_FOOD_ID');
      validateCustomFoodInput({ name: food.name, nutritionPer100g: food.nutritionPer100g });
    }
    if (new Set(localFoods.map((food) => food.id)).size !== localFoods.length) throw new Error('CUSTOM_FOOD_COLLISION');
    const ids = [...new Set([...answers.preferredFoodIds, ...answers.usualFoodIds, ...answers.excludedFoodIds, ...localFoods.map((food) => food.id)])];
    const localById = new Map(localFoods.map((food) => [food.id, food]));
    // Validate remote references inside the same transaction. Never drop an exclusion.
    const refs = ids.map((id) => doc(db, ...(id.startsWith('custom_')
      ? ['users', uid, 'nutritionFoods', id] : ['nutritionFoods', id]) as [string, ...string[]]));
    const existing = await Promise.all(refs.map((ref) => tx.get(ref)));
    existing.forEach((snapshot, index) => {
      const local = localById.get(ids[index]);
      if (local) {
        if (snapshot.exists() && (snapshot.data().name !== local.name
          || JSON.stringify(snapshot.data().nutritionPer100g) !== JSON.stringify(local.nutritionPer100g))) throw new Error('CUSTOM_FOOD_COLLISION');
      } else if (!snapshot.exists() || (!ids[index].startsWith('custom_') && snapshot.data().generationStatus !== 'approved')) {
        throw new Error('ONBOARDING_CATALOG_CHANGED');
      }
    });
    localFoods.forEach((food) => {
      const index = ids.indexOf(food.id);
      if (!existing[index].exists()) tx.set(refs[index], { ...food, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    if (!saved.exists()) tx.set(profile, serialized);
    return saved.exists() ? 'existing' as const : 'transferred' as const;
  });
}

const provisioningFlights = new Map<string, Promise<void>>();
/** Resume only the same identity and consent recorded before the interrupted signup. */
export function recoverOnboardingNutritionProvisioning(user: import('firebase/auth').User): Promise<void> {
  const existing = provisioningFlights.get(user.uid);
  if (existing) return existing;
  const flight = (async () => {
    if (auth.currentUser?.uid !== user.uid) return;
    const { getUserProfile, provisionNewUser } = await import('./userProfile');
    if (await getUserProfile(user.uid)) return;
    const draft = await readOnboardingDraft(true);
    if (!draft?.transfer || draft.transfer.uid !== user.uid || !draft.sessionId
      || auth.currentUser?.uid !== user.uid) return;
    // Earlier v2 bindings were also written only after the registration eligibility
    // assertion. A complete, bound plan snapshot is evidence of that already-started
    // registration; v1/partial/unbound drafts never acquire inferred authorization.
    const legacyAuthorized = draft.currentStepId === 'plan' && draft.nutrition.completed;
    if (!draft.registration?.legalAccepted && !legacyAuthorized) return;
    if (!draft.answers.goal || !isProfileDraftComplete(draft.answers.goal, nutritionDraftAnswers(draft.nutrition))) {
      throw new Error('INCOMPLETE_NUTRITION');
    }
    if (auth.currentUser?.uid !== user.uid) throw new Error('ONBOARDING_IDENTITY_CHANGED');
    try {
      await provisionNewUser(user, { name: draft.name ?? undefined, answers: draftToQuiz(draft),
        legalAccepted: true, nutritionSessionId: draft.sessionId });
    } catch (error) {
      // Another device may have committed this exact creation batch. Rules prevent
      // the losing batch from overwriting it; only the same session acknowledges it.
      if (auth.currentUser?.uid !== user.uid) throw error;
      const marker = await getDoc(doc(db, 'users', user.uid, 'onboardingNutritionState', 'current'));
      if (marker.data()?.sessionId !== draft.sessionId || !await getUserProfile(user.uid)) throw error;
    }
  })().finally(() => { provisioningFlights.delete(user.uid); });
  provisioningFlights.set(user.uid, flight);
  return flight;
}
