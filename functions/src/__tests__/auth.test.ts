import { describe, expect, it } from 'vitest';

import { requireAuth } from '../lib/auth';

describe('requireAuth', () => {
  it('returns the uid from a verified auth token', () => {
    const uid = requireAuth({ auth: { uid: 'user-123' } } as never);

    expect(uid).toBe('user-123');
  });

  it('rejects a request with no verified auth token', () => {
    expect(() => requireAuth({ auth: null } as never)).toThrow(
      'This function requires an authenticated user.',
    );
  });

  it('never trusts a uid supplied in request.data', () => {
    const uid = requireAuth({
      auth: { uid: 'real-uid-from-token' },
      data: { uid: 'attacker-supplied-uid' },
    } as never);

    expect(uid).toBe('real-uid-from-token');
  });
});
