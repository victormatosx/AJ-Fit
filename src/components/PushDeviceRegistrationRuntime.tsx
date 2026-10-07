import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../state/AuthContext';
import { subscribeToPushTokenChanges } from '../services/pushNotifications';
import {
  getAuthenticatedPushUser,
  queueCurrentDeviceRelease,
  refreshCurrentDeviceToken,
  retryPendingDeviceBindings,
  setAuthenticatedPushUser,
} from '../services/pushDeviceRegistration';
import {
  clearNotificationPreferenceState,
  primeNotificationPreferencesCache,
  reconcilePendingNotificationPreferences,
} from '../services/notificationPreferences';
import { configureNotificationAccountLifecycle } from '../services/notificationAccountLifecycle';

configureNotificationAccountLifecycle({
  queueDeviceRelease: queueCurrentDeviceRelease,
  clearPreferenceState: clearNotificationPreferenceState,
});

/**
 * Identity adapter only. Device/token persistence remains encapsulated by
 * pushDeviceRegistration; AuthContext does not know Firestore paths or token
 * fields, and this component never requests notification permission.
 */
export function PushDeviceRegistrationRuntime() {
  const { user, profile, initializing, profileLoading } = useAuth();
  const uid = user?.uid ?? null;
  const previousUid = useRef<string | null>(null);
  const identityReady = !initializing && (!uid || (!profileLoading && profile !== null));

  useEffect(() => {
    if (!identityReady) return;
    const outgoingUid = previousUid.current;
    previousUid.current = uid;
    if (outgoingUid && outgoingUid !== uid) {
      void clearNotificationPreferenceState(outgoingUid);
    }
    void setAuthenticatedPushUser(uid);
    if (uid) {
      void reconcilePendingNotificationPreferences(uid);
      // Warms NotificationSettingsScreen's synchronous first-render hint —
      // see `primeNotificationPreferencesCache`'s doc comment — well before
      // the user could navigate there.
      void primeNotificationPreferencesCache(uid);
    }
  }, [identityReady, uid]);

  useEffect(() => subscribeToPushTokenChanges((token) => {
    const currentUid = getAuthenticatedPushUser();
    if (currentUid) void refreshCurrentDeviceToken(currentUid, token);
  }), []);

  useEffect(() => {
    void retryPendingDeviceBindings(getAuthenticatedPushUser());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const currentUid = getAuthenticatedPushUser();
      void retryPendingDeviceBindings(currentUid);
      if (currentUid) void reconcilePendingNotificationPreferences(currentUid);
    });
    return () => subscription.remove();
  }, []);

  return null;
}
