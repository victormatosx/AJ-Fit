import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  readVaultKey: vi.fn(),
  saveVaultKey: vi.fn(),
  deleteVaultKey: vi.fn(),
  getIdTokenResult: vi.fn(),
  currentUser: { uid: 'alice' } as { uid: string } | null,
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => {
    mocks.httpsCallable(...args);
    return mocks.callable;
  },
}));

vi.mock('../../lib/firebaseFunctions', () => ({
  functions: {},
  FUNCTIONS_REGION: 'us-central1',
}));

vi.mock('../../lib/firebase', () => ({
  auth: {
    get currentUser() {
      return mocks.currentUser
        ? { ...mocks.currentUser, getIdTokenResult: mocks.getIdTokenResult }
        : null;
    },
  },
}));

// Fully mocked rather than partially: the real module imports
// expo-secure-store, which reaches react-native and cannot be parsed in this
// node environment. The two validators are pure and are reproduced here so
// the service is still exercised against real validation rules — their own
// behaviour is covered in lib/__tests__/photoVaultKeyStorage.test.ts.
vi.mock('../../lib/photoVaultKeyStorage', () => {
  const base64ByteLength = (value: string): number | null => {
    if (value.length === 0 || value.length % 4 !== 0) return null;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return (value.length / 4) * 3 - padding;
  };

  return {
    base64ByteLength,
    isValidVaultKeyMaterial: (v: unknown): v is string =>
      typeof v === 'string' && base64ByteLength(v) === 32,
    isValidVaultKeyVersion: (v: unknown): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v >= 1,
    readVaultKey: mocks.readVaultKey,
    saveVaultKey: mocks.saveVaultKey,
    deleteVaultKey: mocks.deleteVaultKey,
  };
});

import { PhotoVaultError } from '../../lib/photoVaultErrors';
import {
  createPhotoVaultKey,
  ensurePhotoVaultKey,
  hasRecentAuth,
  recoverPhotoVaultKey,
} from '../photoVault';

const UID = 'alice';
const OTHER_UID = 'mallory';
const VALID_KEY = 'A'.repeat(43) + '=';
const OTHER_KEY = 'B'.repeat(43) + '=';

/** A callable error as the Firebase JS SDK surfaces it. */
function callableError(code: string) {
  return Object.assign(new Error(code), { code: `functions/${code}` });
}

function freshToken(ageMs = 0) {
  return { authTime: new Date(Date.now() - ageMs).toISOString() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser = { uid: UID };
  mocks.readVaultKey.mockResolvedValue(null);
  mocks.saveVaultKey.mockResolvedValue(undefined);
  mocks.deleteVaultKey.mockResolvedValue(undefined);
  mocks.getIdTokenResult.mockResolvedValue(freshToken());
  mocks.callable.mockResolvedValue({ data: { vaultKey: VALID_KEY, vaultKeyVersion: 1 } });
});

// ── Functions client ───────────────────────────────────────────────────────

describe('callable wiring', () => {
  it('calls createVault by name', async () => {
    await createPhotoVaultKey();

    expect(mocks.httpsCallable.mock.calls[0]![1]).toBe('createVault');
  });

  it('calls recoverVaultKey by name', async () => {
    await recoverPhotoVaultKey();

    expect(mocks.httpsCallable.mock.calls[0]![1]).toBe('recoverVaultKey');
  });

  it('sends no uid or payload to the backend', async () => {
    await createPhotoVaultKey();

    // The backend derives the uid from the verified token; sending one would
    // be meaningless at best and misleading at worst.
    expect(mocks.callable).toHaveBeenCalledWith();
  });
});

// ── Response validation ────────────────────────────────────────────────────

describe('response validation', () => {
  it.each([
    ['a missing key', { vaultKeyVersion: 1 }],
    ['a short key', { vaultKey: 'AAAA', vaultKeyVersion: 1 }],
    ['a long key', { vaultKey: 'A'.repeat(64), vaultKeyVersion: 1 }],
    ['invalid base64', { vaultKey: '!'.repeat(44), vaultKeyVersion: 1 }],
    ['a non-string key', { vaultKey: 12345, vaultKeyVersion: 1 }],
    ['a missing version', { vaultKey: VALID_KEY }],
    ['a zero version', { vaultKey: VALID_KEY, vaultKeyVersion: 0 }],
    ['a fractional version', { vaultKey: VALID_KEY, vaultKeyVersion: 1.5 }],
    ['null', null],
    ['a string', 'nope'],
  ])('rejects %s from createVault and stores nothing', async (_label, data) => {
    mocks.callable.mockResolvedValue({ data });

    await expect(createPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultInvalidResponse' }),
    );
    expect(mocks.saveVaultKey).not.toHaveBeenCalled();
  });

  it('rejects an invalid response from recoverVaultKey', async () => {
    mocks.callable.mockResolvedValue({ data: { vaultKey: 'AAAA', vaultKeyVersion: 1 } });

    await expect(recoverPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultInvalidResponse' }),
    );
    expect(mocks.saveVaultKey).not.toHaveBeenCalled();
  });
});

// ── create ─────────────────────────────────────────────────────────────────

describe('createPhotoVaultKey', () => {
  it('stores the returned key under the caller uid', async () => {
    const result = await createPhotoVaultKey();

    expect(result).toEqual({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });
    expect(mocks.saveVaultKey).toHaveBeenCalledWith(UID, {
      vaultKey: VALID_KEY,
      vaultKeyVersion: 1,
    });
  });

  it('maps already-exists onto a dedicated issue', async () => {
    mocks.callable.mockRejectedValue(callableError('already-exists'));

    await expect(createPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultAlreadyExists' }),
    );
  });

  it('never retries with a second key after already-exists', async () => {
    mocks.callable.mockRejectedValue(callableError('already-exists'));

    await createPhotoVaultKey().catch(() => undefined);

    expect(mocks.callable).toHaveBeenCalledTimes(1);
    expect(mocks.saveVaultKey).not.toHaveBeenCalled();
  });

  it('reports a storage failure without creating another vault', async () => {
    mocks.saveVaultKey.mockRejectedValue(new PhotoVaultError('vaultStorageFailed'));

    await expect(createPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultStorageFailed' }),
    );
    expect(mocks.callable).toHaveBeenCalledTimes(1);
  });

  it('requires an authenticated user', async () => {
    mocks.currentUser = null;

    await expect(createPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultKeyNotAvailable' }),
    );
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('maps a backend failure onto a generic create issue', async () => {
    mocks.callable.mockRejectedValue(callableError('internal'));

    await expect(createPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultCreateFailed' }),
    );
  });
});

// ── recover ────────────────────────────────────────────────────────────────

describe('recoverPhotoVaultKey', () => {
  it('stores the recovered key', async () => {
    const result = await recoverPhotoVaultKey();

    expect(result).toEqual({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });
    expect(mocks.saveVaultKey).toHaveBeenCalledWith(UID, {
      vaultKey: VALID_KEY,
      vaultKeyVersion: 1,
    });
  });

  it('maps a stale token onto a reauth requirement', async () => {
    mocks.callable.mockRejectedValue(callableError('failed-precondition'));

    await expect(recoverPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultReauthRequired' }),
    );
  });

  it('never retries after a stale token', async () => {
    mocks.callable.mockRejectedValue(callableError('failed-precondition'));

    await recoverPhotoVaultKey().catch(() => undefined);

    expect(mocks.callable).toHaveBeenCalledTimes(1);
  });

  it('maps not-found onto an unavailable key', async () => {
    mocks.callable.mockRejectedValue(callableError('not-found'));

    await expect(recoverPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultKeyNotAvailable' }),
    );
  });

  it('maps an internal backend error onto a recovery failure', async () => {
    mocks.callable.mockRejectedValue(callableError('internal'));

    await expect(recoverPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultRecoveryFailed' }),
    );
  });

  it('reports a storage failure and leaves the remote vault alone', async () => {
    mocks.saveVaultKey.mockRejectedValue(new PhotoVaultError('vaultStorageFailed'));

    await expect(recoverPhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultStorageFailed' }),
    );
    expect(mocks.deleteVaultKey).not.toHaveBeenCalled();
  });
});

// ── hasRecentAuth ──────────────────────────────────────────────────────────

describe('hasRecentAuth', () => {
  it('is true right after authenticating', async () => {
    expect(await hasRecentAuth()).toBe(true);
  });

  it('is false for an old session', async () => {
    mocks.getIdTokenResult.mockResolvedValue(freshToken(10 * 60 * 1000));

    expect(await hasRecentAuth()).toBe(false);
  });

  it('is false when the token cannot be read', async () => {
    mocks.getIdTokenResult.mockRejectedValue(new Error('offline'));

    expect(await hasRecentAuth()).toBe(false);
  });

  it('is false when authTime is unparseable', async () => {
    mocks.getIdTokenResult.mockResolvedValue({ authTime: 'not a date' });

    expect(await hasRecentAuth()).toBe(false);
  });

  it('is false with no user', async () => {
    mocks.currentUser = null;

    expect(await hasRecentAuth()).toBe(false);
  });
});

// ── ensure ─────────────────────────────────────────────────────────────────

describe('ensurePhotoVaultKey', () => {
  it('uses the local key without touching the backend', async () => {
    mocks.readVaultKey.mockResolvedValue({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });

    const result = await ensurePhotoVaultKey();

    expect(result).toEqual({
      status: 'local-key-available',
      vaultKey: VALID_KEY,
      vaultKeyVersion: 1,
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('creates a vault when there is no local key', async () => {
    const result = await ensurePhotoVaultKey();

    expect(result).toMatchObject({ status: 'vault-created', vaultKey: VALID_KEY });
  });

  it('recovers when the vault already exists and auth is fresh', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.callable
      .mockRejectedValueOnce(callableError('already-exists'))
      .mockResolvedValueOnce({ data: { vaultKey: OTHER_KEY, vaultKeyVersion: 2 } });

    const result = await ensurePhotoVaultKey();

    expect(result).toEqual({ status: 'recovered', vaultKey: OTHER_KEY, vaultKeyVersion: 2 });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('asks for reauthentication when the vault exists and auth is stale', async () => {
    mocks.callable.mockRejectedValue(callableError('already-exists'));
    mocks.getIdTokenResult.mockResolvedValue(freshToken(10 * 60 * 1000));

    const result = await ensurePhotoVaultKey();

    expect(result).toEqual({ status: 'reauthentication-required' });
    // Only the create attempt — recovery is never tried with a stale token.
    expect(mocks.callable).toHaveBeenCalledTimes(1);
  });

  it('asks for reauthentication when the backend rejects our freshness check', async () => {
    // The backend is the authority; a client that guessed wrong must not loop.
    mocks.callable
      .mockRejectedValueOnce(callableError('already-exists'))
      .mockRejectedValueOnce(callableError('failed-precondition'));

    const result = await ensurePhotoVaultKey();

    expect(result).toEqual({ status: 'reauthentication-required' });
    expect(mocks.callable).toHaveBeenCalledTimes(2);
  });

  it('recovers after a corrupted local entry', async () => {
    mocks.readVaultKey.mockRejectedValue(new PhotoVaultError('vaultLocalKeyCorrupted'));

    const result = await ensurePhotoVaultKey();

    expect(result).toMatchObject({ status: 'vault-created' });
  });

  it('propagates a storage failure instead of silently creating a key', async () => {
    mocks.readVaultKey.mockRejectedValue(new PhotoVaultError('vaultStorageFailed'));

    await expect(ensurePhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultStorageFailed' }),
    );
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('never creates a second vault when one already exists', async () => {
    mocks.callable.mockRejectedValue(callableError('already-exists'));
    mocks.getIdTokenResult.mockResolvedValue(freshToken(10 * 60 * 1000));

    await ensurePhotoVaultKey();

    expect(mocks.saveVaultKey).not.toHaveBeenCalled();
  });
});

// ── Cross-user isolation ───────────────────────────────────────────────────

describe('cross-user isolation', () => {
  it('reads and writes only in the current uid namespace', async () => {
    mocks.currentUser = { uid: OTHER_UID };
    mocks.readVaultKey.mockResolvedValue(null);

    await ensurePhotoVaultKey();

    expect(mocks.readVaultKey).toHaveBeenCalledWith(OTHER_UID);
    expect(mocks.saveVaultKey.mock.calls[0]![0]).toBe(OTHER_UID);
  });

  it("a new user never receives the previous user's local key", async () => {
    const keys = new Map<string, unknown>([[UID, { vaultKey: VALID_KEY, vaultKeyVersion: 1 }]]);
    mocks.readVaultKey.mockImplementation(async (uid: string) => keys.get(uid) ?? null);

    mocks.currentUser = { uid: OTHER_UID };
    const result = await ensurePhotoVaultKey();

    // Falls through to creation for B rather than reusing A's key.
    expect(result).toMatchObject({ status: 'vault-created' });
    expect(mocks.readVaultKey).toHaveBeenCalledWith(OTHER_UID);
    expect(mocks.readVaultKey).not.toHaveBeenCalledWith(UID);
  });
});

// ── Single-flight key resolution ───────────────────────────────────────────

/**
 * Saving three poses at once calls `ensurePhotoVaultKey` three times in the
 * same tick. On an account whose key is not on this device yet, every one of
 * those would otherwise reach `createVault`.
 */
describe('ensurePhotoVaultKey single-flight', () => {
  /** Resolves only when the test says so, so all three callers overlap. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('collapses three concurrent calls into one createVault', async () => {
    const gate = deferred<{ data: unknown }>();
    mocks.callable.mockReturnValue(gate.promise);

    const calls = [ensurePhotoVaultKey(), ensurePhotoVaultKey(), ensurePhotoVaultKey()];
    gate.resolve({ data: { vaultKey: VALID_KEY, vaultKeyVersion: 1 } });
    await Promise.all(calls);

    expect(mocks.callable).toHaveBeenCalledTimes(1);
    // The read is part of the shared flight too, not just the callable.
    expect(mocks.readVaultKey).toHaveBeenCalledTimes(1);
  });

  it('hands every concurrent caller the same result', async () => {
    const gate = deferred<{ data: unknown }>();
    mocks.callable.mockReturnValue(gate.promise);

    const calls = [ensurePhotoVaultKey(), ensurePhotoVaultKey(), ensurePhotoVaultKey()];
    gate.resolve({ data: { vaultKey: VALID_KEY, vaultKeyVersion: 1 } });
    const results = await Promise.all(calls);

    for (const result of results) {
      expect(result).toMatchObject({ status: 'vault-created', vaultKey: VALID_KEY });
    }
  });

  it('propagates one failure to every concurrent caller', async () => {
    const gate = deferred<{ data: unknown }>();
    mocks.callable.mockReturnValue(gate.promise);

    const calls = [ensurePhotoVaultKey(), ensurePhotoVaultKey(), ensurePhotoVaultKey()];
    gate.reject(callableError('internal'));
    const settled = await Promise.allSettled(calls);

    expect(settled.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ]);
    for (const result of settled) {
      expect(result.status === 'rejected' && result.reason).toMatchObject({
        issue: 'vaultCreateFailed',
      });
    }
  });

  it('never caches a rejected flight: the next call retries from scratch', async () => {
    mocks.callable.mockRejectedValueOnce(callableError('internal'));
    await expect(ensurePhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultCreateFailed' }),
    );

    // A registry that kept the rejected promise would replay the failure here
    // forever, leaving the account unable to ever save a first photo.
    mocks.callable.mockResolvedValue({ data: { vaultKey: VALID_KEY, vaultKeyVersion: 1 } });
    await expect(ensurePhotoVaultKey()).resolves.toMatchObject({
      status: 'vault-created',
    });
  });

  it('releases the flight after success, so a later call runs again', async () => {
    await ensurePhotoVaultKey();
    mocks.readVaultKey.mockResolvedValue({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });

    const result = await ensurePhotoVaultKey();

    // Not served from a stale cached flight — it re-read and found the key
    // the first call had just persisted.
    expect(result).toMatchObject({ status: 'local-key-available' });
    expect(mocks.readVaultKey).toHaveBeenCalledTimes(2);
  });

  it('never shares a flight between two uids', async () => {
    const keys = new Map<string, unknown>();
    mocks.readVaultKey.mockImplementation(async (uid: string) => keys.get(uid) ?? null);

    const gate = deferred<{ data: unknown }>();
    mocks.callable.mockReturnValueOnce(gate.promise);
    mocks.callable.mockResolvedValue({ data: { vaultKey: OTHER_KEY, vaultKeyVersion: 2 } });

    mocks.currentUser = { uid: UID };
    const first = ensurePhotoVaultKey();
    mocks.currentUser = { uid: OTHER_UID };
    const second = ensurePhotoVaultKey();

    gate.resolve({ data: { vaultKey: VALID_KEY, vaultKeyVersion: 1 } });
    const [alice, mallory] = await Promise.all([first, second]);

    // Two identities, two resolutions — a shared flight would have handed
    // Mallory Alice's key.
    expect(alice).toMatchObject({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });
    expect(mallory).toMatchObject({ vaultKey: OTHER_KEY, vaultKeyVersion: 2 });
    expect(mocks.callable).toHaveBeenCalledTimes(2);
  });

  it('keeps the local-key fast path free of any backend call', async () => {
    mocks.readVaultKey.mockResolvedValue({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });

    const results = await Promise.all([
      ensurePhotoVaultKey(),
      ensurePhotoVaultKey(),
      ensurePhotoVaultKey(),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({ status: 'local-key-available' });
    }
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('refuses to open a flight for an unauthenticated caller', async () => {
    mocks.currentUser = null;

    await expect(ensurePhotoVaultKey()).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultKeyNotAvailable' }),
    );
    expect(mocks.readVaultKey).not.toHaveBeenCalled();
  });
});

// ── Logging ────────────────────────────────────────────────────────────────

describe('logging', () => {
  it('never logs the vault key', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.callable.mockRejectedValue(callableError('internal'));

    await createPhotoVaultKey().catch(() => undefined);
    await recoverPhotoVaultKey().catch(() => undefined);

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(VALID_KEY);
    expect(logged).toContain('issue');
    spy.mockRestore();
  });
});
