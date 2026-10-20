/**
 * A finished execution is the source of the completed session's identity.
 *
 * Matched on the date the session was actually PERFORMED, not the opportunity
 * it was scheduled for: an advanced session carries a `scheduledLocalDate` in
 * the future, so matching that date found nothing on the day the user
 * actually trained — and the Treino card, whose title, muscle list, body map
 * and metrics all derive from this session, rendered empty. Executions
 * written before `performedLocalDate` existed omit it and are read as if both
 * dates were equal (see `WorkoutExecution`'s own doc comment).
 */
export function completedSessionIndexForLocalDate(
  executions: readonly {
    status: string;
    programInstanceId?: string | null;
    scheduledLocalDate: string;
    performedLocalDate?: string;
    sessionIndex: number;
  }[],
  programInstanceId: string | null,
  localDate: string,
  sessionCount: number,
): number | null {
  const completed = executions.find((item) =>
    (item.status === 'COMPLETED' || item.status === 'PARTIALLY_COMPLETED')
    && (programInstanceId ? item.programInstanceId === programInstanceId : !item.programInstanceId)
    && (item.performedLocalDate ?? item.scheduledLocalDate) === localDate
    && Number.isInteger(item.sessionIndex)
    && item.sessionIndex >= 0
    && item.sessionIndex < sessionCount,
  );
  return completed?.sessionIndex ?? null;
}
