import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PASSWORD_RESET_COOLDOWN_MS,
  createPasswordResetCooldown,
  requestPasswordResetWithCooldown,
} from '../passwordResetCooldown';

describe('password reset UX cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('starts only after an accepted request and suppresses accidental resends', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const cooldown = createPasswordResetCooldown();

    await expect(
      requestPasswordResetWithCooldown(cooldown, request),
    ).resolves.toEqual({ status: 'sent', remainingSeconds: 60 });
    await expect(
      requestPasswordResetWithCooldown(cooldown, request),
    ).resolves.toEqual({ status: 'cooldown', remainingSeconds: 60 });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows another request when the cooldown expires', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const cooldown = createPasswordResetCooldown();

    await requestPasswordResetWithCooldown(cooldown, request);
    vi.advanceTimersByTime(PASSWORD_RESET_COOLDOWN_MS);
    await requestPasswordResetWithCooldown(cooldown, request);

    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    'auth/network-request-failed',
    'auth/too-many-requests',
    'auth/internal-error',
  ])('does not start after %s', async (code) => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('request failed'), { code }))
      .mockResolvedValueOnce(undefined);
    const cooldown = createPasswordResetCooldown();

    await expect(
      requestPasswordResetWithCooldown(cooldown, request),
    ).rejects.toMatchObject({ code });
    expect(cooldown.isActive()).toBe(false);

    await expect(
      requestPasswordResetWithCooldown(cooldown, request),
    ).resolves.toMatchObject({ status: 'sent' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
