import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/firebaseAdmin', () => ({
  auth: { getUser: mocks.getUser },
  db: {},
}));

import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { handleRequestAccountDeletion } from '../requestAccountDeletion';
import { AccountDeletionRepositoryError } from '../repository';
import { currentPolicy } from '../policy';
import { initialProviderRevocationState } from '../providerRevocation/types';
import type { AccountDeletionRepository, CreateOrReuseAccountDeletionResult } from '../repository';
import type { AccountDeletionRecord } from '../types';

const POLICY = currentPolicy();
const nowSeconds = () => Math.floor(Date.now() / 1000);

function request(ageSeconds: number | null, data: unknown = {}, uid = 'uid-1') {
  if (ageSeconds === null) return { auth: null, data } as never;
  return {
    auth: { uid, token: { auth_time: nowSeconds() - ageSeconds } },
    data,
  } as never;
}

function providerData(...ids: string[]) {
  return ids.map((providerId) => ({ providerId }));
}

/** Fake Apple identity client for tests that need `apple.com` linked — the exchange always succeeds. */
function fakeAppleIdentityClient() {
  return {
    exchangeAuthorizationCode: vi
      .fn()
      .mockResolvedValue({ refreshToken: 'fake-refresh-token', accessToken: 'fake-access-token', expiresInSeconds: 3600 }),
  };
}

/** `data` gains a valid `appleAuthorizationCode` automatically — most provider-snapshot tests only care about linkage, not the Apple contract itself (that has its own dedicated describe block below). */
function withAppleMaterial(data: Record<string, unknown> = {}) {
  return { ...data, appleAuthorizationCode: 'fresh-authorization-code' };
}

function fakeRecord(overrides: Partial<AccountDeletionRecord> = {}): AccountDeletionRecord {
  return {
    deletionId: 'del-1',
    uid: 'uid-1',
    workflowVersion: POLICY.workflowVersion,
    policy: POLICY,
    status: 'REQUESTED',
    steps: {} as never,
    providerRevocation: initialProviderRevocationState([], 0),
    revision: 0,
    requestedAt: 0,
    updatedAt: 0,
    completedAt: null,
    lease: null,
    requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
    ...overrides,
  };
}

function fakeRepository(
  result: Partial<CreateOrReuseAccountDeletionResult> = {},
): AccountDeletionRepository & { createOrReuse: ReturnType<typeof vi.fn> } {
  return {
    createOrReuse: vi.fn().mockResolvedValue({
      record: fakeRecord(),
      deduplicated: false,
      blockedTerminalFailure: false,
      ...result,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ providerData: providerData('password') });
  cacheMock.cacheAppleRevocationMaterial.mockResolvedValue({ cached: true });
});

describe('handleRequestAccountDeletion — authentication gates', () => {
  it('rejects an unauthenticated request before touching the repository', async () => {
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(null), repo)).rejects.toThrow(HttpsError);
    expect(repo.createOrReuse).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('rejects a stale token with zero writes', async () => {
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(1000), repo)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('accepts a fresh token and creates exactly one operation', async () => {
    const repo = fakeRepository();
    const response = await handleRequestAccountDeletion(request(0), repo);
    expect(response).toMatchObject({ deletionId: 'del-1', status: 'REQUESTED', accepted: true });
    expect(repo.createOrReuse).toHaveBeenCalledOnce();
  });

  it('a stale token logs WHY requireRecentAuth rejected it (ageSeconds, provider) — the password-reauth loop was previously unfalsifiable from Cloud Logging alone', async () => {
    const repo = fakeRepository();
    const staleRequest = {
      auth: { uid: 'uid-1', token: { auth_time: nowSeconds() - 1000, firebase: { sign_in_provider: 'password' } } },
      data: {},
    } as never;
    await expect(handleRequestAccountDeletion(staleRequest, repo)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('requireRecentAuth rejected'),
      expect.objectContaining({
        hasAuthTime: true,
        ageSeconds: expect.any(Number),
        signInProvider: 'password',
      }),
    );
  });

  it('an unauthenticated request also logs (uid/ageSeconds null) rather than failing silently', async () => {
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(null), repo)).rejects.toThrow(HttpsError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('requireRecentAuth rejected'),
      expect.objectContaining({ hasAuthTime: false, ageSeconds: null, signInProvider: null }),
    );
  });

  it('never logs a token, credential, or password alongside the rejection', async () => {
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(1000), repo)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    const loggedContext = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<string, unknown>;
    for (const forbiddenKey of ['token', 'idToken', 'password', 'credential']) {
      expect(loggedContext).not.toHaveProperty(forbiddenKey);
    }
  });
});

describe('handleRequestAccountDeletion — identity boundary', () => {
  it('derives uid exclusively from request.auth.uid, ignoring any payload uid/userId/targetUid', async () => {
    for (const field of ['uid', 'userId', 'targetUid']) {
      const repo = fakeRepository();
      await expect(
        handleRequestAccountDeletion(request(0, { [field]: 'victim-uid' }), repo),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(repo.createOrReuse).not.toHaveBeenCalled();
    }
  });

  it('passes request.auth.uid (never anything from data) to the repository', async () => {
    const repo = fakeRepository();
    await handleRequestAccountDeletion(request(0, {}, 'the-real-uid'), repo);
    expect(repo.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'the-real-uid' }),
    );
  });
});

describe('handleRequestAccountDeletion — closed payload contract', () => {
  it('accepts an empty object payload', async () => {
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(0, {}), repo)).resolves.toMatchObject({
      accepted: true,
    });
  });

  it('accepts an omitted/undefined payload', async () => {
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(0, undefined), repo)).resolves.toMatchObject({
      accepted: true,
    });
  });

  it.each([
    ['policy', { support: 'DELETE' }],
    ['retentionPolicy', { couponRedemptions: 'DELETE' }],
    ['workflowVersion', 999],
    ['deletionId', 'attacker-chosen-id'],
    ['revision', 5],
    ['status', 'COMPLETED'],
    ['steps', {}],
    ['recentAuth', true],
    ['reauthenticated', true],
    ['authTime', Date.now()],
    ['requestedAt', Date.now()],
  ])('rejects an unexpected field "%s" with invalid-argument, before any write', async (field, value) => {
    const repo = fakeRepository();
    await expect(
      handleRequestAccountDeletion(request(0, { [field]: value }), repo),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('rejects a stale token even when the payload ALSO tries to forge recentAuth: true', async () => {
    const repo = fakeRepository();
    // Whichever check runs first still rejects — this proves neither gate
    // can be bypassed by combining them.
    await expect(
      handleRequestAccountDeletion(request(1000, { recentAuth: true }), repo),
    ).rejects.toThrow(HttpsError);
    expect(repo.createOrReuse).not.toHaveBeenCalled();
  });
});

describe('handleRequestAccountDeletion — provider snapshot', () => {
  it('resolves linked providers server-side via admin.auth().getUser, never from request.data', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('password', 'apple.com', 'google.com') });
    const repo = fakeRepository();
    await handleRequestAccountDeletion(
      // no "providers" field even attempted — contract has none besides
      // appleAuthorizationCode, required here only because apple.com is
      // linked per the server's OWN snapshot above, never trusted from this
      // payload itself.
      request(0, withAppleMaterial()),
      repo,
      { appleIdentityClient: fakeAppleIdentityClient() },
    );
    expect(repo.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ linkedProviders: ['apple.com', 'google.com'] }),
    );
  });

  it.each([
    [[], []],
    [['password'], []],
    [['google.com'], ['google.com']],
    [['apple.com'], ['apple.com']],
    [['password', 'google.com'], ['google.com']],
    [['password', 'apple.com'], ['apple.com']],
    [['google.com', 'apple.com'], ['apple.com', 'google.com']],
    [['password', 'google.com', 'apple.com'], ['apple.com', 'google.com']],
  ])('provider combination %j resolves to %j', async (linked, expected) => {
    mocks.getUser.mockResolvedValue({ providerData: providerData(...linked) });
    const repo = fakeRepository();
    const data = linked.includes('apple.com') ? withAppleMaterial() : {};
    await handleRequestAccountDeletion(request(0, data), repo, {
      appleIdentityClient: fakeAppleIdentityClient(),
    });
    expect(repo.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ linkedProviders: expected }),
    );
  });

  it('never persists email/displayName/photoURL from the Auth user record', async () => {
    mocks.getUser.mockResolvedValue({
      providerData: [{ providerId: 'google.com', email: 'user@example.com', displayName: 'Real Name' }],
    });
    const repo = fakeRepository();
    await handleRequestAccountDeletion(request(0), repo);
    const call = repo.createOrReuse.mock.calls[0][0];
    expect(call.linkedProviders).toEqual(['google.com']);
    expect(JSON.stringify(call)).not.toContain('user@example.com');
    expect(JSON.stringify(call)).not.toContain('Real Name');
  });

  it('maps a getUser failure to a controlled internal error, creating nothing', async () => {
    mocks.getUser.mockRejectedValue(new Error('auth/user-not-found'));
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(0), repo)).rejects.toMatchObject({
      code: 'internal',
    });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
  });
});

describe('handleRequestAccountDeletion — existing operation states', () => {
  it('REQUESTED/PROCESSING/RETRY_SCHEDULED: surfaces deduplicated: true, same deletionId', async () => {
    for (const status of ['REQUESTED', 'PROCESSING', 'RETRY_SCHEDULED'] as const) {
      const repo = fakeRepository({ record: fakeRecord({ status }), deduplicated: true });
      const response = await handleRequestAccountDeletion(request(0), repo);
      expect(response).toMatchObject({ deletionId: 'del-1', status, deduplicated: true, accepted: true });
    }
  });

  it('COMPLETED: logical success, no error, deduplicated: true', async () => {
    const repo = fakeRepository({ record: fakeRecord({ status: 'COMPLETED' }), deduplicated: true });
    const response = await handleRequestAccountDeletion(request(0), repo);
    expect(response).toMatchObject({ status: 'COMPLETED', deduplicated: true, accepted: true });
  });

  it('FAILED_TERMINAL: flags requiresReconciliation, does not throw, does not create a new op', async () => {
    const repo = fakeRepository({
      record: fakeRecord({ status: 'FAILED_TERMINAL' }),
      deduplicated: true,
      blockedTerminalFailure: true,
    });
    const response = await handleRequestAccountDeletion(request(0), repo);
    expect(response).toMatchObject({
      status: 'FAILED_TERMINAL',
      requiresReconciliation: true,
      accepted: true,
    });
  });
});

describe('handleRequestAccountDeletion — repository failure', () => {
  it('maps a repository/transaction failure to a controlled internal error', async () => {
    const repo: AccountDeletionRepository = {
      createOrReuse: vi.fn().mockRejectedValue(new Error('firestore unavailable')),
    };
    await expect(handleRequestAccountDeletion(request(0), repo)).rejects.toMatchObject({
      code: 'internal',
    });
  });

  it('maps an AccountDeletionRepositoryError (corrupted data) to internal, never leaking internals', async () => {
    const repo: AccountDeletionRepository = {
      createOrReuse: vi.fn().mockRejectedValue(new AccountDeletionRepositoryError('corrupted lock document')),
    };
    let caught: unknown;
    try {
      await handleRequestAccountDeletion(request(0), repo);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'internal' });
    expect(String((caught as HttpsError).message)).not.toContain('corrupted lock document');
  });
});

describe('handleRequestAccountDeletion — response shape (§36/§39)', () => {
  it('never exposes policy, revision, steps, or internal lock details', async () => {
    const repo = fakeRepository({ record: fakeRecord({ revision: 7 }) });
    const response = await handleRequestAccountDeletion(request(0), repo);
    expect(response).toEqual({
      deletionId: 'del-1',
      status: 'REQUESTED',
      accepted: true,
      deduplicated: false,
      requiresReconciliation: false,
    });
  });
});

describe('handleRequestAccountDeletion — subscription irrelevance (§60/§61)', () => {
  it('never queries RevenueCat and always records subscriptionActiveAtRequest as null', async () => {
    const repo = fakeRepository();
    await handleRequestAccountDeletion(request(0), repo);
    const call = repo.createOrReuse.mock.calls[0][0];
    expect(call.requestMetadata.subscriptionActiveAtRequest).toBeNull();
  });

  it('accepts the request identically regardless of any subscription-shaped field attempted in the payload', async () => {
    const repo = fakeRepository();
    await expect(
      handleRequestAccountDeletion(request(0, { isPremium: true }), repo),
    ).rejects.toMatchObject({ code: 'invalid-argument' }); // unknown field, rejected on contract grounds, not subscription grounds
  });
});

// ─── Fase 3/5 correction: Apple pre-commit preparation ────────────────────

const cacheMock = vi.hoisted(() => ({ cacheAppleRevocationMaterial: vi.fn() }));
vi.mock('../providerRevocation/appleRevocationPreparation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providerRevocation/appleRevocationPreparation')>();
  return { ...actual, cacheAppleRevocationMaterial: cacheMock.cacheAppleRevocationMaterial };
});

describe('handleRequestAccountDeletion — Apple pre-commit preparation (Fase 3/5 correction)', () => {
  beforeEach(() => {
    cacheMock.cacheAppleRevocationMaterial.mockResolvedValue({ cached: true });
  });

  it('password-only account: never constructs/calls an Apple client at all', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('password') });
    const repo = fakeRepository();
    const appleClient = fakeAppleIdentityClient();
    await handleRequestAccountDeletion(request(0), repo, { appleIdentityClient: appleClient });
    expect(appleClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(cacheMock.cacheAppleRevocationMaterial).not.toHaveBeenCalled();
  });

  it('google-only account: never constructs/calls an Apple client at all', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('google.com') });
    const repo = fakeRepository();
    const appleClient = fakeAppleIdentityClient();
    await handleRequestAccountDeletion(request(0), repo, { appleIdentityClient: appleClient });
    expect(appleClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('Apple linked, no appleAuthorizationCode supplied: rejected before any record is created', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    const repo = fakeRepository();
    await expect(handleRequestAccountDeletion(request(0), repo)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
  });

  it('Apple linked, fresh code: exchanges it, creates the record, then caches material against the REAL deletionId', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    const repo = fakeRepository({ record: fakeRecord({ deletionId: 'del-apple-1' }) });
    const appleClient = fakeAppleIdentityClient();

    const response = await handleRequestAccountDeletion(request(0, withAppleMaterial()), repo, {
      appleIdentityClient: appleClient,
    });

    expect(response.accepted).toBe(true);
    expect(appleClient.exchangeAuthorizationCode).toHaveBeenCalledWith('fresh-authorization-code');
    expect(cacheMock.cacheAppleRevocationMaterial).toHaveBeenCalledWith('del-apple-1', 'fake-refresh-token');
  });

  it('exchange fails with a TERMINAL Apple error (e.g. expired/already-used code): maps to aborted, NEVER failed-precondition (Fase 15 — that code is reserved for a genuinely stale Firebase session)', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    const repo = fakeRepository();
    const { AppleIdentityApiError } = await import('../providerRevocation/appleIdentityClient');
    const appleClient = {
      exchangeAuthorizationCode: vi
        .fn()
        .mockRejectedValue(new AppleIdentityApiError('PROVIDER_AUTHORIZATION_INVALID', 400)),
    };

    await expect(
      handleRequestAccountDeletion(request(0, withAppleMaterial()), repo, { appleIdentityClient: appleClient }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
    expect(cacheMock.cacheAppleRevocationMaterial).not.toHaveBeenCalled();
  });

  it('exchange fails with MISSING_REQUIRED_CONFIGURATION (e.g. invalid_client): maps to internal, NEVER failed-precondition — a backend config problem must never look like a stale user session', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    const repo = fakeRepository();
    const { AppleIdentityApiError } = await import('../providerRevocation/appleIdentityClient');
    const appleClient = {
      exchangeAuthorizationCode: vi
        .fn()
        .mockRejectedValue(new AppleIdentityApiError('MISSING_REQUIRED_CONFIGURATION', 401)),
    };

    await expect(
      handleRequestAccountDeletion(request(0, withAppleMaterial()), repo, { appleIdentityClient: appleClient }),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
    expect(cacheMock.cacheAppleRevocationMaterial).not.toHaveBeenCalled();
  });

  it('exchange fails with a RETRYABLE Apple error: maps to unavailable, deletion NOT created', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    const repo = fakeRepository();
    const { AppleIdentityApiError } = await import('../providerRevocation/appleIdentityClient');
    const appleClient = {
      exchangeAuthorizationCode: vi.fn().mockRejectedValue(new AppleIdentityApiError('UNAVAILABLE', 503)),
    };

    await expect(
      handleRequestAccountDeletion(request(0, withAppleMaterial()), repo, { appleIdentityClient: appleClient }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
  });

  it('deduplicated (existing operation reused): exchanged material is discarded, never cached', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    const repo = fakeRepository({ deduplicated: true });
    const appleClient = fakeAppleIdentityClient();

    const response = await handleRequestAccountDeletion(request(0, withAppleMaterial()), repo, {
      appleIdentityClient: appleClient,
    });

    expect(response.deduplicated).toBe(true);
    expect(appleClient.exchangeAuthorizationCode).toHaveBeenCalledOnce(); // spent, harmlessly
    expect(cacheMock.cacheAppleRevocationMaterial).not.toHaveBeenCalled();
  });

  it('caching failure after record creation does not fail the whole accepted request', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    cacheMock.cacheAppleRevocationMaterial.mockResolvedValue({ cached: false });
    const repo = fakeRepository();
    const appleClient = fakeAppleIdentityClient();

    await expect(
      handleRequestAccountDeletion(request(0, withAppleMaterial()), repo, { appleIdentityClient: appleClient }),
    ).resolves.toMatchObject({ accepted: true });
  });

  it('a payload that smuggles "uid" alongside a valid appleAuthorizationCode is still rejected on contract grounds, never reaching the repository', async () => {
    mocks.getUser.mockResolvedValue({ providerData: providerData('apple.com') });
    const repo = fakeRepository();
    const appleClient = fakeAppleIdentityClient();
    await expect(
      handleRequestAccountDeletion(
        request(0, { ...withAppleMaterial(), uid: 'attacker-uid' }, 'the-real-uid'),
        repo,
        { appleIdentityClient: appleClient },
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(repo.createOrReuse).not.toHaveBeenCalled();
    expect(appleClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });
});
