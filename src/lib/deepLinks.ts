export type DeepLinkIntent =
  | Readonly<{ type: 'active-workout' }>
  | Readonly<{ type: 'support-case'; caseId: string }>
  | Readonly<{ type: 'campaign-tab'; tab: 'home' | 'workout' | 'progress' | 'profile' }>
  | Readonly<{ type: 'nutrition-tab'; destination: 'plan' | 'diary' | 'weekly'; recipientUid?: string }>;

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
  if (pending.type === 'campaign-tab' && incoming.type === 'campaign-tab') return pending.tab === incoming.tab ? pending : incoming;
  if (pending.type === 'nutrition-tab' && incoming.type === 'nutrition-tab') {
    return pending.destination === incoming.destination && pending.recipientUid === incoming.recipientUid ? pending : incoming;
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
  if (pending.type === 'campaign-tab' && handled.type === 'campaign-tab') return pending.tab === handled.tab ? null : pending;
  if (pending.type === 'nutrition-tab' && handled.type === 'nutrition-tab') {
    return pending.destination === handled.destination && pending.recipientUid === handled.recipientUid ? null : pending;
  }
  return null;
}
