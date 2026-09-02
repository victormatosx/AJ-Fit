import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  IDLE_REST_TIMER_STATE,
  addRestSeconds,
  cancelRestTransition,
  consumeExpiredRest,
  createRest,
  ensureWorkoutSessionId,
  reconcileRestExpiration,
  type ActiveRest,
  type RestTimerState,
} from '../lib/restTimer';
import {
  clearRestSession,
  persistRestSession,
  readRestSession,
} from '../services/restSessionStorage';
import { cleanupRestSessionArtifacts } from '../services/restSessionCleanup';
import { logInfo } from '../lib/logger';
import { restLiveActivity, type RestActivityState } from '../lib/restLiveActivity';

type StartRestInput = Readonly<{
  durationSeconds: number;
  exerciseId: string;
  /** Already localized/materialized by the workout layer. */
  exerciseName: string;
  setIndex: number;
  totalSets: number;
}>;

interface RestSessionContextValue {
  workoutSessionId: string | null;
  status: RestTimerState['status'];
  rest: ActiveRest | null;
  beginWorkoutSession: () => string;
  endWorkoutSession: () => void;
  startRest: (input: StartRestInput) => ActiveRest;
  addSeconds: (seconds: number) => ActiveRest | null;
  cancelRest: (restId: string) => boolean;
  consumeExpiration: (restId: string) => boolean;
}

const RestSessionContext = createContext<RestSessionContextValue | null>(null);

type ReconcileSource = 'deadline' | 'foreground';

function toRestActivityState(rest: ActiveRest, exerciseName: string): RestActivityState {
  return {
    sessionId: rest.workoutSessionId,
    startedAt: rest.startedAt,
    endsAt: rest.endsAt,
    exerciseName,
    setIndex: rest.setIndex + 1,
    totalSets: rest.totalSets,
  };
}

/**
 * Owns only workout/rest identity and absolute rest time. Exercise order,
 * progress, load registration and PR decisions remain in WorkoutScreen.
 */
export function RestSessionProvider({ children }: { children: React.ReactNode }) {
  const [workoutSessionId, setWorkoutSessionId] = useState<string | null>(null);
  const workoutSessionIdRef = useRef<string | null>(null);
  const [timerState, setTimerState] = useState<RestTimerState>(IDLE_REST_TIMER_STATE);
  const timerStateRef = useRef<RestTimerState>(IDLE_REST_TIMER_STATE);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const storageRevisionRef = useRef(0);
  const restActivityStateRef = useRef<RestActivityState | null>(null);
  const restActivitySessionStartedRef = useRef(false);

  const publishTimerState = useCallback((next: RestTimerState) => {
    timerStateRef.current = next;
    setTimerState(next);
  }, []);

  const clearPersistedTransition = useCallback(() => {
    storageRevisionRef.current += 1;
    void clearRestSession();
  }, []);

  const ensureSessionId = useCallback(() => {
    const current = workoutSessionIdRef.current;
    const next = ensureWorkoutSessionId(current, randomUUID);
    if (next !== current) {
      workoutSessionIdRef.current = next;
      setWorkoutSessionId(next);
    }
    return next;
  }, []);

  const beginWorkoutSession = useCallback(() => ensureSessionId(), [ensureSessionId]);

  const endWorkoutSession = useCallback(() => {
    const current = timerStateRef.current;
    if (current.status !== 'idle') {
      publishTimerState(IDLE_REST_TIMER_STATE);
      logInfo('restSession', 'rest_ended', { reason: 'workout-ended' });
    }
    if (restActivitySessionStartedRef.current) {
      void restLiveActivity.end('workout_ended');
    }
    restActivityStateRef.current = null;
    restActivitySessionStartedRef.current = false;
    workoutSessionIdRef.current = null;
    setWorkoutSessionId(null);
    clearPersistedTransition();
  }, [clearPersistedTransition, publishTimerState]);

  const startRest = useCallback((input: StartRestInput) => {
    const current = timerStateRef.current;
    if (current.status !== 'idle') return current.rest;

    const { exerciseName, ...restInput } = input;
    const rest = createRest({
      ...restInput,
      restId: randomUUID(),
      workoutSessionId: ensureSessionId(),
      startedAt: Date.now(),
    });
    const next: RestTimerState = { status: 'running', rest };
    publishTimerState(next);
    storageRevisionRef.current += 1;
    void persistRestSession(rest);
    const activityState = toRestActivityState(rest, exerciseName);
    restActivityStateRef.current = activityState;
    restActivitySessionStartedRef.current = true;
    void restLiveActivity.start(activityState);
    logInfo('restSession', 'rest_started', {
      durationSeconds: rest.initialDurationSeconds,
    });
    return rest;
  }, [ensureSessionId, publishTimerState]);

  const addSeconds = useCallback((seconds: number) => {
    const current = timerStateRef.current;
    if (current.status !== 'running') return null;

    const rest = addRestSeconds(current.rest, seconds);
    publishTimerState({ status: 'running', rest });
    storageRevisionRef.current += 1;
    void persistRestSession(rest);
    const currentActivityState = restActivityStateRef.current;
    if (currentActivityState?.sessionId === rest.workoutSessionId) {
      const activityState = { ...currentActivityState, endsAt: rest.endsAt };
      restActivityStateRef.current = activityState;
      void restLiveActivity.update(activityState);
    }
    logInfo('restSession', 'rest_updated', { addedSeconds: seconds });
    return rest;
  }, [publishTimerState]);

  const reconcileExpiration = useCallback((now: number, source: ReconcileSource) => {
    const current = timerStateRef.current;
    const next = reconcileRestExpiration(current, now);
    if (next === current) return false;

    publishTimerState(next);
    clearPersistedTransition();
    logInfo('restSession', 'rest_expired', { source });
    return true;
  }, [clearPersistedTransition, publishTimerState]);

  const cancelRest = useCallback((restId: string) => {
    const transition = cancelRestTransition(timerStateRef.current, restId);
    if (!transition.consumed) return false;

    publishTimerState(transition.state);
    clearPersistedTransition();
    restActivityStateRef.current = null;
    void restLiveActivity.end('cancelled');
    logInfo('restSession', 'rest_ended', { reason: 'skipped' });
    return true;
  }, [clearPersistedTransition, publishTimerState]);

  const consumeExpiration = useCallback((restId: string) => {
    const transition = consumeExpiredRest(timerStateRef.current, restId);
    if (!transition.consumed) return false;

    publishTimerState(transition.state);
    restActivityStateRef.current = null;
    void restLiveActivity.end('completed');
    logInfo('restSession', 'rest_ended', { reason: 'completed' });
    return true;
  }, [publishTimerState]);

  // A single absolute deadline wake-up survives WorkoutScreen unmounts. It is
  // not a countdown ticker: delayed execution always reconciles with Date.now().
  useEffect(() => {
    if (timerState.status !== 'running') return undefined;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled) return;
      const current = timerStateRef.current;
      if (current.status !== 'running' || current.rest.restId !== timerState.rest.restId) return;
      const delay = Math.max(0, current.rest.endsAt - Date.now());
      timeout = setTimeout(() => {
        if (!reconcileExpiration(Date.now(), 'deadline')) schedule();
      }, Math.min(delay, 2_147_483_647));
    };

    schedule();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [reconcileExpiration, timerState]);

  // Same lifecycle pattern used by PhotoVaultContext: keep the previous
  // AppState in a ref, reconcile only on a real return to `active`, and remove
  // the native listener on provider unmount.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (previous !== 'active' && next === 'active') {
        reconcileExpiration(Date.now(), 'foreground');
      }
    });
    return () => subscription.remove();
  }, [reconcileExpiration]);

  // A persisted rest cannot be restored without the rest of the workout
  // engine. Discard it on a cold provider mount instead of fabricating a
  // workout or calling advanceAfterRest without its owning screen state.
  // Cleanup runs even with no storage record because ActivityKit/SystemUI may
  // have outlived the previous JS process independently of AsyncStorage.
  useEffect(() => {
    let mounted = true;
    const readRevision = storageRevisionRef.current;
    void readRestSession().then((persisted) => {
      if (!mounted || storageRevisionRef.current !== readRevision) return;
      if (persisted) {
        logInfo('restSession', 'rest_discarded', { reason: 'workout-not-restorable' });
      }
      storageRevisionRef.current += 1;
      void cleanupRestSessionArtifacts();
    });
    return () => {
      mounted = false;
    };
  }, []);

  // AppShell unmount is a real workout-session boundary (logout/root gate),
  // unlike a WorkoutScreen tab unmount. Never leave its rest orphaned.
  useEffect(() => () => {
    if (timerStateRef.current.status !== 'idle') void clearRestSession();
    if (restActivitySessionStartedRef.current) {
      restActivitySessionStartedRef.current = false;
      void restLiveActivity.end('workout_ended');
    }
  }, []);

  const value = useMemo<RestSessionContextValue>(() => ({
    workoutSessionId,
    status: timerState.status,
    rest: timerState.rest,
    beginWorkoutSession,
    endWorkoutSession,
    startRest,
    addSeconds,
    cancelRest,
    consumeExpiration,
  }), [
    addSeconds,
    beginWorkoutSession,
    cancelRest,
    consumeExpiration,
    endWorkoutSession,
    startRest,
    timerState,
    workoutSessionId,
  ]);

  return <RestSessionContext.Provider value={value}>{children}</RestSessionContext.Provider>;
}

export function useRestSession(): RestSessionContextValue {
  const context = useContext(RestSessionContext);
  if (!context) throw new Error('useRestSession outside provider');
  return context;
}
