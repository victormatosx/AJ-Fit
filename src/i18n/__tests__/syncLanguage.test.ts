import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('expo-localization', () => ({
  getLocales: vi.fn().mockReturnValue([{ languageTag: 'pt-BR' } as never]),
}));

vi.mock('../../lib/firebase', () => ({ db: { __brand: 'mock-db' } }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, coll: string, id: string) => ({ path: `${coll}/${id}` })),
  updateDoc: vi.fn(),
  // Sentinel value stands in for the FieldValue returned by the real SDK;
  // rules-side, `metadata.updatedAt == request.time` is what actually pins
  // the value at deploy time. In tests we only care that the payload
  // structurally CONTAINS this key.
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, updateDoc } from 'firebase/firestore';
import {
  PENDING_LANGUAGE_STORAGE_KEY,
  type PendingLanguageSync,
} from '../pendingLanguageSync';
import { LANGUAGE_STORAGE_KEY } from '../languageStorage';
import type { SupportedLanguage } from '../../types/language';

const mockGetItem = vi.mocked(AsyncStorage.getItem);
const mockSetItem = vi.mocked(AsyncStorage.setItem);
const mockRemoveItem = vi.mocked(AsyncStorage.removeItem);
const mockDoc = vi.mocked(doc);
const mockUpdateDoc = vi.mocked(updateDoc);

/**
 * The AsyncStorage mock is a single flat store — pendingLanguageSync uses
 * one key, languageStorage another. This helper wires them into an in-memory
 * Map so both modules can round-trip through the same fake device.
 */
function useInMemoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  mockGetItem.mockImplementation(async (k: string) => store.get(k) ?? null);
  mockSetItem.mockImplementation(async (k: string, v: string) => {
    store.set(k, v);
  });
  mockRemoveItem.mockImplementation(async (k: string) => {
    store.delete(k);
  });
  return store;
}

/**
 * Fresh module graph per test — i18n's singleton and the sync module's own
 * imports both come out clean. `initI18n()` seeds i18n at `startingLang` so
 * assertions on `i18n.language` are meaningful.
 */
async function freshEnv(
  startingLang: SupportedLanguage,
  initialStorage: Record<string, string> = {},
) {
  vi.resetModules();
  const store = useInMemoryStorage({
    [LANGUAGE_STORAGE_KEY]: startingLang,
    ...initialStorage,
  });
  const { default: i18n, __resetI18nForTests, initI18n } = await import('../index');
  __resetI18nForTests();
  await initI18n();
  const sync = await import('../syncLanguage');
  const pending = await import('../pendingLanguageSync');
  // Init consumed the storage-read call; wipe interaction counters so tests
  // only see calls triggered by the code under test.
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
  mockUpdateDoc.mockReset();
  return { i18n, sync, pending, store };
}

function firestoreError(code: string): Error & { code: string } {
  const err = new Error(`firestore ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

/** Race the outcome against a very short timer to prove the outer function
 *  already returned even though the background push is still pending. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | '__timeout__'> {
  return Promise.race([
    p,
    new Promise<'__timeout__'>((resolve) =>
      setTimeout(() => resolve('__timeout__'), ms),
    ),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

// ── classifyRemoteError ────────────────────────────────────────────────────

describe('classifyRemoteError', () => {
  it.each(['permission-denied', 'invalid-argument', 'unauthenticated'])(
    'classifies %s as permanent',
    async (code) => {
      const { sync } = await freshEnv('pt-BR');
      expect(sync.classifyRemoteError(firestoreError(code))).toBe('permanent');
    },
  );

  it.each(['unavailable', 'deadline-exceeded', 'aborted'])(
    'classifies %s as recoverable',
    async (code) => {
      const { sync } = await freshEnv('pt-BR');
      expect(sync.classifyRemoteError(firestoreError(code))).toBe('recoverable');
    },
  );

  it('classifies unknown / non-code errors as recoverable so the user does not lose their choice', async () => {
    const { sync } = await freshEnv('pt-BR');
    expect(sync.classifyRemoteError(new Error('offline'))).toBe('recoverable');
    expect(sync.classifyRemoteError('boom')).toBe('recoverable');
    expect(sync.classifyRemoteError(undefined)).toBe('recoverable');
  });
});

// ── changeLanguageForUser — local + fast return ────────────────────────────

describe('changeLanguageForUser — happy path', () => {
  it('applies locally, writes pending, pushes remote via dotted path, clears pending', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const result = await sync.changeLanguageForUser({ uid: 'alice', next: 'en' });
    await expect(result.remote).resolves.toEqual({ status: 'synced' });

    expect(i18n.language).toBe('en');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(store.get(PENDING_LANGUAGE_STORAGE_KEY)).toBeUndefined();

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'users', 'alice');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    // metadata.updatedAt is required by the update rule — see the payload
    // shape test below for the full contract.
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/alice' },
      {
        'preferences.language': 'en',
        'metadata.updatedAt': { __sentinel: 'serverTimestamp' },
      },
    );
  });

  it('is a no-op when the requested language equals the current one', async () => {
    const { sync, i18n } = await freshEnv('pt-BR');
    const result = await sync.changeLanguageForUser({ uid: 'alice', next: 'pt-BR' });
    await expect(result.remote).resolves.toEqual({ status: 'synced' });
    expect(i18n.language).toBe('pt-BR');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('rejects invalid languages before any local or remote effect', async () => {
    const { sync, i18n } = await freshEnv('pt-BR');
    await expect(
      sync.changeLanguageForUser({
        uid: 'alice',
        next: 'fr' as unknown as SupportedLanguage,
      }),
    ).rejects.toThrow(/not a supported language/);
    expect(i18n.language).toBe('pt-BR');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

// ── changeLanguageForUser — offline / non-blocking contract ────────────────

describe('changeLanguageForUser — offline / non-blocking', () => {
  it('outer promise resolves fast even when updateDoc stays pending forever (offline)', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    // Simulate offline: updateDoc's promise never settles. The Firebase JS
    // SDK behaves exactly like this when the device has no connection AND
    // no cached backend response — the write is enqueued and the promise
    // stays pending until reconnection.
    mockUpdateDoc.mockReturnValue(new Promise<void>(() => {}));

    const { remote } = await sync.changeLanguageForUser({ uid: 'alice', next: 'en' });

    // Local part was applied and the pending record persisted — even without
    // a server ACK the UI has everything it needs to close the sheet.
    expect(i18n.language).toBe('en');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('en');
    const raw = store.get(PENDING_LANGUAGE_STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toMatchObject({
      uid: 'alice', value: 'en', attempts: 1,
    });

    // The background remote handle is still pending. Prove it by racing it
    // against a short timer: if the outer function had awaited updateDoc we
    // would never have gotten here at all.
    const raced = await withTimeout(remote, 25);
    expect(raced).toBe('__timeout__');
  });
});

// ── changeLanguageForUser — remote outcomes on .remote handle ──────────────

describe('changeLanguageForUser — remote outcomes', () => {
  it('rolls back local state and clears pending on permission-denied', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    mockUpdateDoc.mockRejectedValueOnce(firestoreError('permission-denied'));

    const { remote } = await sync.changeLanguageForUser({ uid: 'alice', next: 'en' });

    // Immediately after outer resolve, local was already switched.
    expect(i18n.language).toBe('en');

    const outcome = await remote;
    expect(outcome).toMatchObject({
      status: 'rolled-back',
      reason: 'permanent',
      error: expect.objectContaining({ code: 'permission-denied' }),
    });
    // Post-rollback: runtime + cache + pending all agree on `previous`.
    expect(i18n.language).toBe('pt-BR');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('pt-BR');
    expect(store.get(PENDING_LANGUAGE_STORAGE_KEY)).toBeUndefined();
  });

  it('rolls back on invalid-argument', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    mockUpdateDoc.mockRejectedValueOnce(firestoreError('invalid-argument'));

    const { remote } = await sync.changeLanguageForUser({ uid: 'alice', next: 'en' });
    const outcome = await remote;

    expect(outcome).toMatchObject({ status: 'rolled-back', reason: 'permanent' });
    expect(i18n.language).toBe('pt-BR');
    expect(store.get(PENDING_LANGUAGE_STORAGE_KEY)).toBeUndefined();
  });

  it('keeps local + pending on recoverable errors and resolves to status pending', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    mockUpdateDoc.mockRejectedValueOnce(firestoreError('unavailable'));

    const { remote } = await sync.changeLanguageForUser({ uid: 'alice', next: 'en' });
    const outcome = await remote;

    expect(outcome).toMatchObject({
      status: 'pending',
      reason: 'recoverable',
      error: expect.objectContaining({ code: 'unavailable' }),
    });
    expect(i18n.language).toBe('en');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('en');
    const raw = store.get(PENDING_LANGUAGE_STORAGE_KEY);
    expect(raw).toBeDefined();
    const p = JSON.parse(raw!) as PendingLanguageSync;
    expect(p).toMatchObject({ uid: 'alice', value: 'en', attempts: 1 });
  });

  it('remote handle never rejects — even permanent errors resolve with a tagged outcome', async () => {
    const { sync } = await freshEnv('pt-BR');
    mockUpdateDoc.mockRejectedValueOnce(firestoreError('permission-denied'));
    const { remote } = await sync.changeLanguageForUser({ uid: 'alice', next: 'en' });
    // Assert that awaiting the handle does not throw — a UI subscriber can
    // do `remote.then(...)` without a matching `.catch`.
    await expect(remote).resolves.toBeDefined();
  });
});

describe('changeLanguageForUser — payload shape (rules-driven)', () => {
  it('sends exactly { "preferences.language": next, "metadata.updatedAt": <serverTimestamp> } and nothing else', async () => {
    const { sync } = await freshEnv('pt-BR');
    mockUpdateDoc.mockResolvedValueOnce(undefined);
    const { remote } = await sync.changeLanguageForUser({ uid: 'alice', next: 'es' });
    await remote;
    const [, payload] = mockUpdateDoc.mock.calls[0]!;
    // Rule-required: metadata.updatedAt MUST equal request.time on every
    // authenticated update to /users/{uid}. Without it the server rejects
    // the whole write with permission-denied — that regression bit us in
    // production once and this test exists so it can't happen twice.
    expect(new Set(Object.keys(payload as object))).toEqual(
      new Set(['preferences.language', 'metadata.updatedAt']),
    );
    // Never send the whole preferences map (would trip preferencesValid.hasAll
    // if theme/units missing, or the inner .hasOnly(['language']) if not).
    expect(payload).not.toHaveProperty('preferences');
    expect(payload).not.toHaveProperty('preferences.theme');
    expect(payload).not.toHaveProperty('preferences.units');
    // Never send any other metadata subkey — only updatedAt is client-mutable.
    expect(payload).not.toHaveProperty('metadata.createdAt');
    expect(payload).not.toHaveProperty('metadata.role');
    expect(payload).not.toHaveProperty('metadata.activeWorkoutId');
  });
});

// ── reconcileLanguageOnLoad — non-blocking local + optional background ─────

describe('reconcileLanguageOnLoad — Case A: pending same UID', () => {
  it('applies pending locally, resolves fast, background push clears pending on success', async () => {
    const initialPending: PendingLanguageSync = {
      uid: 'alice', value: 'en', createdAt: 1, attempts: 1,
    };
    const { i18n, sync, store } = await freshEnv('pt-BR', {
      [PENDING_LANGUAGE_STORAGE_KEY]: JSON.stringify(initialPending),
    });
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'pt-BR',
    });
    // Local part already applied.
    expect(result.applied).toBe('pending-value');
    expect(i18n.language).toBe('en');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('en');

    // Background: awaiting reveals the eventual outcome.
    await expect(result.remote).resolves.toEqual({ status: 'synced' });
    expect(store.get(PENDING_LANGUAGE_STORAGE_KEY)).toBeUndefined();
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('returns fast even when the background push stays pending (offline reconciliation)', async () => {
    const initialPending: PendingLanguageSync = {
      uid: 'alice', value: 'en', createdAt: 1, attempts: 1,
    };
    const { sync } = await freshEnv('pt-BR', {
      [PENDING_LANGUAGE_STORAGE_KEY]: JSON.stringify(initialPending),
    });
    mockUpdateDoc.mockReturnValue(new Promise<void>(() => {}));

    // The `langReconciling` gate in App.tsx depends on this: if reconcile
    // awaited updateDoc, cold-start-while-offline would strand the router.
    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'pt-BR',
    });
    expect(result.applied).toBe('pending-value');
    const raced = await withTimeout(result.remote!, 25);
    expect(raced).toBe('__timeout__');
  });

  it('increments attempts and keeps pending on recoverable failure', async () => {
    const initialPending: PendingLanguageSync = {
      uid: 'alice', value: 'en', createdAt: 1, attempts: 2,
    };
    const { i18n, sync, store } = await freshEnv('pt-BR', {
      [PENDING_LANGUAGE_STORAGE_KEY]: JSON.stringify(initialPending),
    });
    mockUpdateDoc.mockRejectedValueOnce(firestoreError('unavailable'));

    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'pt-BR',
    });
    await expect(result.remote).resolves.toMatchObject({
      status: 'pending', reason: 'recoverable',
    });

    expect(i18n.language).toBe('en');
    const raw = store.get(PENDING_LANGUAGE_STORAGE_KEY)!;
    expect(JSON.parse(raw)).toMatchObject({ uid: 'alice', value: 'en', attempts: 3 });
  });

  it('falls back to remote value on permanent failure, clears pending', async () => {
    const initialPending: PendingLanguageSync = {
      uid: 'alice', value: 'es', createdAt: 1, attempts: 1,
    };
    const { i18n, sync, store } = await freshEnv('pt-BR', {
      [PENDING_LANGUAGE_STORAGE_KEY]: JSON.stringify(initialPending),
    });
    mockUpdateDoc.mockRejectedValueOnce(firestoreError('permission-denied'));

    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'en',
    });
    // Local first: applied pending immediately.
    expect(result.applied).toBe('pending-value');
    expect(i18n.language).toBe('es');

    // Background rolls forward to remote because permanent server rejection.
    const outcome = await result.remote;
    expect(outcome).toMatchObject({ status: 'rolled-back', reason: 'permanent' });
    expect(i18n.language).toBe('en');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(store.get(PENDING_LANGUAGE_STORAGE_KEY)).toBeUndefined();
  });
});

describe('reconcileLanguageOnLoad — Case B: no pending', () => {
  it('applies the remote language and mirrors to local storage — no push', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'es',
    });
    expect(result.applied).toBe('remote-value');
    expect(result.remote).toBeUndefined();
    expect(i18n.language).toBe('es');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('es');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('reconcileLanguageOnLoad — Case C: pending from another UID', () => {
  it("discards the previous user's pending and never pushes it to the current account", async () => {
    const foreignPending: PendingLanguageSync = {
      uid: 'mallory', value: 'es', createdAt: 1, attempts: 0,
    };
    const { i18n, sync, store } = await freshEnv('pt-BR', {
      [PENDING_LANGUAGE_STORAGE_KEY]: JSON.stringify(foreignPending),
    });

    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'en',
    });

    expect(result.applied).toBe('remote-value');
    expect(i18n.language).toBe('en');
    expect(store.get(PENDING_LANGUAGE_STORAGE_KEY)).toBeUndefined();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('reconcileLanguageOnLoad — Case D: no valid remote', () => {
  it('keeps local i18n untouched when remoteLanguage is null', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: null,
    });
    expect(result.applied).toBe('local-value');
    expect(i18n.language).toBe('pt-BR');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('pt-BR');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('ignores an unsupported remote language safely (Case D fallback)', async () => {
    const { i18n, sync, store } = await freshEnv('pt-BR');
    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'fr',
    });
    expect(result.applied).toBe('local-value');
    expect(i18n.language).toBe('pt-BR');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('pt-BR');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('reconcileLanguageOnLoad — no loops, no duplicate writes', () => {
  it('two back-to-back calls with no pending each write remote-mirror at most once', async () => {
    const { sync, store } = await freshEnv('pt-BR');
    await sync.reconcileLanguageOnLoad({ uid: 'alice', remoteLanguage: 'en' });
    await sync.reconcileLanguageOnLoad({ uid: 'alice', remoteLanguage: 'en' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('a single reconcile fires exactly one updateDoc per pending — no internal retry loop', async () => {
    const initialPending: PendingLanguageSync = {
      uid: 'alice', value: 'en', createdAt: 1, attempts: 1,
    };
    const { sync } = await freshEnv('pt-BR', {
      [PENDING_LANGUAGE_STORAGE_KEY]: JSON.stringify(initialPending),
    });
    mockUpdateDoc.mockRejectedValueOnce(firestoreError('unavailable'));
    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'pt-BR',
    });
    await result.remote;
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });
});

describe('logout preserves the language cache (contract via absence)', () => {
  it('never calls removeItem on the language cache key', async () => {
    const initialPending: PendingLanguageSync = {
      uid: 'alice', value: 'en', createdAt: 1, attempts: 0,
    };
    const { sync } = await freshEnv('pt-BR', {
      [PENDING_LANGUAGE_STORAGE_KEY]: JSON.stringify(initialPending),
    });
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const result = await sync.reconcileLanguageOnLoad({
      uid: 'alice', remoteLanguage: 'pt-BR',
    });
    await result.remote;

    const removedKeys = mockRemoveItem.mock.calls.map(([k]) => k);
    expect(removedKeys).not.toContain(LANGUAGE_STORAGE_KEY);
  });
});
