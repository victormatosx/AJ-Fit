import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RECOVERY_LOG_ALLOWED_FIELDS,
  RECOVERY_LOG_SCOPE,
  buildRecoveryLogContext,
  logRecoveryEvent,
} from '../logging';

const logInfo = vi.hoisted(() => vi.fn());
const logWarn = vi.hoisted(() => vi.fn());

vi.mock('../../lib/logger', () => ({ logInfo, logWarn }));

afterEach(() => {
  vi.clearAllMocks();
});

/** Everything a recovery log line must never be able to carry. */
const NEVER_LOGGABLE = [
  'code',
  'recoveryCode',
  'plaintext',
  'digest',
  'pepper',
  'selector',
  'secret',
  'totp',
  'totpCode',
  'qrSecret',
  'idToken',
  'refreshToken',
  'customToken',
  'password',
  'credential',
  'googleCredential',
  'appleCredential',
  'email',
  'uid',
  'displayName',
  'phoneNumber',
] as const;

describe('recovery logging — allow-list', () => {
  it('declares the complete set of emittable fields', () => {
    expect([...RECOVERY_LOG_ALLOWED_FIELDS].sort()).toEqual(
      [
        'attempt',
        'eventType',
        'internalCode',
        'operationId',
        'outcome',
        'schemaVersion',
        'stage',
      ].sort(),
    );
  });

  it('never allows a field that could carry a secret or identify the account', () => {
    for (const forbidden of NEVER_LOGGABLE) {
      expect(RECOVERY_LOG_ALLOWED_FIELDS).not.toContain(forbidden);
    }
  });

  it('emits only allow-listed keys', () => {
    const context = buildRecoveryLogContext({
      eventType: 'recovery.attempt',
      stage: 'verify',
      outcome: 'rejected',
      internalCode: 'CODE_NOT_FOUND',
      operationId: 'abcdefgh-1234-5678-9012-abcdefabcdef',
      attempt: 2,
      schemaVersion: 1,
    });

    for (const key of Object.keys(context)) {
      expect(RECOVERY_LOG_ALLOWED_FIELDS).toContain(key);
    }
  });

  it('drops any field not on the allow-list, even when handed one', () => {
    const context = buildRecoveryLogContext({
      eventType: 'recovery.attempt',
      stage: 'verify',
      outcome: 'rejected',
      // Fields a future contributor might add by mistake.
      uid: 'user-123',
      email: 'alice@example.com',
      selector: '2W7K9XQF3MTB',
      digest: 'ZGlnZXN0',
      code: 'AJF-2W7K-9XQF',
    } as never);

    expect(context).toEqual({
      eventType: 'recovery.attempt',
      stage: 'verify',
      outcome: 'rejected',
    });

    const serialized = JSON.stringify(context);
    for (const leaked of ['user-123', 'alice@example.com', '2W7K9XQF3MTB', 'ZGlnZXN0', 'AJF-']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('omits optional fields rather than emitting undefined', () => {
    const context = buildRecoveryLogContext({
      eventType: 'recovery.attempt',
      stage: 'parse',
      outcome: 'started',
    });

    expect(Object.keys(context).sort()).toEqual(['eventType', 'outcome', 'stage']);
  });
});

describe('recovery logging — operationId handling', () => {
  it('truncates the operationId to a short correlation prefix', () => {
    const operationId = 'abcdefgh-1234-5678-9012-abcdefabcdef';
    const context = buildRecoveryLogContext({
      eventType: 'recovery.attempt',
      stage: 'reserve',
      outcome: 'succeeded',
      operationId,
    });

    expect(context.operationId).toBe('abcdefgh');
    expect(context.operationId).not.toBe(operationId);
    expect(String(context.operationId).length).toBeLessThan(operationId.length);
  });
});

describe('recovery logging — severity', () => {
  it.each(['started', 'succeeded'] as const)('logs %s at info', (outcome) => {
    logRecoveryEvent({ eventType: 'recovery.attempt', stage: 'reset', outcome });

    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logWarn).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      RECOVERY_LOG_SCOPE,
      `reset:${outcome}`,
      expect.objectContaining({ outcome }),
    );
  });

  it.each(['rejected', 'failed'] as const)('logs %s at warn', (outcome) => {
    logRecoveryEvent({ eventType: 'recovery.attempt', stage: 'verify', outcome });

    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('scopes every line under mfaRecovery', () => {
    expect(RECOVERY_LOG_SCOPE).toBe('mfaRecovery');

    logRecoveryEvent({ eventType: 'recovery.attempt', stage: 'lookup', outcome: 'started' });

    expect(logInfo.mock.calls[0][0]).toBe(RECOVERY_LOG_SCOPE);
  });

  it('never passes a raw error object through', () => {
    logRecoveryEvent({
      eventType: 'recovery.attempt',
      stage: 'reset',
      outcome: 'failed',
      internalCode: 'RECOVERY_SET_NOT_ACTIVE',
    });

    const [, message, context] = logWarn.mock.calls[0];
    expect(message).toBe('reset:failed');
    expect(context).toEqual({
      eventType: 'recovery.attempt',
      stage: 'reset',
      outcome: 'failed',
      internalCode: 'RECOVERY_SET_NOT_ACTIVE',
    });
  });
});
