import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userGetMock = vi.hoisted(() => vi.fn());
const docMock = vi.hoisted(() => vi.fn(() => ({ get: userGetMock })));

vi.mock('../../lib/firebaseAdmin', () => ({
  db: { doc: docMock },
}));

// The subject import stays below the hoisted Admin SDK mock by design.
// eslint-disable-next-line import/first
import { PUSH_QA_CUSTOM_CLAIM, requirePushQaUid } from '../qaAuthorization';

function request(
  token: Record<string, unknown> | null,
  data: unknown = {},
): CallableRequest<unknown> {
  return {
    data,
    auth: token === null ? undefined : { uid: 'authenticated-user', token: token as never },
    rawRequest: {} as never,
  } as CallableRequest<unknown>;
}

function mockFirestoreRole(role: string | undefined): void {
  userGetMock.mockResolvedValue({
    exists: role !== undefined,
    data: () => role === undefined ? undefined : { metadata: { role } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFirestoreRole('user');
});

describe('push QA authorization', () => {
  it('rejects an unauthenticated request before reading Firestore', async () => {
    await expect(requirePushQaUid(request(null))).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'authentication_required',
    });
    expect(userGetMock).not.toHaveBeenCalled();
  });

  it('rejects an authenticated normal user', async () => {
    await expect(requirePushQaUid(request({}))).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'push_qa_permission_required',
    });
  });

  it('allows the narrow pushQa custom claim without granting the admin role', async () => {
    await expect(requirePushQaUid(request({ [PUSH_QA_CUSTOM_CLAIM]: true })))
      .resolves.toBe('authenticated-user');
    expect(userGetMock).not.toHaveBeenCalled();
  });

  it.each([false, 'true', 1, null])('rejects non-boolean-true pushQa value %#', async (value) => {
    await expect(requirePushQaUid(request({ [PUSH_QA_CUSTOM_CLAIM]: value })))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('keeps an existing Firestore admin authorized', async () => {
    mockFirestoreRole('admin');
    await expect(requirePushQaUid(request({}))).resolves.toBe('authenticated-user');
    expect(userGetMock).toHaveBeenCalledTimes(1);
  });

  it('never trusts pushQa or another uid from the request payload', async () => {
    await expect(requirePushQaUid(request({}, {
      pushQa: true,
      uid: 'another-user',
      targetUid: 'another-user',
    }))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('preserves the verified-email policy', async () => {
    await expect(requirePushQaUid(request({
      [PUSH_QA_CUSTOM_CLAIM]: true,
      email_verified: false,
      firebase: { identities: { email: ['tester@example.com'] } },
    }))).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'email_verification_required',
    });
    expect(userGetMock).not.toHaveBeenCalled();
  });
});
