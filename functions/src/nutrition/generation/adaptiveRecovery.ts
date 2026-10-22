/** Closed, bounded audit facts; never inspect AI prose to grant credit. */
export interface RecoveryEvent {
  callNumber: number; attempt: number; role: 'creator' | 'reviewer';
  code: string | null; reviewStatus: string | null;
}
const recoverableCreatorCodes = new Set([
  'AI_SCHEMA_INVALID', 'AI_CONTENT_SAFETY_MISMATCH', 'AI_MACRO_VALIDATION_FAILED',
  'AI_EVIDENCE_INSUFFICIENT', 'AI_CATALOG_RESOLUTION_FAILED',
]);
export function recoveryEligible(history: readonly RecoveryEvent[]): boolean {
  if (history.length !== 3) return false;
  const [first, corrected, review] = history;
  return first.callNumber === 1 && first.attempt === 1 && first.role === 'creator'
    && recoverableCreatorCodes.has(first.code ?? '') && first.reviewStatus === null
    && corrected.callNumber === 2 && corrected.attempt === 2 && corrected.role === 'creator'
    && corrected.code === null && corrected.reviewStatus === null
    && review.callNumber === 3 && review.attempt === 2 && review.role === 'reviewer'
    && (review.code === 'AI_REVIEW_REJECTED' && review.reviewStatus === 'rejected'
      || review.code === 'AI_REVIEW_INSUFFICIENT_INFORMATION' && review.reviewStatus === 'insufficient_information');
}
export function recoveryReviewAllowed(history: readonly RecoveryEvent[]): boolean {
  return history.length === 4 && recoveryEligible(history.slice(0, 3))
    && history[3].callNumber === 4 && history[3].attempt === 3
    && history[3].role === 'creator' && history[3].code === null && history[3].reviewStatus === null;
}
