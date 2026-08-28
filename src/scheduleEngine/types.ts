import type { Weekday } from '../state/AppState';

/**
 * Schedule Engine V1 (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md).
 * Turns an ordered, prescribed session sequence (A/B/C/... from the active
 * `WorkoutProgramSnapshot`) into "what should this user train right now".
 * Never selects Txxx, never edits sessions/sets/reps/exerciseId.
 */

/** User preference. Survives program regeneration; not program-scoped. */
export interface ScheduleConfig {
  trainingDays: Weekday[];
  /** Program-scoped guidance days. Never walked as executable sessions. */
  activeRecoveryDays?: Weekday[];
  /** IANA timezone (e.g. "America/Sao_Paulo"). Weekday resolution is always local, never UTC. */
  timezone: string;
  scheduleVersion: number;
}

export type ScheduleEventType = 'COMPLETED' | 'SKIPPED' | 'MISS_RESOLVED';
export type SkipReasonCode = 'FOLLOWED_SCHEDULE_AFTER_MISS';
export type MissDecision = 'CONTINUE_SEQUENCE' | 'FOLLOW_SCHEDULE';

/** Immutable ledger entry. Never rewritten; see docs §Persistência. */
export interface ScheduleEvent {
  type: ScheduleEventType;
  sessionIndex: number;
  /** Local calendar date (YYYY-MM-DD) this occurrence was scheduled for. */
  scheduledDate: string;
  reasonCode?: SkipReasonCode;
  decision?: MissDecision;
}

export interface PendingMissDecision {
  /** Session that was due and never completed (what CONTINUE_SEQUENCE resumes). */
  missedSessionIndex: number;
  /** Session the rotation would be on today if the miss is skipped (what FOLLOW_SCHEDULE jumps to). */
  calendarSessionIndex: number;
  /** Local date the missed session had been due. */
  missedScheduledDate: string;
  /** Local date this conflict was first detected. */
  detectedOnDate: string;
}

/** Runtime cursor. Scoped to a single programId — never carried over to a new program (docs §Troca de programa). */
export interface ScheduleState {
  programId: string;
  /** 0-based index into `program.sessions` — the next session the rotation owes the user. */
  nextSessionIndex: number;
  /** Local date the rotation was last walked through (inclusive). Only advances on COMPLETED/MISS_RESOLVED, never on a mere read. */
  cursorDate: string;
  lastCompletedAt: string | null;
  pendingMissDecision: PendingMissDecision | null;
}

export type ScheduleResolution =
  | { status: 'PROGRAM_NOT_AVAILABLE' }
  | { status: 'SCHEDULE_SETUP_REQUIRED' }
  /** Today isn't a trainingDay. `nextWorkoutDate`/`nextSessionIndex` are the calendar's and the rotation's answer to "when/what next" (docs §Próximo treino != próximo dia) — never re-derived independently by callers. */
  | { status: 'REST_DAY'; nextWorkoutDate: string; nextSessionIndex: number }
  | { status: 'ACTIVE_RECOVERY_DAY'; nextWorkoutDate: string; nextSessionIndex: number }
  /** Today IS a trainingDay and its session was already completed — distinct from REST_DAY so the UI never conflates "nothing scheduled" with "already done" (docs §Conclusão diária). */
  | { status: 'TODAY_COMPLETED'; nextWorkoutDate: string; nextSessionIndex: number }
  | { status: 'SESSION_READY'; sessionIndex: number }
  | {
      status: 'MISSED_SESSION_DECISION_REQUIRED';
      missedSessionIndex: number;
      calendarSessionIndex: number;
    };

export interface ResolveWorkoutScheduleInput {
  hasActiveProgram: boolean;
  sessionCount: number;
  config: ScheduleConfig | null;
  /** null means the program has never been walked yet (freshly activated). */
  state: Pick<ScheduleState, 'nextSessionIndex' | 'cursorDate' | 'pendingMissDecision' | 'lastCompletedAt'> | null;
  /** Local activation date (YYYY-MM-DD) of the active program; used only when `state` is null. */
  activatedAtLocalDate: string;
  /** Local "today" (YYYY-MM-DD), already resolved in the user's timezone by the caller. */
  todayLocalDate: string;
  /**
   * `scheduledDate` of a miss occurrence that already has a `MISS_RESOLVED`
   * ledger event (docs §Decisão idempotente) — derived by the caller from
   * `scheduleEvents` via the deterministic `scheduleEventId`, never a second
   * source of truth. When the current walk's `occurrences[0]` matches this
   * date, that exact gap already received a decision (CONTINUE_SEQUENCE or
   * FOLLOW_SCHEDULE) and must not be re-asked — CONTINUE_SEQUENCE's contract
   * is "keep offering the missed session," not "re-litigate it on every
   * subsequent read." A genuinely NEW miss can only arise once `cursorDate`
   * itself advances (a real completion), which always produces a different
   * `occurrences[0]`.
   */
  resolvedMissScheduledDate?: string | null;
}
