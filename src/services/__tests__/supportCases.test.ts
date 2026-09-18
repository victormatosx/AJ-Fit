import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: new Map<string, { size: number; type: string; exists: boolean }>(),
  storageRef: vi.fn(),
  uploadBytes: vi.fn(),
  openBlob: vi.fn(),
  closeBlob: vi.fn(),
  httpsCallable: vi.fn(),
  prepare: vi.fn(),
  create: vi.fn(),
  sendChat: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
  File: class FakeFile {
    readonly uri: string;
    constructor(uri: string) { this.uri = uri; }
    get size() { return mocks.files.get(this.uri)?.size ?? 0; }
    get type() { return mocks.files.get(this.uri)?.type ?? ''; }
    get exists() { return mocks.files.get(this.uri)?.exists ?? false; }
  },
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0' } } }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'pt-BR' }] }));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '18.0', constants: { Model: 'iPhone' } },
}));

vi.mock('firebase/firestore', () => ({
  collection: (...path: unknown[]) => ({ path }),
  doc: () => ({ id: 'req-1' }),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => mocks.httpsCallable(name),
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => {
    mocks.storageRef(path);
    return { path };
  },
  uploadBytes: (...args: unknown[]) => mocks.uploadBytes(...args),
}));

vi.mock('../supportAttachmentUploadBlob', () => ({
  openSupportAttachmentUploadBlob: (...args: unknown[]) => mocks.openBlob(...args),
  closeSupportAttachmentUploadBlob: (...args: unknown[]) => mocks.closeBlob(...args),
}));

vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: { uid: 'alice' } },
  db: {},
  storage: {},
}));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));

import { createSupportCase, sendSupportChatMessage } from '../supportCases';
import type { CreateSupportTicketInput } from '../../types/support';

const SUPPORT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const nativeBlob = { size: 1_024, type: 'image/jpeg', close: vi.fn() } as unknown as Blob;

function baseInput(overrides: Partial<CreateSupportTicketInput> = {}): CreateSupportTicketInput {
  return {
    userId: 'alice',
    userName: 'Alice',
    userEmail: 'alice@example.com',
    type: 'BUG',
    subject: 'subject',
    message: 'message',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.files.set('file:///cache/picker/photo.jpg', { size: 1_024, type: 'image/jpeg', exists: true });
  mocks.openBlob.mockResolvedValue(nativeBlob);
  mocks.httpsCallable.mockImplementation((name: string) => {
    if (name === 'prepareSupportAttachmentUpload') return mocks.prepare;
    if (name === 'createSupportCase') return mocks.create;
    if (name === 'sendSupportChatMessage') return mocks.sendChat;
    throw new Error(`unexpected callable: ${name}`);
  });
  mocks.prepare.mockResolvedValue({ data: { uploadId: 'upload-1', storagePath: 'supportUploads/alice/upload-1' } });
  mocks.create.mockResolvedValue({ data: { caseId: 'case-1' } });
  mocks.sendChat.mockResolvedValue({ data: { caseId: 'case-1', messageId: 'message-1' } });
  mocks.uploadBytes.mockResolvedValue(undefined);
});

describe('createSupportCase attachment upload (mobile)', () => {
  it('creates a case with no attachment and never touches Storage', async () => {
    const caseId = await createSupportCase(baseInput());

    expect(caseId).toBe('case-1');
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ uploadId: undefined }));
  });

  it('uploads a JPEG attachment as a native Blob, not an ArrayBuffer', async () => {
    const caseId = await createSupportCase(baseInput({
      attachment: { uri: 'file:///cache/picker/photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg' },
    }));

    expect(mocks.openBlob).toHaveBeenCalledWith('file:///cache/picker/photo.jpg');
    expect(mocks.uploadBytes).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'supportUploads/alice/upload-1' }),
      nativeBlob,
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(ArrayBuffer.isView(mocks.uploadBytes.mock.calls[0]?.[1])).toBe(false);
    expect(mocks.closeBlob).toHaveBeenCalledWith(nativeBlob);
    expect(caseId).toBe('case-1');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'upload-1' }));
  });

  it('uploads a PNG attachment as a native Blob', async () => {
    mocks.files.set('file:///cache/picker/photo.png', { size: 2_048, type: 'image/png', exists: true });
    mocks.openBlob.mockResolvedValueOnce({ size: 2_048, type: 'image/png', close: vi.fn() } as unknown as Blob);

    await createSupportCase(baseInput({
      attachment: { uri: 'file:///cache/picker/photo.png', fileName: 'photo.png', mimeType: 'image/png' },
    }));

    expect(mocks.uploadBytes).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ contentType: 'image/png' }),
    );
  });

  it('accepts a file at the 8MB limit', async () => {
    mocks.files.set('file:///cache/picker/max.jpg', { size: SUPPORT_ATTACHMENT_MAX_BYTES, type: 'image/jpeg', exists: true });
    mocks.openBlob.mockResolvedValueOnce({ size: SUPPORT_ATTACHMENT_MAX_BYTES, close: vi.fn() } as unknown as Blob);

    await expect(createSupportCase(baseInput({
      attachment: { uri: 'file:///cache/picker/max.jpg', mimeType: 'image/jpeg' },
    }))).resolves.toBe('case-1');
  });

  it('rejects a file over the 8MB limit before opening the native Blob', async () => {
    mocks.files.set('file:///cache/picker/huge.jpg', { size: SUPPORT_ATTACHMENT_MAX_BYTES + 1, type: 'image/jpeg', exists: true });

    await expect(createSupportCase(baseInput({
      attachment: { uri: 'file:///cache/picker/huge.jpg', mimeType: 'image/jpeg' },
    }))).rejects.toThrow('support/attachment-too-large');

    expect(mocks.openBlob).not.toHaveBeenCalled();
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not create the support case when the Storage upload fails', async () => {
    mocks.uploadBytes.mockRejectedValueOnce(new Error('storage/unauthorized'));

    await expect(createSupportCase(baseInput({
      attachment: { uri: 'file:///cache/picker/photo.jpg', mimeType: 'image/jpeg' },
    }))).rejects.toThrow('storage/unauthorized');

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.closeBlob).toHaveBeenCalledWith(nativeBlob);
  });

  it('requests a fresh prepared upload/storagePath on retry instead of reusing the failed one', async () => {
    mocks.uploadBytes.mockRejectedValueOnce(new Error('storage/unauthorized'));
    mocks.prepare
      .mockResolvedValueOnce({ data: { uploadId: 'upload-1', storagePath: 'supportUploads/alice/upload-1' } })
      .mockResolvedValueOnce({ data: { uploadId: 'upload-2', storagePath: 'supportUploads/alice/upload-2' } });

    const attempt1 = createSupportCase(baseInput({
      attachment: { uri: 'file:///cache/picker/photo.jpg', mimeType: 'image/jpeg' },
    }));
    await expect(attempt1).rejects.toThrow('storage/unauthorized');

    const caseId = await createSupportCase(baseInput({
      attachment: { uri: 'file:///cache/picker/photo.jpg', mimeType: 'image/jpeg' },
    }));

    expect(caseId).toBe('case-1');
    expect(mocks.storageRef).toHaveBeenNthCalledWith(1, 'supportUploads/alice/upload-1');
    expect(mocks.storageRef).toHaveBeenNthCalledWith(2, 'supportUploads/alice/upload-2');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'upload-2' }));
  });

  it('contains no ArrayBuffer upload path for native platforms', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/supportCases.ts', 'utf8');
    expect(source).not.toContain('.arrayBuffer()');
  });
});

describe('sendSupportChatMessage attachment upload (mobile)', () => {
  it('sends a text-only chat message and never touches Storage', async () => {
    await sendSupportChatMessage('case-1', 'Só texto.');

    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
    expect(mocks.sendChat).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-1', message: 'Só texto.', uploadId: undefined }));
  });

  it('sends an image-only chat message as a native Blob, not an ArrayBuffer', async () => {
    await sendSupportChatMessage('case-1', '', {
      uri: 'file:///cache/picker/photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg',
    });

    expect(mocks.openBlob).toHaveBeenCalledWith('file:///cache/picker/photo.jpg');
    expect(mocks.uploadBytes).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'supportUploads/alice/upload-1' }),
      nativeBlob,
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(ArrayBuffer.isView(mocks.uploadBytes.mock.calls[0]?.[1])).toBe(false);
    expect(mocks.closeBlob).toHaveBeenCalledWith(nativeBlob);
    expect(mocks.sendChat).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-1', message: '', uploadId: 'upload-1' }));
  });

  it('sends a text + image chat message, uploading before calling the callable', async () => {
    await sendSupportChatMessage('case-1', 'Segue o print.', {
      uri: 'file:///cache/picker/photo.jpg', mimeType: 'image/jpeg',
    });

    expect(mocks.uploadBytes).toHaveBeenCalledOnce();
    expect(mocks.sendChat).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-1', message: 'Segue o print.', uploadId: 'upload-1' }));
  });

  it('does not call the callable when the Storage upload fails (no orphaned message)', async () => {
    mocks.uploadBytes.mockRejectedValueOnce(new Error('storage/unauthorized'));

    await expect(sendSupportChatMessage('case-1', '', {
      uri: 'file:///cache/picker/photo.jpg', mimeType: 'image/jpeg',
    })).rejects.toThrow('storage/unauthorized');

    expect(mocks.sendChat).not.toHaveBeenCalled();
    expect(mocks.closeBlob).toHaveBeenCalledWith(nativeBlob);
  });

  it('rejects a chat image over the 8MB limit before opening the native Blob', async () => {
    mocks.files.set('file:///cache/picker/huge.jpg', { size: SUPPORT_ATTACHMENT_MAX_BYTES + 1, type: 'image/jpeg', exists: true });

    await expect(sendSupportChatMessage('case-1', '', {
      uri: 'file:///cache/picker/huge.jpg', mimeType: 'image/jpeg',
    })).rejects.toThrow('support/attachment-too-large');

    expect(mocks.openBlob).not.toHaveBeenCalled();
    expect(mocks.sendChat).not.toHaveBeenCalled();
  });
});
