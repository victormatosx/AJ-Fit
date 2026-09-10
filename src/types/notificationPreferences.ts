/**
 * The three user-facing notification groups (AJ Fit product notifications —
 * docs Fase 4 §5/§12). Deliberately NOT the 16 individual future
 * notifications and NOT `OPERATIONAL` (billing alerts): those always reach
 * the user regardless of these toggles — see
 * `functions/src/notifications/preferences.ts`, the server-side mirror of
 * this exact field list.
 *
 * `firestore.rules :: notificationPreferencesValid` MUST accept exactly this
 * set. If you add or remove a key, update the rules file (and its tests) in
 * the same change — same contract-lives-in-two-places convention as
 * `SUPPORTED_LANGUAGES` in `language.ts`.
 */
export const NOTIFICATION_PREFERENCE_KEYS = [
  'workoutsAndReminders',
  'evolutionAndAchievements',
  'progress',
] as const;

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

/** Persisted at `users/{uid}.preferences.notificationPreferences`. Every key is optional — an absent key means "default true", never written by this app. */
export type NotificationPreferences = Partial<Record<NotificationPreferenceKey, boolean>>;

/** A missing field (legacy user, or a toggle never touched) defaults to on — read-time fallback only, never backfilled (docs Fase 4 §3). */
export const DEFAULT_NOTIFICATION_PREFERENCE = true;

export function isNotificationPreferenceKey(value: unknown): value is NotificationPreferenceKey {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_PREFERENCE_KEYS as readonly string[]).includes(value)
  );
}
/** Resolves one key with the default-true fallback — the single place both the settings screen and any future reader should use. */
export function resolveNotificationPreference(
  preferences: NotificationPreferences | undefined,
  key: NotificationPreferenceKey,
): boolean {
  const value = preferences?.[key];
  return typeof value === 'boolean' ? value : DEFAULT_NOTIFICATION_PREFERENCE;
}
