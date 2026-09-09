import * as Crypto from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';

import { auth } from '../lib/firebase';
import { functions, FUNCTIONS_REGION } from '../lib/firebaseFunctions';
import { errorCode, logInfo, sanitizeLogText } from '../lib/logger';
import {
  getAuthenticatedPushUser,
  refreshCurrentDeviceToken,
  syncCurrentDeviceBinding,
  updatePushPermissionState,
  type PushDeviceSyncResult,
} from './pushDeviceRegistration';
import {
  getCurrentPushToken,
  getNotificationPermissionStatus,
  getPushSupportStatus,
  requestPushTokenForDevelopment,
  type PushPermissionStatus,
  type PushNotificationType,
  type PushSupportStatus,
} from './pushNotifications';

export const QA_PUSH_NOTIFICATION_TYPES = [
  'QA_TEST',
  'WORKOUT_DAY',
  'RECOVERY_DAY',
  'MISSED_WORKOUT',
  'EVOLUTION_UNLOCKED',
  'PROGRAM_UPDATED',
  'EVOLUTION_APPROACHING',
  'BILLING_ISSUE',
  'PREMIUM_ENDED',
  'RE_ENGAGEMENT_EARLY',
  'RE_ENGAGEMENT_LATE',
  'PHOTO_REMINDER',
  'ASSESSMENT_REMINDER',
  'COMPARE_PROGRESS',
] as const satisfies readonly PushNotificationType[];
export type QaPushNotificationType = (typeof QA_PUSH_NOTIFICATION_TYPES)[number];

const QA_PUSH_LOG_SCOPE = 'qaPushNotification';
export const QA_PUSH_CALLABLE_NAME = 'dispatchTestNotification';

export type QaPushDispatchResult = {
  status: string;
  dispatchId: string;
  deviceCount?: number;
  acceptedCount?: number;
};

export interface QaPushDiagnostics {
  support: PushSupportStatus;
  permission: PushPermissionStatus;
  registration: PushDeviceSyncResult['status'];
  expoPushTokenPresent: boolean;
}

function assertDevelopment(): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('qa_push_unavailable');
  }
}

function identityIsCurrent(uid: string): boolean {
  return getAuthenticatedPushUser() === uid;
}

/**
 * DEV-only client surface. The backend independently requires App Check,
 * an authenticated push-QA capability or admin role, fixed content and
 * self-targeting.
 */
export async function sendQaPushNotification(
  notificationType: QaPushNotificationType,
  qaRequestId = Crypto.randomUUID(),
): Promise<QaPushDispatchResult> {
  const safeContext = {
    notificationType,
    authenticated: auth.currentUser !== null,
    pushRegistered: getCurrentPushToken() !== null,
  };

  try {
    assertDevelopment();
    if (!(QA_PUSH_NOTIFICATION_TYPES as readonly string[]).includes(notificationType)) {
      throw new Error('qa_push_type_unsupported');
    }
    logInfo(QA_PUSH_LOG_SCOPE, 'qa_push_callable_invoking', {
      ...safeContext,
      callableName: QA_PUSH_CALLABLE_NAME,
      region: FUNCTIONS_REGION,
    });
    const callable = httpsCallable<
      { notificationType: QaPushNotificationType; qaRequestId: string },
      QaPushDispatchResult
    >(
      functions,
      QA_PUSH_CALLABLE_NAME,
    );
    const result = (await callable({ notificationType, qaRequestId })).data;
    logInfo(QA_PUSH_LOG_SCOPE, 'qa_push_callable_succeeded', {
      ...safeContext,
      status: result.status,
      deviceCount: result.deviceCount,
      acceptedCount: result.acceptedCount,
    });
    return result;
  } catch (cause) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    logInfo(QA_PUSH_LOG_SCOPE, 'qa_push_callable_failed', {
      ...safeContext,
      errorCode: errorCode(cause) ?? 'UNCLASSIFIED',
      errorMessage: sanitizeLogText(rawMessage),
    });
    throw cause;
  }
}

/** Reads permission/token state and reuses the existing registration flow. */
export async function loadQaPushDiagnostics(uid: string): Promise<QaPushDiagnostics> {
  assertDevelopment();
  const support = getPushSupportStatus();
  if (!identityIsCurrent(uid)) {
    return {
      support,
      permission: 'error',
      registration: 'stale-identity',
      expoPushTokenPresent: false,
    };
  }
  const permission = await getNotificationPermissionStatus();
  if (!identityIsCurrent(uid)) {
    return {
      support,
      permission: 'error',
      registration: 'stale-identity',
      expoPushTokenPresent: false,
    };
  }
  const registration = await syncCurrentDeviceBinding(uid);
  if (!identityIsCurrent(uid)) {
    return {
      support,
      permission: 'error',
      registration: 'stale-identity',
      expoPushTokenPresent: false,
    };
  }
  return {
    support,
    permission,
    registration: registration.status,
    expoPushTokenPresent: getCurrentPushToken() !== null,
  };
}

/** Explicit QA action: request permission/token, then force the existing binding sync. */
export async function refreshQaPushRegistration(uid: string): Promise<QaPushDiagnostics> {
  assertDevelopment();
  const support = getPushSupportStatus();
  if (!identityIsCurrent(uid)) {
    return {
      support,
      permission: 'error',
      registration: 'stale-identity',
      expoPushTokenPresent: false,
    };
  }
  const token = await requestPushTokenForDevelopment();
  if (!identityIsCurrent(uid)) {
    return {
      support,
      permission: 'error',
      registration: 'stale-identity',
      expoPushTokenPresent: false,
    };
  }
  const registration = token
    ? await refreshCurrentDeviceToken(uid, token)
    : await updatePushPermissionState(uid);
  const permission = await getNotificationPermissionStatus();
  if (!identityIsCurrent(uid)) {
    return {
      support,
      permission: 'error',
      registration: 'stale-identity',
      expoPushTokenPresent: false,
    };
  }
  return {
    support,
    permission,
    registration: registration.status,
    expoPushTokenPresent: getCurrentPushToken() !== null,
  };
}

export function qaPushUnavailableMessage(
  reasonCode: PushSupportStatus['reasonCode'],
): string | null {
  switch (reasonCode) {
    case 'SUPPORTED':
      return null;
    case 'EXPO_GO':
      return 'Push remoto não está disponível no Expo Go. Abra o development build do AJ Fit.';
    case 'NATIVE_API_MISSING':
      return 'Push não está disponível neste build. Recompile o development build com suporte nativo a notifications.';
    case 'UNSUPPORTED_PLATFORM':
      return 'Push remoto não está disponível nesta plataforma.';
  }
}

export function qaPushErrorMessage(cause: unknown): string {
  const code = errorCode(cause) ?? '';
  const message = cause instanceof Error ? sanitizeLogText(cause.message) : '';
  if (message === 'qa_push_type_unsupported') {
    return 'Tipo de notificação não suportado pelo QA client.';
  }
  if (code.endsWith('unauthenticated')) {
    return 'Faça login novamente para usar o QA de push (functions/unauthenticated).';
  }
  if (code.endsWith('permission-denied')) {
    return 'Esta conta não está autorizada para QA de push (functions/permission-denied).';
  }
  if (code.endsWith('invalid-argument')) {
    return 'A callable rejeitou o payload (functions/invalid-argument). O backend publicado pode estar desatualizado.';
  }
  if (code.endsWith('not-found')) {
    return 'A callable dispatchTestNotification não foi encontrada em us-central1 (functions/not-found).';
  }
  if (code.endsWith('failed-precondition')) {
    return 'A conta não está disponível para notificações (functions/failed-precondition).';
  }
  if (code.includes('app-check')) return 'App Check rejeitou este development build.';
  if (code) return `Falha na callable (${code}).`;
  return 'Não foi possível criar o dispatch. Verifique conexão, registro e logs das Functions.';
}
