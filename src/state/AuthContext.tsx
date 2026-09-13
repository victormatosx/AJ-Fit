import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { User } from 'firebase/auth';
import {
  signUpWithEmail,
  signInWithEmail,
  resetPassword,
  signOutUser,
  subscribeToAuthState,
  logAuthError,
  toAuthError,
} from '../services/auth';
import {
  provisionNewUser,
  ensureUserProvisioned,
  getUserProfile,
  getLatestQuestionnaire,
  type QuestionnaireAnswers,
  type QuestionnaireDoc,
  type UserProfile,
} from '../services/userProfile';
import {
  signInWithProvider as socialSignIn,
  completeLinkingWithPassword as socialLinkPassword,
  completeLinkingWithProvider as socialLinkProvider,
  discardNewSocialIdentity,
  getLinkedProviders,
  type SocialProvider,
} from '../services/socialAuth';
import {
  refreshEmailVerificationStatus,
  sendVerificationEmail,
} from '../services/emailVerification';
import { cleanupRestSessionArtifacts } from '../services/restSessionCleanup';
import { logInfo, logWarn } from '../lib/logger';
import {
  createInitialProfileLoadState,
  reduceProfileLoad,
  withFirestoreRetry,
  type QuestionnaireResolution,
} from '../lib/profileLoadState';
import { createSingleFlight } from '../lib/singleFlight';
import { normalizeWeekdays, trainingDaysValid } from '../lib/questionnaireSchema';
import {
  persistPreparedWorkoutProgram,
  type PrepareWorkoutProgramResult,
} from '../services/workoutPrograms';
import { ensureScheduleConfigFromQuestionnaire } from '../services/workoutSchedule';
import {
  assertNewAccountEligibility,
  RegistrationEligibilityError,
  resolveSocialAccountAdmission,
} from '../lib/registrationEligibility';

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type AuthCtx = {
  /** Current authenticated user (Firebase Auth), or null when signed out. */
  user: User | null;
  /** Main Firestore user document, or null. */
  profile: UserProfile | null;
  /** Most recent questionnaire for the current user, or null. */
  questionnaire: QuestionnaireDoc | null;
  /**
   * Explicit resolution of "does this account have a completed
   * questionnaire" — see `src/lib/profileLoadState.ts`. This, NOT
   * `Boolean(questionnaire)`, is the source of truth the navigation gate
   * (`resolvePremiumGate`) must use: `questionnaire` alone cannot
   * distinguish "not loaded yet" / "confirmed absent" / "read failed".
   */
  questionnaireResolution: QuestionnaireResolution;
  /** Linked sign-in providerIds, e.g. ['password','google.com','apple.com']. */
  linkedProviders: string[];
  /** True while the initial auth state is being resolved on startup. */
  initializing: boolean;
  /** True while `profile`/`questionnaire` are catching up to a just-set `user`. */
  profileLoading: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    answers: QuestionnaireAnswers,
    legalAccepted: boolean,
    /**
     * Phase 3 — the Analysis screen's pre-auth `prepareWorkoutProgram`
     * result (the onboarding funnel's own `preparedWorkoutProgram` state),
     * if it produced one. Optional and never trusted blindly —
     * `persistPreparedWorkoutProgram` re-validates it against the
     * questionnaire this call persists before using it for anything.
     */
    prepared?: PrepareWorkoutProgramResult | null,
  ) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Sign in with a social provider (may throw AccountLinkingRequiredError).
   * `name` is only ever used the ONE time this actually provisions a brand
   * new user document (`ensureUserProvisioned` never overwrites an existing
   * one) — same onboarding name `signUp` already threads through for the
   * email/password path.
   */
  signInWithProvider: (
    provider: SocialProvider,
    answers?: QuestionnaireAnswers | null,
    name?: string | null,
    legalAccepted?: boolean,
  ) => Promise<void>;
  /** Complete a pending link using the existing email/password account. */
  completeLinkingWithPassword: (
    email: string,
    password: string,
    answers?: QuestionnaireAnswers | null,
    name?: string | null,
    legalAccepted?: boolean,
  ) => Promise<void>;
  /** Complete a pending link using another social provider. */
  completeLinkingWithProvider: (
    provider: SocialProvider,
    answers?: QuestionnaireAnswers | null,
    name?: string | null,
    legalAccepted?: boolean,
  ) => Promise<void>;
  reset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Reloads Firebase Auth and returns its current `emailVerified` value. */
  refreshEmailVerification: () => Promise<boolean>;
  /** Re-reads the user document and latest questionnaire into global state. */
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Firebase mutates the existing User instance during reload(). This revision
  // forces context consumers to observe updated readonly fields such as
  // `emailVerified` even when the object reference itself stays the same.
  const [authRevision, setAuthRevision] = useState(0);

  // Identity-scoped profile+questionnaire resolution — see
  // `src/lib/profileLoadState.ts` for the full state machine and why
  // `questionnaire: null` alone can never be trusted as "confirmed absent".
  const [loadState, dispatchLoad] = useReducer(
    reduceProfileLoad<UserProfile, QuestionnaireDoc>,
    undefined,
    createInitialProfileLoadState<UserProfile, QuestionnaireDoc>,
  );
  // Monotonic generation, read/incremented synchronously (independent of
  // React's render/commit timing) so a slower/older load can never
  // overwrite a newer one (e.g. the listener's pre-write read racing
  // signUp's post-write read) — the reducer double-checks the same
  // (uid, generation) pair again on commit, matching
  // `SubscriptionContext`'s `identityGeneration` pattern.
  const generationRef = useRef(0);
  // Separately scopes listener failures: an old rejected profile request must
  // not affect error handling for a newer Firebase identity callback.
  const authStateSeq = useRef(0);
  // All operations that can replace Firebase's current identity share one
  // synchronous flight. This closes the sign-in A/sign-in B race across the
  // complete workflow (Firebase Auth + provisioning + state load), while reset
  // remains independent because it does not mutate the current identity.
  const identityOperationFlightRef = useRef<ReturnType<
    typeof createSingleFlight<void>
  > | null>(null);
  const resetOperationFlightRef = useRef<ReturnType<
    typeof createSingleFlight<void>
  > | null>(null);
  if (!identityOperationFlightRef.current) {
    identityOperationFlightRef.current = createSingleFlight<void>();
  }
  if (!resetOperationFlightRef.current) {
    resetOperationFlightRef.current = createSingleFlight<void>();
  }
  const identityOperationFlight = identityOperationFlightRef.current;
  const resetOperationFlight = resetOperationFlightRef.current;

  /**
   * Loads the user document (+ one-time schema migration) and questionnaire,
   * with a small bounded retry for transient Firestore read failures
   * (`unavailable`/`deadline-exceeded` — see `withFirestoreRetry`).
   *
   * Root-cause fix (cold-start `hasQuestionnaire` intermittency): a read
   * failure now commits `questionnaireResolution: 'error'` — never
   * silently collapsed into "no questionnaire". `profile`/`questionnaire`
   * are left untouched on failure (never nulled out), so a transient error
   * on a background refresh can never erase already-known-good data. Only a
   * genuinely resolved empty query (`getLatestQuestionnaire` returning
   * `null` without throwing) can ever produce `'not_found'`.
   *
   * Still rethrows on failure — existing callers (`signUp`/`signIn`/etc.)
   * keep surfacing their own error UX unchanged; the difference is that
   * `questionnaireResolution` is ALSO updated first, which is what the
   * central navigation gate now reads instead of `Boolean(questionnaire)`.
   */
  const loadUserState = useCallback(async (uid: string) => {
    const generation = ++generationRef.current;
    const startedAt = Date.now();
    dispatchLoad({ type: 'load-started', uid, generation });

    const outcome = await withFirestoreRetry(
      (attempt) => Promise.all([getUserProfile(uid), getLatestQuestionnaire(uid, attempt)]),
      {
        onAttempt: ({ attempt, error, retryable }) => {
          if (!error) return;
          logWarn('auth', 'profile_state_load_failed', {
            uid,
            source: 'loadUserState',
            attempt,
            retryable: retryable ?? false,
            final: false,
            durationMs: Date.now() - startedAt,
            error,
          });
        },
      },
    );

    const superseded = generation !== generationRef.current;

    if (outcome.ok) {
      const [nextProfile, nextQuestionnaire] = outcome.value;
      if (superseded) {
        logInfo('auth', 'profile_state_load_superseded', {
          uid,
          source: 'loadUserState',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      dispatchLoad({
        type: 'load-succeeded',
        uid,
        generation,
        profile: nextProfile,
        questionnaire: nextQuestionnaire,
      });
      logInfo('auth', 'profile_state_committed', {
        uid,
        questionnaireResolution: nextQuestionnaire ? 'found' : 'not_found',
        profileLoading: false,
        attempts: outcome.attempts,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    if (superseded) {
      logInfo('auth', 'profile_state_load_superseded', {
        uid,
        source: 'loadUserState',
        outcome: 'error',
        durationMs: Date.now() - startedAt,
      });
    } else {
      dispatchLoad({ type: 'load-failed', uid, generation, error: outcome.error });
      logWarn('auth', 'profile_state_load_failed', {
        uid,
        source: 'loadUserState',
        final: true,
        attempts: outcome.attempts,
        retryable: outcome.retryable,
        durationMs: Date.now() - startedAt,
        error: outcome.error,
      });
    }
    throw outcome.error;
  }, []);

  const clearUserState = useCallback(() => {
    generationRef.current += 1; // cancel any in-flight load
    dispatchLoad({ type: 'identity-cleared' });
  }, []);

  const rollbackIncompleteSocialIdentity = useCallback(async (
    incompleteUser: User,
    firebaseCreatedNow: boolean,
  ) => {
    try {
      if (firebaseCreatedNow) {
        await discardNewSocialIdentity(incompleteUser);
      } else {
        await signOutUser();
      }
    } catch (rollbackError) {
      logAuthError('registration-eligibility:rollback', rollbackError);
    } finally {
      setUser(null);
      clearUserState();
    }
  }, [clearUserState]);

  // The auth listener never creates documents. The repository may atomically
  // migrate an existing legacy document; account creation stays in the
  // explicit email/social operations below.
  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (nextUser) => {
      const authSeq = ++authStateSeq.current;
      logInfo('auth', 'auth_state_resolved', {
        uid: nextUser?.uid,
        authenticated: Boolean(nextUser),
      });

      if (!nextUser) {
        setUser(null);
        clearUserState();
        setInitializing(false);
        return;
      }

      // Every identity-mutating operation (`signUp`/`signIn`/social sign-in/
      // linking) runs inside `identityOperationFlight` AND already calls its
      // OWN authoritative `loadUserState` once it has finished whatever this
      // identity needed first (`signUp` specifically: `provisionNewUser`
      // writing the user doc + questionnaire). Firebase fires this listener
      // the instant Auth creates/signs in the user — independently, and
      // typically BEFORE that provisioning finishes. A read at that exact
      // moment is not wrong, it is just PREMATURE: it genuinely finds no
      // questionnaire yet and — correctly, by `profileLoadState.ts`'s own
      // rules — commits `questionnaireResolution: 'not_found'`, which
      // `resolvePremiumGate` (accurately, given what it was told) routes to
      // `'onboardingFunnel'`. That committed-then-corrected state is exactly
      // what produced a real ~2-3s flash of the questionnaire right after
      // signup, before the explicit flow's own load corrected it to
      // `'found'`. Skipping this listener's redundant read while an
      // identity operation owns this uid removes the premature read
      // entirely — `questionnaireResolution` simply stays at whatever it
      // already was (`'unknown'` on a fresh signup, never `'not_found'`)
      // until the owning operation's own load commits the real answer.
      // `resolvePremiumGate` treats anything but `'found'`/`'not_found'` as
      // neutral (renders the loading state, not onboarding), so this is not
      // a timeout/sleep/hidden-loading-spinner workaround — it is simply
      // never performing the read that was wrong to begin with. A cold
      // start with an already-persisted session (the common case this
      // listener exists for) has no identity operation in flight at all —
      // `isRunning()` is `false` — and behaves exactly as before.
      if (identityOperationFlight.isRunning()) {
        setInitializing(false);
        return;
      }

      setUser(nextUser);

      // `loadUserState` marks profileLoading synchronously. Releasing
      // `initializing` immediately after starting it lets SubscriptionContext
      // synchronize the same UID with RevenueCat in parallel with the two
      // Firestore reads. The central gate still waits for both independent
      // states, so unknown subscription/profile data never becomes access.
      const userStatePromise = loadUserState(nextUser.uid);
      setInitializing(false);
      try {
        await userStatePromise;
      } catch (err) {
        if (authSeq !== authStateSeq.current) return;
        // `loadUserState` already committed `questionnaireResolution:
        // 'error'` (or left prior state untouched if superseded) before
        // rethrowing — deliberately NOT calling `clearUserState()` here
        // anymore. That call used to be the exact place a transient read
        // failure got reinterpreted as "no questionnaire": it reset
        // `questionnaire` to `null`, indistinguishable from a confirmed
        // absence. See `src/lib/profileLoadState.ts`'s module doc comment.
        logAuthError('listener:load-profile', err);
      }
    });
    return unsubscribe;
  }, [loadUserState, clearUserState, identityOperationFlight]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      profile: loadState.profile,
      questionnaire: loadState.questionnaire,
      questionnaireResolution: loadState.questionnaireResolution,
      linkedProviders: user ? getLinkedProviders(user) : [],
      initializing,
      profileLoading: loadState.loading,
      signUp: (email, password, name, answers, legalAccepted, prepared) =>
        identityOperationFlight.run(async () => {
          // Timing instrumentation (audit: onboarding→Home lifecycle report,
          // item 9) — never logs questionnaire content, only durations/ids/
          // status, matching the pattern `onboarding_workout_generation_*`
          // already established in AnalyzingScreen.
          const signUpStartedAt = Date.now();
          assertNewAccountEligibility({ answers, legalAccepted });
          // Single, authoritative creation flow — runs exactly once per account.
          const newUser = await signUpWithEmail(email, password, name);
          // Start delivery immediately after Firebase Auth creates the password
          // user. Capture a failure as data so profile provisioning still
          // completes and the account never ends up half-created in Firestore.
          const verificationError = sendVerificationEmail(newUser)
            .then(() => null)
            .catch((error: unknown) => error);
          try {
            const provisionStartedAt = Date.now();
            const questionnaireId = await provisionNewUser(newUser, { name, answers, legalAccepted });
            logInfo('auth', 'signup_provision_completed', {
              durationMs: Date.now() - provisionStartedAt,
              found: Boolean(questionnaireId),
            });
            // Phase 3: the Analysis screen already computed (or attempted to
            // compute) the plan pre-auth — `persistPreparedWorkoutProgram`
            // validates it against the questionnaire just written above
            // (fingerprint + engine/template versions) and, when it checks
            // out, persists it directly instead of recomputing; on any
            // mismatch/missing `prepared` it transparently falls back to the
            // full authoritative Firestore-backed computation
            // (`generateAndPersistWorkoutProgram`), same as before Phase 3.
            // `scheduleConfig` is bridged from the same questionnaire's
            // `trainingDays` right after, reusing Phase 1's
            // `ensureScheduleConfigFromQuestionnaire` unchanged — by the time
            // this try block finishes, an established account normally has
            // both `workoutPrograms` AND `scheduleConfig` ready before ever
            // reaching Paywall/Home. A failure in EITHER step is deliberately
            // NON-FATAL to signup — `automatic_reconciliation` (Phase 1)
            // remains the fallback that fills either gap the next time the
            // app opens, exactly like a transient failure always could.
            if (questionnaireId && answers) {
              const persistStartedAt = Date.now();
              let generatedPlanTrainingDays: NonNullable<QuestionnaireAnswers['trainingDays']> = [];
              try {
                const generation = await persistPreparedWorkoutProgram({
                  uid: newUser.uid,
                  questionnaireId,
                  questionnaireVersion: 1,
                  answers,
                  prepared: prepared ?? null,
                  source: 'onboarding',
                });
                logInfo('workout_program', 'onboarding_workout_program_persist_completed', {
                  outcome: generation.status,
                  usedPrepared: Boolean(prepared && prepared.status === 'SUCCESS'),
                  durationMs: Date.now() - persistStartedAt,
                });
                if (generation.status === 'SUCCESS') {
                  generatedPlanTrainingDays = generation.plan.weeklySchedule
                    ?.filter((day) => day.state === 'TRAINING')
                    .map((day) => day.weekday) ?? [];
                }
              } catch (error) {
                logWarn('workout_program', 'onboarding_workout_program_persist_failed', {
                  error,
                  durationMs: Date.now() - persistStartedAt,
                });
              }
              if (generatedPlanTrainingDays.length > 0 || trainingDaysValid(answers)) {
                const scheduleStartedAt = Date.now();
                try {
                  await ensureScheduleConfigFromQuestionnaire(
                    newUser.uid,
                    generatedPlanTrainingDays.length > 0
                      ? generatedPlanTrainingDays
                      : normalizeWeekdays(answers.trainingDays ?? []),
                    deviceTimezone(),
                  );
                  logInfo('workout_schedule', 'onboarding_schedule_config_completed', {
                    durationMs: Date.now() - scheduleStartedAt,
                  });
                } catch (error) {
                  logWarn('workout_schedule', 'onboarding_schedule_config_failed', {
                    error,
                    durationMs: Date.now() - scheduleStartedAt,
                  });
                }
              }
            }
            setUser(newUser);
            await loadUserState(newUser.uid); // authoritative post-write load
          } catch (err) {
            logAuthError('signup:firestore-profile', err);
            throw toAuthError(err);
          }
          // Automatic delivery happens exactly once. Every later send requires
          // an explicit user tap on the verification screen.
          const sendError = await verificationError;
          if (sendError) throw sendError;
          logInfo('auth', 'signup_completed', { durationMs: Date.now() - signUpStartedAt });
        }),
      signIn: (email, password) => identityOperationFlight.run(async () => {
        const authedUser = await signInWithEmail(email, password);
        try {
          setUser(authedUser);
          await loadUserState(authedUser.uid);
        } catch (err) {
          logAuthError('signin:load-profile', err);
          throw toAuthError(err);
        }
      }),
      signInWithProvider: (provider, answers, name, legalAccepted) =>
        identityOperationFlight.run(async () => {
          // The credential sign-in triggers the auth-state listener; provisioning
          // stays here (explicit flow). Firebase's UserCredential tells us
          // whether this provider sign-in created the Auth identity.
          const socialResult = await socialSignIn(provider);
          const authedUser = socialResult.user;
          try {
            const existingProfile = socialResult.isNewUser
              ? null
              : await getUserProfile(authedUser.uid);
            const admission = resolveSocialAccountAdmission({
              isNewUser: socialResult.isNewUser,
              hasProfile: existingProfile !== null,
              answers,
              legalAccepted,
            });
            if (admission === 'requires-provisioning') {
              await provisionNewUser(authedUser, {
                answers,
                name: name ?? undefined,
                legalAccepted,
              });
            }
            setUser(authedUser);
            await loadUserState(authedUser.uid);
          } catch (err) {
            if (err instanceof RegistrationEligibilityError) {
              await rollbackIncompleteSocialIdentity(
                authedUser,
                socialResult.isNewUser,
              );
            }
            logAuthError(`${provider}:firestore-profile`, err);
            throw err instanceof RegistrationEligibilityError ? err : toAuthError(err);
          }
        }),
      completeLinkingWithPassword: (email, password, answers, name, legalAccepted) =>
        identityOperationFlight.run(async () => {
          const linkedUser = await socialLinkPassword(email, password);
          try {
            await ensureUserProvisioned(
              linkedUser,
              { answers, name: name ?? undefined, legalAccepted },
              'existing',
            );
            setUser(linkedUser);
            await loadUserState(linkedUser.uid);
          } catch (err) {
            logAuthError('link:password:firestore-profile', err);
            throw toAuthError(err);
          }
        }),
      completeLinkingWithProvider: (provider, answers, name, legalAccepted) =>
        identityOperationFlight.run(async () => {
          const linkedUser = await socialLinkProvider(provider);
          try {
            await ensureUserProvisioned(
              linkedUser,
              { answers, name: name ?? undefined, legalAccepted },
              'existing',
            );
            setUser(linkedUser);
            await loadUserState(linkedUser.uid);
          } catch (err) {
            logAuthError(`link:${provider}:firestore-profile`, err);
            throw toAuthError(err);
          }
        }),
      reset: (email) => resetOperationFlight.run(() => resetPassword(email)),
      logout: () => identityOperationFlight.run(async () => {
        await cleanupRestSessionArtifacts();
        await signOutUser();
      }),
      refreshEmailVerification: async () => {
        const refreshed = await refreshEmailVerificationStatus();
        setUser(refreshed.user);
        setAuthRevision((revision) => revision + 1);
        return refreshed.emailVerified;
      },
      refreshProfile: async () => {
        if (user) await loadUserState(user.uid);
      },
    }),
    [
      user,
      loadState,
      initializing,
      loadUserState,
      authRevision,
      identityOperationFlight,
      resetOperationFlight,
      rollbackIncompleteSocialIdentity,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
