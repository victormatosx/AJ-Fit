import { useEffect, useRef, useState } from 'react';
import {
  addOptimisticMessage,
  createOptimisticMessage,
  reconcileOptimisticMessages,
  retryOptimisticMessage,
  setOptimisticStatus,
  setOptimisticUploadId,
  type OptimisticAttachment,
  type OptimisticSupportMessage,
} from '../lib/supportChatOptimistic';
import {
  requestId as createRequestId,
  sendSupportChatMessage,
  stageSupportChatAttachment,
  type SupportMessage,
} from '../services/supportCases';

export interface OptimisticSupportChatController {
  /** Returns false if there was nothing to send, or a send was already being submitted this tick (double-tap guard) — the caller should NOT clear its draft in that case. */
  send(message: string, attachment: OptimisticAttachment | null): boolean;
  retry(item: OptimisticSupportMessage): void;
}

/**
 * The testable core behind `useOptimisticSupportChat` — plain functions with
 * no React dependency, so this can be unit-tested with mocked service calls
 * directly (`src/hooks/__tests__/useOptimisticSupportChat.test.ts`), the
 * same way `SupportCaseDetailScreen` itself can't be (no React Native test
 * renderer in this project).
 */
export function createOptimisticSupportChatController(
  caseId: string,
  getPending: () => readonly OptimisticSupportMessage[],
  setPending: (next: OptimisticSupportMessage[]) => void,
): OptimisticSupportChatController {
  let submitting = false;

  async function dispatchSend(
    reqId: string,
    message: string,
    attachment: OptimisticAttachment | null,
    cachedUploadId: string | undefined,
  ) {
    try {
      let uploadId = cachedUploadId;
      if (attachment && !uploadId) {
        uploadId = await stageSupportChatAttachment(attachment);
        setPending(setOptimisticUploadId(getPending(), reqId, uploadId));
      }
      await sendSupportChatMessage(caseId, message, undefined, { requestId: reqId, stagedUploadId: uploadId });
      setPending(setOptimisticStatus(getPending(), reqId, 'SENT'));
    } catch {
      // Recoverable: the bubble stays visible as FAILED with a retry
      // affordance instead of silently dropping the message. If the backend
      // actually committed despite this error (timeout after commit), the
      // reconciliation effect in the hook still resolves this to the real
      // message once the listener catches up.
      setPending(setOptimisticStatus(getPending(), reqId, 'FAILED'));
    }
  }

  function send(message: string, attachment: OptimisticAttachment | null): boolean {
    const clean = message.trim();
    if ((!clean && !attachment) || submitting) return false;
    submitting = true;
    const reqId = createRequestId();
    setPending(addOptimisticMessage(getPending(), createOptimisticMessage(reqId, clean, attachment, Date.now())));
    submitting = false;
    void dispatchSend(reqId, clean, attachment, undefined);
    return true;
  }

  function retry(item: OptimisticSupportMessage) {
    if (item.status !== 'FAILED') return;
    setPending(retryOptimisticMessage(getPending(), item.requestId));
    void dispatchSend(item.requestId, item.message, item.attachment, item.uploadId);
  }

  return { send, retry };
}

/**
 * Owns the Support V2 chat optimistic-send state for a single case (perf
 * audit, 2026-09-17): a bubble appears the instant "Enviar" is tapped, the
 * backend call runs in parallel, and the bubble is reconciled away the
 * moment the realtime listener (`messages`) delivers the persisted message
 * with the same `requestId` — see `src/lib/supportChatOptimistic.ts` for the
 * state-transition rules and `createOptimisticSupportChatController` above
 * for the send/retry wiring.
 */
export function useOptimisticSupportChat(caseId: string, messages: readonly SupportMessage[]) {
  const [pending, setPending] = useState<OptimisticSupportMessage[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const controllerRef = useRef<OptimisticSupportChatController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createOptimisticSupportChatController(caseId, () => pendingRef.current, setPending);
  }

  // Reconciliation: the ONLY key is requestId, matched against what the
  // realtime listener just delivered — never message text or a timestamp.
  // This also covers "Firestore committed but the callable response was
  // lost/timed out": the moment the persisted message shows up here, the
  // optimistic entry is dropped regardless of whether it was still SENDING
  // or had already been marked FAILED.
  useEffect(() => {
    const persistedRequestIds = new Set(messages.map(item => item.requestId).filter((value): value is string => !!value));
    setPending(prev => reconcileOptimisticMessages(prev, persistedRequestIds));
  }, [messages]);

  return { pending, send: controllerRef.current.send, retry: controllerRef.current.retry };
}
