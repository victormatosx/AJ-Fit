import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('firebase-functions/v2', () => ({ logger: loggerMocks }));

import { logFunctionError, logInfo } from '../lib/logger';

describe('Functions logging policy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('masks operational identifiers and redacts promo codes centrally', () => {
    logInfo('billing', 'event', {
      uid: 'JPZ123456789Mc2',
      eventId: 'event_123456789',
      code: 'HELLO25',
    });

    expect(loggerMocks.info).toHaveBeenCalledWith('[billing] event', {
      uid: 'JPZ…Mc2',
      eventId: 'eve…789',
      code: '[redacted]',
    });
  });

  it('does not allow context to overwrite the provider error code', () => {
    logFunctionError(
      'promo',
      Object.assign(new Error('failure'), { code: 'functions/internal' }),
      { uid: 'abcdefghijk', code: 'SECRETCOUPON' },
    );

    expect(loggerMocks.error).toHaveBeenCalledWith('[promo]', {
      uid: 'abc…ijk',
      code: 'functions/internal',
    });
  });
});
