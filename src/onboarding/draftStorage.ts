import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultQuiz, type Quiz } from '../state/AppState';
import { logError } from '../lib/logger';
import { getStepSequence, ONBOARDING_STEPS, type OnboardingStepId } from './steps';
import { emptyOnboardingNutrition, restoreOnboardingNutrition, type OnboardingNutritionDraft } from './nutritionDraft';
import { cleanApplicableAnswers, normalizeLoadedQuiz } from '../lib/questionnaireSchema';

export const ONBOARDING_DRAFT_STORAGE_KEY = 'ajfit-onboarding-draft';
export const ONBOARDING_DRAFT_SCHEMA_VERSION = 2 as const;

/**
 * JSON has no `Date` — the draft stores `birthDate` as an ISO string (or
 * `null`), mirroring the same problem `toPersistedAnswers` solves for
 * Firestore's `Timestamp`.
 */
export type DraftQuizAnswers = Omit<Quiz, 'birthDate' | 'place'> & {
  birthDate: string | null;
  place?: Quiz['place'] | 'both' | null;
  /** @deprecated read-only compatibility for the removed mixed-location branch. */
  primaryPlace?: unknown;
  /** @deprecated read-only compatibility for drafts created before removal. */
  limitationImpact?: unknown;
  /** @deprecated read-only compatibility for drafts created before removal. */
  motivation?: unknown;
};

/**
 * The health-integration step's choice (Fase 5) — pre-auth-only, same as
 * `name`: never part of `Quiz`/Firestore questionnaire. `'connect'` means
 * "ask me to finish connecting once I'm signed in" — it is NOT itself a
 * live connection or a granted permission; see
 * `services/healthIntegrationOnboardingStep.ts` for what happens with it
 * once a real uid exists.
 */
export type OnboardingHealthIntegrationChoice = 'connect' | 'skip';

export interface OnboardingDraftV1 {
  version: 1;
  currentStepId: OnboardingStepId;
  updatedAt: string;
  /** Pre-auth-only field — never part of `Quiz`/Firestore questionnaire. */
  name: string | null;
  /** Pre-auth-only field — never part of `Quiz`/Firestore questionnaire. `null` until the step is answered. */
  healthIntegrationChoice: OnboardingHealthIntegrationChoice | null;
  answers: DraftQuizAnswers;
}

export interface OnboardingDraft extends Omit<OnboardingDraftV1, 'version'> {
  version: 2;
  sessionId: string | null;
  registration?: { legalAccepted: true };
  healthTransferUid?: string;
  nutrition: OnboardingNutritionDraft;
  transfer: { uid: string; status: 'pending' | 'confirmed' } | null;
}
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let storageQueue: Promise<unknown> = Promise.resolve();
function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.catch(() => undefined).then(operation);
  storageQueue = result;
  return result;
}

function toDraftAnswers(quiz: Quiz): DraftQuizAnswers {
  const { birthDate, ...rest } = cleanApplicableAnswers(quiz);
  return { ...rest, birthDate: birthDate ? birthDate.toISOString() : null };
}

function fromDraftAnswers(raw: Partial<DraftQuizAnswers> | undefined | null): Quiz {
  const {
    birthDate,
    primaryPlace: legacyPrimaryPlace,
    limitationImpact: _legacyLimitationImpact,
    motivation: _legacyMotivation,
    ...rest
  } = raw ?? {};
  const parsedBirthDate = birthDate ? new Date(birthDate) : null;
  return normalizeLoadedQuiz({
    ...defaultQuiz,
    ...rest,
    primaryPlace: legacyPrimaryPlace,
    birthDate: parsedBirthDate && !Number.isNaN(parsedBirthDate.getTime()) ? parsedBirthDate : null,
  });
}

export function buildDraft(params: {
  currentStepId: OnboardingStepId;
  name: string | null;
  healthIntegrationChoice: OnboardingHealthIntegrationChoice | null;
  quiz: Quiz;
  nutrition?: OnboardingNutritionDraft;
}): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_SCHEMA_VERSION,
    currentStepId: params.currentStepId,
    updatedAt: new Date().toISOString(),
    name: params.name,
    healthIntegrationChoice: params.healthIntegrationChoice,
    answers: toDraftAnswers(params.quiz),
    nutrition: params.nutrition ?? emptyOnboardingNutrition(),
    transfer: null,
    sessionId: null,
  };
}

/**
 * Never throws and never returns a shape the rest of the app can't trust —
 * an unrecognized/corrupted/future-versioned draft is treated the same as
 * "no draft" so a schema change can never crash a cold start.
 */
function migrateDraft(raw: unknown): OnboardingDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<Omit<OnboardingDraft, 'version'>> & { version?: number };
  if (candidate.version !== 1 && candidate.version !== 2) return null;
  if (!candidate.transfer?.uid && candidate.updatedAt && Date.now() - Date.parse(candidate.updatedAt) > RETENTION_MS) return null;
  if (typeof candidate.currentStepId !== 'string') return null;
  const legacyGroupedSteps: Record<string, OnboardingStepId> = {
    motivation: 'goal',
    primaryPlace: 'place',
    scheduleMode: 'days',
    trainingDays: 'days',
    pregnancyPrenatalCare: 'pregnancyCare',
    pregnancyExerciseRestriction: 'pregnancyCare',
    pregnancyComplication: 'pregnancyCare',
    postpartumTimeSinceBirth: 'postpartumContext',
    postpartumDeliveryType: 'postpartumContext',
  };
  let currentStepId = legacyGroupedSteps[candidate.currentStepId] ?? candidate.currentStepId as OnboardingStepId;
  const quiz = fromDraftAnswers(candidate.answers);
  const sequence = getStepSequence('anonymous', quiz);
  if (!sequence.includes(currentStepId)) currentStepId = sequence[0];
  const nutrition = restoreOnboardingNutrition(candidate.nutrition);
  if (!nutrition.completed && ONBOARDING_STEPS.findIndex((s) => s.id === currentStepId)
    > ONBOARDING_STEPS.findIndex((s) => s.id === 'interstitial_ajFitProgress')) {
    if (!currentStepId.startsWith('nutrition_')) currentStepId = `nutrition_${quiz.goal && sequence.includes('nutrition_nutritionGoalCategory') ? 'nutritionGoalCategory' : 'progressionPace'}`;
  }
  return {
    version: 2,
    nutrition,
    transfer: candidate.transfer ?? null,
    ...(candidate.registration?.legalAccepted === true ? { registration: { legalAccepted: true as const } } : {}),
    ...(typeof candidate.healthTransferUid === 'string' ? { healthTransferUid: candidate.healthTransferUid } : {}),
    sessionId: candidate.sessionId ?? null,
    currentStepId,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    name: typeof candidate.name === 'string' ? candidate.name : null,
    // Absent on every draft written before Fase 5 — degrades to `null`
    // ("no choice made yet"), never silently treated as `'connect'`.
    healthIntegrationChoice: candidate.healthIntegrationChoice === 'connect' || candidate.healthIntegrationChoice === 'skip'
      ? candidate.healthIntegrationChoice
      : null,
    answers: (candidate.answers ?? {}) as DraftQuizAnswers,
  };
}

export async function readOnboardingDraft(strict = false): Promise<OnboardingDraft | null> {
  return ordered(async () => {
    try {
      const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value && !value.transfer?.uid && typeof value.updatedAt === 'string'
        && Date.now() - Date.parse(value.updatedAt) > RETENTION_MS) {
        await AsyncStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
        return null;
      }
      return migrateDraft(value);
    } catch (err) { logError('onboardingDraft:read', err); if (strict) throw err; return null; }
  });
}

/** Draft's quiz answers reconstructed into the client `Quiz` shape, ready for `setQuiz`. */
export function draftToQuiz(draft: OnboardingDraft): Quiz {
  return fromDraftAnswers(draft.answers);
}

/** Failures propagate: auth must never proceed after an unconfirmed local snapshot. */
export async function writeOnboardingDraft(draft: OnboardingDraft): Promise<void> {
  return ordered(async () => {
    const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    let existing: OnboardingDraft | null = null;
    try { existing = raw ? migrateDraft(JSON.parse(raw)) : null; } catch { /* Replace corrupt unbound JSON. */ }
    if (existing?.transfer) throw new Error('ONBOARDING_TRANSFER_PENDING'); // Never overwrite another account's pending snapshot.
    await AsyncStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, ...(existing?.registration ? { registration: existing.registration } : {}), ...(existing?.healthTransferUid ? { healthTransferUid: existing.healthTransferUid } : {}), sessionId: draft.sessionId ?? existing?.sessionId ?? null }));
  });
}
export async function bindOnboardingDraft(uid: string, sessionId: string, legalAccepted = false): Promise<void> {
  return ordered(async () => {
    const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    const draft = raw ? migrateDraft(JSON.parse(raw)) : null;
    if (!draft?.nutrition.completed || draft.sessionId !== sessionId) throw new Error('ONBOARDING_SNAPSHOT_MISMATCH');
    if (draft.transfer && draft.transfer.uid !== uid) throw new Error('ONBOARDING_IDENTITY_MISMATCH');
    await AsyncStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, ...(legalAccepted ? { registration: { legalAccepted: true } } : {}), transfer: { uid, status: 'pending' } }));
  });
}
export async function clearOnboardingDraft(expected?: { uid: string; sessionId: string | null }): Promise<void> {
  return ordered(async () => {
    if (expected) {
      const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
      const draft = raw ? migrateDraft(JSON.parse(raw)) : null;
      if (!draft || draft.transfer?.uid !== expected.uid || draft.sessionId !== expected.sessionId) return;
    }
    await AsyncStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
  });
}

/** Bind only a choice captured before authentication; never infer ownership on login. */
export async function bindOnboardingHealthSnapshot(uid: string, snapshot: OnboardingDraft | null): Promise<void> {
  if (!snapshot?.healthIntegrationChoice) return;
  return ordered(async () => {
    const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    const draft = raw ? migrateDraft(JSON.parse(raw)) : null;
    if (!draft || draft.updatedAt !== snapshot.updatedAt) return;
    if ((draft.transfer && draft.transfer.uid !== uid) || (draft.healthTransferUid && draft.healthTransferUid !== uid)) return;
    await AsyncStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, healthTransferUid: uid }));
  });
}

export async function acknowledgeOnboardingHealthChoice(uid: string): Promise<void> {
  return ordered(async () => {
    const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    const draft = raw ? migrateDraft(JSON.parse(raw)) : null;
    if (!draft || (draft.transfer?.uid !== uid && draft.healthTransferUid !== uid)) return;
    await AsyncStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, healthIntegrationChoice: null }));
  });
}
