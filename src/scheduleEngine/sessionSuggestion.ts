/**
 * Session suggestion — the rotation under the new training model.
 *
 * The calendar no longer gates anything: the user may start ANY session of
 * their active program on ANY day, and the app's only job is to remember what
 * to offer next. That is a single circular pointer:
 *
 *     offer A → user picks A → offer B → user picks B → offer C → offer A …
 *
 * ## The one rule that makes double-advance impossible
 *
 * Both intentional SELECTION and durable COMPLETION resolve to the exact same
 * assignment:
 *
 *     suggestedSessionIndex = (sessionIndex + 1) % sessionCount
 *
 * It is idempotent by construction, so none of these can ever advance twice:
 *
 *  - selecting B and then finishing B (completion recomputes the same C);
 *  - selecting B twice (still C, never D);
 *  - a retried/redelivered finalize for the same session;
 *  - a cold-start recovery that re-finalizes an already-terminal execution.
 *
 * There is deliberately no "consumed" flag to keep in sync — the arithmetic
 * is the guarantee.
 *
 * ## Selecting is not training
 *
 * `selectSession` never writes an execution, never emits a COMPLETED event,
 * never touches loads, frequency or the streak. Abandoning the session the
 * user selected leaves the suggestion where the selection put it, by product
 * decision: the user already told us what they intend to do next.
 *
 * ## Late finalize vs. a newer selection
 *
 * A finalize can arrive after the user has already selected something else
 * (slow network, cold-start recovery, second device). Honouring it blindly
 * would drag the suggestion backwards, away from the user's most recent
 * intent. So every intentional selection bumps a monotonic `version`, the
 * execution carries the version it was started from, and a completion only
 * moves the pointer while no newer selection has happened. The completion
 * itself is still fully recorded — only the suggestion is left alone.
 */

export interface SessionSuggestion {
  /** The session the app offers next. Always a valid index into `sessions[]`. */
  suggestedSessionIndex: number;
  /** Monotonic, bumped by every intentional selection. Never decreases. */
  version: number;
  /** Last session the user intentionally chose; `null` before any selection. */
  lastSelectedSessionIndex: number | null;
}

export function isValidSessionIndex(value: unknown, sessionCount: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < sessionCount;
}

/** The circular successor — the single formula both selection and completion use. */
export function suggestionAfter(sessionIndex: number, sessionCount: number): number {
  return sessionCount > 0 ? (((sessionIndex + 1) % sessionCount) + sessionCount) % sessionCount : 0;
}

/**
 * Normalizes whatever is persisted into a usable suggestion.
 *
 * Reads the legacy `nextSessionIndex` when the new field is absent: under the
 * old model that field already meant "the next session the rotation owes",
 * which is exactly this pointer, so every existing account keeps its place
 * with no migration. A corrupted or out-of-range value degrades to session 0
 * rather than leaving the user unable to train.
 */
export function readSessionSuggestion(
  stored: { suggestedSessionIndex?: unknown; nextSessionIndex?: unknown; suggestionVersion?: unknown;
    lastSelectedSessionIndex?: unknown } | null | undefined,
  sessionCount: number,
): SessionSuggestion {
  const persisted = stored?.suggestedSessionIndex ?? stored?.nextSessionIndex;
  return {
    suggestedSessionIndex: isValidSessionIndex(persisted, sessionCount) ? persisted : 0,
    version: Number.isInteger(stored?.suggestionVersion) && (stored!.suggestionVersion as number) >= 0
      ? stored!.suggestionVersion as number
      : 0,
    lastSelectedSessionIndex: isValidSessionIndex(stored?.lastSelectedSessionIndex, sessionCount)
      ? stored!.lastSelectedSessionIndex as number
      : null,
  };
}

export type SuggestionTransition =
  | { status: 'APPLIED'; suggestion: SessionSuggestion }
  /** Nothing to persist — the pointer already says this. */
  | { status: 'UNCHANGED'; suggestion: SessionSuggestion }
  | { status: 'REJECTED'; reason: 'SESSION_INDEX_OUT_OF_RANGE' | 'STALE_SUGGESTION_VERSION' };

/**
 * The user intentionally chose `sessionIndex`.
 *
 * Always advances the pointer past it and bumps the version. Re-selecting the
 * session the pointer already followed is reported `UNCHANGED` so a repeated
 * tap costs no write — and, critically, cannot walk the rotation forward
 * again.
 *
 * Merely rendering a card or opening the Home must never call this: only an
 * explicit, user-initiated choice does.
 */
export function selectSession(
  current: SessionSuggestion,
  sessionIndex: number,
  sessionCount: number,
): SuggestionTransition {
  if (!isValidSessionIndex(sessionIndex, sessionCount)) {
    return { status: 'REJECTED', reason: 'SESSION_INDEX_OUT_OF_RANGE' };
  }
  const suggestedSessionIndex = suggestionAfter(sessionIndex, sessionCount);
  if (current.suggestedSessionIndex === suggestedSessionIndex
    && current.lastSelectedSessionIndex === sessionIndex) {
    return { status: 'UNCHANGED', suggestion: current };
  }
  return {
    status: 'APPLIED',
    suggestion: { suggestedSessionIndex, version: current.version + 1, lastSelectedSessionIndex: sessionIndex },
  };
}

/**
 * A session was durably completed.
 *
 * Applies the same assignment as a selection but WITHOUT bumping the version
 * (a completion is not a new intent), and only while the execution's own
 * `startedFromVersion` still matches the stored one — so a late finalize
 * never overrides a selection the user made in the meantime.
 *
 * `startedFromVersion` is omitted for executions created before the field
 * existed; those are treated as current, reproducing the previous behavior
 * (the completion advances the rotation) instead of silently refusing.
 */
export function completeSession(
  current: SessionSuggestion,
  input: { sessionIndex: number; sessionCount: number; startedFromVersion?: number },
): SuggestionTransition {
  if (!isValidSessionIndex(input.sessionIndex, input.sessionCount)) {
    return { status: 'REJECTED', reason: 'SESSION_INDEX_OUT_OF_RANGE' };
  }
  if (input.startedFromVersion !== undefined && input.startedFromVersion !== current.version) {
    return { status: 'REJECTED', reason: 'STALE_SUGGESTION_VERSION' };
  }
  const suggestedSessionIndex = suggestionAfter(input.sessionIndex, input.sessionCount);
  if (current.suggestedSessionIndex === suggestedSessionIndex) {
    return { status: 'UNCHANGED', suggestion: current };
  }
  return {
    status: 'APPLIED',
    suggestion: { ...current, suggestedSessionIndex },
  };
}
