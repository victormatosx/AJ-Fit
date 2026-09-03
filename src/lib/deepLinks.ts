export type DeepLinkIntent = Readonly<{
  type: 'active-workout';
}>;

/**
 * Converts an external URL into one of the app's explicitly supported
 * internal intents. Keep this allowlist strict: URLs never become tab ids or
 * other navigation state directly.
 */
export function parseDeepLink(url: string): DeepLinkIntent | null {
  try {
    const parsed = new URL(url);
    const isActiveWorkout =
      parsed.protocol === 'ajfit:' &&
      parsed.hostname === 'workout' &&
      parsed.pathname === '/active' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      parsed.search === '' &&
      parsed.hash === '';

    return isActiveWorkout ? { type: 'active-workout' } : null;
  } catch {
    return null;
  }
}

export function enqueueDeepLinkIntent(
  pending: DeepLinkIntent | null,
  incoming: DeepLinkIntent,
): DeepLinkIntent {
  return pending?.type === incoming.type ? pending : incoming;
}

export function consumeDeepLinkIntent(
  pending: DeepLinkIntent | null,
  handled: DeepLinkIntent,
): DeepLinkIntent | null {
  return pending?.type === handled.type ? null : pending;
}
