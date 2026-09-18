import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { isRunningInExpoGo } from 'expo';
import { Linking, Platform } from 'react-native';

import { logError, logInfo } from '../lib/logger';
import { getAJFitRestActivityNativeModule } from '../../modules/ajfit-rest-activity';

const PUSH_LOG_SCOPE = 'pushNotifications';
export const GENERAL_NOTIFICATION_CHANNEL_ID = 'ajfit_general';

export type PushPermissionStatus =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'unsupported'
  | 'error';

export type PushSupportReasonCode =
  | 'SUPPORTED'
  | 'UNSUPPORTED_PLATFORM'
  | 'EXPO_GO'
  | 'NATIVE_API_MISSING';

export type PushSupportStatus = Readonly<{
  supported: boolean;
  reasonCode: PushSupportReasonCode;
}>;

/**
 * Small routing-independent contract for future notification phases.
 * Display copy is deliberately absent: consumers must never route by title/body.
 */
export const PUSH_NOTIFICATION_TYPES = [
  'QA_TEST',
  'EVOLUTION_UNLOCKED',
  'EVOLUTION_APPROACHING',
  'PROGRAM_UPDATED',
  'BILLING_ISSUE',
  'PREMIUM_ENDED',
  'WORKOUT_DAY',
  'RECOVERY_DAY',
  'MISSED_WORKOUT',
  'RE_ENGAGEMENT_EARLY',
  'RE_ENGAGEMENT_LATE',
  'PHOTO_REMINDER',
  'ASSESSMENT_REMINDER',
  'COMPARE_PROGRESS',
  'WEEK_COMPLETED',
  'WEEK_STREAK',
  'SUPPORT_SINGLE_REPLY',
  'SUPPORT_CHAT_MESSAGE',
] as const;
export type PushNotificationType = (typeof PUSH_NOTIFICATION_TYPES)[number];

export interface PushPayload {
  type: PushNotificationType;
  notificationId: string;
  caseId?: string;
  messageId?: string;
}

export interface PushMessageEvent {
  notificationRequestId: string;
  payload: PushPayload | null;
  receivedAt: number;
}

export interface NotificationOpenEvent extends PushMessageEvent {
  actionIdentifier: string;
}

/** Runtime-only. Phase 2 will own durable, user-scoped multi-device storage. */
export interface PushTokenSnapshot {
  expoPushToken: string;
  nativeToken: {
    type: 'ios' | 'android';
    data: string;
  };
  obtainedAt: number;
}

type Subscription = { remove(): void };
type NotificationsApi = Pick<
  typeof Notifications,
  | 'addNotificationReceivedListener'
  | 'addNotificationResponseReceivedListener'
  | 'addPushTokenListener'
  | 'clearLastNotificationResponse'
  | 'getDevicePushTokenAsync'
  | 'getExpoPushTokenAsync'
  | 'getLastNotificationResponse'
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'
  | 'setNotificationChannelAsync'
  | 'setNotificationHandler'
> & {
  AndroidImportance: typeof Notifications.AndroidImportance;
  AndroidNotificationVisibility: typeof Notifications.AndroidNotificationVisibility;
  IosAuthorizationStatus: typeof Notifications.IosAuthorizationStatus;
};

export interface PushNotificationsDependencies {
  notifications: NotificationsApi;
  platform: string;
  isExpoGo: boolean;
  nativeApiAvailable: boolean;
  projectId?: string;
  now(): number;
  development: boolean;
  recordAndroidPermissionRequest(): void | Promise<void>;
  info(message: string, context?: Record<string, unknown>): void;
  error(operation: string, cause: unknown): void;
}

export interface PushNotificationsService {
  isPushSupported(): boolean;
  getPushSupportStatus(): PushSupportStatus;
  getNotificationPermissionStatus(): Promise<PushPermissionStatus>;
  requestNotificationPermission(): Promise<PushPermissionStatus>;
  getPushToken(): Promise<PushTokenSnapshot | null>;
  refreshPushToken(): Promise<PushTokenSnapshot | null>;
  getCurrentPushToken(): PushTokenSnapshot | null;
  clearPushTokenMemory(): void;
  subscribeToPushTokenChanges(listener: (token: PushTokenSnapshot) => void): () => void;
  subscribeToForegroundMessages(listener: (event: PushMessageEvent) => void): () => void;
  subscribeToNotificationOpens(listener: (event: NotificationOpenEvent) => void): () => void;
  getLastNotificationOpenEvent(): NotificationOpenEvent | null;
  setForegroundSupportCaseId(caseId: string | null): void;
  initializeRuntime(): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function parsePushPayload(value: unknown): PushPayload | null {
  if (!isRecord(value)) return null;

  const type = nonEmptyString(value.type);
  const notificationId = nonEmptyString(value.notificationId);
  if (!(PUSH_NOTIFICATION_TYPES as readonly string[]).includes(type ?? '') || !notificationId) {
    return null;
  }
  const support = type === 'SUPPORT_SINGLE_REPLY' || type === 'SUPPORT_CHAT_MESSAGE';
  const caseId = nonEmptyString(value.caseId);
  const messageId = nonEmptyString(value.messageId);
  if (support && (!caseId || !messageId)) return null;
  return support
    ? { type: type as PushNotificationType, notificationId, caseId, messageId }
    : { type: type as PushNotificationType, notificationId };
}

function resolveProjectId(): string | undefined {
  const easProjectId = Constants.easConfig?.projectId;
  const manifestEas = Constants.expoConfig?.extra?.eas;
  const manifestProjectId = isRecord(manifestEas)
    ? nonEmptyString(manifestEas.projectId)
    : undefined;
  return nonEmptyString(easProjectId) ?? manifestProjectId;
}

function createDefaultDependencies(): PushNotificationsDependencies {
  return {
    notifications: Notifications,
    platform: Platform.OS,
    // SDK 56 executionEnvironment=storeClient covers both Expo Go and a
    // development build, while expoGoConfig can be populated from the dev
    // launcher manifest. This is the same native ExpoGo-module check used by
    // expo-notifications itself.
    isExpoGo: isRunningInExpoGo(),
    nativeApiAvailable: [
      Notifications.getPermissionsAsync,
      Notifications.requestPermissionsAsync,
      Notifications.getDevicePushTokenAsync,
      Notifications.getExpoPushTokenAsync,
      Notifications.addNotificationReceivedListener,
      Notifications.addNotificationResponseReceivedListener,
      Notifications.addPushTokenListener,
      Notifications.setNotificationHandler,
    ].every((candidate) => typeof candidate === 'function'),
    projectId: resolveProjectId(),
    now: Date.now,
    development: typeof __DEV__ !== 'undefined' && __DEV__,
    recordAndroidPermissionRequest() {
      return getAJFitRestActivityNativeModule()?.recordNotificationPermissionRequest?.();
    },
    info(message, context) {
      logInfo(PUSH_LOG_SCOPE, message, context);
    },
    error(operation, cause) {
      logError(PUSH_LOG_SCOPE, cause, { operation });
    },
  };
}

/**
 * Factory is exported to test native success/failure boundaries without
 * loading an Expo runtime in Vitest. App code uses only the singleton exports
 * at the end of this module.
 */
export function createPushNotificationsService(
  dependencies: PushNotificationsDependencies,
): PushNotificationsService {
  const foregroundListeners = new Set<(event: PushMessageEvent) => void>();
  const openListeners = new Set<(event: NotificationOpenEvent) => void>();
  const tokenListeners = new Set<(token: PushTokenSnapshot) => void>();

  let currentPushToken: PushTokenSnapshot | null = null;
  let tokenRequest: Promise<PushTokenSnapshot | null> | null = null;
  let lastOpenEvent: NotificationOpenEvent | null = null;
  let lastOpenKey: string | null = null;
  let foregroundSupportCaseId: string | null = null;
  let runtimeConsumers = 0;
  let runtimeSubscriptions: Subscription[] = [];

  const devInfo = (message: string, context?: Record<string, unknown>) => {
    if (dependencies.development) dependencies.info(message, context);
  };
  const devError = (operation: string, cause: unknown) => {
    if (dependencies.development) dependencies.error(operation, cause);
  };

  const getPushSupportStatus = (): PushSupportStatus => {
    if (dependencies.platform !== 'ios' && dependencies.platform !== 'android') {
      return { supported: false, reasonCode: 'UNSUPPORTED_PLATFORM' };
    }
    if (dependencies.isExpoGo) {
      return { supported: false, reasonCode: 'EXPO_GO' };
    }
    if (!dependencies.nativeApiAvailable) {
      return { supported: false, reasonCode: 'NATIVE_API_MISSING' };
    }
    return { supported: true, reasonCode: 'SUPPORTED' };
  };

  const isPushSupported = () => getPushSupportStatus().supported;

  const mapPermission = (
    response: Notifications.NotificationPermissionsStatus,
  ): PushPermissionStatus => {
    if (dependencies.platform === 'ios' && response.ios) {
      switch (response.ios.status) {
        case dependencies.notifications.IosAuthorizationStatus.AUTHORIZED:
        case dependencies.notifications.IosAuthorizationStatus.PROVISIONAL:
        case dependencies.notifications.IosAuthorizationStatus.EPHEMERAL:
          return 'granted';
        case dependencies.notifications.IosAuthorizationStatus.DENIED:
          return 'denied';
        case dependencies.notifications.IosAuthorizationStatus.NOT_DETERMINED:
          return 'not-determined';
      }
    }

    if (response.granted || response.status === 'granted') return 'granted';
    if (response.status === 'denied') return 'denied';
    return 'not-determined';
  };

  const getNotificationPermissionStatus = async (): Promise<PushPermissionStatus> => {
    if (!isPushSupported()) {
      devInfo('push_unsupported', {
        platform: dependencies.platform,
        reasonCode: getPushSupportStatus().reasonCode,
      });
      return 'unsupported';
    }

    try {
      const status = mapPermission(await dependencies.notifications.getPermissionsAsync());
      devInfo('push_permission_status', { status });
      return status;
    } catch (cause) {
      devError('get_permission_status', cause);
      return 'error';
    }
  };

  const ensureAndroidChannel = async (): Promise<boolean> => {
    if (dependencies.platform !== 'android') return true;

    try {
      await dependencies.notifications.setNotificationChannelAsync(
        GENERAL_NOTIFICATION_CHANNEL_ID,
        {
          name: 'AJ Fit',
          importance: dependencies.notifications.AndroidImportance.DEFAULT,
          lockscreenVisibility:
            dependencies.notifications.AndroidNotificationVisibility.PRIVATE,
          showBadge: true,
          sound: 'default',
        },
      );
      return true;
    } catch (cause) {
      devError('configure_android_channel', cause);
      return false;
    }
  };

  const requestNotificationPermission = async (): Promise<PushPermissionStatus> => {
    if (!isPushSupported()) return 'unsupported';

    // Android 13 requires a channel to exist before token/permission APIs can
    // surface the system prompt. This channel is deliberately distinct from
    // the Rest Timer's silent ongoing `rest_timer` channel.
    if (!(await ensureAndroidChannel())) return 'error';

    const current = await getNotificationPermissionStatus();
    if (current !== 'not-determined') {
      devInfo('push_permission_request_skipped', { status: current });
      return current;
    }

    try {
      if (dependencies.platform === 'android') {
        // The Rest Timer already has a first-use POST_NOTIFICATIONS flow. Mark
        // its shared prompt history before this central flow asks, mirroring
        // the same conservative ordering its native implementation uses.
        try {
          await dependencies.recordAndroidPermissionRequest();
        } catch (cause) {
          // This additive compatibility hook must never make the actual OS
          // permission flow depend on Rest Activity native availability.
          devError('record_android_permission_request', cause);
        }
      }
      const status = mapPermission(
        await dependencies.notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        }),
      );
      devInfo('push_permission_request_result', { status });
      return status;
    } catch (cause) {
      devError('request_permission', cause);
      return 'error';
    }
  };

  const isNativeToken = (
    token: Notifications.DevicePushToken,
  ): token is Notifications.NativeDevicePushToken =>
    (token.type === 'ios' || token.type === 'android') &&
    typeof token.data === 'string' &&
    token.data.length > 0;

  const buildSnapshot = async (
    nativeToken: Notifications.NativeDevicePushToken,
  ): Promise<PushTokenSnapshot | null> => {
    const projectId = nonEmptyString(dependencies.projectId);
    if (!projectId) {
      devError('get_push_token', new Error('missing EAS projectId'));
      return null;
    }

    try {
      const expoToken = await dependencies.notifications.getExpoPushTokenAsync({
        projectId,
        devicePushToken: nativeToken,
      });
      if (!nonEmptyString(expoToken.data)) {
        devError('get_push_token', new Error('empty Expo push token'));
        return null;
      }

      const previousToken = currentPushToken;
      const snapshot: PushTokenSnapshot = {
        expoPushToken: expoToken.data,
        nativeToken: { type: nativeToken.type, data: nativeToken.data },
        obtainedAt: dependencies.now(),
      };
      currentPushToken = snapshot;
      devInfo('push_token_obtained', {
        provider: 'expo',
        nativeProvider: nativeToken.type === 'ios' ? 'apns' : 'fcm',
      });
      if (
        !previousToken ||
        previousToken.expoPushToken !== snapshot.expoPushToken ||
        previousToken.nativeToken.data !== snapshot.nativeToken.data
      ) {
        tokenListeners.forEach((listener) => {
          try {
            listener(snapshot);
          } catch (cause) {
            devError('token_subscriber', cause);
          }
        });
      }
      return snapshot;
    } catch (cause) {
      devError('get_push_token', cause);
      return null;
    }
  };

  const acquirePushToken = async (force: boolean): Promise<PushTokenSnapshot | null> => {
    if (!isPushSupported()) return null;
    if (tokenRequest) return tokenRequest;

    tokenRequest = (async () => {
      const permission = await getNotificationPermissionStatus();
      if (permission !== 'granted') {
        currentPushToken = null;
        devInfo('push_token_unavailable', { reason: `permission_${permission}` });
        return null;
      }
      // Re-check permission before reusing memory so a Settings revocation is
      // reflected on the next public API call.
      if (!force && currentPushToken) return currentPushToken;
      if (!(await ensureAndroidChannel())) return null;

      try {
        const nativeToken = await dependencies.notifications.getDevicePushTokenAsync();
        if (!isNativeToken(nativeToken)) {
          devError('get_device_push_token', new Error('unsupported or empty device token'));
          return null;
        }
        return await buildSnapshot(nativeToken);
      } catch (cause) {
        devError('get_device_push_token', cause);
        return null;
      }
    })().finally(() => {
      tokenRequest = null;
    });

    return tokenRequest;
  };

  const notifyTokenChanged = async (token: Notifications.DevicePushToken) => {
    if (!isNativeToken(token)) {
      devError('refresh_device_push_token', new Error('unsupported or empty device token'));
      return;
    }

    const permission = await getNotificationPermissionStatus();
    if (permission !== 'granted') {
      currentPushToken = null;
      devInfo('push_token_refresh_ignored', { reason: `permission_${permission}` });
      return;
    }

    const snapshot = await buildSnapshot(token);
    if (!snapshot) return;
    devInfo('push_token_refreshed', { nativeProvider: token.type === 'ios' ? 'apns' : 'fcm' });
  };

  const clearPushTokenMemory = () => {
    currentPushToken = null;
  };

  const messageEvent = (notification: Notifications.Notification): PushMessageEvent => ({
    notificationRequestId: notification.request.identifier,
    payload: parsePushPayload(notification.request.content.data),
    receivedAt: dependencies.now(),
  });

  const dispatch = <T>(
    listeners: Set<(event: T) => void>,
    event: T,
    operation: string,
  ) => {
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (cause) {
        devError(operation, cause);
      }
    });
  };

  const receiveNotification = (notification: Notifications.Notification) => {
    const event = messageEvent(notification);
    devInfo('push_foreground_message', {
      notificationId: event.notificationRequestId,
      payloadType: event.payload?.type,
      structuredPayload: event.payload !== null,
    });
    dispatch(foregroundListeners, event, 'foreground_subscriber');
  };

  const openNotification = (response: Notifications.NotificationResponse) => {
    const baseEvent = messageEvent(response.notification);
    const dedupeKey = `${baseEvent.notificationRequestId}:${response.actionIdentifier}`;
    if (dedupeKey === lastOpenKey) return;

    const event: NotificationOpenEvent = {
      ...baseEvent,
      actionIdentifier: response.actionIdentifier,
    };
    lastOpenKey = dedupeKey;
    lastOpenEvent = event;
    devInfo('push_notification_opened', {
      actionIdentifier: event.actionIdentifier,
      notificationId: event.notificationRequestId,
      payloadType: event.payload?.type,
      structuredPayload: event.payload !== null,
    });
    dispatch(openListeners, event, 'open_subscriber');
  };

  const initializeRuntime = (): (() => void) => {
    runtimeConsumers += 1;
    if (runtimeConsumers > 1 || !isPushSupported()) {
      return () => {
        runtimeConsumers = Math.max(0, runtimeConsumers - 1);
      };
    }

    try {
      dependencies.notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          const payload = parsePushPayload(notification.request.content.data);
          const isAlreadyOpenSupportCase =
            payload?.caseId !== undefined && payload.caseId === foregroundSupportCaseId;
          return {
            shouldShowBanner: !isAlreadyOpenSupportCase,
            shouldShowList: !isAlreadyOpenSupportCase,
            shouldPlaySound: false,
            shouldSetBadge: false,
          };
        },
        handleError: (_notificationId, cause) => {
          devError('foreground_handler', cause);
        },
      });
    } catch (cause) {
      devError('install_foreground_handler', cause);
    }

    const addSubscription = (operation: string, subscribe: () => Subscription) => {
      try {
        runtimeSubscriptions.push(subscribe());
      } catch (cause) {
        devError(operation, cause);
      }
    };

    addSubscription('listen_foreground', () =>
      dependencies.notifications.addNotificationReceivedListener(receiveNotification),
    );
    addSubscription('listen_open', () =>
      dependencies.notifications.addNotificationResponseReceivedListener(openNotification),
    );
    addSubscription('listen_token_refresh', () =>
      dependencies.notifications.addPushTokenListener((token) => {
        void notifyTokenChanged(token);
      }),
    );

    try {
      const initialResponse = dependencies.notifications.getLastNotificationResponse();
      if (initialResponse) {
        openNotification(initialResponse);
        dependencies.notifications.clearLastNotificationResponse();
      }
    } catch (cause) {
      devError('read_initial_notification_open', cause);
    }

    devInfo('push_runtime_initialized');

    return () => {
      runtimeConsumers = Math.max(0, runtimeConsumers - 1);
      if (runtimeConsumers > 0) return;

      runtimeSubscriptions.forEach((subscription) => subscription.remove());
      runtimeSubscriptions = [];
      try {
        dependencies.notifications.setNotificationHandler(null);
      } catch (cause) {
        devError('remove_foreground_handler', cause);
      }
    };
  };

  const subscribe = <T>(listeners: Set<(event: T) => void>, listener: (event: T) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    isPushSupported,
    getPushSupportStatus,
    getNotificationPermissionStatus,
    requestNotificationPermission,
    getPushToken: () => acquirePushToken(false),
    refreshPushToken: () => acquirePushToken(true),
    getCurrentPushToken: () => currentPushToken,
    clearPushTokenMemory,
    subscribeToPushTokenChanges: (listener) => subscribe(tokenListeners, listener),
    subscribeToForegroundMessages: (listener) => subscribe(foregroundListeners, listener),
    subscribeToNotificationOpens: (listener) => subscribe(openListeners, listener),
    getLastNotificationOpenEvent: () => lastOpenEvent,
    setForegroundSupportCaseId: (caseId) => {
      foregroundSupportCaseId = caseId;
    },
    initializeRuntime,
  };
}

const pushNotifications = createPushNotificationsService(createDefaultDependencies());

export const isPushSupported = pushNotifications.isPushSupported;
export const getPushSupportStatus = pushNotifications.getPushSupportStatus;
export const getNotificationPermissionStatus =
  pushNotifications.getNotificationPermissionStatus;
export const requestNotificationPermission =
  pushNotifications.requestNotificationPermission;
export const getPushToken = pushNotifications.getPushToken;
export const refreshPushToken = pushNotifications.refreshPushToken;
export const getCurrentPushToken = pushNotifications.getCurrentPushToken;
export const clearPushTokenMemory = pushNotifications.clearPushTokenMemory;
export const subscribeToPushTokenChanges =
  pushNotifications.subscribeToPushTokenChanges;
export const subscribeToForegroundMessages =
  pushNotifications.subscribeToForegroundMessages;
export const subscribeToNotificationOpens =
  pushNotifications.subscribeToNotificationOpens;
export const getLastNotificationOpenEvent =
  pushNotifications.getLastNotificationOpenEvent;
export const setForegroundSupportCaseId =
  pushNotifications.setForegroundSupportCaseId;
export const initializePushNotificationRuntime =
  pushNotifications.initializeRuntime;

/**
 * Opens this app's page in the system Settings app (Fase 4 §15) — the only
 * legitimate move once permission has already been denied; the OS refuses
 * to show its own prompt again, so re-calling `requestNotificationPermission`
 * would silently resolve to `denied` without ever surfacing a dialog.
 * `Linking.openSettings()` is the official React Native API for this on both
 * platforms. Centralized here so no screen ever imports `Linking` directly
 * for this purpose — the same reasoning that keeps every other native call
 * behind this one service module.
 */
export async function openSystemNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (cause) {
    logError('pushNotifications', cause, { operation: 'open_system_settings' });
  }
}

/**
 * Explicit DEV-only QA entry point. It is never invoked by app bootstrap and
 * is unavailable in production builds. The returned object is the only place
 * a tester can inspect the complete token; automatic logs never print it.
 */
export async function requestPushTokenForDevelopment(): Promise<PushTokenSnapshot | null> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  const status = await requestNotificationPermission();
  if (status !== 'granted') return null;
  return getPushToken();
}
