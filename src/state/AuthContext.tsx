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
import { AppState } from 'react-native';
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
import {
  readProfilePresentationCache,
  writeProfilePresentationCache,
  removeProfilePresentationCache,
  type ProfilePresentationCache,
} from '../lib/profilePresentationCache';
import { removeEvolutionSummaryPresentationCache } from '../lib/evolutionSummaryPresentationCache';
import { removeHomePresentationSnapshot } from '../lib/homePresentationSnapshot';
import { recordPerfMark } from '../lib/perf';
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
  /** Presentation only. Never route or mutate using this stale projection. */
  cachedPresentation: ProfilePresentationCache | null;
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
   * email/password path. `prepared` mirrors `signUp`'s own parameter for the
   * exact same reason: the Analysis screen's pre-auth `preparedWorkoutProgram`
   * is reused (never trusted blindly — `persistPreparedWorkoutProgram`
   * re-validates it) instead of discarding it and always regenerating.
   */
  signInWithProvider: (
    provider: SocialProvider,
    answers?: QuestionnaireAnswers | null,
    name?: string | null,
    legalAccepted?: boolean,
    prepared?: PrepareWorkoutProgramResult | null,
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
  const [cachedPresentation, setCachedPresentation] = useState<ProfilePresentationCache | null>(null);

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
    let remoteDone = false;
    // Local DEV-only A/B switch. It disables only presentation hydration;
    // Firestore requests and cache writes are identical in both variants.
    const readLocalPresentation = !(__DEV__ && process.env.EXPO_PUBLIC_PROFILE_PRESENTATION_CACHE_ENABLED === '0');
    if (readLocalPresentation) void readProfilePresentationCache(uid).then((cached) => {
      if (generation !== generationRef.current) return;
      const outcome = cached === 'miss' ? 'miss' : cached === 'invalid' ? 'invalid' : 'hit';
      recordPerfMark(`profile_cache_${typeof cached !== 'string' && !cached.profile ? 'miss' : outcome}`);
      recordPerfMark(`questionnaire_cache_${typeof cached !== 'string' && !cached.questionnaire ? 'miss' : outcome}`);
      if (cached === 'miss' || cached === 'invalid' || remoteDone) return;
      setCachedPresentation(cached);
      if (cached.profile) {
        recordPerfMark('profile_cache_hydration');
        recordPerfMark('profile_cached_ready');
      }
      if (cached.questionnaire) recordPerfMark('questionnaire_cache_hydration');
    });

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
    remoteDone = true;

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
      // Camada B (2026-09-24 orphaned-Google-account audit) — bootstrap/auth
      // reconciliation's recognition point: an authenticated identity
      // (`auth.currentUser` already resolved, or this load would not be
      // running) with a CONFIRMED-absent `users/{uid}` document is, by this
      // app's own invariants, an incompletely provisioned registration —
      // `provisionNewUser`/`ensureUserProvisioned` always write `users/{uid}`
      // and (when real answers exist) its first questionnaire in the SAME
      // atomic batch, so no legitimate account can ever reach this state.
      // Never auto-repaired here: fabricating a profile without the
      // legal-acceptance/questionnaire evidence that only the user can
      // supply again would violate `assertNewAccountEligibility`'s guarantee
      // (see `rollbackIncompleteSocialIdentity` — it deliberately never
      // deletes a recoverable identity either). Recovery instead reuses the
      // EXISTING architecture unchanged: `questionnaireResolution:
      // 'not_found'` already routes `resolvePremiumGate` to
      // `'onboardingFunnel'`, and a subsequent `signInWithProvider` for the
      // SAME linked identity re-authenticates to this SAME uid
      // (`resolveSocialAccountAdmission` already treats `hasProfile: false`
      // as `'requires-provisioning'` regardless of `isNewUser`) and completes
      // provisioning exactly once — this log line exists purely so an
      // orphaned identity like this is OBSERVABLE instead of silent.
      if (nextProfile === null) {
        logWarn('auth', 'incomplete_identity_detected', {
          uid,
          hasQuestionnaire: nextQuestionnaire !== null,
        });
      }
      setCachedPresentation({
        schemaVersion: 1,
        uid,
        cachedAt: Date.now(),
        profile: nextProfile ? { name: nextProfile.profile.name } : null,
        questionnaire: nextQuestionnaire ? {
          goal: nextQuestionnaire.answers.goal,
          days: nextQuestionnaire.answers.days,
        } : null,
      });
      void writeProfilePresentationCache(uid, nextProfile, nextQuestionnaire).catch(() => undefined);
      recordPerfMark('profile_network_revalidation');
      recordPerfMark('questionnaire_network_revalidation');
      recordPerfMark('profile_remote_ready');
      recordPerfMark('profile_ready');
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
    setCachedPresentation(null);
    dispatchLoad({ type: 'identity-cleared' });
  }, []);

  // Returning from device network settings retries a failed bootstrap. The
  // gate remains closed until the remote read succeeds; a cached projection
  // never resolves `questionnaireResolution`.
  useEffect(() => {
    if (!user || loadState.questionnaireResolution !== 'error') return;
    const uid = user.uid;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadUserState(uid).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [user, loadState.questionnaireResolution, loadUserState]);

  const rollbackIncompleteSocialIdentity = useCallback(async () => {
    try {
      // Never hard-delete a Firebase Auth identity here. An incomplete
      // social registration has no AJ Fit profile yet and can safely resume
      // provisioning on a later sign-in. Actual account deletion is owned
      // exclusively by requestAccountDeletion + reconciliation.
      await signOutUser();
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
        recordPerfMark('auth_ready');
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
      recordPerfMark('auth_ready');

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
      profile: user && loadState.uid === user.uid ? loadState.profile : null,
      questionnaire: user && loadState.uid === user.uid ? loadState.questionnaire : null,
      cachedPresentation: user && cachedPresentation?.uid === user.uid ? cachedPresentation : null,
      questionnaireResolution: user && loadState.uid === user.uid
        ? loadState.questionnaireResolution : 'unknown',
      linkedProviders: user ? getLinkedProviders(user) : [],
      initializing,
      profileLoading: (user !== null && loadState.uid !== user.uid) || loadState.loading,
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
              const generatedScheduleMode = answers.scheduleMode ?? 'fixed';
              if (generatedScheduleMode === 'flexible' || generatedPlanTrainingDays.length > 0 || trainingDaysValid(answers)) {
                const scheduleStartedAt = Date.now();
                try {
                  await ensureScheduleConfigFromQuestionnaire(
                    newUser.uid,
                    generatedPlanTrainingDays.length > 0
                      ? generatedPlanTrainingDays
                      : normalizeWeekdays(answers.trainingDays ?? []),
                    deviceTimezone(),
                    generatedScheduleMode,
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
      signInWithProvider: (provider, answers, name, legalAccepted, prepared) =>
        identityOperationFlight.run(async () => {
          // The credential sign-in triggers the auth-state listener; provisioning
          // stays here (explicit flow). Firebase's UserCredential tells us
          // whether this provider sign-in created the Auth identity — except
          // for `socialSignIn`'s own network-failure reconciliation path
          // (`socialAuth.ts`'s Camada A), which deliberately reports
          // `isNewUser: false` when it cannot know for certain, so this exact
          // `getUserProfile` check below always runs instead of being skipped.
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
              const questionnaireId = await provisionNewUser(authedUser, {
                answers,
                name: name ?? undefined,
                legalAccepted,
              });
              // Mirrors `signUp`'s exact Phase 3 bridge above — reuses the
              // Analysis screen's pre-auth `prepared` result instead of
              // always regenerating post-signup. Never fatal to sign-in: a
              // failure here (or a missing/stale `prepared`) falls through
              // to `persistPreparedWorkoutProgram`'s own authoritative
              // fallback, exactly like `signUp`; `automatic_reconciliation`
              // remains the final safety net either way.
              if (questionnaireId && answers) {
                let generatedPlanTrainingDays: NonNullable<QuestionnaireAnswers['trainingDays']> = [];
                try {
                  const generation = await persistPreparedWorkoutProgram({
                    uid: authedUser.uid,
                    questionnaireId,
                    questionnaireVersion: 1,
                    answers,
                    prepared: prepared ?? null,
                    source: 'onboarding',
                  });
                  logInfo('workout_program', 'onboarding_workout_program_persist_completed', {
                    outcome: generation.status,
                    usedPrepared: Boolean(prepared && prepared.status === 'SUCCESS'),
                  });
                  if (generation.status === 'SUCCESS') {
                    generatedPlanTrainingDays = generation.plan.weeklySchedule
                      ?.filter((day) => day.state === 'TRAINING')
                      .map((day) => day.weekday) ?? [];
                  }
                } catch (error) {
                  logWarn('workout_program', 'onboarding_workout_program_persist_failed', { error });
                }
                const generatedScheduleMode = answers.scheduleMode ?? 'fixed';
                if (generatedScheduleMode === 'flexible' || generatedPlanTrainingDays.length > 0 || trainingDaysValid(answers)) {
                  try {
                    await ensureScheduleConfigFromQuestionnaire(
                      authedUser.uid,
                      generatedPlanTrainingDays.length > 0
                        ? generatedPlanTrainingDays
                        : normalizeWeekdays(answers.trainingDays ?? []),
                      deviceTimezone(),
                      generatedScheduleMode,
                    );
                  } catch (error) {
                    logWarn('workout_schedule', 'onboarding_schedule_config_failed', { error });
                  }
                }
              }
            }
            setUser(authedUser);
            await loadUserState(authedUser.uid);
          } catch (err) {
            if (err instanceof RegistrationEligibilityError) {
              await rollbackIncompleteSocialIdentity();
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
        const outgoingUid = user?.uid;
        clearUserState();
        await cleanupRestSessionArtifacts();
        await signOutUser();
        if (outgoingUid) {
          await Promise.all([
            removeProfilePresentationCache(outgoingUid),
            removeEvolutionSummaryPresentationCache(outgoingUid),
            removeHomePresentationSnapshot(outgoingUid),
          ]).catch(() => undefined);
        }
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
      cachedPresentation,
      clearUserState,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
