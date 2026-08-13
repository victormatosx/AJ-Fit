import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { getLocales } from 'expo-localization';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../lib/firebase';
import type { CreateSupportTicketInput } from '../types/support';

function deviceModel(): string {
  const constants = Platform.constants as unknown as Record<string, unknown>;
  const value = constants.Model ?? constants.model ?? constants.interfaceIdiom;
  return typeof value === 'string' ? value : 'unknown';
}

function extensionFor(fileName?: string | null, mimeType?: string | null) {
  const named = fileName?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (named) return named;
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

async function uploadAttachment(input: CreateSupportTicketInput, ticketId: string) {
  if (!input.attachment) return [];
  const attachmentId = doc(collection(db, '_ids')).id;
  const extension = extensionFor(input.attachment.fileName, input.attachment.mimeType);
  const path = `users/${input.userId}/support/${ticketId}/attachments/${attachmentId}.${extension}`;
  const objectRef = ref(storage, path);

  if (Platform.OS === 'web') {
    const response = await fetch(input.attachment.uri);
    if (!response.ok) throw new Error('support/attachment-read-failed');
    const contentType = input.attachment.mimeType || response.headers.get('content-type') || 'image/jpeg';
    await uploadBytes(objectRef, await response.bytes(), {
      contentType,
      customMetadata: { ownerId: input.userId, ticketId },
    });
    return [{ url: await getDownloadURL(objectRef), path, type: 'IMAGE' }];
  }

  const file = new File(input.attachment.uri);
  if (!file.exists || !file.size) throw new Error('support/attachment-read-failed');
  if (file.size > 8 * 1024 * 1024) throw new Error('support/attachment-too-large');
  const contentType = input.attachment.mimeType || file.type || 'image/jpeg';
  const bucket = storage.app.options.storageBucket;
  const currentUser = auth.currentUser;
  if (!bucket || !currentUser || currentUser.uid !== input.userId) {
    throw new Error('support/attachment-auth-unavailable');
  }
  const token = await currentUser.getIdToken();
  const authorization = `Firebase ${token}`;
  const startResponse = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(path)}`,
    {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size),
        'X-Goog-Upload-Header-Content-Type': contentType,
      },
      body: JSON.stringify({
        name: path,
        contentType,
        metadata: { ownerId: input.userId, ticketId },
      }),
    },
  );
  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!startResponse.ok || !uploadUrl) throw new Error('support/attachment-upload-start-failed');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error('support/attachment-upload-failed');
  return [{ url: await getDownloadURL(objectRef), path, type: 'IMAGE' }];
}

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<string> {
  const ticketRef = doc(collection(db, 'supportTickets'));
  const messageRef = doc(collection(ticketRef, 'messages'));
  const attachments = await uploadAttachment(input, ticketRef.id);
  const now = serverTimestamp();
  const locale = getLocales()[0];
  const batch = writeBatch(db);

  batch.set(ticketRef, {
    id: ticketRef.id,
    userId: input.userId,
    userName: input.userName,
    userEmail: input.userEmail,
    type: input.type,
    subject: input.subject,
    status: 'OPEN',
    priority: 'NORMAL',
    lastMessage: input.message,
    createdAt: now,
    updatedAt: now,
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    deviceModel: deviceModel(),
    language: locale?.languageTag ?? 'unknown',
    attachmentsCount: attachments.length,
  });
  batch.set(messageRef, {
    senderType: 'USER',
    senderId: input.userId,
    message: input.message,
    attachments,
    createdAt: now,
    readAt: null,
  });
  await batch.commit();
  return ticketRef.id;
}
