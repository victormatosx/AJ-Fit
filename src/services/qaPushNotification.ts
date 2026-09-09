import * as Crypto from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../lib/firebaseFunctions';
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
  requestPushTokenForDevelopment,
  type PushPermissionStatus,
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
] as const;
export type QaPushNotificationType = (typeof QA_PUSH_NOTIFICATION_TYPES)[number];

export type QaPushDispatchResult = {
  status: string;
  dispatchId: string;
  deviceCount?: number;
  acceptedCount?: number;
};

export interface QaPushDiagnostics {
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
 * authenticated admin role, fixed content and self-targeting.
 */
export async function sendQaPushNotification(
  notificationType: QaPushNotificationType,
  qaRequestId = Crypto.randomUUID(),
): Promise<QaPushDispatchResult> {
  assertDevelopment();
  if (!(QA_PUSH_NOTIFICATION_TYPES as readonly string[]).includes(notificationType)) {
    throw new Error('qa_push_type_unsupported');
  }
  const callable = httpsCallable<
    { notificationType: QaPushNotificationType; qaRequestId: string },
    QaPushDispatchResult
  >(
    functions,
    'dispatchTestNotification',
  );
  return (await callable({ notificationType, qaRequestId })).data;
}

/** Reads permission/token state and reuses the existing registration flow. */
export async function loadQaPushDiagnostics(uid: string): Promise<QaPushDiagnostics> {
  assertDevelopment();
  if (!identityIsCurrent(uid)) {
    return { permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false };
  }
  const permission = await getNotificationPermissionStatus();
  if (!identityIsCurrent(uid)) {
    return { permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false };
  }
  const registration = await syncCurrentDeviceBinding(uid);
  if (!identityIsCurrent(uid)) {
    return { permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false };
  }
  return {
    permission,
    registration: registration.status,
    expoPushTokenPresent: getCurrentPushToken() !== null,
  };
}

/** Explicit QA action: request permission/token, then force the existing binding sync. */
export async function refreshQaPushRegistration(uid: string): Promise<QaPushDiagnostics> {
  assertDevelopment();
  if (!identityIsCurrent(uid)) {
    return { permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false };
  }
  const token = await requestPushTokenForDevelopment();
  if (!identityIsCurrent(uid)) {
    return { permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false };
  }
  const registration = token
    ? await refreshCurrentDeviceToken(uid, token)
    : await updatePushPermissionState(uid);
  const permission = await getNotificationPermissionStatus();
  if (!identityIsCurrent(uid)) {
    return { permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false };
  }
  return {
    permission,
    registration: registration.status,
    expoPushTokenPresent: getCurrentPushToken() !== null,
  };
}

export function qaPushErrorMessage(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code?: unknown }).code)
    : '';
  if (code.endsWith('unauthenticated')) return 'Faça login novamente para usar o QA de push.';
  if (code.endsWith('permission-denied')) return 'Esta conta não está autorizada para QA de push.';
  if (code.endsWith('failed-precondition')) return 'A conta não está disponível para notificações.';
  if (code.includes('app-check')) return 'App Check rejeitou este development build.';
  return 'Não foi possível criar o dispatch. Verifique conexão, registro e logs das Functions.';
}
