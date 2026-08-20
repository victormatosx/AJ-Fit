/**
 * Explicit, identity-scoped resolution state for the cold-start
 * `users/{uid}` + latest-questionnaire load (`AuthContext.loadUserState`).
 *
 * ROOT CAUSE this replaces: the previous implementation tracked only
 * `questionnaire: QuestionnaireDoc | null`, so `null` meant three different
 * things at once — "not loaded yet", "confirmed absent", and "the Firestore
 * read failed". A transient read failure (network blip, `unavailable`,
 * cold-start token race) collapsed into the same client state as "this
 * account never completed the questionnaire", intermittently bouncing an
 * established account back to onboarding. `QuestionnaireResolution` makes
 * the third case a distinct, first-class state that can never be read as
 * "not found" by the navigation gate (`src/lib/premiumGate.ts`).
 *
 * Pure identity-scoped reducer, same pattern as `subscriptionLifecycle.ts`
 * (SubscriptionContext's state machine): every event carries the `uid` and
 * `generation` captured when its async work started, so a result for an
 * older identity/attempt is a no-op even if it resolves after a newer
 * login, logout, or refresh. `AuthContext.tsx` is the only impure caller —
 * it owns the `generation` ref and dispatches these events; this file has
 * no dependency on React or Firebase.
 */

export type QuestionnaireResolution = 'unknown' | 'loading' | 'found' | 'not_found' | 'error';

export type ProfileLoadState<TProfile, TQuestionnaire> = {
  uid: string | null;
  generation: number;
  loading: boolean;
  profile: TProfile | null;
  questionnaire: TQuestionnaire | null;
  questionnaireResolution: QuestionnaireResolution;
  error: unknown | null;
};

export type ProfileLoadEvent<TProfile, TQuestionnaire> =
  | { type: 'identity-cleared' }
  | { type: 'load-started'; uid: string; generation: number }
  | {
      type: 'load-succeeded';
      uid: string;
      generation: number;
      profile: TProfile | null;
      questionnaire: TQuestionnaire | null;
    }
  | { type: 'load-failed'; uid: string; generation: number; error: unknown };

export function createInitialProfileLoadState<TProfile, TQuestionnaire>(): ProfileLoadState<
  TProfile,
  TQuestionnaire
> {
  return {
    uid: null,
    generation: 0,
    loading: false,
    profile: null,
    questionnaire: null,
    questionnaireResolution: 'unknown',
    error: null,
  };
}

function isCurrentLoad<TProfile, TQuestionnaire>(
  state: ProfileLoadState<TProfile, TQuestionnaire>,
  event: { uid: string; generation: number },
): boolean {
  return state.uid === event.uid && state.generation === event.generation;
}

/**
 * `load-started` always applies unconditionally — it is what DEFINES the
 * new "current" (uid, generation) pair every later event is checked
 * against. `load-succeeded`/`load-failed` are no-ops when they don't match
 * the CURRENT (uid, generation): either a newer load already started
 * (`generation` mismatch) or a different account is now active (`uid`
 * mismatch) — either way, a stale async result must never overwrite
 * fresher state.
 *
 * A failed load never clears a previously-committed `profile`/`questionnaire`
 * (invariant this file exists to protect: an error is never reinterpreted
 * as "no questionnaire", and a refresh that fails must not erase
 * known-good data either). `load-started` for the SAME uid (a refresh, not
 * a new login) preserves the previous `profile`/`questionnaire` for the
 * same reason; a genuine identity change (different uid) clears them,
 * since carrying a stale account's data into a new one's loading window
 * would be a leak, not a convenience.
 */
export function reduceProfileLoad<TProfile, TQuestionnaire>(
  state: ProfileLoadState<TProfile, TQuestionnaire>,
  event: ProfileLoadEvent<TProfile, TQuestionnaire>,
): ProfileLoadState<TProfile, TQuestionnaire> {
  switch (event.type) {
    case 'identity-cleared':
      return createInitialProfileLoadState();

    case 'load-started': {
      const sameIdentity = state.uid === event.uid;
      return {
        uid: event.uid,
        generation: event.generation,
        loading: true,
        profile: sameIdentity ? state.profile : null,
        questionnaire: sameIdentity ? state.questionnaire : null,
        questionnaireResolution: 'loading',
        error: null,
      };
    }

    case 'load-succeeded':
      if (!isCurrentLoad(state, event)) return state;
      return {
        ...state,
        loading: false,
        profile: event.profile,
        questionnaire: event.questionnaire,
        questionnaireResolution: event.questionnaire ? 'found' : 'not_found',
        error: null,
      };

    case 'load-failed':
      if (!isCurrentLoad(state, event)) return state;
      return {
        ...state,
        loading: false,
        questionnaireResolution: 'error',
        error: event.error,
      };

    default:
      return state;
  }
}

// ─── Retry policy for transient Firestore read failures ─────────────────

/**
 * Only codes that plausibly mean "the request itself never really landed"
 * (a dropped connection, a request that timed out mid-flight). Deliberately
 * narrow: `permission-denied`, `unauthenticated`, `invalid-argument`, and
 * anything unrecognized are treated as permanent — retrying them cannot
 * change the outcome, and blindly retrying `permission-denied` would just
 * hide a real Rules/auth problem behind a spinner instead of surfacing it.
 */
const RETRYABLE_FIRESTORE_CODES = new Set(['unavailable', 'deadline-exceeded']);

function firestoreErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isRetryableFirestoreError(err: unknown): boolean {
  const code = firestoreErrorCode(err);
  return code !== undefined && RETRYABLE_FIRESTORE_CODES.has(code);
}

/**
 * Delay before each retry, in order (one entry per retry, not counting the
 * initial attempt) — `[400, 1200]` means: try immediately, retry once after
 * 400ms, retry once more after 1200ms (3 attempts total, ~1.6s worst case
 * before surfacing the recoverable error UI). Short enough that a genuine
 * cold-start network blip self-heals before a user notices; bounded low
 * enough to never look like a hang.
 */
export const PROFILE_LOAD_RETRY_DELAYS_MS: readonly number[] = [400, 1200];

export type FirestoreRetryResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number; retryable: boolean };

/**
 * Runs `load` up to `1 + delaysMs.length` times. Stops immediately — no
 * further attempts — the first time `load()` throws a non-retryable error,
 * since retrying `permission-denied` (etc.) can never succeed.
 */
export async function withFirestoreRetry<T>(
  load: (attempt: number) => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    onAttempt?: (info: { attempt: number; error?: unknown; retryable?: boolean }) => void;
  } = {},
): Promise<FirestoreRetryResult<T>> {
  const delays = options.delaysMs ?? PROFILE_LOAD_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = delays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential retries are the point
      const value = await load(attempt);
      options.onAttempt?.({ attempt });
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      const retryable = isRetryableFirestoreError(error);
      const isLastAttempt = attempt === maxAttempts;
      options.onAttempt?.({ attempt, error, retryable });
      if (!retryable || isLastAttempt) {
        return { ok: false, error, attempts: attempt, retryable };
      }
      // eslint-disable-next-line no-await-in-loop -- sequential retries are the point
      await sleep(delays[attempt - 1]);
    }
  }
  /* istanbul ignore next -- the loop above always returns before falling through */
  throw new Error('withFirestoreRetry: unreachable');
}
