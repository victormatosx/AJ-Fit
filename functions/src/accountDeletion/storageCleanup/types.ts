/**
 * Types for the Storage Cleanup Engine — Fase 7.
 */

/** Result of hard-deleting one Storage resource category. No PII — a prefix label and a count. */
export interface StorageResourceCleanupResult {
  resource: string;
  deletedCount: number;
  alreadyAbsent: boolean;
}
