/**
 * Support tickets/messages/attachments — Fase 8 §6/§7/§9/§10/§12.
 *
 * Schema audited from `firestore.rules` (`supportTicketValid`/
 * `supportMessageValid`, §465-512) and `src/services/supportTickets.ts` —
 * never invented:
 *   - `supportTickets/{ticketId}`: `id, userId, userName, userEmail, type,
 *     subject, status, priority, lastMessage, createdAt, updatedAt,
 *     appVersion, platform, osVersion, deviceModel, language,
 *     attachmentsCount`. No `photoURL` field on the ticket itself.
 *   - `supportTickets/{ticketId}/messages/{messageId}`: `senderType,
 *     senderId, message, attachments (≤1, {url, path, type}), createdAt,
 *     readAt`.
 *   - Attachment objects live in Storage at
 *     `users/{uid}/support/{ticketId}/attachments/*` — the exact prefix
 *     Fase 7's `StorageCleanupEngine` was deliberately built to never touch
 *     (see `../storageCleanup/resources.ts`'s doc comment). This module is
 *     the ONLY place a future DELETE policy for support could authorize
 *     removing those objects.
 *
 * `userId` is the ownership field — tickets are found by querying
 * `supportTickets` where `userId == uid`, never by trusting a caller-
 * supplied ticket id list.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

import { storage as defaultStorage } from '../../lib/firebaseAdmin';
import type { RetentionAction } from '../types';
import { UnsupportedRetentionActionError } from './types';
import type { RetainedDataCategoryResult } from './types';

const SUPPORT_TICKETS_COLLECTION = 'supportTickets';
const PAGE_SIZE = 200;

function supportAttachmentsPrefix(uid: string): string {
  return `users/${uid}/support/`;
}

/**
 * Every `supportTickets` doc owned by `uid` — paginated by document ID so an
 * unbounded number of tickets never loads more than one page at a time.
 * Ownership is always `userId == uid`, queried fresh, never a caller-
 * supplied list.
 */
async function findOwnedTicketIds(db: Firestore, uid: string): Promise<string[]> {
  const ids: string[] = [];
  let lastId: string | null = null;

  for (;;) {
    let query = db
      .collection(SUPPORT_TICKETS_COLLECTION)
      .where('userId', '==', uid)
      .orderBy('__name__')
      .limit(PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) ids.push(doc.id);
    lastId = snapshot.docs[snapshot.docs.length - 1].id;
    if (snapshot.size < PAGE_SIZE) break;
  }

  return ids;
}

async function deleteMessagesSubcollection(db: Firestore, ticketId: string): Promise<void> {
  const messagesRef = db.collection(SUPPORT_TICKETS_COLLECTION).doc(ticketId).collection('messages');

  for (;;) {
    const snapshot = await messagesRef.orderBy('__name__').limit(PAGE_SIZE).get();
    if (snapshot.empty) return;

    const writer = db.bulkWriter();
    for (const doc of snapshot.docs) writer.delete(doc.ref);
    await writer.close();

    if (snapshot.size < PAGE_SIZE) return;
  }
}

async function deleteAttachmentObjects(storage: Storage, uid: string): Promise<void> {
  const bucket = storage.bucket();
  const prefix = supportAttachmentsPrefix(uid);
  let pageToken: string | undefined;

  for (;;) {
    const query: { prefix: string; maxResults: number; autoPaginate: false; pageToken?: string } = {
      prefix,
      maxResults: 500,
      autoPaginate: false,
      ...(pageToken ? { pageToken } : {}),
    };
    const [files, nextQuery] = await bucket.getFiles(query);

    if (files.length > 0) {
      await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
    }

    // See Fase 7's `deletePrefixObjects.ts`: the real Storage Emulator
    // returns `null` (not `{}`) once there is nothing left to paginate.
    pageToken = nextQuery && 'pageToken' in nextQuery ? nextQuery.pageToken : undefined;
    if (!pageToken) break;
  }
}

async function deleteOwnedTickets(
  db: Firestore,
  storage: Storage,
  uid: string,
  ticketIds: string[],
): Promise<void> {
  for (const ticketId of ticketIds) {
    await deleteMessagesSubcollection(db, ticketId);
    await db.collection(SUPPORT_TICKETS_COLLECTION).doc(ticketId).delete();
  }
  // One prefix delete covers every ticket's attachments at once — Storage
  // has no per-ticket atomicity to preserve here, and this stays idempotent
  // (missing prefix = 0 objects = success) regardless of how far a prior,
  // interrupted attempt got.
  await deleteAttachmentObjects(storage, uid);
}

export async function processSupportRetention(
  uid: string,
  action: RetentionAction,
  deps: { db: Firestore; storage?: Storage },
): Promise<RetainedDataCategoryResult> {
  const { db } = deps;
  const storage = deps.storage ?? defaultStorage;

  if (action === 'ANONYMIZE') {
    throw new UnsupportedRetentionActionError('support', action);
  }

  if (action === 'DELETE') {
    const ticketIds = await findOwnedTicketIds(db, uid);
    if (ticketIds.length === 0) {
      // Still run the attachment-prefix delete: a ticket doc could have been
      // removed by a prior, interrupted attempt while its attachments
      // survived — idempotency means finishing that leftover work, not
      // stopping early because Firestore looks empty.
      await deleteAttachmentObjects(storage, uid);
      return { category: 'support', action, outcome: 'ALREADY_ABSENT', resourceCount: 0 };
    }

    await deleteOwnedTickets(db, storage, uid, ticketIds);
    return { category: 'support', action, outcome: 'DELETED', resourceCount: ticketIds.length };
  }

  // RETAIN / SKIP: no mutation. The inventory read is observability only —
  // it proves this step ran and looked, never a precondition for the
  // (absent) destructive action.
  const ticketIds = await findOwnedTicketIds(db, uid);
  return { category: 'support', action, outcome: 'RETAINED', resourceCount: ticketIds.length };
}
