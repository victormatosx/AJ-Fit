import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultQuiz, type Quiz } from '../state/AppState';
import { logError, logInfo } from '../lib/logger';
import type { OnboardingStepId } from './steps';
import { cleanApplicableAnswers, normalizeLoadedQuiz } from '../lib/questionnaireSchema';

export const ONBOARDING_DRAFT_STORAGE_KEY = 'ajfit-onboarding-draft';
export const ONBOARDING_DRAFT_SCHEMA_VERSION = 1 as const;

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

export interface OnboardingDraftV1 {
  version: 1;
  currentStepId: OnboardingStepId;
  updatedAt: string;
  /** Pre-auth-only field — never part of `Quiz`/Firestore questionnaire. */
  name: string | null;
  answers: DraftQuizAnswers;
}

export type OnboardingDraft = OnboardingDraftV1;

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
  quiz: Quiz;
}): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_SCHEMA_VERSION,
    currentStepId: params.currentStepId,
    updatedAt: new Date().toISOString(),
    name: params.name,
    answers: toDraftAnswers(params.quiz),
  };
}

/**
 * Never throws and never returns a shape the rest of the app can't trust —
 * an unrecognized/corrupted/future-versioned draft is treated the same as
 * "no draft" so a schema change can never crash a cold start.
 */
function migrateDraft(raw: unknown): OnboardingDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<OnboardingDraftV1>;
  if (candidate.version !== 1) return null;
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
  return {
    version: 1,
    currentStepId: legacyGroupedSteps[candidate.currentStepId] ?? candidate.currentStepId as OnboardingStepId,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    name: typeof candidate.name === 'string' ? candidate.name : null,
    answers: (candidate.answers ?? {}) as DraftQuizAnswers,
  };
}

export async function readOnboardingDraft(): Promise<OnboardingDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = migrateDraft(JSON.parse(raw));
    if (!parsed) {
      logInfo('onboardingDraft', 'draft_discarded_incompatible');
      return null;
    }
    return parsed;
  } catch (err) {
    logError('onboardingDraft:read', err);
    return null;
  }
}

/** Draft's quiz answers reconstructed into the client `Quiz` shape, ready for `setQuiz`. */
export function draftToQuiz(draft: OnboardingDraft): Quiz {
  return fromDraftAnswers(draft.answers);
}

export async function writeOnboardingDraft(draft: OnboardingDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch (err) {
    logError('onboardingDraft:write', err);
  }
}

/**
 * Only call once the draft's data has been durably written under the real
 * Firebase UID (post `provisionNewUser`/`ensureUserProvisioned`/
 * `addQuestionnaire` success) — never before, so a dropped connection during
 * signup can't silently lose the anonymous progress.
 */
export async function clearOnboardingDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
  } catch (err) {
    logError('onboardingDraft:clear', err);
  }
}
