export type NotificationAccountLifecycleHandlers = Readonly<{
  queueDeviceRelease: (uid: string) => Promise<unknown>;
  clearPreferenceState: (uid: string) => Promise<void>;
}>;

let handlers: NotificationAccountLifecycleHandlers | null = null;

/**
 * Keeps Auth and account-deletion cleanup independent from React Native and
 * expo-notifications at module-load time. The passive push runtime installs
 * the concrete handlers when the application bundle initializes.
 */
export function configureNotificationAccountLifecycle(
  nextHandlers: NotificationAccountLifecycleHandlers,
): void {
  handlers = nextHandlers;
}

export async function queueNotificationDeviceRelease(uid: string): Promise<void> {
  await handlers?.queueDeviceRelease(uid);
}

export async function clearNotificationAccountPreferenceState(uid: string): Promise<void> {
  await handlers?.clearPreferenceState(uid);
}
