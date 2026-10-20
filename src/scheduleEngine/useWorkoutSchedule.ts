import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../state/AuthContext';
import { errorClass, errorCode, logInfo, logWarn } from '../lib/logger';
import { recordPerfMark } from '../lib/perf';
import {
  ensureScheduleConfigFromQuestionnaire,
  hasScheduledSessionCompletion,
  loadScheduleConfig,
  loadScheduleSuggestionState,
  resolveMissedSession,
  resolveTodaysSchedule,
  selectWorkoutSession,
} from '../services/workoutSchedule';
import { hasWorkoutDailyCompletion } from '../services/workoutExecutions';
import { loadWorkoutPilotEnrollment } from '../services/workoutPilotEnrollment';
import {
  loadDecidedMissedNoticeIds,
  rememberDecidedMissedNoticeId,
} from '../services/missedSessionNoticeStorage';
import {
  detectMissedSessionNotice,
  type MissedSessionNotice,
} from './missedSessionNotice';
import { resolveFreeSchedule } from './freeScheduleResolver';
import { finalizeWorkoutSession } from '../services/finalizeWorkoutSession';
import { listExecutionsForProgram, type PersistedWorkoutExecution } from '../services/workoutExecutions';
import { normalizeWeekdays, trainingDaysValid } from '../lib/questionnaireSchema';
import { addDaysLocal } from './calendar';
import { localDateInTimezone } from './localDate';
import { takeScheduleConfigBootstrapHandoff } from './scheduleConfigBootstrapHandoff';
import type {
  MissDecision,
  MissedSessionDecisionIdentity,
  ScheduleConfig,
  ScheduleResolution,
} from './types';
import {
  classifyMissResolutionOutcome,
  type MissResolutionOutcome,
} from './missedDecisionResolution';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';
import { legacyTrainingDays } from '../workoutPrescription/weeklySchedule';
import { resolveEffectiveCalendarAuthority } from './calendarAuthority';
import { completedSessionIndexForLocalDate } from './completedSessionIndex';
import {
  applyScheduleReloadOutcome,
  type ScheduleRefreshError,
  type ScheduleRefreshProjection,
} from './scheduleRefreshState';

const notAvailable: ScheduleResolution = { status: 'PROGRAM_NOT_AVAILABLE' };

/**
 * Finds the newest terminal execution belonging to the active program
 * instance. This is the crash-recovery bridge for the narrow window where
 * Execution committed but Schedule did not. ABANDONED is never completion.
 */
export function terminalExecutionForScheduleRecovery(
  executions: readonly PersistedWorkoutExecution[],
  programInstanceId: string | null,
): PersistedWorkoutExecution | null {
  return executions
    .filter((item) => (
      item.status === 'COMPLETED' || item.status === 'PARTIALLY_COMPLETED'
    ) && (programInstanceId ? item.programInstanceId === programInstanceId : !item.programInstanceId))
    .sort((a, b) => b.scheduledLocalDate.localeCompare(a.scheduledLocalDate))[0] ?? null;
}

export interface WorkoutScheduleController {
  resolution: ScheduleResolution;
  completedTodaySessionIndex: number | null;
  /**
   * `scheduleState.suggestionVersion` as of the last reload. Must be passed to
   * `startOrResumeWorkoutExecution` as `startedFromSuggestionVersion`, so a
   * finalize that lands after a newer selection leaves that newer intent
   * standing (see `sessionSuggestion.ts`).
   */
  suggestionVersion: number;
  /** True once today's single credited workout exists — the daily limit. */
  workoutCreditedToday: boolean;
  /**
   * Persists an INTENTIONAL session choice and advances the suggestion past
   * it (A→B, B→C, C→A). Never called from a render, a mount or a preview —
   * only from an explicit user action. Resolves to the new suggestion, or
   * `null` when the write failed, in which case the caller must reconcile
   * from `reload()` rather than assume the local value.
   */
  selectSession: (targetSessionIndex: number) => Promise<number | null>;
  config: ScheduleConfig | null;
  loading: boolean;
  /** False for the render where a new program arrived before its schedule reload reset the old projection. */
  matchesActiveProgram: boolean;
  /** Last refresh failure, separate from the last authoritative resolution. */
  refreshError: ScheduleRefreshError | null;
  reload: () => Promise<ScheduleResolution | null>;
  /**
   * True only for an account enrolled in the controlled pilot of the new
   * training architecture. Screens read this to choose which experience to
   * render; it grants nothing — the Rules and `finalizeWorkoutSession`
   * independently re-read the same server-side fact. `false` whenever the
   * flag is absent, unreadable, or not yet loaded.
   */
  pilotEnrolled: boolean;
  /**
   * A recommended day went by with no workout and the user has not answered
   * about it yet. Presentation only: it blocks nothing, and `resolution` is
   * already `SESSION_READY`. `null` for legacy accounts.
   */
  missedNotice: MissedSessionNotice | null;
  /**
   * Answers `missedNotice`. Resolves to the session index that is today's
   * offer afterwards, or `null` when the write was refused.
   */
  decideMissedNotice: (decision: MissDecision) => Promise<number | null>;
  /** Records the notice as answered without changing the rotation. */
  dismissMissedNotice: () => void;
  /** Resolves only the exact missed occurrence captured when the modal opened. */
  resolveMiss: (
    decision: MissDecision,
    expected: MissedSessionDecisionIdentity,
  ) => Promise<MissResolutionOutcome>;
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Bridges the pure Schedule Engine (src/scheduleEngine/) to the active
 * program from `useWorkoutPrescription`. Read-only besides the single,
 * idempotent "first miss detected" write inside `resolveTodaysSchedule`
 * (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md) — opening the app never
 * otherwise changes program or schedule state.
 */
export function useWorkoutSchedule(program: WorkoutProgramSnapshot | null): WorkoutScheduleController {
  const { user, questionnaire } = useAuth();
  const uid = user?.uid ?? null;
  const programId = program?.programId ?? null;
  const programInstanceId = program?.programInstanceId ?? null;
  // Sealed-program mode: only a bootstrap default (brand-new ScheduleConfig)
  // and a last-resort fallback for legacy accounts with no ScheduleConfig at
  // all. ScheduleConfig is the calendar authority now (docs §Agenda
  // configurável) — see `effectiveScheduleMode`/`reload()` below, which
  // always prefer the user-editable config over this sealed value.
  const sealedProgramScheduleMode = program?.scheduleMode ?? 'fixed';
  const prescribedProgramDays = useMemo(() => (program ? legacyTrainingDays(program) : []), [program]);
  const sessionCount = program
    ? program.prescribedTrainingFrequency ?? program.prescribedStructuredDays ?? program.sessions.length
    : 0;
  const authoritativeActivatedAt = program?.programInstanceActivatedAt ?? program?.activatedAt;
  const activatedAtLocalDate = authoritativeActivatedAt
    ? localDateInTimezone(authoritativeActivatedAt.toDate(), deviceTimezone())
    : null;

  const [projection, setProjection] = useState<ScheduleRefreshProjection>({
    resolution: notAvailable,
    refreshError: null,
  });
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [suggestion, setSuggestion] = useState<{ version: number; creditedToday: boolean }>({
    version: 0, creditedToday: false,
  });
  // Pilot enrolment as of the last successful reload. Starts `false` so the
  // very first render — before any read has resolved — is the legacy
  // experience, never the new one.
  const [enrolled, setEnrolled] = useState(false);
  const [missedNotice, setMissedNotice] = useState<MissedSessionNotice | null>(null);
  const missResolutionInFlightRef = useRef<Promise<MissResolutionOutcome> | null>(null);
  const [completedToday, setCompletedToday] = useState<{
    scopeKey: string; localDate: string; sessionIndex: number | null;
  } | null>(null);
  // Render-level effective mode, derived from the last successfully reloaded
  // ScheduleConfig. Used by callers (e.g. `resolveMiss`) that run outside
  // `reload()`'s own scope and therefore can't recompute it from a freshly
  // awaited read.
  const effectiveScheduleMode = config?.scheduleMode ?? sealedProgramScheduleMode;
  const [loading, setLoading] = useState(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const reloadSequenceRef = useRef(0);
  const scheduleScopeKey = uid
    ? `${uid}:${programInstanceId ?? programId ?? 'no-program'}`
    : null;
  const scheduleScopeRef = useRef(scheduleScopeKey);
  // Retains the background refresh Promise so post-durable Schedule
  // projection work is explicit and never an unhandled fire-and-forget.
  const completionReloadRef = useRef<Promise<unknown> | null>(null);

  const reload = useCallback(async () => {
    const reloadId = ++reloadSequenceRef.current;
    const reloadStartedAtMs = Date.now();
    if (scheduleScopeRef.current !== scheduleScopeKey) {
      scheduleScopeRef.current = scheduleScopeKey;
      setProjection({ resolution: notAvailable, refreshError: null });
      setConfig(null);
    }
    if (!uid) {
      setProjection({ resolution: notAvailable, refreshError: null });
      setConfig(null);
      setLoading(false);
      return notAvailable;
    }
    // No active program yet (still resolving in `useWorkoutPrescription`, or
    // genuinely none). `resolveTodaysSchedule`'s own `!hasActiveProgram`
    // branch (scheduleEngine/resolver.ts) returns `PROGRAM_NOT_AVAILABLE`
    // unconditionally without ever reading `config`/`state` — so fetching
    // them here first only to throw the read away. Mirrors that exact
    // `hasActiveProgram` condition. `config` is left as-is (not reset) so an
    // already-loaded value isn't discarded for nothing.
    if (!programId || sessionCount <= 0) {
      setProjection({ resolution: notAvailable, refreshError: null });
      setLoading(false);
      return notAvailable;
    }
    setLoading(true);
    try {
      let loadedConfig = takeScheduleConfigBootstrapHandoff(uid) ?? await loadScheduleConfig(uid);
      // Reconciliation, not a second question: the questionnaire already
      // asked `trainingDays` — if the Schedule Engine has no config yet
      // AND that answer is valid, bridge it across automatically instead of
      // ever showing SCHEDULE_SETUP_REQUIRED for something already known.
      // `ensureScheduleConfigFromQuestionnaire` is create-only (never
      // overwrites a config the user edited afterward) and transaction-
      // guarded (safe against this hook mounting twice concurrently) — see
      // its doc comment in `services/workoutSchedule.ts`.
      if (!loadedConfig && (sealedProgramScheduleMode === 'flexible' || prescribedProgramDays.length > 0)) {
        loadedConfig = await ensureScheduleConfigFromQuestionnaire(
          uid,
          prescribedProgramDays,
          deviceTimezone(),
          sealedProgramScheduleMode,
        );
      } else if (!loadedConfig && questionnaire && trainingDaysValid(questionnaire.answers)) {
        loadedConfig = await ensureScheduleConfigFromQuestionnaire(
          uid,
          normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
          deviceTimezone(),
          questionnaire.answers.scheduleMode ?? 'fixed',
        );
      }
      // ScheduleConfig — the user-editable preference doc — is now the
      // calendar authority (docs §Agenda configurável): it decides both
      // `scheduleMode` and `trainingDays` whenever it holds a value that's
      // structurally consistent with this program's prescribed frequency.
      // The sealed program's `weeklySchedule`/`scheduleMode` only steps back
      // in as a migration-safety fallback — never silently overriding an
      // account that explicitly edited its agenda, and never leaving a
      // legacy/inconsistent account stuck in REST_DAY.
      const calendar = resolveEffectiveCalendarAuthority({
        scheduleConfig: loadedConfig ? { ...loadedConfig } : null,
        program: program ?? {},
        snapshotInputs: questionnaire?.answers ? { ...questionnaire.answers } : null,
      });
      const effectiveScheduleModeForThisLoad = calendar.scheduleMode;
      const effectiveConfig = loadedConfig
        ? {
            ...loadedConfig,
            scheduleMode: calendar.scheduleMode,
            trainingDays: calendar.trainingDays,
            activeRecoveryDays: calendar.activeRecoveryDays,
          }
        : null;
      recordPerfMark('today_schedule_config_ready');

      const timezone = loadedConfig?.timezone ?? deviceTimezone();
      const todayLocalDate = localDateInTimezone(new Date(), timezone);
      let completedTodaySessionIndex: number | null = null;
      // Real terminal executions, by the day the effort happened. Collected
      // from the list the recovery check below already fetches, so the
      // missed-session notice costs no extra read. Stays empty when that
      // block does not run, which is exactly when no notice is possible
      // anyway (it requires configured training days).
      const performedLocalDates = new Set<string>();
      // The OPPORTUNITY each terminal execution consumed. Differs from the
      // set above only for anticipated/deferred sessions — precisely the case
      // where a day has no effort of its own yet was already trained.
      const coveredScheduledLocalDates = new Set<string>();

      // Process-death recovery, case B: finishWorkoutExecution atomically
      // terminalizes the execution and clears the active mutex, so `current`
      // intentionally cannot be used as a completion marker. Re-discover the
      // terminal execution from Firestore and resume only the missing,
      // idempotent Schedule mutation. Both documents remain authoritative.
      if (programId && (effectiveScheduleModeForThisLoad === 'flexible' || effectiveConfig?.trainingDays.length) && activatedAtLocalDate) {
        try {
          const executions = await listExecutionsForProgram(uid, programId);
          const candidate = terminalExecutionForScheduleRecovery(executions, programInstanceId);
          completedTodaySessionIndex = completedSessionIndexForLocalDate(
            executions, programInstanceId, todayLocalDate, sessionCount,
          );
          for (const item of executions) {
            if (item.status !== 'COMPLETED' && item.status !== 'PARTIALLY_COMPLETED') continue;
            // Same provenance rule the rest of the app uses: the day of the
            // EFFORT, falling back to the scheduled date for documents
            // written before `performedLocalDate` existed.
            performedLocalDates.add(item.performedLocalDate ?? item.scheduledLocalDate);
            coveredScheduledLocalDates.add(item.scheduledLocalDate);
          }
          if (candidate && !(await hasScheduledSessionCompletion({
            uid,
            programId,
            ...(programInstanceId ? { programInstanceId } : {}),
            sessionIndex: candidate.sessionIndex,
            scheduledLocalDate: candidate.scheduledLocalDate,
            // A `flexible` schedule's same-day repeat (occurrence 2+) has its
            // own distinct COMPLETED event id (`_oN` suffix) — omitting this
            // made every recovery check fall back to occurrence 1's id, so a
            // terminal occurrence 2+ execution whose Schedule write never
            // landed (process death) was wrongly read as "already recorded"
            // whenever an earlier occurrence that same day really had
            // completed, and recovery silently skipped it.
            ...(candidate.occurrence ? { occurrence: candidate.occurrence } : {}),
          }))) {
            logInfo('workout_schedule', 'terminal_execution_schedule_recovery_started', {});
            await finalizeWorkoutSession({ executionId: candidate.executionId });
            logInfo('workout_schedule', 'terminal_execution_schedule_recovery_completed', {});
          }
        } catch (error) {
          // Fail closed: a still-missing Schedule fact remains retryable on
          // foreground/cold start and is never presented as completed here.
          logWarn('workout_schedule', 'terminal_execution_schedule_recovery_failed', {
            errorCode: errorCode(error),
            errorClass: errorClass(error),
          });
        }
      }
      recordPerfMark('today_schedule_recovery_checked');
      // CONTROLLED PILOT FORK. Enrolment is read server-side here, and the
      // same document is re-read by the Rules and by `finalizeWorkoutSession`
      // — so this branch chooses the EXPERIENCE only, and a wrong `true` grants
      // nothing. The fail-safe direction is what matters: unreadable or absent
      // means legacy, so no account is ever shown an affordance the backend
      // would refuse.
      const pilotEnrolled = await loadWorkoutPilotEnrollment(uid);
      let result: ScheduleResolution;
      let suggestionUpdate: { version: number; creditedToday: boolean } | null = null;
      let noticeUpdate: MissedSessionNotice | null = null;
      // Size of the device-local "already answered" set at detection time.
      // Logged because an empty set is indistinguishable from "nothing was
      // ever answered" in the notice's own output, and the two have opposite
      // meanings when a notice the user already dismissed shows up again.
      let decidedNoticeCount = 0;
      if (pilotEnrolled) {
        // NEW TRAINING MODEL — the calendar no longer decides what is
        // available. `resolveTodaysSchedule` is bypassed along with everything
        // it implied: the trainingDay walk, the rest-day block, the setup gate
        // and the miss-detection WRITE it performed on a mere read. What
        // replaces it is `resolveFreeSchedule` (pure, no I/O) over two facts:
        // the stored suggestion, and whether today's single credited workout
        // already exists.
        const [suggestionState, workoutCreditedToday, decidedNoticeIds] = await Promise.all([
          loadScheduleSuggestionState(uid, programId, programInstanceId ?? undefined),
          hasWorkoutDailyCompletion(uid, todayLocalDate),
          // Device-local "stop asking" set; see `missedSessionNoticeStorage`.
          loadDecidedMissedNoticeIds(uid),
        ]);
        decidedNoticeCount = decidedNoticeIds.length;
        const free = resolveFreeSchedule({
          hasActiveProgram: true,
          sessionCount,
          state: suggestionState,
          recommendedWeekdays: effectiveConfig?.trainingDays ?? [],
          todayLocalDate,
          workoutCreditedToday,
        });
        // Mapped onto the existing `ScheduleResolution` union so every current
        // consumer keeps compiling and rendering unchanged. The mapping is the
        // integration: `SESSION_READY` on ANY day (so no screen can block on
        // the calendar), and `TODAY_COMPLETED` once the day is claimed — which
        // is already the state the app renders as "treino de hoje concluído",
        // including refusing to start another session. For an enrolled account
        // `REST_DAY`, `ACTIVE_RECOVERY_DAY`, `SCHEDULE_SETUP_REQUIRED` and
        // `MISSED_SESSION_DECISION_REQUIRED` are never produced.
        result = free.status === 'PROGRAM_NOT_AVAILABLE'
          ? notAvailable
          : free.status === 'TODAY_COMPLETED'
            ? {
                status: 'TODAY_COMPLETED',
                nextWorkoutDate: free.nextRecommendedLocalDate ?? addDaysLocal(todayLocalDate, 1),
                nextSessionIndex: free.sessionIndex,
              }
            : { status: 'SESSION_READY', sessionIndex: free.sessionIndex };
        suggestionUpdate = {
          version: free.status === 'PROGRAM_NOT_AVAILABLE' ? 0 : free.suggestionVersion,
          creditedToday: workoutCreditedToday,
        };
        // Detection only — it produces no status and gates nothing. The
        // resolution above is already final and always lets the user train.
        noticeUpdate = free.status === 'PROGRAM_NOT_AVAILABLE' ? null : detectMissedSessionNotice({
          hasActiveProgram: true,
          sessionCount,
          programInstanceId,
          recommendedWeekdays: effectiveConfig?.trainingDays ?? [],
          lastPerformedLocalDate: suggestionState?.lastPerformedLocalDate ?? null,
          performedLocalDates,
          coveredScheduledLocalDates,
          suggestedSessionIndex: free.sessionIndex,
          todayLocalDate,
          workoutCreditedToday,
          decidedNoticeIds,
        });
      } else {
        // LEGACY — unchanged from the published path, including the two reads
        // the new branch replaces. `suggestionUpdate` stays null so the
        // controller keeps `version: 0`, which is exactly what stops the client
        // from sending `startedFromSuggestionVersion` on execution create.
        result = await resolveTodaysSchedule({
          uid,
          programId,
          programInstanceId,
          sessionCount,
          scheduleMode: effectiveScheduleModeForThisLoad,
          activatedAtLocalDate,
          todayLocalDate,
          // Already awaited above (`loadedConfig`) — same uid, same document,
          // no write in between. Skips resolveTodaysSchedule's own otherwise-
          // redundant `loadScheduleConfig` read.
          storedConfig: effectiveConfig,
        });
      }
      recordPerfMark('today_schedule_resolved');
      if (reloadId === reloadSequenceRef.current) {
        setConfig(effectiveConfig);
        setCompletedToday({ scopeKey: scheduleScopeKey!, localDate: todayLocalDate, sessionIndex: completedTodaySessionIndex });
        setEnrolled(pilotEnrolled);
        if (suggestionUpdate) setSuggestion(suggestionUpdate);
        // Legacy accounts never get one: their notice is the published
        // `MISSED_SESSION_DECISION_REQUIRED` resolution, untouched.
        setMissedNotice(pilotEnrolled ? noticeUpdate : null);
      }
      setProjection((current) => applyScheduleReloadOutcome(current, reloadSequenceRef.current, {
        kind: 'success',
        reloadId,
        resolution: result,
      }));
      logInfo('workout_schedule', 'schedule_resolved', {
        status: result.status,
        durationMs: Date.now() - reloadStartedAtMs,
        reloadId,
        applied: reloadId === reloadSequenceRef.current,
        // Pilot observability. `noticeId` is `(instanceId, missedDate)` — no
        // uid, no personal data — and is the only way to tell a legitimate
        // new missed day from the same one being raised twice.
        enrolled: pilotEnrolled,
        missedNoticeId: noticeUpdate?.noticeId ?? null,
        missedOccurrenceCount: noticeUpdate?.missedOccurrenceCount ?? 0,
        decidedNoticeCount,
      });
      return reloadId === reloadSequenceRef.current ? result : null;
    } catch (error) {
      const refreshError = {
        code: errorCode(error),
        errorClass: errorClass(error),
      };
      setProjection((current) => applyScheduleReloadOutcome(current, reloadSequenceRef.current, {
        kind: 'failure',
        reloadId,
        error: refreshError,
      }));
      logWarn('workout_schedule', 'schedule_resolve_failed', {
        durationMs: Date.now() - reloadStartedAtMs,
        reloadId,
        errorCode: refreshError.code,
        errorClass: refreshError.errorClass,
        resolutionPreserved: true,
        ignoredAsStale: reloadId !== reloadSequenceRef.current,
      });
      return null;
    } finally {
      if (reloadId === reloadSequenceRef.current) setLoading(false);
    }
  }, [uid, programId, programInstanceId, sessionCount, sealedProgramScheduleMode, activatedAtLocalDate, questionnaire, prescribedProgramDays, program, scheduleScopeKey]);

  useEffect(() => { void reload(); }, [reload]);

  const reloadAfterCompletion = useCallback(() => {
    const reloadStartedAtMs = Date.now();
    logInfo('workout_performance', 'schedule_reload_start', { timestampMs: reloadStartedAtMs });
    const operation = reload()
      .catch((error) => {
        logWarn('workout_schedule', 'schedule_completion_reload_failed', {
          errorCode: errorCode(error),
          errorClass: errorClass(error),
        });
      })
      .finally(() => {
        logInfo('workout_performance', 'schedule_reload_end', {
          timestampMs: Date.now(),
          durationMs: Date.now() - reloadStartedAtMs,
        });
        if (completionReloadRef.current === operation) completionReloadRef.current = null;
      });
    completionReloadRef.current = operation;
    return operation;
  }, [reload]);

  // A completion-time projection reload can fail while the durable Schedule
  // write remains correct. Retry presentation on the next real foreground
  // transition; cold start is already covered by the mount-time reload.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'active' && previousState !== 'active') reloadAfterCompletion();
    });
    return () => subscription.remove();
  }, [reloadAfterCompletion]);

  /**
   * Missed-session resolution, pilot-gated.
   *
   * ENROLLED: retired. The new model has no missed-session concept — the
   * resolver never reports `MISSED_SESSION_DECISION_REQUIRED`, so no screen
   * can reach a state that needs resolving, and nothing may stand between the
   * user and training. Returning `FAILED` without touching Firestore is
   * deliberate: a stray caller must not write a `MISS_RESOLVED`/`SKIPPED`
   * ledger entry under rules that no longer have a miss to resolve.
   *
   * NOT ENROLLED: the published behaviour, unchanged. A legacy account can
   * still be shown the decision modal by `resolveTodaysSchedule`, and it must
   * still be able to act on it — otherwise the pilot would strand every other
   * user on an unresolvable screen. Historical events stay readable in both
   * branches.
   */
  const resolveMiss = useCallback((
    decision: MissDecision,
    expected: MissedSessionDecisionIdentity,
  ): Promise<MissResolutionOutcome> => {
    if (enrolled) {
      logWarn('workout_schedule', 'miss_resolution_retired', {});
      return Promise.resolve({ status: 'FAILED', resolution: null });
    }
    if (missResolutionInFlightRef.current) return missResolutionInFlightRef.current;
    if (effectiveScheduleMode === 'flexible' || !uid || !programId || sessionCount === 0) {
      return Promise.resolve({ status: 'FAILED', resolution: null });
    }
    const timezone = config?.timezone ?? deviceTimezone();
    const todayLocalDate = localDateInTimezone(new Date(), timezone);
    const operation = (async (): Promise<MissResolutionOutcome> => {
      let failure: unknown | null = null;
      try {
        await resolveMissedSession({
          uid,
          programId,
          ...(programInstanceId ? { programInstanceId } : {}),
          sessionCount,
          decision,
          todayLocalDate,
          expected,
        });
      } catch (error) {
        failure = error;
        logWarn('workout_schedule', 'schedule_miss_resolution_failed', { error });
      }
      const resolution = await reload();
      return classifyMissResolutionOutcome({ error: failure, expected, resolution });
    })();
    missResolutionInFlightRef.current = operation;
    const release = () => {
      if (missResolutionInFlightRef.current === operation) missResolutionInFlightRef.current = null;
    };
    void operation.then(release, release);
    return operation;
  }, [enrolled, uid, programId, programInstanceId, sessionCount, effectiveScheduleMode, config, reload]);

  /**
   * Persists an intentional session choice. Explicit user action only — never
   * a render, a mount or a preview. Optimistically publishes the new
   * suggestion so the card updates immediately, then reconciles from the
   * authoritative reload; on failure it reverts by reloading rather than
   * leaving a local value the server never accepted.
   */
  const selectSessionInFlightRef = useRef<Promise<number | null> | null>(null);
  const selectSession = useCallback((targetSessionIndex: number): Promise<number | null> => {
    if (selectSessionInFlightRef.current) return selectSessionInFlightRef.current;
    // Pilot-gated. The Rules reject a suggestion write from a non-enrolled
    // account, so attempting it would only produce a permission error; a
    // legacy account repositions through the published path instead.
    if (!enrolled) return Promise.resolve(null);
    if (!uid || !programId || sessionCount <= 0 || !activatedAtLocalDate) return Promise.resolve(null);
    const operation = (async (): Promise<number | null> => {
      try {
        const next = await selectWorkoutSession({
          uid,
          programId,
          ...(programInstanceId ? { programInstanceId } : {}),
          sessionCount,
          targetSessionIndex,
          activatedAtLocalDate,
        });
        setProjection((current) => applyScheduleReloadOutcome(current, reloadSequenceRef.current, {
          kind: 'success',
          reloadId: reloadSequenceRef.current,
          resolution: suggestion.creditedToday
            ? current.resolution
            : { status: 'SESSION_READY', sessionIndex: next.suggestedSessionIndex },
        }));
        setSuggestion((current) => ({ ...current, version: next.version }));
        return next.suggestedSessionIndex;
      } catch (error) {
        logWarn('workout_schedule', 'session_selection_failed', {
          errorCode: errorCode(error),
          errorClass: errorClass(error),
        });
        // Never leave the UI on a value the server did not accept.
        await reload();
        return null;
      }
    })();
    selectSessionInFlightRef.current = operation;
    const release = () => {
      if (selectSessionInFlightRef.current === operation) selectSessionInFlightRef.current = null;
    };
    void operation.then(release, release);
    return operation;
  }, [enrolled, uid, programId, programInstanceId, sessionCount, activatedAtLocalDate, suggestion.creditedToday, reload]);

  /**
   * Answers the missed-session notice. Pilot only — a legacy account's notice
   * is the published `MISSED_SESSION_DECISION_REQUIRED` flow via `resolveMiss`.
   *
   * Each answer SELECTS the session it is going to train, and selecting
   * advances the suggestion immediately — whether or not the workout is then
   * started, cancelled or abandoned. So the target differs per answer, and the
   * suggestion always lands exactly one position past it:
   *
   *  - `CONTINUE_SEQUENCE` ("refazer hoje") selects the pending session (A):
   *    trains A, suggestion becomes B.
   *  - `FOLLOW_SCHEDULE` ("seguir o planejamento") selects the NEXT one (B),
   *    which is what the user will train: trains B, suggestion becomes C. A is
   *    skipped by simply never being selected.
   *
   * Selecting the pending session for BOTH answers was a defect: it left the
   * suggestion on B while B was the session being trained, so cancelling or
   * abandoning B offered B again — and the rotation only reached C at
   * finalize, contradicting the immediate-advance rule.
   *
   * The caller must start the returned index EXPLICITLY: the pointer has
   * already moved past it, so re-reading the resolution would start the
   * session AFTER the one the user was shown.
   *
   * Finalizing cannot advance a second time: `completeSession` recomputes
   * `suggestionAfter(sessionIndex)`, finds the pointer already there and
   * reports `UNCHANGED` (see `sessionSuggestion.ts`). That holds for both
   * answers — A→B and B→C alike.
   *
   * Either way the notice id is remembered locally so the same missed day is
   * never raised twice, including when the user simply dismisses it.
   */
  const decideMissedNoticeInFlightRef = useRef<Promise<number | null> | null>(null);
  const decideMissedNotice = useCallback((decision: MissDecision): Promise<number | null> => {
    if (decideMissedNoticeInFlightRef.current) return decideMissedNoticeInFlightRef.current;
    const notice = missedNotice;
    if (!enrolled || !notice || !uid) return Promise.resolve(null);
    const operation = (async (): Promise<number | null> => {
      try {
        // The session this answer will train — and therefore the one to select.
        const target = decision === 'CONTINUE_SEQUENCE'
          ? notice.pendingSessionIndex
          : notice.skipToSessionIndex;
        const next = await selectSession(target);
        // A refused write must not be recorded as answered, or the user loses
        // both the question and its effect.
        if (next === null) return null;
        await rememberDecidedMissedNoticeId(uid, notice.noticeId);
        setMissedNotice(null);
        return target;
      } catch (error) {
        logWarn('workout_schedule', 'missed_notice_decision_failed', {
          errorCode: errorCode(error),
          errorClass: errorClass(error),
        });
        return null;
      }
    })();
    decideMissedNoticeInFlightRef.current = operation;
    const release = () => {
      if (decideMissedNoticeInFlightRef.current === operation) decideMissedNoticeInFlightRef.current = null;
    };
    void operation.then(release, release);
    return operation;
  }, [enrolled, uid, missedNotice, selectSession]);

  /** Dismissal counts as answered: the same missed day must not be raised again. */
  const dismissMissedNotice = useCallback((): void => {
    if (!uid || !missedNotice) return;
    void rememberDecidedMissedNoticeId(uid, missedNotice.noticeId);
    setMissedNotice(null);
  }, [uid, missedNotice]);

  return {
    resolution: projection.resolution,
    completedTodaySessionIndex: projection.resolution.status === 'TODAY_COMPLETED'
      && completedToday?.scopeKey === scheduleScopeKey
      && completedToday.localDate === localDateInTimezone(new Date(), config?.timezone ?? deviceTimezone())
      ? completedToday.sessionIndex : null,
    config,
    loading,
    matchesActiveProgram: scheduleScopeRef.current === scheduleScopeKey,
    refreshError: projection.refreshError,
    reload,
    resolveMiss,
    suggestionVersion: suggestion.version,
    workoutCreditedToday: suggestion.creditedToday,
    selectSession,
    pilotEnrolled: enrolled,
    missedNotice,
    decideMissedNotice,
    dismissMissedNotice,
  };
}
