import { useEffect } from 'react';

import {
  initializePushNotificationRuntime,
  requestPushTokenForDevelopment,
  type PushTokenSnapshot,
} from '../services/pushNotifications';

declare global {
  // Development-build console hook for push *registration* diagnostics only.
  // It is never installed in production and cannot send a notification: the
  // in-app QA dispatch surface was removed, and `dispatchTestNotification`
  // remains a backend-authorized callable with no client wrapper.
  var __AJFIT_PUSH_QA__:
    | {
        requestPermissionAndGetToken(): Promise<PushTokenSnapshot | null>;
      }
    | undefined;
}

/**
 * Installs passive receive/open/token-refresh listeners for the process.
 * It intentionally never requests permission or fetches a token.
 */
export function PushNotificationsRuntime() {
  useEffect(() => {
    const disposeRuntime = initializePushNotificationRuntime();

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      globalThis.__AJFIT_PUSH_QA__ = {
        requestPermissionAndGetToken: requestPushTokenForDevelopment,
      };
    }

    return () => {
      disposeRuntime();
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        globalThis.__AJFIT_PUSH_QA__ = undefined;
      }
    };
  }, []);
  return null;
}
