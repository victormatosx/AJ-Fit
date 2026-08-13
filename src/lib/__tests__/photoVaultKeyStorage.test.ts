import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => store);

import {
  base64ByteLength,
  deleteVaultKey,
  isValidVaultKeyMaterial,
  isValidVaultKeyVersion,
  readVaultKey,
  saveVaultKey,
} from '../photoVaultKeyStorage';
import { PhotoVaultError } from '../photoVaultErrors';

const UID = 'alice';
const OTHER_UID = 'mallory';

/** A well-formed 32-byte key in base64 (44 chars, one pad). */
const VALID_KEY = 'A'.repeat(43) + '=';

function storedPayload(overrides: Record<string, unknown> = {}, uid = UID) {
  return JSON.stringify({ uid, vaultKey: VALID_KEY, vaultKeyVersion: 1, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.setItemAsync.mockResolvedValue(undefined);
  store.deleteItemAsync.mockResolvedValue(undefined);
  store.getItemAsync.mockResolvedValue(null);
});

// ── base64 length, without Buffer/atob ─────────────────────────────────────

describe('base64ByteLength', () => {
  it('measures a 32-byte key', () => {
    expect(base64ByteLength(VALID_KEY)).toBe(32);
  });

  it.each([
    ['AAAA', 3],
    ['AAA=', 2],
    ['AA==', 1],
  ])('measures %s as %i bytes', (value, bytes) => {
    expect(base64ByteLength(value)).toBe(bytes);
  });

  it.each(['', 'AAA', 'AAAAA', 'not base64!', '====', 'A A A A'])(
    'rejects malformed base64: %s',
    (value) => {
      expect(base64ByteLength(value)).toBeNull();
    },
  );
});

describe('validators', () => {
  it('accepts exactly 32 bytes', () => {
    expect(isValidVaultKeyMaterial(VALID_KEY)).toBe(true);
  });

  it.each([
    ['16 bytes', 'A'.repeat(22) + '=='],
    ['48 bytes', 'A'.repeat(64)],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidVaultKeyMaterial(value)).toBe(false);
  });

  it.each([null, undefined, 42, {}, []])('rejects non-string key %s', (value) => {
    expect(isValidVaultKeyMaterial(value)).toBe(false);
  });

  it.each([1, 2, 99])('accepts version %i', (version) => {
    expect(isValidVaultKeyVersion(version)).toBe(true);
  });

  it.each([0, -1, 1.5, '1', null, undefined, NaN])('rejects version %s', (version) => {
    expect(isValidVaultKeyVersion(version)).toBe(false);
  });
});

// ── Saving ─────────────────────────────────────────────────────────────────

describe('saveVaultKey', () => {
  it('stores the key under a uid-namespaced entry', async () => {
    await saveVaultKey(UID, { vaultKey: VALID_KEY, vaultKeyVersion: 1 });

    const [key, value] = store.setItemAsync.mock.calls[0]!;
    expect(key).toContain(UID);
    expect(JSON.parse(value as string)).toEqual({
      uid: UID,
      vaultKey: VALID_KEY,
      vaultKeyVersion: 1,
    });
  });

  it('uses a different entry for a different user', async () => {
    await saveVaultKey(UID, { vaultKey: VALID_KEY, vaultKeyVersion: 1 });
    await saveVaultKey(OTHER_UID, { vaultKey: VALID_KEY, vaultKeyVersion: 1 });

    expect(store.setItemAsync.mock.calls[0]![0]).not.toBe(store.setItemAsync.mock.calls[1]![0]);
  });

  it('refuses to store an invalid key', async () => {
    await expect(
      saveVaultKey(UID, { vaultKey: 'too-short', vaultKeyVersion: 1 }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultInvalidResponse' }));

    expect(store.setItemAsync).not.toHaveBeenCalled();
  });

  it('refuses to store an invalid version', async () => {
    await expect(
      saveVaultKey(UID, { vaultKey: VALID_KEY, vaultKeyVersion: 0 }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultInvalidResponse' }));
  });

  it.each(['', 'has space', 'has/slash', 'has:colon'])(
    'fails closed for an unsafe uid: %s',
    async (uid) => {
      await expect(
        saveVaultKey(uid, { vaultKey: VALID_KEY, vaultKeyVersion: 1 }),
      ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultStorageFailed' }));

      expect(store.setItemAsync).not.toHaveBeenCalled();
    },
  );

  it('reports a storage failure without echoing the value', async () => {
    store.setItemAsync.mockRejectedValue(new Error(`keychain refused ${VALID_KEY}`));

    const error = await saveVaultKey(UID, {
      vaultKey: VALID_KEY,
      vaultKeyVersion: 1,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PhotoVaultError);
    expect((error as PhotoVaultError).issue).toBe('vaultStorageFailed');
    expect((error as Error).message).not.toContain(VALID_KEY);
  });
});

// ── Reading ────────────────────────────────────────────────────────────────

describe('readVaultKey', () => {
  it('returns null when nothing is stored', async () => {
    expect(await readVaultKey(UID)).toBeNull();
  });

  it('round-trips a stored key', async () => {
    store.getItemAsync.mockResolvedValue(storedPayload());

    expect(await readVaultKey(UID)).toEqual({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });
  });

  it('reads from the namespaced entry for that uid', async () => {
    store.getItemAsync.mockResolvedValue(storedPayload());
    await readVaultKey(UID);

    expect(store.getItemAsync.mock.calls[0]![0]).toContain(UID);
  });

  it.each([
    ['invalid JSON', 'not json at all'],
    ['a non-object', JSON.stringify('a string')],
    ['a missing key', JSON.stringify({ uid: UID, vaultKeyVersion: 1 })],
    ['a short key', storedPayload({ vaultKey: 'AAAA' })],
    ['a long key', storedPayload({ vaultKey: 'A'.repeat(64) })],
    ['a bad version', storedPayload({ vaultKeyVersion: 0 })],
    ['a missing version', JSON.stringify({ uid: UID, vaultKey: VALID_KEY })],
  ])('treats %s as corrupted and discards it', async (_label, raw) => {
    store.getItemAsync.mockResolvedValue(raw);

    await expect(readVaultKey(UID)).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultLocalKeyCorrupted' }),
    );
    expect(store.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it("rejects a payload belonging to another uid", async () => {
    // Defense in depth: the namespace already prevents this, but a payload
    // whose uid disagrees must never be trusted.
    store.getItemAsync.mockResolvedValue(storedPayload({}, OTHER_UID));

    await expect(readVaultKey(UID)).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultLocalKeyCorrupted' }),
    );
    expect(store.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('reports a read failure as a storage failure', async () => {
    store.getItemAsync.mockRejectedValue(new Error('keychain locked'));

    await expect(readVaultKey(UID)).rejects.toThrowError(
      expect.objectContaining({ issue: 'vaultStorageFailed' }),
    );
  });
});

// ── Cross-user isolation ───────────────────────────────────────────────────

describe('cross-user isolation', () => {
  it("user B never reads user A's key", async () => {
    const entries = new Map<string, string>();
    store.setItemAsync.mockImplementation(async (k: string, v: string) => {
      entries.set(k, v);
    });
    store.getItemAsync.mockImplementation(async (k: string) => entries.get(k) ?? null);

    await saveVaultKey(UID, { vaultKey: VALID_KEY, vaultKeyVersion: 1 });

    expect(await readVaultKey(OTHER_UID)).toBeNull();
    expect(await readVaultKey(UID)).toEqual({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });
  });
});

// ── Deleting ───────────────────────────────────────────────────────────────

describe('deleteVaultKey', () => {
  it('deletes the namespaced entry', async () => {
    await deleteVaultKey(UID);

    expect(store.deleteItemAsync.mock.calls[0]![0]).toContain(UID);
  });

  it('never throws when the platform refuses', async () => {
    store.deleteItemAsync.mockRejectedValue(new Error('keychain unavailable'));

    await expect(deleteVaultKey(UID)).resolves.toBeUndefined();
  });
});

// ── Logging ────────────────────────────────────────────────────────────────

describe('logging', () => {
  it('never writes the key to the console', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.getItemAsync.mockResolvedValue('corrupted');

    await readVaultKey(UID).catch(() => undefined);
    await saveVaultKey(UID, { vaultKey: VALID_KEY, vaultKeyVersion: 1 });

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(VALID_KEY);
    spy.mockRestore();
  });
});
