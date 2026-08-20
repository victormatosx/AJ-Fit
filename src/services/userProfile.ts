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
  runTransaction,
  serverTimestamp,
  Timestamp,
  deleteField,
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
import {
  normalizeDisplayName,
  validateDisplayName,
  validateProfileBirthDate,
  validateProfileHeight,
} from '../lib/userProfileValidation';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '../types/language';
import {
  DEFAULT_UNITS_PREFERENCE,
  type UnitsPreference,
} from '../types/units';

/**
 * User repository — the only place that touches `users/{userId}` and its
 * `questionnaires` subcollection.
 *
 * Data model (docs/03_modelagem_banco_e_dados.md, docs/04_contratos_de_api.md §5):
 *
 *   users/{userId}
 *     profile { name, email, birthDate, photoURL, photoVersion, height }
 *     preferences { language, units, theme }
 *     subscription { status, provider, trialEndsAt, currentPeriodEndsAt, ... }
 *       (full schema: docs/13_assinaturas_e_billing.md §26 — only the 4
 *       fields the legacy migration below can populate are typed here; the
 *       rest are backend-only, written exclusively via
 *       functions/src/billing/subscriptionSync.ts)
 *     metadata { role, activeWorkoutId, createdAt, updatedAt }
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
  profile: {
    name: string;
    email: string;
    /** Mutable value; the onboarding snapshot remains immutable. */
    birthDate?: Timestamp | null;
    /** Download URL for `users/{uid}/profile/avatar` in Firebase Storage. */
    photoURL?: string;
    /** Server timestamp changed exclusively with photoURL. */
    photoVersion?: Timestamp;
    /** Mutable value in cm; overrides the immutable onboarding questionnaire's height. */
    height?: number;
  };
  preferences: {
    language: SupportedLanguage;
    units: UnitsPreference;
    theme: 'dark' | 'light' | 'system';
  };
  subscription: {
    status?: SubscriptionStatus;
    /** Webhook mirror only; CustomerInfo remains authoritative for access. */
    entitlementActive?: boolean;
    provider?: 'REVENUECAT';
    productId?: string;
    store?: 'APP_STORE' | 'PLAY_STORE';
    startedAt?: Timestamp;
    trialEndsAt?: Timestamp | null;
    /** Renamed from `endsAt` in Sprint 3.5 — docs/13_assinaturas_e_billing.md §26. */
    currentPeriodEndsAt?: Timestamp | null;
    canceledAt?: Timestamp | null;
    lastRenewedAt?: Timestamp | null;
    lastEventId?: string;
    lastEventTimestampMs?: number;
    updatedAt?: Timestamp;
  };
  metadata: {
    role: 'user' | 'admin';
    activeWorkoutId?: string;
    createdAt: Timestamp | null;
    updatedAt: Timestamp | null;
    /**
     * Server-set marker for the initial commercial gate (docs/13 — "Fase 1
     * limited-mode rollout" removed the root Paywall for EVERYONE; this
     * reintroduces it only for accounts that never resolved it).
     *
     * - Absent (no key at all): a document written before this field
     *   existed. Never reinterpreted as "new" — see `provisionNewUser`. The
     *   gate (`src/lib/premiumGate.ts`) treats absence as resolved, exactly
     *   like an established account, so no pre-existing user is ever pushed
     *   into an initial Paywall retroactively.
     * - `null`: written explicitly by `provisionNewUser` for every account
     *   created from this field's introduction onward. Means "brand new,
     *   initial commercial gate still pending".
     * - `Timestamp`: written exclusively by the backend
     *   (`functions/src/billing/subscriptionSync.ts`) the first time a
     *   RevenueCat webhook event confirms `entitlementActive: true` for this
     *   uid. Never written or overwritable by the client — Firestore Rules'
     *   `users/{userId}` update rule restricts client updates to
     *   `metadata.updatedAt` only, so this field can only transition
     *   null → Timestamp via the Admin SDK. Once set, never cleared: a
     *   later cancellation/expiration does not revert the account to
     *   "new" (see the CASE B matrix in docs/13).
     */
    commercialGateResolvedAt?: Timestamp | null;
  };
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

function migratedUserDocument(data: Record<string, unknown>): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    name: typeof data.name === 'string' ? data.name : 'Atleta',
    email: typeof data.email === 'string' ? data.email : '',
  };
  if (data.birthDate instanceof Timestamp) profile.birthDate = data.birthDate;
  if (typeof data.photoURL === 'string') profile.photoURL = data.photoURL;

  const subscription: Record<string, unknown> = {};
  if (typeof data.subscriptionStatus === 'string') {
    subscription.status = data.subscriptionStatus;
  }
  if (typeof data.subscriptionProvider === 'string') {
    subscription.provider = data.subscriptionProvider;
  }
  if (data.trialEndsAt instanceof Timestamp || data.trialEndsAt === null) {
    subscription.trialEndsAt = data.trialEndsAt;
  }
  if (data.subscriptionEndsAt instanceof Timestamp || data.subscriptionEndsAt === null) {
    // Old flat field was `subscriptionEndsAt`; the nested field it maps to
    // was renamed `endsAt` → `currentPeriodEndsAt` in Sprint 3.5 (must match
    // firestore.rules' `legacyMigrationValid()`, which reads this same old
    // flat field into the new nested name).
    subscription.currentPeriodEndsAt = data.subscriptionEndsAt;
  }

  const metadata: Record<string, unknown> = {
    role: 'user',
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (typeof data.activeWorkoutId === 'string') {
    metadata.activeWorkoutId = data.activeWorkoutId;
  }

  return {
    profile,
    preferences: {
      language: DEFAULT_LANGUAGE,
      units: DEFAULT_UNITS_PREFERENCE,
      theme: 'dark',
    },
    subscription,
    metadata,
  };
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
      profile: {
        name: deriveName(user, input.name),
        email: user.email ?? '',
        ...(input.answers?.birthDate
          ? { birthDate: Timestamp.fromDate(input.answers.birthDate) }
          : {}),
      },
      preferences: {
        language: DEFAULT_LANGUAGE,
        units: DEFAULT_UNITS_PREFERENCE,
        theme: 'dark',
      },
      subscription: {},
      metadata: {
        role: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Explicit `null`, never omitted: this is what marks the account as
        // "new, initial commercial gate pending" (see the `UserProfile`
        // type doc comment). Written identically regardless of provider
        // (email/password, Apple, Google) — `provisionNewUser` is the only
        // place any of them create this document.
        commercialGateResolvedAt: null,
      },
    },
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

/** Reads the main user document and atomically upgrades the former flat schema. */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const ref = userRef(uid);
  let migrated = false;

  const current = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data.profile && data.preferences && data.subscription && data.metadata) {
      return data as UserProfile;
    }

    transaction.set(ref, migratedUserDocument(data));
    migrated = true;
    return null;
  });

  if (current || !migrated) return current;
  const migratedSnap = await getDoc(ref);
  return migratedSnap.exists() ? (migratedSnap.data() as UserProfile) : null;
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
 * Updates non-sensitive, client-editable profile fields and always
 * refreshes `updatedAt`. Sensitive/backend-owned fields are impossible to pass
 * (type) and are also rejected by Firestore rules.
 */
export async function updateUserProfile(
  uid: string,
  data: {
    name?: string;
    birthDate?: Date | null;
    photoURL?: string | null;
    height?: number | null;
  } = {},
): Promise<void> {
  const update: Record<string, unknown> = { 'metadata.updatedAt': serverTimestamp() };

  if (data.name !== undefined) {
    const error = validateDisplayName(data.name);
    // Validators returned locale-free string messages in the past. They now
    // return `{ code, params }`; we rethrow the code as the Error message so
    // this service stays locale-free and the caller (EditProfileScreen)
    // decides how to display it. Callers that don't recognize the code fall
    // back to a generic "couldn't save" toast.
    if (error) throw new Error(error.code);
    update['profile.name'] = normalizeDisplayName(data.name);
  }
  if (data.birthDate !== undefined) {
    if (data.birthDate) {
      const error = validateProfileBirthDate(data.birthDate);
      if (error) throw new Error(error.code);
    }
    update['profile.birthDate'] = data.birthDate
      ? Timestamp.fromDate(data.birthDate)
      : deleteField();
  }
  if (data.photoURL !== undefined) {
    update['profile.photoURL'] = data.photoURL || deleteField();
    update['profile.photoVersion'] = serverTimestamp();
  }
  if (data.height !== undefined) {
    if (data.height !== null) {
      const error = validateProfileHeight(data.height);
      if (error) throw new Error(error.code);
    }
    update['profile.height'] = data.height ?? deleteField();
  }

  await updateDoc(userRef(uid), update);
}
