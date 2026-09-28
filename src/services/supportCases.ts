import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
  type DocumentData, type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';

import { auth, db, storage } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import {
  closeSupportAttachmentUploadBlob,
  openSupportAttachmentUploadBlob,
} from './supportAttachmentUploadBlob';
import type { CreateSupportTicketInput } from '../types/support';

export type SupportCaseState = 'SUBMITTED' | 'CLOSED_SINGLE' | 'CHAT_OPEN' | 'CHAT_CLOSED' | 'ACCOUNT_DELETION';
export type SupportCaseMode = null | 'SINGLE_REPLY' | 'CHAT';
export interface SupportCase {
  id: string;
  ownerUid: string;
  type: string;
  subject: string;
  state: SupportCaseState;
  mode: SupportCaseMode;
  lastMessage: string;
  lastMessageAt?: { toDate(): Date };
  unreadByUserCount: number;
  updatedAt?: { toDate(): Date };
  closedAt?: { toDate(): Date } | null;
  purgeAt?: { toDate(): Date } | null;
}
export interface SupportMessage {
  id: string;
  senderType: 'USER' | 'ADMIN';
  senderId: string;
  message: string;
  attachments: { storagePath: string; mimeType: string; type: 'IMAGE' }[];
  createdAt?: { toDate(): Date };
  readAt?: { toDate(): Date } | null;
  /** Set by the backend from the client-supplied idempotency key — the only key optimistic-UI reconciliation is allowed to match on (never text/timestamp). */
  requestId?: string;
}

function mapDocument<T>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

/** Exported so the optimistic-UI screen can mint a requestId up front and reuse the exact same one across retries. */
export function requestId(): string {
  return doc(collection(db, '_clientIds')).id;
}

function deviceModel(): string {
  const constants = Platform.constants as unknown as Record<string, unknown>;
  const value = constants.Model ?? constants.model ?? constants.interfaceIdiom;
  return typeof value === 'string' ? value : 'unknown';
}

async function uploadPreparedAttachment(
  attachment: NonNullable<CreateSupportTicketInput['attachment']>,
): Promise<string> {
  const mimeType = (attachment.mimeType || 'image/jpeg').toLowerCase();
  const prepare = httpsCallable<
    { requestId: string; mimeType: string },
    { uploadId: string; storagePath: string }
  >(functions, 'prepareSupportAttachmentUpload');
  const prepared = (await prepare({ requestId: requestId(), mimeType })).data;
  const objectRef = ref(storage, prepared.storagePath);
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('support/attachment-auth-unavailable');
  const metadata = { contentType: mimeType, customMetadata: { ownerId: currentUser.uid, uploadId: prepared.uploadId } };

  if (Platform.OS === 'web') {
    const response = await fetch(attachment.uri);
    if (!response.ok) throw new Error('support/attachment-read-failed');
    await uploadBytes(objectRef, await response.bytes(), metadata);
    return prepared.uploadId;
  }

  const file = new File(attachment.uri);
  if (!file.exists || !file.size) throw new Error('support/attachment-read-failed');
  if (file.size > 8 * 1024 * 1024) throw new Error('support/attachment-too-large');

  // React Native cannot create a Blob from an ArrayBuffer/ArrayBufferView,
  // so the file is opened as a native-backed Blob via XHR instead of using
  // File's binary-buffer reader. See supportAttachmentUploadBlob.ts.
  const blob = await openSupportAttachmentUploadBlob(attachment.uri);
  try {
    if (blob.size > 8 * 1024 * 1024) throw new Error('support/attachment-too-large');
    // Going through the Firebase SDK is security-critical: it attaches both
    // Firebase Auth and the initialized App Check token to Storage requests.
    await uploadBytes(objectRef, blob, metadata);
    return prepared.uploadId;
  } finally {
    closeSupportAttachmentUploadBlob(blob);
  }
}

/** Compatibility signature for SupportFormScreen; caller identity fields are ignored. */
export async function createSupportCase(input: CreateSupportTicketInput): Promise<string> {
  const uploadId = input.attachment ? await uploadPreparedAttachment(input.attachment) : undefined;
  const create = httpsCallable<Record<string, unknown>, { caseId: string }>(functions, 'createSupportCase');
  const locale = getLocales()[0];
  const result = await create({
    requestId: requestId(), type: input.type, subject: input.subject, message: input.message, uploadId,
    appVersion: Constants.expoConfig?.version ?? 'unknown', platform: Platform.OS,
    osVersion: String(Platform.Version), deviceModel: deviceModel(), language: locale?.languageTag ?? 'unknown',
  });
  return result.data.caseId;
}

export function observeOwnSupportCases(uid: string, onData: (cases: SupportCase[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'supportCases'), where('ownerUid', '==', uid), orderBy('updatedAt', 'desc'), limit(50)),
    snapshot => onData(snapshot.docs.map(item => mapDocument<SupportCase>(item))),
    onError,
  );
}

export function observeSupportCase(caseId: string, onData: (value: SupportCase | null) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(db, 'supportCases', caseId), snapshot => onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as SupportCase : null), onError);
}

export function observeSupportMessages(caseId: string, onData: (messages: SupportMessage[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'supportCases', caseId, 'messages'), orderBy('createdAt', 'asc')), snapshot => onData(snapshot.docs.map(item => mapDocument<SupportMessage>(item))), onError);
}

/** Exported so a retry can stage the attachment once and reuse the same uploadId — never a second upload for the same optimistic message. */
export async function stageSupportChatAttachment(
  attachment: NonNullable<CreateSupportTicketInput['attachment']>,
): Promise<string> {
  return uploadPreparedAttachment(attachment);
}

export async function sendSupportChatMessage(
  caseId: string,
  message: string,
  attachment?: CreateSupportTicketInput['attachment'] | null,
  options?: { requestId?: string; stagedUploadId?: string },
): Promise<{ messageId: string; uploadId?: string }> {
  const uploadId = options?.stagedUploadId ?? (attachment ? await uploadPreparedAttachment(attachment) : undefined);
  const send = httpsCallable<Record<string, unknown>, { caseId: string; messageId: string; idempotent: boolean }>(functions, 'sendSupportChatMessage');
  const result = await send({ caseId, message: message.trim(), uploadId, requestId: options?.requestId ?? requestId() });
  return { messageId: result.data.messageId, uploadId };
}

export async function markSupportMessageRead(caseId: string, messageId: string): Promise<void> {
  const mark = httpsCallable(functions, 'markSupportMessageRead');
  await mark({ caseId, messageId });
}

export async function getSupportAttachmentAccess(caseId: string, messageId: string, storagePath: string): Promise<string> {
  const access = httpsCallable<Record<string, string>, { url: string }>(functions, 'getSupportAttachmentAccess');
  return (await access({ caseId, messageId, storagePath })).data.url;
}
