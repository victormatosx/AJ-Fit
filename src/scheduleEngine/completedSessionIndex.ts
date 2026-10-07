/** A finished execution is the source of the completed session's identity. */
export function completedSessionIndexForLocalDate(
  executions: readonly {
    status: string;
    programInstanceId?: string | null;
    scheduledLocalDate: string;
    sessionIndex: number;
  }[],
  programInstanceId: string | null,
  localDate: string,
  sessionCount: number,
): number | null {
  const completed = executions.find((item) =>
    (item.status === 'COMPLETED' || item.status === 'PARTIALLY_COMPLETED')
    && (programInstanceId ? item.programInstanceId === programInstanceId : !item.programInstanceId)
    && item.scheduledLocalDate === localDate
    && Number.isInteger(item.sessionIndex)
    && item.sessionIndex >= 0
    && item.sessionIndex < sessionCount,
  );
  return completed?.sessionIndex ?? null;
}
