/**
 * Push for Support V2 admin messages, moved OFF the `sendSupportChatMessage`/
 * `adminReplyAndCloseSupportCase` callables' critical path (perf audit,
 * 2026-09-17): those callables used to `await notifyUser(...)` — a full
 * `dispatchNotification` pipeline (claim transaction, device-eligibility
 * query, an external HTTP call to Expo, and a persist transaction) — before
 * returning to the admin's browser. That is exactly why "suporte → user"
 * felt slow while being functionally correct.
 *
 * DESIGN: an `onDocumentCreated` trigger on
 * `supportCases/{caseId}/messages/{messageId}`, the same "commit boundary"
 * pattern as `accountDeletion/immediateDispatch.ts` — Eventarc only fires
 * after the triggering write is durably committed, so this can never run
 * before the message transaction (`sendSupportChatMessage`/
 * `adminTransition('SINGLE')` in supportV2.ts) has actually succeeded, and
 * it never re-fires for a message that was *not* newly created:
 *   - An idempotent retry of either callable takes the early-return branch
 *     and never calls `transaction.create(messageRef, ...)` again, so this
 *     trigger never re-fires for that `messageId` — no dedup logic needed
 *     here beyond what `dispatchNotification` already does internally
 *     (`claimDispatch`'s `idempotencyKey`), which stays untouched.
 *   - SINGLE vs CHAT: `adminTransition('SINGLE')` writes the message and its
 *     `_actions/{messageId}` decision receipt with the SAME id, in the same
 *     transaction (see supportV2.ts). `sendSupportChatMessage` never writes
 *     an `_actions` doc. So an `_actions/{messageId}` doc existing with
 *     `kind === 'SINGLE'` is the exact same signal `adminTransition` used to
 *     decide `SUPPORT_SINGLE_REPLY` vs `SUPPORT_CHAT_MESSAGE` — reproduced
 *     here without adding any new field to the message document itself
 *     (payload/content/schema of `messages/{messageId}` is unchanged).
 *   - Only `senderType === 'ADMIN'` messages push — a user's own message to
 *     support never did, and still never does.
 */

import { onDocumentCreated, type FirestoreEvent, type QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';

import { db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  SUPPORT_ACTIONS_SUBCOLLECTION,
  SUPPORT_CASES_COLLECTION,
  notifyUser,
} from './supportV2';

const SCOPE = 'supportV2.onSupportAdminMessageCreated';

/** Testable core, independent of the `onDocumentCreated` wiring below. */
export async function handleSupportAdminMessageCreated(
  caseId: string,
  messageId: string,
  snapshot: QueryDocumentSnapshot,
): Promise<void> {
  const message = snapshot.data();
  if (message?.senderType !== 'ADMIN') return;

  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);
  const [caseSnapshot, actionSnapshot] = await Promise.all([
    caseRef.get(),
    caseRef.collection(SUPPORT_ACTIONS_SUBCOLLECTION).doc(messageId).get(),
  ]);
  const ownerUid = caseSnapshot.data()?.ownerUid;
  if (typeof ownerUid !== 'string' || !ownerUid) {
    logFunctionError(SCOPE, new Error('support_case_owner_missing'), { caseId, messageId });
    return;
  }

  const isSingleReply = actionSnapshot.exists && actionSnapshot.data()?.kind === 'SINGLE';
  await notifyUser({
    uid: ownerUid,
    caseId,
    messageId,
    type: isSingleReply ? 'SUPPORT_SINGLE_REPLY' : 'SUPPORT_CHAT_MESSAGE',
  });
  logInfo(SCOPE, 'support_admin_message_push_dispatched', {
    caseId,
    messageId,
    type: isSingleReply ? 'SUPPORT_SINGLE_REPLY' : 'SUPPORT_CHAT_MESSAGE',
  });
}

export const onSupportAdminMessageCreated = onDocumentCreated(
  {
    document: `${SUPPORT_CASES_COLLECTION}/{caseId}/messages/{messageId}`,
    retry: true,
  },
  async (event: FirestoreEvent<QueryDocumentSnapshot | undefined, { caseId: string; messageId: string }>) => {
    if (!event.data) return;
    await handleSupportAdminMessageCreated(event.params.caseId, event.params.messageId, event.data);
  },
);
