export type DeepLinkIntent =
  | Readonly<{ type: 'active-workout' }>
  | Readonly<{ type: 'support-case'; caseId: string }>;

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
  if (!pending || pending.type !== incoming.type) return incoming;
  if (pending.type === 'support-case' && incoming.type === 'support-case') {
    return pending.caseId === incoming.caseId ? pending : incoming;
  }
  return pending;
}

export function consumeDeepLinkIntent(
  pending: DeepLinkIntent | null,
  handled: DeepLinkIntent,
): DeepLinkIntent | null {
  if (!pending || pending.type !== handled.type) return pending;
  if (pending.type === 'support-case' && handled.type === 'support-case') {
    return pending.caseId === handled.caseId ? null : pending;
  }
  return null;
}
