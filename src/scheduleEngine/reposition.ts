/**
 * Session indexes the rotation walks past when moving its anchor. Walking is
 * always forward through the cyclic prescription; choosing an earlier visual
 * index therefore wraps through the end of the split. The selected target is
 * not included because it remains the next session to perform.
 */
export function repositionedSessionIndexes(
  currentSessionIndex: number,
  targetSessionIndex: number,
  sessionCount: number,
): number[] {
  if (!Number.isInteger(sessionCount) || sessionCount <= 0) throw new Error('INVALID_REPOSITION_SESSION_COUNT');
  if (!Number.isInteger(currentSessionIndex) || currentSessionIndex < 0 || currentSessionIndex >= sessionCount) {
    throw new Error('INVALID_REPOSITION_CURRENT_SESSION_INDEX');
  }
  if (!Number.isInteger(targetSessionIndex) || targetSessionIndex < 0 || targetSessionIndex >= sessionCount) {
    throw new Error('INVALID_REPOSITION_TARGET_SESSION_INDEX');
  }
  const result: number[] = [];
  let index = currentSessionIndex;
  while (index !== targetSessionIndex) {
    result.push(index);
    index = (index + 1) % sessionCount;
  }
  return result;
}
