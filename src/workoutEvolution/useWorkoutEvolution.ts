import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { onSnapshot, type Timestamp } from 'firebase/firestore';
import { useAuth } from '../state/AuthContext';
import { logWarn } from '../lib/logger';
import { recordPerfMark } from '../lib/perf';
import {
  readEvolutionSummaryPresentationCache,
  writeEvolutionSummaryPresentationCache,
} from '../lib/evolutionSummaryPresentationCache';
import {
  FOREGROUND_RECONCILE_THROTTLE_MS,
  shouldReconcileOnForeground,
} from './foregroundReconcile';
import {
  listWorkoutLifecycleEventsForProgramInstance,
  lifecycleRef,
  loadPendingEvolution,
  loadProgramInstance,
  loadWorkoutLifecycleDeduped,
  pendingEvolutionRef,
} from '../services/workoutLifecycle';
import { loadActiveWorkoutProgram, loadWorkoutProgramSnapshot } from '../services/workoutPrograms';
import { evaluateProgressionV2ForUser, evaluateProgressionV2ForUserFull } from '../services/workoutProgressionV2';
import {
  activatePendingEvolution,
  deferPendingEvolution,
  reconcileWorkoutLifecycle,
} from '../services/workoutLifecycleApplication';
import type { ProgressionDecision } from '../progressionEngineV2/types';
import type { CurrentTrainingLevel, PendingEvolution } from '../workoutLifecycle/types';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import { computePrescriptionDiff, type PrescriptionDiffSummary } from './diff';
import { buildEvolutionViewModel, buildProvisionalEvolutionViewModel, type LifecycleContext } from './viewModel';
import { nextViewModelAfterLoad } from './loadReducer';
import type { EvolutionViewModel, PendingEvolutionSummary } from './types';
import {
  evolutionSummaryOf,
  viewModelFromEvolutionPresentationCache,
  viewModelWhileEvolutionRefreshes,
} from './presentationCachePolicy';
import {
  acknowledgeAutoActivationNotice,
  loadUnacknowledgedAutoActivationNotice,
} from './autoActivationNotice';

function toPendingSummary(pending: PendingEvolution<Timestamp>): PendingEvolutionSummary {
  return {
    type: pending.type,
    quality: pending.quality,
    fromLevel: pending.fromLevel,
    toLevel: pending.toLevel,
    deferralCount: pending.deferralCount,
    nextPromptAt: pending.nextPromptAt ? pending.nextPromptAt.toDate() : null,
    autoActivateAt: pending.autoActivateAt ? pending.autoActivateAt.toDate() : null,
    sessionsCompletedAtEarn: pending.sessionsCompletedAtEarn,
  };
}

export interface WorkoutEvolutionController {
  viewModel: EvolutionViewModel;
  /** True only for the very first load; a background `refresh()` after an action keeps the last known `viewModel` visible instead of flashing LOADING (docs §76). */
  loading: boolean;
  actionPending: boolean;
  actionError: string | null;
  /** Real source-vs-target diff for a pending or unacknowledged AUTO activation. */
  diff: PrescriptionDiffSummary | null;
  /** The pending plan's `FinalWorkoutPlan`, present only while a pending evolution exists — same object `diff` was computed from. Lets the UI resolve real exercise display names for the swap list (Home redesign, section 3/5) without any new fetch. */
  pendingPlan: FinalWorkoutPlan | null;
  /** Canonical "START NOW" — calls the Fase 4 activation API directly; never a local write (docs §41/§X). */
  start: () => Promise<boolean>;
  /** Canonical "KEEP CURRENT" — calls the Fase 4 defer API directly (docs §42/§Y). */
  defer: () => Promise<boolean>;
  /** Device-local UX acknowledgement; never mutates the immutable domain event. */
  acknowledgeAutoActivation: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Refreshes the React projection only; caller already ran the canonical reconciler. */
  refreshProjection: () => Promise<void>;
  /**
   * The lifecycle's own `workoutLifecycleState/current.currentTrainingLevel`,
   * surfaced verbatim — the SAME field `authorizeMutation` reads to regenerate
   * an ADAPT, so a UI keyed on it can never offer the authority something it
   * will refuse. `null` until the lifecycle has loaded (or when the account
   * has none). Deliberately not `summary.activeLevel`/`earnedLevel`: those are
   * presentation values (cycle level, and a pending promotion's TARGET), and
   * neither is guaranteed to equal `currentTrainingLevel`.
   */
  currentTrainingLevel: CurrentTrainingLevel | null;
}

/**
 * The single hook AppShell/screens should use to consume Workout Lifecycle
 * evolution state — composes Fase 2 (`evaluateProgressionV2ForUser`), Fase 4
 * (`reconcileWorkoutLifecycle`/`loadPendingEvolution`/activation/deferral)
 * into one `EvolutionViewModel` via the pure presenter
 * (`buildEvolutionViewModel`). Never recomputes eligibility itself (docs §4/§B).
 *
 * Cold-start, foreground, and manual recovery delegate to the same idempotent
 * `reconcileWorkoutLifecycle` entry point. Realtime listeners may refresh only
 * the projection when their caller already owns reconciliation.
 */
export function useWorkoutEvolution(activeProgramInstanceId: string | null = null): WorkoutEvolutionController {
  const { user } = useAuth();
  const [viewModel, setViewModel] = useState<EvolutionViewModel>({ kind: 'LOADING' });
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [diff, setDiff] = useState<PrescriptionDiffSummary | null>(null);
  const [currentTrainingLevel, setCurrentTrainingLevel] = useState<CurrentTrainingLevel | null>(null);
  const [pendingPlan, setPendingPlan] = useState<FinalWorkoutPlan | null>(null);
  const hasLoadedOnce = useRef(false);
  const actionInFlight = useRef(false);
  // Mirrors `viewModel` synchronously (state updates are async/batched) so a
  // `load()` failure can decide "do I have a resolved snapshot worth
  // preserving?" against the actual current value, not a stale closure —
  // and so the foreground listener can read it without depending on
  // `viewModel` itself (which would re-subscribe AppState/Firestore
  // listeners below on every state change).
  const viewModelRef = useRef<EvolutionViewModel>(viewModel);
  const commitViewModel = useCallback((next: EvolutionViewModel) => {
    viewModelRef.current = next;
    setViewModel(next);
  }, []);
  // Foreground-resume trigger bookkeeping (docs: foreground reconcile gap).
  // `reconcileInFlight` covers ANY `load()` caller — COLD_START, the
  // Firestore realtime listeners below, a user action's own refresh, or a
  // previous FOREGROUND — so a foreground resume racing any of those never
  // fires a second, overlapping reconcile; the existing idempotent
  // `reconcileWorkoutLifecycle` plus this guard is what makes concurrent
  // triggers converge instead of duplicating work.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const reconcileInFlight = useRef(false);
  const lastForegroundReconcileAtRef = useRef<number | null>(null);
  // Stale-result guard (docs: resilience hardening, 2026-09) — `load()` can
  // legitimately run concurrently (COLD_START racing a Firestore listener
  // refresh, a manual action's own `load()`, etc.); nothing upstream
  // serializes those calls. Each call captures the generation counter at
  // start and only commits state if it's still the newest call by the time
  // its awaits resolve — an older call that resolves later (success OR
  // failure) can never clobber a newer call's already-applied result.
  const loadGenerationRef = useRef(0);
  // Identity of whichever summary is currently painted (cached OR current).
  // A ProgramInstance switch can therefore blank an old program immediately,
  // before any late async work has a chance to label it as the new one.
  const visibleProgramInstanceIdRef = useRef<string | null>(null);
  const cacheReadGenerationRef = useRef(0);
  const programScopeGenerationRef = useRef(0);
  const previousActiveProgramInstanceIdRef = useRef(activeProgramInstanceId);
  const currentPresentationScopeRef = useRef({
    uid: user?.uid ?? null,
    programInstanceId: activeProgramInstanceId,
  });
  currentPresentationScopeRef.current = {
    uid: user?.uid ?? null,
    programInstanceId: activeProgramInstanceId,
  };
  if (previousActiveProgramInstanceIdRef.current !== activeProgramInstanceId) {
    // null -> first known identity is ordinary bootstrap, not a program
    // switch. Any later change invalidates loads that started for the old
    // scope, including a response that resolves after the new render.
    if (previousActiveProgramInstanceIdRef.current !== null) programScopeGenerationRef.current += 1;
    previousActiveProgramInstanceIdRef.current = activeProgramInstanceId;
  }

  const load = useCallback(async (options?: {
    trigger?: 'FOREGROUND';
    skipReconcile?: boolean;
    propagateError?: boolean;
  }) => {
    if (!user) return;
    recordPerfMark('evolution_start');
    // Progressive rendering (Fase 5.2) only derives a new provisional summary
    // on a genuine first load. Fase 5.3 keeps a previous summary during a
    // background refresh, but deliberately removes its stale action framing
    // until a new authoritative terminal state arrives.
    const isInitialLoad = !hasLoadedOnce.current;
    if (!isInitialLoad) {
      const previous = viewModelRef.current;
      const refreshing = viewModelWhileEvolutionRefreshes(previous);
      if (refreshing !== previous) commitViewModel(refreshing);
    }
    if (!hasLoadedOnce.current) setLoading(true);
    reconcileInFlight.current = true;
    const generation = ++loadGenerationRef.current;
    const programScopeGeneration = programScopeGenerationRef.current;
    const isCurrent = () => loadGenerationRef.current === generation &&
      programScopeGenerationRef.current === programScopeGeneration;
    try {
      let reconciledDecision: ProgressionDecision | null | undefined;
      let reconciledLifecycle: Awaited<ReturnType<typeof loadWorkoutLifecycleDeduped>> | undefined;
      if (!options?.skipReconcile) {
        const reconcileResult = await reconcileWorkoutLifecycle({
          uid: user.uid,
          trigger: options?.trigger ?? (hasLoadedOnce.current ? 'RECOVERY' : 'COLD_START'),
        });
        reconciledDecision = reconcileResult.progressionDecision;
        reconciledLifecycle = reconcileResult.lifecycle;
      }
      recordPerfMark('evolution_reconcile_ready');

      const [lifecycle, pendingAfter, decision, progressionFull] = await Promise.all([
        reconciledLifecycle !== undefined
          ? Promise.resolve(reconciledLifecycle)
          : loadWorkoutLifecycleDeduped(user.uid),
        loadPendingEvolution(user.uid),
        reconciledDecision !== undefined
          ? Promise.resolve(reconciledDecision)
          : evaluateProgressionV2ForUser(user.uid),
        // Home redesign (2026-10-07): the only place that reads
        // `ProgressionSnapshotV2.activeTime.pausedAt`/`earnedIntermediateCycleCount`
        // for display. Deliberately a SEPARATE call from `decision` above —
        // `reconcileWorkoutLifecycle`'s own internal evaluation (inside the
        // protected prepare/persist chain) never returns the full snapshot,
        // and this hook must not reach into that chain to get it.
        // Known cost: this duplicates the reconcile path's read batch on
        // every load in the common case; avoiding that would require
        // extending workoutLifecycleApplication.ts's ReconcileResult, which
        // this plan deliberately does not touch — see Task 6's rationale.
        evaluateProgressionV2ForUserFull(user.uid),
      ]);
      recordPerfMark('evolution_lifecycle_pending_progression_ready');
      // `ActiveTime.pausedAt` is typed `unknown` at the shared-types level
      // (it is persisted as a Firestore Timestamp elsewhere), but the pure
      // V2 resolver (`computeActiveTimeTrace`) only ever assigns it a
      // `LocalDate` (a plain `YYYY-MM-DD` string) or `null` — safe to narrow
      // here, the one place that reads it for display.
      const pausedAtLocalDate = (progressionFull?.snapshot.activeTime.pausedAt as string | null | undefined) ?? null;
      const intermediateCyclesEarned = progressionFull?.snapshot.earnedIntermediateCycleCount ?? null;

      if (!lifecycle) {
        if (isCurrent()) {
          visibleProgramInstanceIdRef.current = null;
          commitViewModel({ kind: 'UNAVAILABLE' });
          setDiff(null);
          setCurrentTrainingLevel(null);
          recordPerfMark('evolution_state_commit');
          recordPerfMark('evolution_authoritative_ready');
        }
        return;
      }
      if (isCurrent()) setCurrentTrainingLevel(lifecycle.lifecycle.currentTrainingLevel);
      const lifecycleContext: LifecycleContext = {
        // The active lifecycle level stays cycle-coherent until activation.
        // A pending promotion's immutable earned fact is presented from the
        // pending target, never by temporarily corrupting the active pointer.
        earnedLevel: pendingAfter?.type === 'LEVEL_PROMOTION'
          ? pendingAfter.toLevel
          : lifecycle.lifecycle.currentTrainingLevel,
        activeLevel: lifecycle.cycle.level,
        cycleNumber: lifecycle.cycle.cycleNumber,
        isHistoryComplete: lifecycle.lifecycle.initializationOrigin !== 'V1_MIGRATION_BASELINE',
      };
      // Progressive rendering (Fase 5.2): `summary` is already safe and final
      // here — it's computed identically inside every possible terminal kind
      // below, regardless of what the pending/notice tail resolves to (see
      // `buildProvisionalEvolutionViewModel`'s doc comment). Revealing it now
      // means the user sees real level/cycle/adherence/proximity content
      // instead of a bare "loading" label for the remaining events/notice
      // round trip, without ever needing to later correct it.
      if (isCurrent() && isInitialLoad) {
        commitViewModel(buildProvisionalEvolutionViewModel({ lifecycle: lifecycleContext, decision, pausedAtLocalDate, intermediateCyclesEarned }));
        recordPerfMark('evolution_first_useful_content');
        recordPerfMark('evolution_current_summary_visible');
        visibleProgramInstanceIdRef.current = lifecycle.programInstance.programInstanceId;
      }
      // Started here (Fase 2 — validated), before events/notice, so it
      // overlaps with that work instead of running strictly after it; only
      // ever awaited below, only when `pendingAfter` is truthy.
      const pendingProgramPromise = pendingAfter ? loadActiveWorkoutProgram(user.uid) : null;
      const instanceEvents = await listWorkoutLifecycleEventsForProgramInstance(
        user.uid,
        lifecycle.programInstance.programInstanceId,
      );
      recordPerfMark('evolution_events_ready');
      const autoActivationNotice = await loadUnacknowledgedAutoActivationNotice(user.uid, instanceEvents);
      recordPerfMark('evolution_activation_notice_ready');
      if (isCurrent()) {
        const authoritativeViewModel = buildEvolutionViewModel({
          now: new Date(),
          lifecycle: lifecycleContext,
          decision,
          pending: pendingAfter ? toPendingSummary(pendingAfter) : null,
          autoActivationNotice,
          pausedAtLocalDate,
          intermediateCyclesEarned,
        });
        visibleProgramInstanceIdRef.current = lifecycle.programInstance.programInstanceId;
        commitViewModel(authoritativeViewModel);
        recordPerfMark('evolution_state_commit');
        recordPerfMark('evolution_authoritative_ready');
        const summary = evolutionSummaryOf(authoritativeViewModel);
        if (summary) {
          // This is the only write-through site: every input above completed,
          // and the terminal authoritative projection is already committed.
          void writeEvolutionSummaryPresentationCache(
            user.uid,
            lifecycle.programInstance.programInstanceId,
            summary,
          ).catch(() => undefined);
        }
      }

      if (pendingAfter) {
        const currentProgram = await pendingProgramPromise;
        const pendingPlanValue = pendingAfter.plan as FinalWorkoutPlan;
        // `diff` and `pendingPlan` must rise and fall together — both derived
        // from the same "is this pending evolution still current for the
        // active program instance" check, never one populated while the
        // other is null. A stale pending (source instance moved past) must
        // blank both, so a future swap-list UI built on `pendingPlan` can
        // never show exercise names from a plan `diff` has already rejected.
        const isPendingCurrent = currentProgram?.programInstanceId === pendingAfter.sourceProgramInstanceId;
        if (isCurrent()) {
          setDiff(isPendingCurrent
            ? computePrescriptionDiff({ current: currentProgram, pending: pendingPlanValue })
            : null);
          setPendingPlan(isPendingCurrent ? pendingPlanValue : null);
        }
      } else if (autoActivationNotice && lifecycle.programInstance.previousProgramInstanceId) {
        const [currentProgram, previousInstance] = await Promise.all([
          loadActiveWorkoutProgram(user.uid),
          loadProgramInstance(user.uid, lifecycle.programInstance.previousProgramInstanceId),
        ]);
        const previousProgram = previousInstance
          ? await loadWorkoutProgramSnapshot(user.uid, previousInstance.contentIdentity)
          : null;
        if (isCurrent()) {
          setDiff(currentProgram?.programInstanceId === lifecycle.programInstance.programInstanceId && previousProgram
            ? computePrescriptionDiff({ current: previousProgram, pending: currentProgram })
            : null);
          setPendingPlan(null);
        }
      } else if (isCurrent()) {
        setDiff(null);
        setPendingPlan(null);
      }
    } catch (error) {
      logWarn('workout_evolution', 'load_failed', { error });
      if (isCurrent()) {
        // Resilience hardening (docs 2026-09): `nextViewModelAfterLoad` is
        // the pure state machine — a failed REFRESH preserves whatever
        // resolved view model was already on screen (never downgraded to
        // `ERROR` by a merely transient failure); only a failure with
        // nothing resolved yet, or piling on an already-failed attempt,
        // actually produces `ERROR`.
        const previous = viewModelRef.current;
        const next = nextViewModelAfterLoad(previous, { status: 'failure' });
        if (next === previous) {
          logWarn('workout_evolution', 'load_failed_preserved_previous_view_model', {
            previousKind: previous.kind,
          });
        } else {
          if (!evolutionSummaryOf(next)) visibleProgramInstanceIdRef.current = null;
          commitViewModel(next);
          recordPerfMark('evolution_state_commit');
        }
      }
      // Background/cold-start refreshes remain self-contained. Explicit
      // projection barriers (finish/discard) opt in so their orchestrator can
      // diagnose the secondary failure and choose safe navigation behavior.
      if (options?.propagateError) throw error;
    } finally {
      if (loadGenerationRef.current === generation) {
        reconcileInFlight.current = false;
        if (programScopeGenerationRef.current === programScopeGeneration) {
          hasLoadedOnce.current = true;
          setLoading(false);
        }
      }
    }
  }, [user, commitViewModel]);

  // Local cache hydration and remote reconciliation are deliberately
  // independent effects. The AsyncStorage read never gates `load()` and is
  // only allowed to paint while no current-session summary has won the race.
  useEffect(() => {
    const generation = ++cacheReadGenerationRef.current;
    const uid = user?.uid;

    if (visibleProgramInstanceIdRef.current &&
        visibleProgramInstanceIdRef.current !== activeProgramInstanceId) {
      visibleProgramInstanceIdRef.current = null;
      commitViewModel({ kind: 'LOADING' });
    }

    if (!uid || !activeProgramInstanceId) return undefined;
    recordPerfMark('evolution_cache_read_start');
    void readEvolutionSummaryPresentationCache(uid, activeProgramInstanceId).then((cached) => {
      const currentScope = currentPresentationScopeRef.current;
      if (cacheReadGenerationRef.current !== generation || currentScope.uid !== uid ||
          currentScope.programInstanceId !== activeProgramInstanceId) return;
      if (typeof cached === 'string') {
        recordPerfMark('evolution_cache_miss');
        return;
      }
      recordPerfMark('evolution_cache_hit');
      const current = viewModelRef.current;
      if (current.kind !== 'LOADING' && current.kind !== 'ERROR') return;
      const cachedViewModel = viewModelFromEvolutionPresentationCache(cached);
      visibleProgramInstanceIdRef.current = cached.programInstanceId;
      commitViewModel(current.kind === 'ERROR'
        ? { ...cachedViewModel, noticeUnavailable: true }
        : cachedViewModel);
      recordPerfMark('evolution_cached_summary_visible');
    }).catch(() => recordPerfMark('evolution_cache_miss'));

    return () => {
      if (cacheReadGenerationRef.current === generation) cacheReadGenerationRef.current += 1;
    };
  }, [activeProgramInstanceId, commitViewModel, user]);

  useEffect(() => {
    load();
  }, [load]);

  // FOREGROUND trigger: cold start and POST_WORKOUT already cover app launch
  // and finishing a session, but a background -> foreground resume WITHOUT a
  // remount (the common case on mobile) previously reconciled nothing until
  // the next cold start or completed workout. Mirrors the
  // `PhotoVaultContext`/`RestSessionContext`/`SubscriptionContext` AppState
  // pattern: track the previous state in a ref, act only on a real resume,
  // remove the listener on cleanup. Reads `user`/`load` from the closure of
  // an effect scoped to `user`, so a logout/login (`user` identity change)
  // tears down the old listener before a new one — for a new uid — is ever
  // attached; it can never stay attached to a stale account.
  useEffect(() => {
    if (!user) return undefined;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      const now = Date.now();
      const shouldReconcile = shouldReconcileOnForeground({
        previousState: previous,
        nextState: next,
        hasLoadedOnce: hasLoadedOnce.current,
        reconcileInFlight: reconcileInFlight.current,
        now,
        lastForegroundReconcileAtMs: lastForegroundReconcileAtRef.current,
        throttleMs: FOREGROUND_RECONCILE_THROTTLE_MS,
        // A broken state gets the next genuine resume as an immediate retry
        // opportunity instead of waiting out the healthy-state cooldown —
        // there is nothing good on screen for the throttle to protect.
        isRecoveringFromError: viewModelRef.current.kind === 'ERROR',
      });
      if (!shouldReconcile) return;
      lastForegroundReconcileAtRef.current = now;
      // `load()` already has its own try/catch (see above) that logs and, on
      // a genuine initial-load failure (nothing resolved yet), falls back to
      // an ERROR view-model without throwing — a refresh failure with a
      // resolved view model already on screen instead preserves it (see
      // `isResolvedEvolutionViewModel`). This `.catch` is only a defensive
      // backstop, matching the same non-blocking contract COLD_START already
      // relies on. The next foreground resume or POST_WORKOUT is what
      // actually retries.
      void load({ trigger: 'FOREGROUND' }).catch((error) => {
        logWarn('workout_evolution', 'foreground_reconcile_failed', { error });
      });
    });
    return () => subscription.remove();
  }, [load, user]);

  useEffect(() => {
    if (!user) return undefined;
    let lifecycleInitial = true;
    let pendingInitial = true;
    const refreshAfterInitial = (source: 'lifecycle' | 'pending') => {
      if (source === 'lifecycle' && lifecycleInitial) {
        lifecycleInitial = false;
        return;
      }
      if (source === 'pending' && pendingInitial) {
        pendingInitial = false;
        return;
      }
      void load({ skipReconcile: true });
    };
    const unsubscribeLifecycle = onSnapshot(
      lifecycleRef(user.uid),
      () => refreshAfterInitial('lifecycle'),
      (error) => logWarn('workout_evolution', 'lifecycle_listener_failed', { error }),
    );
    const unsubscribePending = onSnapshot(
      pendingEvolutionRef(user.uid),
      () => refreshAfterInitial('pending'),
      (error) => logWarn('workout_evolution', 'pending_listener_failed', { error }),
    );
    return () => {
      unsubscribeLifecycle();
      unsubscribePending();
    };
  }, [load, user]);

  const start = useCallback(async () => {
    // Defense in depth: callers cannot invoke a lifecycle write while the
    // controller is exposing a cached/current-session summary-only state.
    // The UI already renders no CTA for SUMMARY_READY, but the controller
    // enforces the same authoritative boundary independently.
    const current = viewModelRef.current;
    if (!user || actionInFlight.current || visibleProgramInstanceIdRef.current !== activeProgramInstanceId ||
        (current.kind !== 'EVOLUTION_READY' && current.kind !== 'EVOLUTION_DEFERRED')) return false;
    actionInFlight.current = true;
    setActionPending(true);
    setActionError(null);
    try {
      const result = await activatePendingEvolution({ uid: user.uid, trigger: 'MANUAL' });
      if (result.status !== 'ACTIVATED') {
        setActionError(result.status);
        await load();
        return false;
      }
      await load();
      return true;
    } catch (error) {
      logWarn('workout_evolution', 'start_failed', { error });
      setActionError('ACTIVATION_FAILED');
      return false;
    } finally {
      actionInFlight.current = false;
      setActionPending(false);
    }
  }, [activeProgramInstanceId, user, load]);

  const defer = useCallback(async () => {
    const current = viewModelRef.current;
    if (!user || actionInFlight.current || visibleProgramInstanceIdRef.current !== activeProgramInstanceId ||
        current.kind !== 'EVOLUTION_READY' || !current.canDefer) return false;
    actionInFlight.current = true;
    setActionPending(true);
    setActionError(null);
    try {
      const result = await deferPendingEvolution({ uid: user.uid });
      if (result.status !== 'DEFERRED') {
        setActionError(result.status);
        await load();
        return false;
      }
      await load();
      return true;
    } catch (error) {
      logWarn('workout_evolution', 'defer_failed', { error });
      setActionError('DEFER_FAILED');
      return false;
    } finally {
      actionInFlight.current = false;
      setActionPending(false);
    }
  }, [activeProgramInstanceId, user, load]);

  const acknowledgeAutoActivation = useCallback(async () => {
    if (!user || viewModel.kind !== 'AUTO_ACTIVATION_NOTICE') return;
    const { activationEventId, summary } = viewModel;
    try {
      await acknowledgeAutoActivationNotice(user.uid, activationEventId);
    } catch (error) {
      // Non-blocking by design: the real explanation may reappear next cold
      // start, but lifecycle and navigation remain usable.
      logWarn('workout_evolution', 'auto_activation_ack_failed', { error });
    }
    commitViewModel({ kind: 'PROGRESSING', summary });
    setDiff(null);
  }, [user, viewModel, commitViewModel]);

  const refreshProjection = useCallback(
    () => load({ skipReconcile: true, propagateError: true }),
    [load],
  );

  const displayedViewModel = visibleProgramInstanceIdRef.current &&
    visibleProgramInstanceIdRef.current !== activeProgramInstanceId
    ? { kind: 'LOADING' as const }
    : viewModel;

  return {
    viewModel: displayedViewModel, loading, actionPending, actionError, diff, pendingPlan, start, defer,
    acknowledgeAutoActivation, refresh: load, refreshProjection, currentTrainingLevel,
  };
}
