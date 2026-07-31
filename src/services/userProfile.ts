import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import type { Quiz } from '../state/AppState';
import {
  toPersistedAnswers,
  fromPersistedAnswers,
  type PersistedQuizAnswers,
} from '../lib/questionnaireAnswers';
import { logError } from '../lib/logError';

/**
 * User repository — the only place that touches `users/{userId}` and its
 * `questionnaires` subcollection.
 *
 * Data model (docs/03_modelagem_banco_e_dados.md, docs/04_contratos_de_api.md §5):
 *
 *   users/{userId}
 *     userId, role, name, email, createdAt, updatedAt          (client-owned)
 *     activeWorkoutId, subscriptionStatus, subscriptionProvider,
 *     trialEndsAt, subscriptionEndsAt                          (backend-owned)
 *
 *   users/{userId}/questionnaires/{questionnaireId}
 *     answers, version, createdAt
 *
 * The main document holds NO questionnaire answers. Each questionnaire (initial
 * or future reassessment) is a separate immutable document in the subcollection.
 *
 * `role` is always "user" when written by the client — promotion to admin is a
 * backend-only operation, enforced by Firestore rules. Documents in `users`
 * are ALWAYS keyed by uid (setDoc), never created with addDoc/auto-ids.
 */

/** Subscription statuses per docs/13_assinaturas_e_billing.md §22. */
export type SubscriptionStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'CANCELED'
  | 'BILLING_ISSUE'
  | 'EXPIRED';

export type UserProfile = {
  userId: string;
  role: 'user';
  name: string;
  email: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  // Backend-owned, optional until populated by the backend:
  activeWorkoutId?: string;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionProvider?: 'REVENUECAT';
  trialEndsAt?: Timestamp | null;
  subscriptionEndsAt?: Timestamp | null;
};

/** Questionnaire answers (the initial onboarding quiz shape). */
export type QuestionnaireAnswers = Quiz;

export type QuestionnaireDoc = {
  id: string;
  answers: QuestionnaireAnswers;
  version: number;
  createdAt: Timestamp | null;
};

// birthDate ⇄ Timestamp conversion (`toPersistedAnswers`/`fromPersistedAnswers`,
// including legacy-`age` compat) lives in src/lib/questionnaireAnswers.ts —
// it's pure Firestore-Timestamp logic with no app-initialization dependency,
// which is also what makes it unit-testable in isolation.

const USERS = 'users';
const QUESTIONNAIRES = 'questionnaires';

function userRef(uid: string) {
  return doc(db, USERS, uid);
}

function questionnairesRef(uid: string) {
  return collection(db, USERS, uid, QUESTIONNAIRES);
}

function deriveName(user: User, name?: string): string {
  const explicit = name?.trim() || user.displayName?.trim();
  if (explicit) return explicit;
  const local = user.email?.split('@')[0];
  return local || 'Atleta';
}

/**
 * Whether the onboarding answers are real (the user actually completed the
 * questionnaire) vs. untouched defaults. Prevents creating an empty
 * questionnaire on a social first-login that skipped onboarding.
 */
export function hasMeaningfulAnswers(answers?: QuestionnaireAnswers | null): boolean {
  return !!(
    answers &&
    (answers.sex !== null ||
      answers.goal !== null ||
      answers.level !== null ||
      answers.frequency !== null ||
      answers.place !== null)
  );
}

/**
 * Creates a brand-new user: the main `users/{uid}` document plus the initial
 * questionnaire, atomically, in a single batch. This is the ONLY place that
 * creates the user document, and it runs exactly once per account (from
 * `signUp`), so there is no race and no duplication.
 *
 * The main doc is keyed by uid (setDoc). The questionnaire id is generated once
 * up-front via `doc(collection(...))` — a single deterministic ref, no addDoc.
 */
export async function provisionNewUser(
  user: User,
  input: { name?: string; answers?: QuestionnaireAnswers | null },
): Promise<void> {
  const batch = writeBatch(db);

  batch.set(
    userRef(user.uid),
    {
      userId: user.uid,
      role: 'user',
      name: deriveName(user, input.name),
      email: user.email ?? '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  // Create the first questionnaire only when we actually have answers — never
  // an empty questionnaire (e.g. a social login that skipped onboarding).
  if (hasMeaningfulAnswers(input.answers)) {
    const qDoc = doc(questionnairesRef(user.uid));
    batch.set(qDoc, {
      answers: toPersistedAnswers(input.answers as Quiz),
      version: 1,
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

/**
 * Provisions the user document (+ first questionnaire) ONLY when it does not
 * exist yet. Used by every sign-in path that may be a first login (social,
 * or account creation). Never recreates or overwrites an existing user.
 * Returns true when a new user was created.
 */
export async function ensureUserProvisioned(
  user: User,
  input: { name?: string; answers?: QuestionnaireAnswers | null } = {},
): Promise<boolean> {
  const existing = await getUserProfile(user.uid);
  if (existing) return false;
  await provisionNewUser(user, input);
  return true;
}

/** Reads the main user document, or null when it does not exist. */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/** Reads the most recent questionnaire, or null when there is none. */
export async function getLatestQuestionnaire(
  uid: string,
): Promise<QuestionnaireDoc | null> {
  const q = query(questionnairesRef(uid), orderBy('createdAt', 'desc'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const raw = d.data() as {
    answers?: Partial<PersistedQuizAnswers>;
    version: number;
    createdAt: Timestamp | null;
  };
  if (!raw.answers) {
    // Never thrown (fromPersistedAnswers tolerates this), but worth a signal
    // — a questionnaire doc with no `answers` map shouldn't normally exist.
    logError('questionnaire:malformed', new Error('questionnaire doc missing answers'), {
      questionnaireId: d.id,
    });
  }
  return {
    id: d.id,
    answers: fromPersistedAnswers(raw.answers, raw.createdAt),
    version: raw.version,
    createdAt: raw.createdAt,
  };
}

/**
 * Adds a new questionnaire (e.g. a reassessment). Creates a separate immutable
 * document — never overwrites previous ones. `version` should increment across
 * the user's questionnaires.
 */
export async function addQuestionnaire(
  uid: string,
  answers: QuestionnaireAnswers,
  version: number,
): Promise<string> {
  const qDoc = doc(questionnairesRef(uid));
  await setDoc(qDoc, { answers: toPersistedAnswers(answers), version, createdAt: serverTimestamp() });
  await updateUserProfile(uid, {});
  return qDoc.id;
}

/**
 * Updates non-sensitive, client-editable fields (currently `name`) and always
 * refreshes `updatedAt`. Sensitive/backend-owned fields are impossible to pass
 * (type) and are also rejected by Firestore rules.
 */
export async function updateUserProfile(
  uid: string,
  data: Partial<Pick<UserProfile, 'name'>> = {},
): Promise<void> {
  const allowed = new Set(['name']);
  const safe = Object.fromEntries(
    Object.entries(data).filter(([key]) => allowed.has(key)),
  );
  await updateDoc(userRef(uid), { ...safe, updatedAt: serverTimestamp() });
}
