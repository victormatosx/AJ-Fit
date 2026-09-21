import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { onSnapshot, type Timestamp } from 'firebase/firestore';
import { useAuth } from '../state/AuthContext';
import { logWarn } from '../lib/logger';
import { recordPerfMark } from '../lib/perf';
import {
  FOREGROUND_RECONCILE_THROTTLE_MS,
  shouldReconcileOnForeground,
} from './foregroundReconcile';
import {
  listWorkoutLifecycleEventsForProgramInstance,
  lifecycleRef,
  loadPendingEvolution,
  loadProgramInstance,
  loadWorkoutLifecycle,
  pendingEvolutionRef,
} from '../services/workoutLifecycle';
import { loadActiveWorkoutProgram, loadWorkoutProgramSnapshot } from '../services/workoutPrograms';
import { evaluateProgressionV2ForUser } from '../services/workoutProgressionV2';
import {
  activatePendingEvolution,
  deferPendingEvolution,
  reconcileWorkoutLifecycle,
} from '../services/workoutLifecycleApplication';
import type { PendingEvolution } from '../workoutLifecycle/types';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import { computePrescriptionDiff, type PrescriptionDiffSummary } from './diff';
import { buildEvolutionViewModel, type LifecycleContext } from './viewModel';
import { nextViewModelAfterLoad } from './loadReducer';
import type { EvolutionViewModel, PendingEvolutionSummary } from './types';
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
  /** Canonical "START NOW" — calls the Fase 4 activation API directly; never a local write (docs §41/§X). */
  start: () => Promise<boolean>;
  /** Canonical "KEEP CURRENT" — calls the Fase 4 defer API directly (docs §42/§Y). */
  defer: () => Promise<boolean>;
  /** Device-local UX acknowledgement; never mutates the immutable domain event. */
  acknowledgeAutoActivation: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Refreshes the React projection only; caller already ran the canonical reconciler. */
  refreshProjection: () => Promise<void>;
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
export function useWorkoutEvolution(): WorkoutEvolutionController {
  const { user } = useAuth();
  const [viewModel, setViewModel] = useState<EvolutionViewModel>({ kind: 'LOADING' });
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [diff, setDiff] = useState<PrescriptionDiffSummary | null>(null);
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

  const load = useCallback(async (options?: {
    trigger?: 'FOREGROUND';
    skipReconcile?: boolean;
    propagateError?: boolean;
  }) => {
    if (!user) return;
    if (!hasLoadedOnce.current) setLoading(true);
    reconcileInFlight.current = true;
    const generation = ++loadGenerationRef.current;
    const isCurrent = () => loadGenerationRef.current === generation;
    try {
      if (!options?.skipReconcile) {
        await reconcileWorkoutLifecycle({
          uid: user.uid,
          trigger: options?.trigger ?? (hasLoadedOnce.current ? 'RECOVERY' : 'COLD_START'),
        });
      }
      recordPerfMark('evolution_reconcile_ready');

      const [lifecycle, pendingAfter, decision] = await Promise.all([
        loadWorkoutLifecycle(user.uid),
        loadPendingEvolution(user.uid),
        evaluateProgressionV2ForUser(user.uid),
      ]);
      recordPerfMark('evolution_lifecycle_pending_progression_ready');

      if (!lifecycle) {
        if (isCurrent()) {
          commitViewModel({ kind: 'UNAVAILABLE' });
          setDiff(null);
          recordPerfMark('evolution_state_commit');
        }
        return;
      }
      const instanceEvents = await listWorkoutLifecycleEventsForProgramInstance(
        user.uid,
        lifecycle.programInstance.programInstanceId,
      );
      recordPerfMark('evolution_events_ready');
      const autoActivationNotice = await loadUnacknowledgedAutoActivationNotice(user.uid, instanceEvents);
      recordPerfMark('evolution_activation_notice_ready');
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
      if (isCurrent()) {
        commitViewModel(buildEvolutionViewModel({
          now: new Date(),
          lifecycle: lifecycleContext,
          decision,
          pending: pendingAfter ? toPendingSummary(pendingAfter) : null,
          autoActivationNotice,
        }));
        recordPerfMark('evolution_state_commit');
      }

      if (pendingAfter) {
        const currentProgram = await loadActiveWorkoutProgram(user.uid);
        const pendingPlan = pendingAfter.plan as FinalWorkoutPlan;
        if (isCurrent()) {
          setDiff(currentProgram?.programInstanceId === pendingAfter.sourceProgramInstanceId
            ? computePrescriptionDiff({ current: currentProgram, pending: pendingPlan })
            : null);
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
        }
      } else if (isCurrent()) {
        setDiff(null);
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
          commitViewModel(next);
          recordPerfMark('evolution_state_commit');
        }
      }
      // Background/cold-start refreshes remain self-contained. Explicit
      // projection barriers (finish/discard) opt in so their orchestrator can
      // diagnose the secondary failure and choose safe navigation behavior.
      if (options?.propagateError) throw error;
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
      reconcileInFlight.current = false;
    }
  }, [user, commitViewModel]);

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
    if (!user || actionInFlight.current) return false;
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
  }, [user, load]);

  const defer = useCallback(async () => {
    if (!user || actionInFlight.current) return false;
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
  }, [user, load]);

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

  return {
    viewModel, loading, actionPending, actionError, diff, start, defer,
    acknowledgeAutoActivation, refresh: load, refreshProjection,
  };
}
