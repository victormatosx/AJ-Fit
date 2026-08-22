/**
 * Types for the Firestore Cleanup Engine — Fase 6.
 */

/** Result of hard-deleting one resource category. No PII — a count and two booleans. */
export interface ResourceCleanupResult {
  resource: string;
  deletedCount: number;
  /** `true` when there was nothing to delete at all — logical success, not a distinct code path (Fase 6 §15/§16). */
  alreadyAbsent: boolean;
}
