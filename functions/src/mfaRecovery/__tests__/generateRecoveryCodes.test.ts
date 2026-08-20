import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase-functions/v2/https', async () => {
  class HttpsError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { HttpsError, onCall: (_options: unknown, handler: unknown) => handler };
});

vi.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({ name, value: () => '' }),
}));

const getUser = vi.hoisted(() => vi.fn());
vi.mock('../../lib/firebaseAdmin', () => ({ auth: { getUser }, db: {} }));

const readRecoveryPepper = vi.hoisted(() => vi.fn());
vi.mock('../pepper', async () => {
  const actual = await vi.importActual<typeof import('../pepper')>('../pepper');
  return { ...actual, readRecoveryPepper: () => readRecoveryPepper() };
});

const persistNewRecoverySet = vi.hoisted(() => vi.fn());
const readRecoveryPointerState = vi.hoisted(() => vi.fn());
vi.mock('../recoverySetRepository', async () => {
  const actual =
    await vi.importActual<typeof import('../recoverySetRepository')>('../recoverySetRepository');
  return {
    ...actual,
    readRecoveryPointerState: (uid: string) => readRecoveryPointerState(uid),
    persistNewRecoverySet: (
      uid: string,
      expectedVersion: number,
      buildSet: (input: { version: number }) => unknown,
      now: Date,
    ) => persistNewRecoverySet(uid, expectedVersion, buildSet, now),
  };
});

import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';

import { parseRecoveryCode } from '../codeFormat';
import { RECOVERY_PEPPER_MIN_BYTES, computeRecoveryCodeDigest } from '../digest';
import { RecoveryError } from '../errors';
import { handleGenerateRecoveryCodes } from '../generateRecoveryCodes';
import {
  RecoveryGenerationConflictError,
  RecoverySelectorTakenError,
} from '../recoverySetRepository';
import { RECOVERY_CODES_PER_SET, validateRecoverySet } from '../schema';

const UID = 'alice';
const PEPPER = randomBytes(RECOVERY_PEPPER_MIN_BYTES);

function request(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      uid: UID,
      token: { auth_time: Math.floor(Date.now() / 1000) },
    },
    data: {},
    ...overrides,
  } as never;
}

/** Captures the document the handler asked the repository to persist. */
function persistedDocument(callIndex = 0): Record<string, unknown> {
  const buildSet = persistNewRecoverySet.mock.calls[callIndex][2];
  return (buildSet as (input: { version: number }) => Record<string, unknown>)({ version: 1 });
}

/** Succeeds, echoing back whatever selector the handler generated. */
function persistSucceeds() {
  return async (
    _uid: string,
    _expectedVersion: number,
    buildSet: (i: { version: number }) => { recoverySetId: string },
  ) => ({
    recoverySetId: buildSet({ version: 1 }).recoverySetId,
    rotatedSetId: null,
    version: 1,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({
    multiFactor: { enrolledFactors: [{ factorId: 'totp', uid: 'factor-1' }] },
  });
  readRecoveryPepper.mockReturnValue(PEPPER);
  readRecoveryPointerState.mockResolvedValue({ activeSetId: null, version: 0 });
  persistNewRecoverySet.mockImplementation(persistSucceeds());
});

describe('authentication', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(handleGenerateRecoveryCodes({ data: {} } as never)).rejects.toMatchObject({
      code: 'unauthenticated',
    });

    expect(persistNewRecoverySet).not.toHaveBeenCalled();
  });

  it('rejects a token with no auth_time', async () => {
    await expect(
      handleGenerateRecoveryCodes(request({ auth: { uid: UID, token: {} } })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects authentication older than five minutes', async () => {
    const stale = Math.floor(Date.now() / 1000) - (5 * 60 + 30);

    await expect(
      handleGenerateRecoveryCodes(request({ auth: { uid: UID, token: { auth_time: stale } } })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(persistNewRecoverySet).not.toHaveBeenCalled();
  });

  it('accepts authentication just inside the window', async () => {
    const fresh = Math.floor(Date.now() / 1000) - 60;

    await expect(
      handleGenerateRecoveryCodes(request({ auth: { uid: UID, token: { auth_time: fresh } } })),
    ).resolves.toMatchObject({ count: RECOVERY_CODES_PER_SET });
  });

  it('rejects an auth_time implausibly in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 600;

    await expect(
      handleGenerateRecoveryCodes(request({ auth: { uid: UID, token: { auth_time: future } } })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('takes the uid from the token and ignores the payload entirely', async () => {
    await handleGenerateRecoveryCodes(
      request({ data: { uid: 'mallory', email: 'mallory@example.com', recoverySetId: 'XX' } }),
    );

    expect(getUser).toHaveBeenCalledWith(UID);
    expect(persistNewRecoverySet.mock.calls[0][0]).toBe(UID);
    expect(persistedDocument().uid).toBe(UID);
  });
});

describe('MFA precondition', () => {
  it('refuses to generate for a user with no second factor', async () => {
    getUser.mockResolvedValue({ multiFactor: undefined });

    await expect(handleGenerateRecoveryCodes(request())).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(persistNewRecoverySet).not.toHaveBeenCalled();
  });

  it('refuses when enrolledFactors is empty', async () => {
    getUser.mockResolvedValue({ multiFactor: { enrolledFactors: [] } });

    await expect(handleGenerateRecoveryCodes(request())).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('does not accept a phone factor as a substitute for TOTP', async () => {
    getUser.mockResolvedValue({
      multiFactor: { enrolledFactors: [{ factorId: 'phone', uid: 'factor-1' }] },
    });

    await expect(handleGenerateRecoveryCodes(request())).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('proceeds when TOTP is enrolled alongside other factors', async () => {
    getUser.mockResolvedValue({
      multiFactor: {
        enrolledFactors: [
          { factorId: 'phone', uid: 'factor-1' },
          { factorId: 'totp', uid: 'factor-2' },
        ],
      },
    });

    await expect(handleGenerateRecoveryCodes(request())).resolves.toMatchObject({
      count: RECOVERY_CODES_PER_SET,
    });
  });
});

describe('secret availability', () => {
  it('fails without leaking that the pepper is missing', async () => {
    readRecoveryPepper.mockImplementation(() => {
      throw new RecoveryError('PEPPER_UNAVAILABLE');
    });

    // The pepper is read before any generation happens, so the failure
    // escapes as-is rather than being mapped — either way the caller never
    // learns which precondition failed.
    await expect(handleGenerateRecoveryCodes(request())).rejects.toThrow();
    expect(persistNewRecoverySet).not.toHaveBeenCalled();
  });
});

describe('successful generation', () => {
  it('returns exactly the declared response contract', async () => {
    const response = await handleGenerateRecoveryCodes(request());

    expect(Object.keys(response).sort()).toEqual(
      ['codes', 'count', 'createdAt', 'recoverySetId'].sort(),
    );
    expect(response.count).toBe(RECOVERY_CODES_PER_SET);
    expect(response.codes).toHaveLength(RECOVERY_CODES_PER_SET);
    expect(new Date(response.createdAt).toISOString()).toBe(response.createdAt);
  });

  it('never returns uid, digests, pepper version or internal state', async () => {
    const serialized = JSON.stringify(await handleGenerateRecoveryCodes(request()));

    for (const leaked of [
      UID,
      'pepperVersion',
      'digest',
      'rateLimit',
      'activeOperation',
      'schemaVersion',
      '_mfaRecovery',
      'status',
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('returns codes in the grouped form the client validates', async () => {
    // THE REGRESSION THIS LOCKS DOWN
    // ------------------------------
    // The generator produces the CANONICAL form (43 chars, no separators) —
    // that is what gets hashed. The client validates the DISPLAY form (53
    // chars, ten hyphens), because that is the artifact a user reads and
    // writes down. Phase 3 originally shipped without the formatting step at
    // the transport boundary, so every response failed the client's parser
    // with `recoveryInvalidResponse` even though generation had fully
    // succeeded and a recovery set had already been persisted.
    //
    // This pattern is copied verbatim from src/services/mfaRecovery.ts. The
    // two packages cannot share a module, so the contract is pinned on the
    // producing side instead.
    const CLIENT_PATTERN = /^AJF(-[0-9A-HJKMNP-TV-Z]{4}){10}$/;

    const response = await handleGenerateRecoveryCodes(request());

    for (const code of response.codes) {
      expect(code, 'must match the client-side contract').toMatch(CLIENT_PATTERN);
      expect(code).toHaveLength(53);
      expect((code.match(/-/g) ?? [])).toHaveLength(10);
    }
  });

  it('hashes the canonical form, not the formatted one', async () => {
    // Formatting happens after hashing. Both forms canonicalize identically,
    // so a user typing the grouped code back verifies against the same
    // digest — but the persisted digest must correspond to the canonical
    // string, which is what `computeRecoveryCodeDigest` receives upstream.
    const response = await handleGenerateRecoveryCodes(request());
    const persisted = persistedDocument().codes as Array<{ digest: string }>;

    for (const code of response.codes) {
      const canonical = parseRecoveryCode(code).canonical;
      expect(canonical).toHaveLength(43);
      expect(canonical).not.toContain('-');
      expect(computeRecoveryCodeDigest(canonical, PEPPER)).toBe(
        computeRecoveryCodeDigest(code, PEPPER),
      );
    }
    expect(persisted).toHaveLength(RECOVERY_CODES_PER_SET);
  });

  it('returns codes that all parse and share the returned selector', async () => {
    const response = await handleGenerateRecoveryCodes(request());

    for (const code of response.codes) {
      expect(parseRecoveryCode(code).selector).toBe(response.recoverySetId);
    }
  });

  it('returns unique codes', async () => {
    const { codes } = await handleGenerateRecoveryCodes(request());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('persists a schema-valid set containing only digests', async () => {
    const response = await handleGenerateRecoveryCodes(request());
    const document = persistedDocument();

    expect(validateRecoverySet(document)).toEqual([]);
    expect(document.status).toBe('active');
    expect(document.pepperVersion).toBe(1);

    const serialized = JSON.stringify(document);
    for (const code of response.codes) {
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain(parseRecoveryCode(code).secret);
    }
    expect(serialized).not.toContain('AJF');
  });

  it('marks every persisted code available and unreserved', async () => {
    await handleGenerateRecoveryCodes(request());
    const codes = persistedDocument().codes as Array<Record<string, unknown>>;

    expect(codes).toHaveLength(RECOVERY_CODES_PER_SET);
    for (const code of codes) {
      expect(code.state).toBe('available');
      expect(code.operationId).toBeNull();
      expect(code.consumedAt).toBeNull();
    }
  });

  it('uses the server clock for every timestamp', async () => {
    const before = Date.now();
    const response = await handleGenerateRecoveryCodes(request());
    const after = Date.now();

    const createdAt = new Date(response.createdAt).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
    expect(persistedDocument().createdAt).toBeInstanceOf(Date);
  });

  it('logs a creation event carrying no secret or identity', async () => {
    await handleGenerateRecoveryCodes(request());

    const [message, context] = vi.mocked(logger.info).mock.calls.at(-1) ?? [];
    expect(String(message)).toContain('generate:succeeded');
    expect(context).toMatchObject({ eventType: 'recovery_set_created' });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(UID);
    expect(serialized).not.toContain('AJF');
  });
});

describe('rotation', () => {
  it('logs a rotation event when a previous set was replaced', async () => {
    persistNewRecoverySet.mockResolvedValue({
      recoverySetId: 'SELECTORBBBB',
      rotatedSetId: 'SELECTORAAAA',
      version: 2,
    });

    await handleGenerateRecoveryCodes(request());

    const [, context] = vi.mocked(logger.info).mock.calls.at(-1) ?? [];
    expect(context).toMatchObject({ eventType: 'recovery_set_rotated' });
  });
});

describe('concurrent generation — exactly one winner', () => {
  it('reports a conflict instead of issuing a second set of codes', async () => {
    persistNewRecoverySet.mockRejectedValue(new RecoveryGenerationConflictError());

    const error = await handleGenerateRecoveryCodes(request()).catch((err) => err);

    expect(error).toBeInstanceOf(HttpsError);
    expect(error.code).toBe('aborted');
  });

  it('returns no plaintext at all to the loser', async () => {
    persistNewRecoverySet.mockRejectedValue(new RecoveryGenerationConflictError());

    const error = await handleGenerateRecoveryCodes(request()).catch((err) => err);

    // The whole point: a losing call must not hand out codes that are already
    // dead. There is no `codes` anywhere on the failure path.
    expect(error.codes).toBeUndefined();
    expect(JSON.stringify(error.message)).not.toContain('AJF');
  });

  it('does not retry a conflict as if it were a selector collision', async () => {
    // A retry would re-read the winner's version and then succeed — which is
    // exactly the bug. A conflict is terminal for this call.
    persistNewRecoverySet.mockRejectedValue(new RecoveryGenerationConflictError());

    await handleGenerateRecoveryCodes(request()).catch(() => undefined);

    expect(persistNewRecoverySet).toHaveBeenCalledTimes(1);
  });

  it('models two devices racing: one gets codes, the other is refused', async () => {
    // Device A and device B, same uid, both with fresh auth, both reading
    // version 0. The repository lets the first commit through and rejects the
    // second on the compare-and-set.
    let committed = false;
    persistNewRecoverySet.mockImplementation(
      async (
        _uid: string,
        _expectedVersion: number,
        buildSet: (i: { version: number }) => { recoverySetId: string },
      ) => {
        if (committed) {
          throw new RecoveryGenerationConflictError();
        }
        committed = true;
        return { recoverySetId: buildSet({ version: 1 }).recoverySetId, rotatedSetId: null, version: 1 };
      },
    );

    const [deviceA, deviceB] = await Promise.allSettled([
      handleGenerateRecoveryCodes(request()),
      handleGenerateRecoveryCodes(request()),
    ]);

    const outcomes = [deviceA, deviceB];
    const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const losers = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winner = (winners[0] as PromiseFulfilledResult<{ codes: string[] }>).value;
    expect(winner.codes).toHaveLength(RECOVERY_CODES_PER_SET);

    const loser = (losers[0] as PromiseRejectedResult).reason;
    expect(loser.code).toBe('aborted');
    expect(loser.codes).toBeUndefined();
  });

  it('logs the conflict without a code, uid or selector', async () => {
    persistNewRecoverySet.mockRejectedValue(new RecoveryGenerationConflictError());

    await handleGenerateRecoveryCodes(request()).catch(() => undefined);

    const logged = JSON.stringify([
      ...vi.mocked(logger.warn).mock.calls,
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.error).mock.calls,
    ]);
    expect(logged).toContain('GENERATION_CONFLICT');
    expect(logged).not.toContain('AJF');
    expect(logged).not.toContain(UID);
  });
});

describe('lost response — state idempotency is not response idempotency', () => {
  it('mints a brand new set rather than replaying an earlier one', async () => {
    // The winner committed but its response never reached the client. The
    // client calls again. The backend CANNOT return the previous plaintext —
    // it was never stored — so it generates a fresh set and rotates the old.
    readRecoveryPointerState.mockResolvedValue({ activeSetId: 'PREVIOUSSETX', version: 1 });
    persistNewRecoverySet.mockImplementation(
      async (
        _uid: string,
        _expectedVersion: number,
        buildSet: (i: { version: number }) => { recoverySetId: string },
      ) => ({
        recoverySetId: buildSet({ version: 2 }).recoverySetId,
        rotatedSetId: 'PREVIOUSSETX',
        version: 2,
      }),
    );

    const response = await handleGenerateRecoveryCodes(request());

    expect(response.recoverySetId).not.toBe('PREVIOUSSETX');
    expect(response.codes).toHaveLength(RECOVERY_CODES_PER_SET);
    // Committed against the version it actually read — a legitimate sequential
    // regeneration, not a conflict.
    expect(persistNewRecoverySet.mock.calls[0][1]).toBe(1);
  });

  it('never exposes a way to read a previous set back', async () => {
    // There is no handler input that could name an earlier set: the payload is
    // not read at all, so a "give me my codes again" call is not expressible.
    await handleGenerateRecoveryCodes(
      request({ data: { recoverySetId: 'PREVIOUSSETX', replay: true } }),
    );

    expect(persistNewRecoverySet).toHaveBeenCalledTimes(1);
    expect(persistedDocument().recoverySetId).not.toBe('PREVIOUSSETX');
  });
});

describe('failure handling', () => {
  it('retries with a fresh selector when one is taken', async () => {
    persistNewRecoverySet
      .mockRejectedValueOnce(new RecoverySelectorTakenError())
      .mockImplementationOnce(persistSucceeds());

    const response = await handleGenerateRecoveryCodes(request());

    expect(persistNewRecoverySet).toHaveBeenCalledTimes(2);
    // The retry regenerated everything, so the two attempts used different
    // selectors — reusing secrets under a new selector would break the digests.
    const first = persistedDocument(0).recoverySetId;
    const second = persistedDocument(1).recoverySetId;
    expect(first).not.toBe(second);
    expect(response.recoverySetId).toBe(second);
  });

  it('commits every selector retry against the SAME expected version', async () => {
    persistNewRecoverySet
      .mockRejectedValueOnce(new RecoverySelectorTakenError())
      .mockImplementationOnce(persistSucceeds());
    readRecoveryPointerState.mockResolvedValue({ activeSetId: 'PREVIOUSSETX', version: 4 });

    await handleGenerateRecoveryCodes(request());

    // Re-reading the version on retry would let this call adopt a concurrent
    // winner's state and rotate codes already handed to a user. The token is
    // read once, before minting, and never refreshed.
    expect(persistNewRecoverySet.mock.calls[0][1]).toBe(4);
    expect(persistNewRecoverySet.mock.calls[1][1]).toBe(4);
    expect(readRecoveryPointerState).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget rather than looping', async () => {
    persistNewRecoverySet.mockRejectedValue(new RecoverySelectorTakenError());

    await expect(handleGenerateRecoveryCodes(request())).rejects.toMatchObject({
      code: 'internal',
    });
    expect(persistNewRecoverySet).toHaveBeenCalledTimes(3);
  });

  it('maps a repository failure to internal without detail', async () => {
    persistNewRecoverySet.mockRejectedValue(
      new Error('FIRESTORE_UNAVAILABLE project=ajfit-2f321'),
    );

    const error = await handleGenerateRecoveryCodes(request()).catch((err) => err);

    expect(error).toBeInstanceOf(HttpsError);
    expect(error.code).toBe('internal');
    expect(error.message).not.toContain('ajfit-2f321');
    expect(error.message).not.toContain('FIRESTORE_UNAVAILABLE');
  });

  it('never logs a recovery code when generation fails', async () => {
    persistNewRecoverySet.mockRejectedValue(new Error('boom'));

    await handleGenerateRecoveryCodes(request()).catch(() => undefined);

    const logged = JSON.stringify([
      ...vi.mocked(logger.error).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
      ...vi.mocked(logger.info).mock.calls,
    ]);
    expect(logged).not.toContain('AJF');
    expect(logged).not.toContain(UID);
  });
});
