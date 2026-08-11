import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAdminMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('../../lib/firebaseAdmin', () => ({
  db: {
    doc: vi.fn(() => ({ get: firebaseAdminMocks.getDocument })),
  },
  auth: {
    getUser: firebaseAdminMocks.getUser,
  },
}));

import { validFirebaseUserExists } from '../subscriptionSync';

describe('validFirebaseUserExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires users/{uid} and does not create or query Auth when the document is absent', async () => {
    firebaseAdminMocks.getDocument.mockResolvedValue({ exists: false });

    await expect(validFirebaseUserExists('firebase-missing')).resolves.toBe(false);
    expect(firebaseAdminMocks.getUser).not.toHaveBeenCalled();
  });

  it('returns true only when the Firestore document and Firebase Auth user both exist', async () => {
    firebaseAdminMocks.getDocument.mockResolvedValue({ exists: true });
    firebaseAdminMocks.getUser.mockResolvedValue({ uid: 'firebase-current' });

    await expect(validFirebaseUserExists('firebase-current')).resolves.toBe(true);
    expect(firebaseAdminMocks.getUser).toHaveBeenCalledWith('firebase-current');
  });

  it('rejects a retained Firestore document whose Firebase Auth user was deleted', async () => {
    firebaseAdminMocks.getDocument.mockResolvedValue({ exists: true });
    firebaseAdminMocks.getUser.mockRejectedValue({ code: 'auth/user-not-found' });

    await expect(validFirebaseUserExists('firebase-deleted')).resolves.toBe(false);
  });

  it('propagates an unexpected Auth infrastructure failure for webhook retry', async () => {
    firebaseAdminMocks.getDocument.mockResolvedValue({ exists: true });
    firebaseAdminMocks.getUser.mockRejectedValue({ code: 'auth/internal-error' });

    await expect(validFirebaseUserExists('firebase-current')).rejects.toMatchObject({
      code: 'auth/internal-error',
    });
  });
});
