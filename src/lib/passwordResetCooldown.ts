export const PASSWORD_RESET_COOLDOWN_MS = 60_000;

export type PasswordResetCooldown = {
  isActive: () => boolean;
  remainingSeconds: () => number;
  start: () => number;
};

export type PasswordResetRequestResult =
  | { status: 'cooldown'; remainingSeconds: number }
  | { status: 'sent'; remainingSeconds: number };

/**
 * Ephemeral UX-only cooldown. It deliberately uses no persistent storage:
 * callers that bypass the app also bypass this mechanism, so server-side
 * abuse protection remains Firebase/Identity Platform's responsibility.
 */
export function createPasswordResetCooldown(
  now: () => number = Date.now,
): PasswordResetCooldown {
  let expiresAt = 0;

  const remainingSeconds = () =>
    Math.max(0, Math.ceil((expiresAt - now()) / 1_000));

  return {
    isActive: () => remainingSeconds() > 0,
    remainingSeconds,
    start: () => {
      expiresAt = now() + PASSWORD_RESET_COOLDOWN_MS;
      return remainingSeconds();
    },
  };
}

/**
 * Starts the cooldown only after Firebase accepts the reset request. Network
 * and Firebase failures leave the user immediately able to try again.
 */
export async function requestPasswordResetWithCooldown(
  cooldown: PasswordResetCooldown,
  request: () => Promise<void>,
): Promise<PasswordResetRequestResult> {
  const currentRemaining = cooldown.remainingSeconds();
  if (currentRemaining > 0) {
    return { status: 'cooldown', remainingSeconds: currentRemaining };
  }

  await request();
  return { status: 'sent', remainingSeconds: cooldown.start() };
}
