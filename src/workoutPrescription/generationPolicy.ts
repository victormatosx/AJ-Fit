import type { PrescriptionResult, QuestionnaireAnswers } from './types';

type PrescriptionFailure = Exclude<PrescriptionResult, { status: 'SUCCESS' }>;

/**
 * DR-006 is resolved by Limitation Resolver V1. Kept as a compatibility
 * seam for callers compiled against the earlier gate; real failures now come
 * from the resolver's deterministic reason codes.
 */
export function limitationReadinessFailure(
  _answers: QuestionnaireAnswers,
): PrescriptionFailure | null {
  return null;
}
