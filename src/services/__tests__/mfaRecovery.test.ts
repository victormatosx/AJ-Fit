import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  call: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  app: { name: '[DEFAULT]' },
  auth: {
    app: { name: '[DEFAULT]' },
    currentUser: { uid: 'alice' } as { uid: string } | null,
  },
}));

// `lib/firebase` pulls in react-native; the service only needs `auth`.
vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => {
    mocks.httpsCallable(...args);
    return mocks.call;
  },
}));

vi.mock('../../lib/firebaseFunctions', () => ({ functions: { app: mocks.auth.app } }));
vi.mock('../../lib/logger', () => ({ logError: mocks.logError, logWarn: mocks.logWarn }));

import { MfaRecoveryError } from '../../lib/mfaRecoveryErrors';
import {
  RECOVERY_CODES_PER_SET,
  generateRecoveryCodes,
  parseRecoveryCodesPayload,
} from '../mfaRecovery';

/** Ten well-formed, distinct codes sharing one selector. */
function validCodes(): string[] {
  const selector = '2W7K-9XQF-3MTB';
  const secrets = [
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AB',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AC',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AD',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AE',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AF',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AG',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AH',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AJ',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AK',
    'GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AM',
  ];
  return secrets.map((secret) => `AJF-${selector}-${secret}`);
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    recoverySetId: '2W7K9XQF3MTB',
    codes: validCodes(),
    createdAt: '2026-08-20T10:00:00.000Z',
    count: RECOVERY_CODES_PER_SET,
    ...overrides,
  };
}

function callableError(code: string) {
  return Object.assign(new Error(code), { code: `functions/${code}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = { uid: 'alice' };
  mocks.call.mockResolvedValue({ data: validPayload() });
});

describe('generateRecoveryCodes — no session on this device', () => {
  it('fails locally without calling the backend', async () => {
    mocks.auth.currentUser = null;

    await expect(generateRecoveryCodes()).rejects.toMatchObject({
      issue: 'recoveryUnauthenticated',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('logs a distinguishable reason', async () => {
    mocks.auth.currentUser = null;

    await generateRecoveryCodes().catch(() => undefined);

    // "no session here" must be tellable apart from "backend rejected a token".
    expect(mocks.logError.mock.calls[0]![0]).toContain('no-current-user');
  });
});

describe('generateRecoveryCodes — the request', () => {
  it('calls generateMfaRecoveryCodes by name', async () => {
    await generateRecoveryCodes();

    expect(mocks.httpsCallable.mock.calls[0]![1]).toBe('generateMfaRecoveryCodes');
  });

  it('sends no arguments at all', async () => {
    await generateRecoveryCodes();

    // Identity comes from the verified ID token on the backend. A uid, email,
    // provider or recoverySetId sent from here would be a spoofing surface.
    expect(mocks.call).toHaveBeenCalledWith();
    expect(mocks.call.mock.calls[0]).toHaveLength(0);
  });
});

describe('generateRecoveryCodes — a valid response', () => {
  it('returns exactly ten codes', async () => {
    const result = await generateRecoveryCodes();

    expect(result.codes).toHaveLength(RECOVERY_CODES_PER_SET);
    expect(result.count).toBe(RECOVERY_CODES_PER_SET);
  });

  it('drops backend-only fields instead of forwarding them', async () => {
    const result = await generateRecoveryCodes();

    // recoverySetId/createdAt are backend state the UI must never render.
    expect(Object.keys(result).sort()).toEqual(['codes', 'count']);
  });

  it('logs nothing on the happy path', async () => {
    await generateRecoveryCodes();

    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

describe('parseRecoveryCodesPayload — defensive validation', () => {
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
    ['a missing codes field', validPayload({ codes: undefined })],
    ['codes that are not an array', validPayload({ codes: 'AJF-...' })],
  ])('rejects %s', (_label, data) => {
    expect(() => parseRecoveryCodesPayload(data)).toThrow(MfaRecoveryError);
  });

  it('rejects a set with the wrong number of codes', () => {
    expect(() => parseRecoveryCodesPayload(validPayload({ codes: validCodes().slice(0, 9) }))).toThrow(
      MfaRecoveryError,
    );
    expect(() =>
      parseRecoveryCodesPayload(validPayload({ codes: [...validCodes(), validCodes()[0]] })),
    ).toThrow(MfaRecoveryError);
  });

  it('rejects a count that disagrees with the codes array', () => {
    // Two halves of one response from different states — refuse, do not pick.
    expect(() => parseRecoveryCodesPayload(validPayload({ count: 9 }))).toThrow(MfaRecoveryError);
  });

  it('rejects a malformed code', () => {
    const codes = validCodes();
    codes[4] = 'NOT-A-RECOVERY-CODE';

    expect(() => parseRecoveryCodesPayload(validPayload({ codes }))).toThrow(MfaRecoveryError);
  });

  it('rejects a code containing an excluded alphabet symbol', () => {
    const codes = validCodes();
    // I, L, O and U are never generated; seeing one means this is not our code.
    codes[0] = codes[0].replace('GHJK', 'GHJI');

    expect(() => parseRecoveryCodesPayload(validPayload({ codes }))).toThrow(MfaRecoveryError);
  });

  it('rejects a non-string entry', () => {
    const codes: unknown[] = validCodes();
    codes[2] = 12345;

    expect(() => parseRecoveryCodesPayload(validPayload({ codes }))).toThrow(MfaRecoveryError);
  });

  it('rejects duplicates', () => {
    const codes = validCodes();
    codes[7] = codes[0];

    expect(() => parseRecoveryCodesPayload(validPayload({ codes }))).toThrow(MfaRecoveryError);
  });

  it('reports recoveryInvalidResponse and shows nothing partially', async () => {
    mocks.call.mockResolvedValue({ data: validPayload({ count: 3 }) });

    await expect(generateRecoveryCodes()).rejects.toMatchObject({
      issue: 'recoveryInvalidResponse',
    });
  });

  it('accepts a well-formed payload', () => {
    expect(parseRecoveryCodesPayload(validPayload()).codes).toHaveLength(RECOVERY_CODES_PER_SET);
  });
});

describe('generateRecoveryCodes — error mapping', () => {
  it.each([
    ['unauthenticated', 'recoveryUnauthenticated'],
    ['failed-precondition', 'recoveryReauthRequired'],
    ['permission-denied', 'recoveryReauthRequired'],
    ['aborted', 'recoveryConflict'],
    ['unavailable', 'recoveryNetworkUnavailable'],
    ['deadline-exceeded', 'recoveryNetworkUnavailable'],
    ['internal', 'recoveryGenerationFailed'],
    ['something-else', 'recoveryGenerationFailed'],
  ])('maps %s to %s', async (code, issue) => {
    mocks.call.mockRejectedValue(callableError(code));

    await expect(generateRecoveryCodes()).rejects.toMatchObject({ issue });
  });

  it('treats a codeless rejection as a network failure', async () => {
    mocks.call.mockRejectedValue(new Error('Network request failed'));

    await expect(generateRecoveryCodes()).rejects.toMatchObject({
      issue: 'recoveryNetworkUnavailable',
    });
  });

  it('reports a conflict as its own issue so the UI can offer a retry', async () => {
    mocks.call.mockRejectedValue(callableError('aborted'));

    const error = await generateRecoveryCodes().catch((err) => err);
    expect(error.issue).toBe('recoveryConflict');
  });
});

describe('generateRecoveryCodes — nothing sensitive is logged', () => {
  it('never logs the response, even when parsing fails', async () => {
    mocks.call.mockResolvedValue({ data: validPayload({ count: 2 }) });

    await generateRecoveryCodes().catch(() => undefined);

    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain('AJF-');
    for (const code of validCodes()) {
      expect(logged).not.toContain(code);
    }
  });

  it('never logs the raw rejection object', async () => {
    mocks.call.mockRejectedValue(
      Object.assign(new Error('boom'), {
        code: 'functions/internal',
        details: { codes: validCodes() },
      }),
    );

    await generateRecoveryCodes().catch(() => undefined);

    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain('AJF-');
  });

  it('logs only a sanitized issue', async () => {
    mocks.call.mockRejectedValue(callableError('aborted'));

    await generateRecoveryCodes().catch(() => undefined);

    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const [scope, error] = mocks.logError.mock.calls[0]!;
    // The transport status is included so a real incident is diagnosable from
    // a device log; it is a closed-vocabulary word, never free text.
    expect(scope).toBe('mfaRecovery:generate (aborted)');
    expect((error as MfaRecoveryError).issue).toBe('recoveryConflict');
  });
});
