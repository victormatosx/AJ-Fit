import { createHash, randomUUID } from 'node:crypto';

import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { requireActiveAccount } from '../accountDeletion/activeAccountGuard';
import { requireAdminUid } from '../attribution/adminAuth';
import { requireAuth, requireVerifiedEmailForPrivateAccess } from '../lib/auth';
import { db, storage } from '../lib/firebaseAdmin';
import { dispatchNotification } from '../notifications/dispatcher';

export const SUPPORT_CASES_COLLECTION = 'supportCases';
export const SUPPORT_MESSAGES_SUBCOLLECTION = 'messages';
/** `kind: 'SINGLE' | 'START_CHAT' | 'CLOSE_CHAT'` decision receipts, doc-id-aligned with the message they gate — see adminTransition() and onSupportAdminMessageCreated (supportV2Triggers.ts). */
export const SUPPORT_ACTIONS_SUBCOLLECTION = '_actions';
export const SUPPORT_UPLOADS_COLLECTION = 'supportUploadSessions';
export const SUPPORT_RATE_LIMITS_COLLECTION = 'supportRateLimits';
export const SUPPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SUPPORT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const SUPPORT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const CASE_TYPES = ['BUG', 'FEEDBACK', 'SUPPORT'] as const;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

type SupportCaseType = (typeof CASE_TYPES)[number];
type SupportState = 'SUBMITTED' | 'CLOSED_SINGLE' | 'CHAT_OPEN' | 'CHAT_CLOSED';
type Input = Record<string, unknown>;

function input(request: CallableRequest<unknown>): Input {
  if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
    throw new HttpsError('invalid-argument', 'invalid_payload');
  }
  return request.data as Input;
}

function stringField(data: Input, key: string, min: number, max: number): string {
  const value = data[key];
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `invalid_${key}`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) {
    throw new HttpsError('invalid-argument', `invalid_${key}`);
  }
  return clean;
}

function optionalString(data: Input, key: string, max: number): string | null {
  const value = data[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new HttpsError('invalid-argument', `invalid_${key}`);
  }
  return value;
}

/** Same bounds as `stringField(data, 'message', 1, 5000)` but empty/absent is allowed — a chat/single-reply message may be image-only. */
function optionalMessage(data: Input): string {
  const value = data.message;
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'invalid_message');
  const clean = value.trim();
  if (clean.length > 5000) throw new HttpsError('invalid-argument', 'invalid_message');
  return clean;
}

function requestId(data: Input): string {
  const value = stringField(data, 'requestId', 8, 128);
  if (!SAFE_ID.test(value)) throw new HttpsError('invalid-argument', 'invalid_requestId');
  return value;
}

function deterministicId(scope: string, uid: string, id: string): string {
  return createHash('sha256').update(`${scope}:${uid}:${id}`).digest('hex').slice(0, 40);
}

function requireUser(request: CallableRequest<unknown>): string {
  const uid = requireAuth(request);
  requireVerifiedEmailForPrivateAccess(request);
  return uid;
}

function rateLimitRef(uid: string, scope: string) {
  return db.collection(SUPPORT_RATE_LIMITS_COLLECTION).doc(`${uid}_${scope}`);
}

/**
 * Same check-and-write the rate limit has always done, split out of the
 * `transaction.get` so a caller that already has the snapshot (e.g. fetched
 * together with other reads in one `Promise.all`) doesn't pay a second,
 * sequential round trip for it. Atomicity/abuse-protection are unchanged:
 * this still runs inside the same transaction, and the write still only
 * happens after every other read that transaction needs.
 */
function applyRateLimit(
  transaction: Transaction,
  ref: FirebaseFirestore.DocumentReference,
  snapshot: FirebaseFirestore.DocumentSnapshot,
  uid: string,
  scope: string,
  now: Timestamp,
  limit: number,
  windowMs: number,
): void {
  const previous = snapshot.data();
  const windowStartedAt = previous?.windowStartedAt instanceof Timestamp
    ? previous.windowStartedAt as Timestamp
    : null;
  const sameWindow = windowStartedAt && now.toMillis() - windowStartedAt.toMillis() < windowMs;
  const count = sameWindow && typeof previous?.count === 'number' ? previous.count : 0;
  if (count >= limit) throw new HttpsError('resource-exhausted', 'support_rate_limit');
  transaction.set(ref, {
    ownerUid: uid,
    scope,
    count: count + 1,
    windowStartedAt: sameWindow ? windowStartedAt : now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + windowMs * 2),
  });
}

async function consumeRateLimit(
  transaction: Transaction,
  uid: string,
  scope: string,
  now: Timestamp,
  limit: number,
  windowMs: number,
): Promise<void> {
  const ref = rateLimitRef(uid, scope);
  const snapshot = await transaction.get(ref);
  applyRateLimit(transaction, ref, snapshot, uid, scope, now, limit, windowMs);
}

async function userProfile(uid: string): Promise<{ name: string; email: string }> {
  const snapshot = await db.collection('users').doc(uid).get();
  const data = snapshot.data() ?? {};
  const nested = data.profile && typeof data.profile === 'object'
    ? data.profile as Record<string, unknown>
    : {};
  const name = typeof nested.name === 'string' ? nested.name
    : typeof data.name === 'string' ? data.name
      : typeof data.displayName === 'string' ? data.displayName : 'Usuário';
  const email = typeof nested.email === 'string' ? nested.email
    : typeof data.email === 'string' ? data.email : '';
  return { name: name.slice(0, 80), email: email.slice(0, 254) };
}

/**
 * Shared staging logic behind both prepareSupportAttachmentUploadHandler
 * (mobile, App-Check-enforced) and adminPrepareSupportAttachmentUploadHandler
 * (Admin Web, role-enforced instead — see the two exported handlers below
 * for why there are two entry points and not one relaxed one).
 */
async function stageSupportAttachmentUpload(uid: string, data: Input) {
  const idempotencyKey = requestId(data);
  const mimeType = stringField(data, 'mimeType', 5, 80).toLowerCase();
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new HttpsError('invalid-argument', 'unsupported_attachment_type');
  }
  const uploadId = deterministicId('support-upload', uid, idempotencyKey);
  // Extension-free, server-issued path lets Storage Rules bind the complete
  // final segment directly to supportUploadSessions/{uploadId}.
  const storagePath = `users/${uid}/support-v2/staged/${uploadId}`;
  const ref = db.collection(SUPPORT_UPLOADS_COLLECTION).doc(uploadId);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.ownerUid !== uid || existing.data()?.mimeType !== mimeType) {
        throw new HttpsError('already-exists', 'idempotency_conflict');
      }
      return;
    }
    await consumeRateLimit(transaction, uid, 'upload', now, 10, 60 * 60 * 1000);
    transaction.create(ref, {
      ownerUid: uid,
      mimeType,
      storagePath,
      status: 'STAGED',
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + SUPPORT_UPLOAD_TTL_MS),
    });
  });
  return { uploadId, storagePath, expiresAt: now.toMillis() + SUPPORT_UPLOAD_TTL_MS };
}

/** Mobile entry point — deployed with `enforceAppCheck: true` (see index.ts). */
export async function prepareSupportAttachmentUploadHandler(request: CallableRequest<unknown>) {
  const uid = requireUser(request);
  await requireActiveAccount(uid);
  return stageSupportAttachmentUpload(uid, input(request));
}

/**
 * Admin Web entry point. Admin Web has no App Check provider configured
 * (see index.ts, same reasoning as the other admin* callables), so it
 * cannot call the mobile entry point above — that previously surfaced as
 * "Unauthenticated" the moment attachments were added to the admin
 * composer. Authorization here comes from `requireAdminUid` (fresh
 * server-side admin-role check) instead of App Check attestation; every
 * other guarantee (rate limit, MIME/size, STAGED/anti-overwrite, Storage
 * Rules) is the exact same `stageSupportAttachmentUpload` used by mobile —
 * this is not a second, more permissive attachment system.
 */
export async function adminPrepareSupportAttachmentUploadHandler(request: CallableRequest<unknown>) {
  const adminUid = await requireAdminUid(request);
  await requireActiveAccount(adminUid);
  return stageSupportAttachmentUpload(adminUid, input(request));
}

async function validateUpload(uid: string, uploadId: string | null) {
  if (!uploadId) return null;
  if (!SAFE_ID.test(uploadId)) throw new HttpsError('invalid-argument', 'invalid_uploadId');
  const ref = db.collection(SUPPORT_UPLOADS_COLLECTION).doc(uploadId);
  const snapshot = await ref.get();
  const session = snapshot.data();
  if (!snapshot.exists || session?.ownerUid !== uid || session?.status !== 'STAGED') {
    throw new HttpsError('failed-precondition', 'attachment_session_unavailable');
  }
  if (!(session.expiresAt instanceof Timestamp) || session.expiresAt.toMillis() <= Date.now()) {
    throw new HttpsError('deadline-exceeded', 'attachment_session_expired');
  }
  const [metadata] = await storage.bucket().file(session.storagePath).getMetadata()
    .catch(() => { throw new HttpsError('failed-precondition', 'attachment_upload_incomplete'); });
  const size = Number(metadata.size);
  if (!Number.isFinite(size) || size <= 0 || size > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'attachment_size_invalid');
  }
  if (metadata.contentType !== session.mimeType || metadata.metadata?.ownerId !== uid || metadata.metadata?.uploadId !== uploadId) {
    throw new HttpsError('permission-denied', 'attachment_metadata_invalid');
  }
  return { ref, session, size };
}

export async function createSupportCaseHandler(request: CallableRequest<unknown>) {
  const uid = requireUser(request);
  await requireActiveAccount(uid);
  const data = input(request);
  const idempotencyKey = requestId(data);
  const type = stringField(data, 'type', 3, 20) as SupportCaseType;
  if (!(CASE_TYPES as readonly string[]).includes(type)) throw new HttpsError('invalid-argument', 'invalid_type');
  const subject = stringField(data, 'subject', 3, 100);
  const message = stringField(data, 'message', 10, 5000);
  const uploadId = optionalString(data, 'uploadId', 128);
  const upload = await validateUpload(uid, uploadId);
  const profile = await userProfile(uid);
  const caseId = deterministicId('support-case', uid, idempotencyKey);
  const messageId = deterministicId('support-first-message', uid, idempotencyKey);
  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);
  const messageRef = caseRef.collection('messages').doc(messageId);
  const now = Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(caseRef);
    if (existing.exists) {
      if (existing.data()?.ownerUid !== uid || existing.data()?.createRequestId !== idempotencyKey) {
        throw new HttpsError('already-exists', 'idempotency_conflict');
      }
      return;
    }
    if (upload) {
      const currentUpload = await transaction.get(upload.ref);
      if (currentUpload.data()?.ownerUid !== uid || currentUpload.data()?.status !== 'STAGED') {
        throw new HttpsError('failed-precondition', 'attachment_already_consumed');
      }
    }
    await consumeRateLimit(transaction, uid, 'create-case', now, 5, 60 * 60 * 1000);
    transaction.create(caseRef, {
      id: caseId,
      ownerUid: uid,
      userName: profile.name,
      userEmail: profile.email,
      type,
      subject,
      state: 'SUBMITTED' satisfies SupportState,
      mode: null,
      priority: 'NORMAL',
      lastMessage: message,
      lastMessageAt: now,
      lastSenderType: 'USER',
      unreadByUserCount: 0,
      attachmentCount: upload ? 1 : 0,
      createRequestId: idempotencyKey,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      purgeAt: null,
      schemaVersion: 2,
      client: {
        appVersion: optionalString(data, 'appVersion', 40) ?? 'unknown',
        platform: optionalString(data, 'platform', 20) ?? 'unknown',
        osVersion: optionalString(data, 'osVersion', 40) ?? 'unknown',
        deviceModel: optionalString(data, 'deviceModel', 100) ?? 'unknown',
        language: optionalString(data, 'language', 30) ?? 'unknown',
      },
    });
    const attachment = upload ? [{
      uploadId,
      storagePath: upload.session.storagePath,
      mimeType: upload.session.mimeType,
      size: upload.size,
      type: 'IMAGE',
    }] : [];
    transaction.create(messageRef, {
      senderType: 'USER', senderId: uid, message, attachments: attachment,
      createdAt: now, readAt: null, requestId: idempotencyKey,
    });
    if (upload) transaction.update(upload.ref, {
      status: 'ATTACHED', caseId, messageId, attachedAt: now,
      expiresAt: null,
    });
  });
  return { caseId, messageId, state: 'SUBMITTED' };
}

/** Exported for `onSupportAdminMessageCreated` (supportV2Triggers.ts) — the only other caller. */
export async function notifyUser(params: { uid: string; caseId: string; messageId: string; type: 'SUPPORT_SINGLE_REPLY' | 'SUPPORT_CHAT_MESSAGE' }) {
  const single = params.type === 'SUPPORT_SINGLE_REPLY';
  await dispatchNotification({
    uid: params.uid,
    notificationId: `${params.type}:${params.messageId}`,
    sourceIdentity: `supportMessage:${params.messageId}`,
    idempotencyKey: `notification:${params.uid}:${params.type}:${params.messageId}`,
    type: params.type,
    category: 'OPERATIONAL',
    title: single ? 'Resposta do suporte AJ Fit' : 'Nova mensagem do suporte AJ Fit',
    body: single ? 'Sua solicitação foi respondida. Abra o app para visualizar.' : 'Você recebeu uma nova mensagem. Abra o app para visualizar.',
    intent: 'support-case',
    data: { caseId: params.caseId, messageId: params.messageId },
  });
}

async function adminTransition(
  request: CallableRequest<unknown>,
  kind: 'SINGLE' | 'START_CHAT' | 'CLOSE_CHAT',
) {
  const adminUid = await requireAdminUid(request);
  await requireActiveAccount(adminUid);
  const data = input(request);
  const caseId = stringField(data, 'caseId', 8, 128);
  const idempotencyKey = requestId(data);
  const message = kind === 'SINGLE' ? optionalMessage(data) : null;
  const uploadId = kind === 'SINGLE' ? optionalString(data, 'uploadId', 128) : null;
  if (kind === 'SINGLE' && !message && !uploadId) {
    throw new HttpsError('invalid-argument', 'message_or_attachment_required');
  }
  const upload = kind === 'SINGLE' ? await validateUpload(adminUid, uploadId) : null;
  const messageId = deterministicId(`support-${kind}`, adminUid, idempotencyKey);
  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);
  const messageRef = caseRef.collection('messages').doc(messageId);
  const actionRef = caseRef.collection('_actions').doc(messageId);
  const now = Timestamp.now();
  let idempotent = false;
  await db.runTransaction(async (transaction) => {
    const [caseSnapshot, existingAction] = await Promise.all([
      transaction.get(caseRef),
      transaction.get(actionRef),
    ]);
    if (!caseSnapshot.exists) throw new HttpsError('not-found', 'support_case_not_found');
    const current = caseSnapshot.data()!;
    if (existingAction.exists && existingAction.data()?.requestId === idempotencyKey && existingAction.data()?.kind === kind) {
      idempotent = true;
      return;
    }
    if (kind === 'SINGLE') {
      if (current.state !== 'SUBMITTED' || current.mode !== null) throw new HttpsError('aborted', 'support_case_already_decided');
      if (upload) {
        // Same re-check createSupportCaseHandler already relies on: the
        // pre-transaction validateUpload() call is a fast-path read, this is
        // the authoritative anti-overwrite/anti-reuse check inside the
        // transaction that actually attaches the object to a message.
        const currentUpload = await transaction.get(upload.ref);
        if (currentUpload.data()?.ownerUid !== adminUid || currentUpload.data()?.status !== 'STAGED') {
          throw new HttpsError('failed-precondition', 'attachment_already_consumed');
        }
      }
      const purgeAt = Timestamp.fromMillis(now.toMillis() + SUPPORT_RETENTION_MS);
      const attachments = upload ? [{ uploadId, storagePath: upload.session.storagePath, mimeType: upload.session.mimeType, size: upload.size, type: 'IMAGE' }] : [];
      transaction.create(messageRef, { senderType: 'ADMIN', senderId: adminUid, message, attachments, createdAt: now, readAt: null, requestId: idempotencyKey });
      transaction.update(caseRef, { state: 'CLOSED_SINGLE', mode: 'SINGLE_REPLY', decidedAt: now, closedAt: now, purgeAt, lastMessage: message || '📷', lastMessageAt: now, lastSenderType: 'ADMIN', unreadByUserCount: FieldValue.increment(1), updatedAt: now });
      if (upload) transaction.update(upload.ref, { status: 'ATTACHED', caseId, messageId, attachedAt: now, expiresAt: null });
    } else if (kind === 'START_CHAT') {
      if (current.state !== 'SUBMITTED' || current.mode !== null) throw new HttpsError('aborted', 'support_case_already_decided');
      const assignedAdminUid = typeof current.assignedAdminUid === 'string' ? current.assignedAdminUid : null;
      if (assignedAdminUid && assignedAdminUid !== adminUid) throw new HttpsError('aborted', 'support_case_assigned_to_another_admin');
      transaction.update(caseRef, {
        state: 'CHAT_OPEN', mode: 'CHAT', decidedAt: now,
        assignedAdminUid: adminUid, assignedAt: current.assignedAt ?? now, updatedAt: now,
      });
    } else {
      if (current.state !== 'CHAT_OPEN' || current.mode !== 'CHAT') throw new HttpsError('failed-precondition', 'support_chat_not_open');
      transaction.update(caseRef, { state: 'CHAT_CLOSED', closedAt: now, purgeAt: Timestamp.fromMillis(now.toMillis() + SUPPORT_RETENTION_MS), closedBy: adminUid, updatedAt: now });
    }
    transaction.create(actionRef, { kind, requestId: idempotencyKey, adminUid, createdAt: now });
  });
  // Push to the user is no longer awaited here — it is out of the critical
  // path. `onSupportAdminMessageCreated` (see supportV2Triggers.ts) fires
  // off the `messages/{messageId}` document commit itself and sends the
  // SUPPORT_SINGLE_REPLY push, using this same `_actions/{messageId}` write
  // to tell a SINGLE reply apart from a CHAT message.
  return { caseId, messageId: kind === 'SINGLE' ? messageId : null, idempotent };
}

export const adminReplyAndCloseSupportCaseHandler = (request: CallableRequest<unknown>) => adminTransition(request, 'SINGLE');
export const adminStartSupportChatHandler = (request: CallableRequest<unknown>) => adminTransition(request, 'START_CHAT');
export const adminCloseSupportChatHandler = (request: CallableRequest<unknown>) => adminTransition(request, 'CLOSE_CHAT');

async function sendSupportChatMessage(request: CallableRequest<unknown>, adminOnly: boolean) {
  const uid = requireUser(request);
  const data = input(request);
  const caseId = stringField(data, 'caseId', 8, 128);
  const message = optionalMessage(data);
  const uploadId = optionalString(data, 'uploadId', 128);
  if (!message && !uploadId) throw new HttpsError('invalid-argument', 'message_or_attachment_required');
  const idempotencyKey = requestId(data);

  // `requireActiveAccount` (accountDeletionLocks/{uid}) and the role check
  // below (users/{uid}) are independent documents — read in parallel instead
  // of two sequential round trips. On the admin path, `requireAdminUid`
  // already re-verifies the role server-side via its own users/{uid} read,
  // so that result is reused as `isAdmin` instead of issuing a second,
  // redundant read of the same document right after.
  let isAdmin: boolean;
  if (adminOnly) {
    await Promise.all([requireAdminUid(request), requireActiveAccount(uid)]);
    isAdmin = true;
  } else {
    const [, userSnapshot] = await Promise.all([
      requireActiveAccount(uid),
      db.collection('users').doc(uid).get(),
    ]);
    isAdmin = userSnapshot.data()?.metadata?.role === 'admin';
  }

  const upload = await validateUpload(uid, uploadId);
  const messageId = deterministicId('support-chat-message', uid, idempotencyKey);
  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);
  const messageRef = caseRef.collection('messages').doc(messageId);
  const rateLimitDocRef = rateLimitRef(uid, 'chat-message');
  const now = Timestamp.now();
  let idempotent = false;
  await db.runTransaction(async (transaction) => {
    // Rate-limit doc batched into the same initial round trip as caseRef and
    // messageRef — same read, same decision, same write as before
    // (`applyRateLimit` below), just no longer a separate sequential get.
    const [caseSnapshot, existing, rateLimitSnapshot] = await Promise.all([
      transaction.get(caseRef),
      transaction.get(messageRef),
      transaction.get(rateLimitDocRef),
    ]);
    if (!caseSnapshot.exists) throw new HttpsError('not-found', 'support_case_not_found');
    const supportCase = caseSnapshot.data()!;
    const ownerUid = supportCase.ownerUid;
    if (!isAdmin && ownerUid !== uid) throw new HttpsError('permission-denied', 'support_case_owner_required');
    if (existing.exists && existing.data()?.requestId === idempotencyKey) { idempotent = true; return; }
    if (supportCase.state !== 'CHAT_OPEN' || supportCase.mode !== 'CHAT') throw new HttpsError('failed-precondition', 'support_chat_not_open');
    if (upload) {
      // Same anti-overwrite/anti-reuse re-check as createSupportCaseHandler
      // and adminTransition('SINGLE') — the pre-transaction validateUpload()
      // call above is only a fast-path read.
      const currentUpload = await transaction.get(upload.ref);
      if (currentUpload.data()?.ownerUid !== uid || currentUpload.data()?.status !== 'STAGED') {
        throw new HttpsError('failed-precondition', 'attachment_already_consumed');
      }
    }
    applyRateLimit(transaction, rateLimitDocRef, rateLimitSnapshot, uid, 'chat-message', now, isAdmin ? 120 : 30, 10 * 60 * 1000);
    const senderType = isAdmin ? 'ADMIN' : 'USER';
    const attachments = upload ? [{ uploadId, storagePath: upload.session.storagePath, mimeType: upload.session.mimeType, size: upload.size, type: 'IMAGE' }] : [];
    transaction.create(messageRef, { senderType, senderId: uid, message, attachments, createdAt: now, readAt: null, requestId: idempotencyKey });
    transaction.update(caseRef, { lastMessage: message || '📷', lastMessageAt: now, lastSenderType: senderType, unreadByUserCount: isAdmin ? FieldValue.increment(1) : supportCase.unreadByUserCount ?? 0, updatedAt: now });
    if (upload) transaction.update(upload.ref, { status: 'ATTACHED', caseId, messageId, attachedAt: now, expiresAt: null });
  });
  // Push to the user is handled asynchronously by onSupportAdminMessageCreated
  // (supportV2Triggers.ts) once this transaction's messages/{messageId}
  // write actually commits — never awaited here.
  return { caseId, messageId, idempotent };
}

export const sendSupportChatMessageHandler = (request: CallableRequest<unknown>) => sendSupportChatMessage(request, false);
export const adminSendSupportChatMessageHandler = (request: CallableRequest<unknown>) => sendSupportChatMessage(request, true);

export async function markSupportMessageReadHandler(request: CallableRequest<unknown>) {
  const uid = requireUser(request);
  await requireActiveAccount(uid);
  const data = input(request);
  const caseId = stringField(data, 'caseId', 8, 128);
  const messageId = stringField(data, 'messageId', 8, 128);
  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);
  const messageRef = caseRef.collection('messages').doc(messageId);
  await db.runTransaction(async (transaction) => {
    const [caseSnapshot, messageSnapshot] = await Promise.all([transaction.get(caseRef), transaction.get(messageRef)]);
    if (!caseSnapshot.exists || caseSnapshot.data()?.ownerUid !== uid) throw new HttpsError('permission-denied', 'support_case_owner_required');
    if (!messageSnapshot.exists) throw new HttpsError('not-found', 'support_message_not_found');
    if (messageSnapshot.data()?.senderType !== 'ADMIN') throw new HttpsError('failed-precondition', 'only_admin_messages_are_read_receipts');
    if (messageSnapshot.data()?.readAt) return;
    transaction.update(messageRef, { readAt: Timestamp.now() });
    transaction.update(caseRef, { unreadByUserCount: Math.max(0, Number(caseSnapshot.data()?.unreadByUserCount ?? 0) - 1) });
  });
  return { caseId, messageId, read: true };
}

async function getSupportAttachmentAccess(request: CallableRequest<unknown>, adminOnly: boolean) {
  if (adminOnly) await requireAdminUid(request);
  const uid = requireUser(request);
  await requireActiveAccount(uid);
  const data = input(request);
  const caseId = stringField(data, 'caseId', 8, 128);
  const messageId = stringField(data, 'messageId', 8, 128);
  const storagePath = stringField(data, 'storagePath', 20, 500);
  const [caseSnapshot, messageSnapshot, userSnapshot] = await Promise.all([
    db.doc(`${SUPPORT_CASES_COLLECTION}/${caseId}`).get(),
    db.doc(`${SUPPORT_CASES_COLLECTION}/${caseId}/messages/${messageId}`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  if (!caseSnapshot.exists || !messageSnapshot.exists) throw new HttpsError('not-found', 'support_attachment_not_found');
  const isAdmin = userSnapshot.data()?.metadata?.role === 'admin';
  if (adminOnly && !isAdmin) throw new HttpsError('permission-denied', 'admin_role_required');
  if (!isAdmin && caseSnapshot.data()?.ownerUid !== uid) throw new HttpsError('permission-denied', 'support_case_owner_required');
  const attachments = messageSnapshot.data()?.attachments;
  if (!Array.isArray(attachments) || !attachments.some((attachment) => attachment?.storagePath === storagePath)) {
    throw new HttpsError('permission-denied', 'support_attachment_not_bound_to_message');
  }
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const [url] = await storage.bucket().file(storagePath).getSignedUrl({ action: 'read', expires: expiresAt });
  return { url, expiresAt };
}

export const getSupportAttachmentAccessHandler = (request: CallableRequest<unknown>) => getSupportAttachmentAccess(request, false);
export const adminGetSupportAttachmentAccessHandler = (request: CallableRequest<unknown>) => getSupportAttachmentAccess(request, true);

export function supportCleanupToken(): string { return randomUUID(); }
