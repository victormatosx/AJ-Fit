import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorReason, logError, logInfo, sanitizeLogContext, sanitizeLogText } from '../logger';

afterEach(() => vi.restoreAllMocks());

describe('client logging policy', () => {
  it('extracts only safe callable reason enums from details or message', () => {
    expect(errorReason({ details: { reason: 'reposition_current_session_index_out_of_range' } }))
      .toBe('reposition_current_session_index_out_of_range');
    expect(errorReason(new Error('reposition_current_session_index_out_of_range')))
      .toBe('reposition_current_session_index_out_of_range');
    expect(errorReason(new Error('User email is user@example.com'))).toBeUndefined();
  });

  it('redacts identifiers, credentials, emails and JWT-like values', () => {
    expect(
      sanitizeLogContext({
        uid: 'JPZ123456789Mc2',
        eventId: 'event_123456789',
        appUserId: 'firebase-user-12345',
        originalAppUserId: '$RCAnonymousID:customer-original-12345',
        token: 'secret-token',
      }),
    ).toEqual({
      uid: 'JPZ…Mc2',
      eventId: 'eve…789',
      appUserId: 'fir…345',
      originalAppUserId: '$RC…345',
      token: '[redacted]',
    });
    expect(sanitizeLogText('user@example.com eyJabc.def.ghi')).toBe(
      '[redacted-email] [redacted-jwt]',
    );
  });

  it('drops INFO in production but preserves sanitized errors', () => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logInfo('subscription', 'customer_info_listener_update', { uid: 'abcdefghijk' });
    logError('auth:sign-in', Object.assign(new Error('failed for me@example.com'), {
      code: 'auth/invalid-credential',
    }));

    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[auth:sign-in]', {
      code: 'auth/invalid-credential',
      message: 'failed for [redacted-email]',
    });
  });

  it('sanitizes throttling errors without retaining attempted auth data', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logError(
      'auth:sign-in',
      Object.assign(
        new Error(
          'auth/too-many-requests for person@example.com with attempted-password-123',
        ),
        { code: 'auth/too-many-requests' },
      ),
      {
        email: 'person@example.com',
        password: 'attempted-password-123',
        credential: 'opaque-credential',
        authorization: 'Bearer opaque-token',
      },
    );

    const serialized = JSON.stringify(error.mock.calls);
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('attempted-password-123');
    expect(serialized).not.toContain('opaque-credential');
    expect(serialized).not.toContain('opaque-token');
    expect(serialized).toContain('auth/too-many-requests');
  });

  it('never serializes exception cause, metadata or payload credentials', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'correct horse battery staple';
    const error = Object.assign(new Error('request rejected'), {
      code: 'auth/weak-password',
      cause: { password: secret },
      metadata: { credential: secret },
      payload: { authorization: secret },
    });

    logError('auth:signup', error);

    const serialized = JSON.stringify(errorLog.mock.calls);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('cause');
    expect(serialized).not.toContain('metadata');
    expect(serialized).not.toContain('payload');
  });
});
