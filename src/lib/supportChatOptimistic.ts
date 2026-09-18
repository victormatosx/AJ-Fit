/**
 * Pure state transitions for the Support V2 chat optimistic-send UX
 * (perf audit, 2026-09-17). Kept framework-free and side-effect-free on
 * purpose: `SupportCaseDetailScreen.tsx` cannot be rendered in this
 * project's test suite (no React Native test renderer — see
 * `src/screens/__tests__`), so the actual reconciliation logic lives here,
 * where it can be exercised with real assertions instead of source-text
 * matching.
 *
 * Reconciliation key is ALWAYS `requestId` (the client-generated idempotency
 * key, persisted by the backend on `messages/{messageId}.requestId` — see
 * `functions/src/supportV2/supportV2.ts`), never message text or a
 * timestamp: two messages with identical text sent seconds apart must never
 * be confused with one another.
 */

export type OptimisticStatus = 'SENDING' | 'SENT' | 'FAILED';

export interface OptimisticAttachment {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface OptimisticSupportMessage {
  requestId: string;
  message: string;
  attachment: OptimisticAttachment | null;
  /** Cached once staging succeeds, so a retry after a failed/timed-out send never re-uploads the same file. */
  uploadId?: string;
  status: OptimisticStatus;
  createdAtMs: number;
}

export function createOptimisticMessage(
  requestId: string,
  message: string,
  attachment: OptimisticAttachment | null,
  nowMs: number,
): OptimisticSupportMessage {
  return { requestId, message, attachment, status: 'SENDING', createdAtMs: nowMs };
}

export function addOptimisticMessage(
  pending: readonly OptimisticSupportMessage[],
  item: OptimisticSupportMessage,
): OptimisticSupportMessage[] {
  if (pending.some((existing) => existing.requestId === item.requestId)) return [...pending];
  return [...pending, item];
}

export function setOptimisticStatus(
  pending: readonly OptimisticSupportMessage[],
  requestId: string,
  status: OptimisticStatus,
): OptimisticSupportMessage[] {
  return pending.map((item) => (item.requestId === requestId ? { ...item, status } : item));
}

export function setOptimisticUploadId(
  pending: readonly OptimisticSupportMessage[],
  requestId: string,
  uploadId: string,
): OptimisticSupportMessage[] {
  return pending.map((item) => (item.requestId === requestId ? { ...item, uploadId } : item));
}

/**
 * Marks a FAILED entry back to SENDING for a retry, reusing the exact same
 * `requestId` (and any already-cached `uploadId`) — never a new one.
 * No-op for anything that isn't currently FAILED (guards a double tap on the
 * same retry affordance from starting the request twice).
 */
export function retryOptimisticMessage(
  pending: readonly OptimisticSupportMessage[],
  requestId: string,
): OptimisticSupportMessage[] {
  return pending.map((item) => (
    item.requestId === requestId && item.status === 'FAILED' ? { ...item, status: 'SENDING' } : item
  ));
}

/**
 * Drops every optimistic entry whose `requestId` has already arrived through
 * the realtime listener as a persisted message — regardless of that entry's
 * local status. This is what lets a message that looks FAILED client-side
 * (e.g. the callable timed out) resolve to SENT the moment the listener
 * proves the write actually committed, without ever showing a duplicate
 * bubble once the persisted one is visible.
 */
export function reconcileOptimisticMessages(
  pending: readonly OptimisticSupportMessage[],
  persistedRequestIds: ReadonlySet<string>,
): OptimisticSupportMessage[] {
  const next = pending.filter((item) => !persistedRequestIds.has(item.requestId));
  return next.length === pending.length ? [...pending] : next;
}
