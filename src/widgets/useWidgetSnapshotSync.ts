import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../state/AuthContext';
import { logWarn } from '../lib/logger';
import type { ScheduleMode, Sex, Weekday } from '../state/AppState';
import type { LocalDate } from '../scheduleEngine/calendar';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import type { ScheduleResolution } from '../scheduleEngine/types';
import type { FinalWorkoutSession } from '../workoutPrescription/types';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import {
  listCompletedWorkoutActivityDatesInRange,
  loadActiveExecutionPointer,
  loadWorkoutExecution,
} from '../services/workoutExecutions';
import { beginWidgetSnapshotSession, syncWidgetSnapshot } from './widgetSnapshotSync';
import { fetchWidgetStreakHistory } from './widgetStreakHistoryFetch';
import { buildWorkoutWidgetData, type WorkoutWidgetExecution } from './workoutWidgetProjection';

export interface WidgetSnapshotSyncInput {
  timezone: string;
  sex: Sex;
  hasActiveProgram: boolean;
  scheduleMode?: ScheduleMode;
  prescribedTrainingFrequency?: number;
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
  activatedAtLocalDate: LocalDate | null;
  sessions: readonly FinalWorkoutSession[];
  scheduleResolution: ScheduleResolution | null;
  /** Stable identity for the immutable active program snapshot. */
  programIdentity: string | null;
}

export interface WidgetSnapshotSyncController {
  /**
   * Explicit resync. Callers MUST only invoke this after confirming success
   * of whatever triggered it — e.g. `finalizeWorkoutSession` having
   * resolved `COMPLETED` (see `AppShell.tsx`'s `result === 'COMPLETED'`
   * branch). Never call this optimistically before a backend confirmation.
   */
  resyncNow: (options?: { scheduleResolution?: ScheduleResolution | null }) => Promise<void>;
}

/** Reads the durable mutex first and trusts an execution only when it still backs that pointer. */
export async function loadAuthoritativeWidgetExecution(uid: string): Promise<WorkoutWidgetExecution | null> {
  const pointer = await loadActiveExecutionPointer(uid);
  if (!pointer) return null;
  const execution = await loadWorkoutExecution(uid, pointer.executionId);
  if (!execution || execution.status !== 'IN_PROGRESS' || execution.executionId !== pointer.executionId) return null;
  return {
    status: 'IN_PROGRESS',
    sessionName: execution.sessionName,
    exercises: execution.exercises,
  };
}

/**
 * Wires the Home Screen Widgets snapshot to the events it must track:
 *
 *   - LOGIN / session restore, and TROCA/ATIVAÇÃO DE PROGRAMA: a single
 *     reactive effect below covers both — any change to `uid` or to the
 *     resolved schedule inputs re-derives the snapshot. This mirrors
 *     `useWorkoutActivitySnapshot`'s own `week` memo, which already depends
 *     on exactly this input shape for the same reason (the authoritative
 *     state changed, full stop — it does not matter structurally WHY).
 *   - LOGOUT: handled by `AuthContext.logout()` calling
 *     `clearWidgetSnapshot()` directly — not from here, since a hook
 *     unmounting on logout is not a reliable place to guarantee a clear
 *     actually runs before the logout flow concludes.
 *   - FINALIZAÇÃO DE TREINO: NOT wired automatically — the caller
 *     (`AppShell.tsx`) must call `resyncNow()` itself, only after
 *     `finalizeWorkoutSession` has actually confirmed success. This hook
 *     has no way to observe "did the backend confirm" on its own, and must
 *     never guess.
 *   - FOREGROUND: an `AppState` listener below, same "transition INTO
 *     active" pattern already used by `useWorkoutSchedule.ts`.
 *
 * No Firestore listener is ever opened here — every read is a one-shot
 * bounded range query, triggered only by one of the events above.
 */
export function useWidgetSnapshotSync(input: WidgetSnapshotSyncInput): WidgetSnapshotSyncController {
  const { user } = useAuth();
  const { t, i18n } = useTranslation('workout');
  const uid = user?.uid ?? null;
  const previousUidRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const trainingDaysKey = input.trainingDays.join(',');
  const activeRecoveryDaysKey = input.activeRecoveryDays.join(',');
  const scheduleResolutionKey = JSON.stringify(input.scheduleResolution);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const resyncNow = useCallback(async (options?: { scheduleResolution?: ScheduleResolution | null }) => {
    if (!uid || !input.hasActiveProgram) return;
    try {
      const today = localDateInTimezone(new Date(), input.timezone);
      // Incremental-block search (Phase 2.5 §A) — never a single
      // unconditionally-wide fetch, never a silent truncation. See
      // `fetchWidgetStreakHistory`'s own doc comment for the cost analysis.
      const [history, activeExecution] = await Promise.all([
        fetchWidgetStreakHistory({
          uid,
          todayLocalDate: today,
          streakInput: {
            scheduleMode: input.scheduleMode,
            prescribedTrainingFrequency: input.prescribedTrainingFrequency,
            trainingDays: input.trainingDays,
            activeRecoveryDays: input.activeRecoveryDays,
          },
          fetchRange: listCompletedWorkoutActivityDatesInRange,
        }),
        loadAuthoritativeWidgetExecution(uid),
      ]);
      const effectiveResolution = options && Object.prototype.hasOwnProperty.call(options, 'scheduleResolution')
        ? options.scheduleResolution ?? null
        : input.scheduleResolution;
      const generatedAtMs = Date.now();
      const workout = buildWorkoutWidgetData({
        scheduleMode: input.scheduleMode ?? 'fixed',
        todayLocalDate: today,
        timezone: input.timezone,
        generatedAtMs,
        sex: input.sex,
        sessions: input.sessions,
        resolution: effectiveResolution,
        activeExecution,
        copy: {
          nextWorkout: t('widget.nextWorkout'),
          inProgress: t('widget.inProgress'),
          today: t('widget.today'),
          exercises: (count) => t('widget.exercises', { count }),
          sets: (count) => t('widget.sets', { count }),
        },
        resolveSessionName: (session) => resolveSessionDisplayName(
          t as unknown as LooseTranslate,
          session.name,
          session.type,
          session.displayName,
        ),
        formatDate: (localDate) => new Intl.DateTimeFormat(locale, {
          weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
        }).format(new Date(`${localDate}T12:00:00Z`)).replace(/\.$/, '').toLocaleUpperCase(locale),
      });
      await syncWidgetSnapshot({
        isAuthenticated: true,
        hasActiveProgram: true,
        todayLocalDate: today,
        timezone: input.timezone,
        generatedAtMs,
        scheduleMode: input.scheduleMode,
        prescribedTrainingFrequency: input.prescribedTrainingFrequency,
        trainingDays: input.trainingDays,
        activeRecoveryDays: input.activeRecoveryDays,
        activatedAtLocalDate: input.activatedAtLocalDate,
        completedDates: history.completedDates,
        fulfilledScheduledDates: history.fulfilledScheduledDates,
        historyAvailableFromLocalDate: history.historyAvailableFromLocalDate,
        workout,
      });
    } catch (error) {
      // Deliberately swallow: leave whatever snapshot is already stored as
      // the last known-good state — a failed reconciliation must never
      // clear or corrupt it, same "never flash a worse state than what's
      // already on screen" contract `useWorkoutActivitySnapshot` uses for
      // its own transient-failure handling.
      logWarn('widget_snapshot_sync', 'resync_failed', { error });
    }
    // `uid`/`input.hasActiveProgram`/`input.timezone` are read directly;
    // the remaining fields are intentionally keyed by their stable string
    // forms (`trainingDaysKey`/`activeRecoveryDaysKey`) rather than the
    // array identities themselves, same pattern `useWorkoutActivitySnapshot`
    // already uses for the same inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    uid,
    input.hasActiveProgram,
    input.timezone,
    input.sex,
    input.scheduleMode,
    input.prescribedTrainingFrequency,
    trainingDaysKey,
    activeRecoveryDaysKey,
    input.activatedAtLocalDate,
    input.programIdentity,
    input.sessions,
    scheduleResolutionKey,
    locale,
    t,
  ]);

  useEffect(() => {
    if (!uid) return;
    if (previousUidRef.current !== uid) {
      // Defense in depth: today's only real uid transition into a NEW
      // non-null value goes through `AuthContext.logout()` first, which
      // already starts a new session generation itself. Starting one again
      // here is a harmless no-op in that case, and a correct safety net if
      // a future caller ever observes a login without an intervening
      // explicit logout.
      beginWidgetSnapshotSession();
      previousUidRef.current = uid;
    }
    if (!input.hasActiveProgram) {
      // An explicit NO_PROGRAM snapshot, not a skipped sync — a user who
      // deactivates their program must not keep seeing a stale READY widget.
      void syncWidgetSnapshot({
        isAuthenticated: true,
        hasActiveProgram: false,
        todayLocalDate: localDateInTimezone(new Date(), input.timezone),
        timezone: input.timezone,
        generatedAtMs: Date.now(),
        trainingDays: [],
        activeRecoveryDays: [],
        activatedAtLocalDate: null,
        completedDates: new Set(),
      });
      return;
    }
    void resyncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    uid,
    input.hasActiveProgram,
    input.timezone,
    input.sex,
    input.scheduleMode,
    input.prescribedTrainingFrequency,
    trainingDaysKey,
    activeRecoveryDaysKey,
    input.activatedAtLocalDate,
    input.programIdentity,
    scheduleResolutionKey,
    locale,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'active' && previousState !== 'active') void resyncNow();
    });
    return () => subscription.remove();
  }, [resyncNow]);

  return { resyncNow };
}
