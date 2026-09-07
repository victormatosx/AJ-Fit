import { useEffect } from 'react';

import {
  initializePushNotificationRuntime,
  requestPushTokenForDevelopment,
  type PushTokenSnapshot,
} from '../services/pushNotifications';
import {
  sendQaPushNotification,
  type QaPushDispatchResult,
} from '../services/qaPushNotification';

declare global {
  // Development-build console hook. It is never installed in production.
  var __AJFIT_PUSH_QA__:
    | {
        requestPermissionAndGetToken(): Promise<PushTokenSnapshot | null>;
        sendSelfTestNotification(): Promise<QaPushDispatchResult>;
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
        sendSelfTestNotification: sendQaPushNotification,
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
