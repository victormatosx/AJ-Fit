import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';

import { functions } from '../lib/firebaseFunctions';
import { logError, logInfo } from '../lib/logger';
import {
  clearPushTokenMemory,
  getCurrentPushToken,
  getNotificationPermissionStatus,
  getPushToken,
  type PushPermissionStatus,
  type PushTokenSnapshot,
} from './pushNotifications';

const LOG_SCOPE = 'pushDeviceRegistration';
const INSTALLATION_CREDENTIALS_KEY = 'ajfit.push.installation.v1';
const LOCAL_STATE_KEY = 'ajfit.push.device-lifecycle.v2';
const LAST_SEEN_THROTTLE_MS = 6 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InstallationCredentials {
  installationId: string;
  installationSecret: string;
}

interface SyncPushDeviceRequest extends InstallationCredentials {
  sessionBindingId: string;
  expectedOwnershipVersion: number;
  platform: 'ios' | 'android';
  permissionStatus: 'granted' | 'denied' | 'not-determined';
  expoPushToken?: string;
  nativePushToken?: PushTokenSnapshot['nativeToken'];
}

interface ReleasePushDeviceRequest extends InstallationCredentials {
  ownerUid: string;
  ownershipVersion: number;
}

interface PushDeviceMutationResponse {
  installationId: string;
  ownershipVersion: number;
  ownerChanged: boolean;
  pushEnabled: boolean;
  status: 'synced' | 'stale-sync' | 'released' | 'already-released' | 'stale-release';
  tokenChanged: boolean;
}

interface LocalBinding {
  uid: string;
  sessionBindingId: string;
  ownershipVersion: number | null;
  permissionStatus: 'granted' | 'denied' | 'not-determined' | null;
  tokenFingerprint: string | null;
  lastSuccessfulAt: number | null;
}

interface PendingRelease {
  uid: string;
  ownershipVersion: number;
  createdAt: number;
  attempts: number;
}

interface LocalLifecycleState {
  version: 2;
  desiredUid: string | null;
  binding: LocalBinding | null;
  pendingReleases: Record<string, PendingRelease>;
}

export type PushDeviceSyncResult =
  | {
      status: 'synced';
      pushEnabled: boolean;
      ownerChanged: boolean;
      tokenChanged: boolean;
      ownershipVersion: number;
    }
  | { status: 'throttled'; pushEnabled: boolean; ownershipVersion: number }
  | { status: 'deferred'; reason: 'token-unavailable' | 'permission-error' }
  | { status: 'unsupported' }
  | { status: 'stale-identity' }
  | { status: 'failed' };

export interface PushDeviceReleaseResult {
  status: 'released' | 'stale-release' | 'already-released' | 'failed' | 'not-bound';
}

interface PushDeviceRegistrationDependencies {
  platform: string;
  now(): number;
  randomUUID(): string;
  hash(value: string): Promise<string>;
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  localGet(key: string): Promise<string | null>;
  localSet(key: string, value: string): Promise<void>;
  permissionStatus(): Promise<PushPermissionStatus>;
  currentToken(): PushTokenSnapshot | null;
  acquireToken(): Promise<PushTokenSnapshot | null>;
  clearTokenMemory(): void;
  syncRemote(input: SyncPushDeviceRequest): Promise<PushDeviceMutationResponse>;
  releaseRemote(input: ReleasePushDeviceRequest): Promise<PushDeviceMutationResponse>;
  development: boolean;
  info(message: string, context?: Record<string, unknown>): void;
  error(operation: string, cause: unknown): void;
}

export interface PushDeviceRegistrationService {
  getInstallationId(): Promise<string>;
  syncCurrentDeviceBinding(uid: string): Promise<PushDeviceSyncResult>;
  refreshCurrentDeviceToken(uid: string, token?: PushTokenSnapshot): Promise<PushDeviceSyncResult>;
  updatePushPermissionState(uid: string): Promise<PushDeviceSyncResult>;
  queueCurrentDeviceRelease(uid: string): Promise<PushDeviceReleaseResult>;
  retryPendingDeviceBindings(uid: string | null): Promise<void>;
  setAuthenticatedUser(uid: string | null): Promise<void>;
  getAuthenticatedUser(): string | null;
}

function emptyState(): LocalLifecycleState {
  return { version: 2, desiredUid: null, binding: null, pendingReleases: {} };
}

function validUid(uid: string): boolean {
  return uid.length > 0 && uid.length <= 128 && !uid.includes('/');
}

function parseCredentials(raw: string | null): InstallationCredentials | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<InstallationCredentials>;
    if (
      typeof value.installationId !== 'string' ||
      !UUID_PATTERN.test(value.installationId) ||
      typeof value.installationSecret !== 'string' ||
      !UUID_PATTERN.test(value.installationSecret)
    ) {
      return null;
    }
    return {
      installationId: value.installationId.toLowerCase(),
      installationSecret: value.installationSecret,
    };
  } catch {
    return null;
  }
}

function parseState(raw: string | null): LocalLifecycleState {
  if (!raw) return emptyState();
  try {
    const value = JSON.parse(raw) as Partial<LocalLifecycleState>;
    if (value.version !== 2) return emptyState();
    const binding = value.binding;
    const validBinding = binding &&
      typeof binding.uid === 'string' &&
      UUID_PATTERN.test(binding.sessionBindingId) &&
      (binding.ownershipVersion === null ||
        (Number.isSafeInteger(binding.ownershipVersion) && (binding.ownershipVersion ?? 0) >= 1));
    const pendingReleases = Object.fromEntries(
      Object.entries(value.pendingReleases ?? {}).filter(([, pending]) =>
        pending &&
        typeof pending.uid === 'string' &&
        Number.isSafeInteger(pending.ownershipVersion) &&
        pending.ownershipVersion >= 1 &&
        Number.isFinite(pending.createdAt) &&
        Number.isSafeInteger(pending.attempts),
      ),
    );
    return {
      version: 2,
      desiredUid: typeof value.desiredUid === 'string' ? value.desiredUid : null,
      binding: validBinding ? binding as LocalBinding : null,
      pendingReleases,
    };
  } catch {
    return emptyState();
  }
}

function createDefaultDependencies(): PushDeviceRegistrationDependencies {
  const syncCallable = httpsCallable<SyncPushDeviceRequest, PushDeviceMutationResponse>(
    functions,
    'syncPushDevice',
  );
  const releaseCallable = httpsCallable<ReleasePushDeviceRequest, PushDeviceMutationResponse>(
    functions,
    'releasePushDevice',
  );
  const secureOptions: SecureStore.SecureStoreOptions = Platform.OS === 'ios'
    ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    : {};

  return {
    platform: Platform.OS,
    now: Date.now,
    randomUUID: Crypto.randomUUID,
    hash: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
    secureGet: (key) => SecureStore.getItemAsync(key, secureOptions),
    secureSet: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
    localGet: AsyncStorage.getItem,
    localSet: AsyncStorage.setItem,
    permissionStatus: getNotificationPermissionStatus,
    currentToken: getCurrentPushToken,
    acquireToken: getPushToken,
    clearTokenMemory: clearPushTokenMemory,
    syncRemote: async (input) => (await syncCallable(input)).data,
    releaseRemote: async (input) => (await releaseCallable(input)).data,
    development: typeof __DEV__ !== 'undefined' && __DEV__,
    info: (message, context) => logInfo(LOG_SCOPE, message, context),
    error: (operation, cause) => logError(LOG_SCOPE, cause, { operation }),
  };
}

export function createPushDeviceRegistrationService(
  dependencies: PushDeviceRegistrationDependencies,
): PushDeviceRegistrationService {
  let credentialsPromise: Promise<InstallationCredentials> | null = null;
  let localQueue: Promise<void> = Promise.resolve();
  let authenticatedUid: string | null = null;
  let authGeneration = 0;

  const devInfo = (message: string, context?: Record<string, unknown>) => {
    if (dependencies.development) dependencies.info(message, context);
  };
  const devError = (operation: string, cause: unknown) => {
    if (dependencies.development) dependencies.error(operation, cause);
  };

  const credentials = (): Promise<InstallationCredentials> => {
    if (credentialsPromise) return credentialsPromise;
    credentialsPromise = (async () => {
      const stored = parseCredentials(await dependencies.secureGet(INSTALLATION_CREDENTIALS_KEY));
      if (stored) return stored;
      const created = {
        installationId: dependencies.randomUUID().toLowerCase(),
        installationSecret: dependencies.randomUUID(),
      };
      await dependencies.secureSet(INSTALLATION_CREDENTIALS_KEY, JSON.stringify(created));
      devInfo('installation_created');
      return created;
    })().catch((cause) => {
      credentialsPromise = null;
      throw cause;
    });
    return credentialsPromise;
  };

  const mutateState = <T>(
    mutation: (state: LocalLifecycleState) => { state: LocalLifecycleState; value: T },
  ): Promise<T> => {
    let resolveValue: (value: T) => void;
    let rejectValue: (cause: unknown) => void;
    const valuePromise = new Promise<T>((resolve, reject) => {
      resolveValue = resolve;
      rejectValue = reject;
    });
    localQueue = localQueue.catch(() => undefined).then(async () => {
      try {
        const current = parseState(await dependencies.localGet(LOCAL_STATE_KEY));
        const result = mutation(current);
        await dependencies.localSet(LOCAL_STATE_KEY, JSON.stringify(result.state));
        resolveValue(result.value);
      } catch (cause) {
        rejectValue(cause);
      }
    });
    return valuePromise;
  };

  const readState = () => mutateState((state) => ({ state, value: state }));

  const ensureBinding = (uid: string): Promise<LocalBinding> =>
    mutateState((state) => {
      if (state.desiredUid === uid && state.binding?.uid === uid) {
        return { state, value: state.binding };
      }
      const binding: LocalBinding = {
        uid,
        sessionBindingId: dependencies.randomUUID(),
        ownershipVersion: null,
        permissionStatus: null,
        tokenFingerprint: null,
        lastSuccessfulAt: null,
      };
      return {
        state: { ...state, desiredUid: uid, binding },
        value: binding,
      };
    });

  const syncInternal = async (
    uid: string,
    options: { force?: boolean; token?: PushTokenSnapshot; generation?: number } = {},
  ): Promise<PushDeviceSyncResult> => {
    if (!validUid(uid)) return { status: 'failed' };
    if (
      (options.generation !== undefined && options.generation !== authGeneration) ||
      authenticatedUid !== uid
    ) {
      return { status: 'stale-identity' };
    }
    if (dependencies.platform !== 'ios' && dependencies.platform !== 'android') {
      return { status: 'unsupported' };
    }

    const binding = await ensureBinding(uid);
    const permission = await dependencies.permissionStatus();
    if (permission === 'unsupported') return { status: 'unsupported' };
    if (permission === 'error') return { status: 'deferred', reason: 'permission-error' };

    let token: PushTokenSnapshot | null = null;
    if (permission === 'granted') {
      token = options.token ?? dependencies.currentToken() ?? await dependencies.acquireToken();
      if (!token) return { status: 'deferred', reason: 'token-unavailable' };
    }

    if (
      (options.generation !== undefined && options.generation !== authGeneration) ||
      authenticatedUid !== uid
    ) {
      return { status: 'stale-identity' };
    }

    const permissionStatus = permission as 'granted' | 'denied' | 'not-determined';
    const tokenFingerprint = token
      ? await dependencies.hash(`${token.expoPushToken}:${token.nativeToken.data}`)
      : null;
    const latest = await readState();
    if (
      (options.generation !== undefined && options.generation !== authGeneration) ||
      authenticatedUid !== uid ||
      latest.binding?.uid !== uid ||
      latest.binding.sessionBindingId !== binding.sessionBindingId
    ) {
      return { status: 'stale-identity' };
    }
    const sameBinding =
      latest.binding?.uid === uid &&
      latest.binding.sessionBindingId === binding.sessionBindingId &&
      latest.binding.ownershipVersion !== null &&
      latest.binding.permissionStatus === permissionStatus &&
      latest.binding.tokenFingerprint === tokenFingerprint;
    const recent =
      latest.binding?.lastSuccessfulAt != null &&
      dependencies.now() - latest.binding.lastSuccessfulAt < LAST_SEEN_THROTTLE_MS;
    if (!options.force && sameBinding && recent) {
      return {
        status: 'throttled',
        pushEnabled: permissionStatus === 'granted',
        ownershipVersion: latest.binding!.ownershipVersion!,
      };
    }

    try {
      const installationCredentials = await credentials();
      const remoteInput = (expectedOwnershipVersion: number): SyncPushDeviceRequest => ({
        ...installationCredentials,
        sessionBindingId: binding.sessionBindingId,
        expectedOwnershipVersion,
        platform: dependencies.platform as 'ios' | 'android',
        permissionStatus,
        ...(token
          ? { expoPushToken: token.expoPushToken, nativePushToken: token.nativeToken }
          : {}),
      });
      let response = await dependencies.syncRemote(remoteInput(
        latest.binding.ownershipVersion ?? 0,
      ));
      if (response.status === 'stale-sync') {
        if (
          (options.generation !== undefined && options.generation !== authGeneration) ||
          authenticatedUid !== uid
        ) {
          return { status: 'stale-identity' };
        }
        response = await dependencies.syncRemote(remoteInput(response.ownershipVersion));
        if (response.status === 'stale-sync') {
          devInfo('sync_fenced_twice', { uid, installationId: response.installationId });
          return { status: 'failed' };
        }
      }
      if (response.status !== 'synced') return { status: 'failed' };
      if (
        (options.generation !== undefined && options.generation !== authGeneration) ||
        authenticatedUid !== uid
      ) {
        return { status: 'stale-identity' };
      }

      await mutateState((state) => {
        if (
          state.desiredUid !== uid ||
          state.binding?.sessionBindingId !== binding.sessionBindingId
        ) {
          return { state, value: undefined };
        }
        return {
          state: {
            ...state,
            binding: {
              ...state.binding,
              ownershipVersion: response.ownershipVersion,
              permissionStatus,
              tokenFingerprint,
              lastSuccessfulAt: dependencies.now(),
            },
          },
          value: undefined,
        };
      });
      devInfo(response.ownerChanged ? 'ownership_transferred' : 'device_registered', {
        uid,
        installationId: response.installationId,
        pushEnabled: response.pushEnabled,
        tokenChanged: response.tokenChanged,
      });
      return {
        status: 'synced',
        ownershipVersion: response.ownershipVersion,
        pushEnabled: response.pushEnabled,
        ownerChanged: response.ownerChanged,
        tokenChanged: response.tokenChanged,
      };
    } catch (cause) {
      devError('sync_device', cause);
      return { status: 'failed' };
    }
  };

  const releaseBinding = async (pending: PendingRelease): Promise<PushDeviceReleaseResult> => {
    const key = `${pending.uid}:${pending.ownershipVersion}`;
    try {
      const response = await dependencies.releaseRemote({
        ...(await credentials()),
        ownerUid: pending.uid,
        ownershipVersion: pending.ownershipVersion,
      });
      await mutateState((state) => {
        const next = { ...state.pendingReleases };
        delete next[key];
        return { state: { ...state, pendingReleases: next }, value: undefined };
      });
      devInfo(
        response.status === 'stale-release' ? 'release_fenced' : 'device_released',
        { uid: pending.uid, installationId: response.installationId, status: response.status },
      );
      if (
        response.status === 'released' ||
        response.status === 'already-released' ||
        response.status === 'stale-release'
      ) {
        return { status: response.status };
      }
      return { status: 'failed' };
    } catch (cause) {
      await mutateState((state) => ({
        state: {
          ...state,
          pendingReleases: {
            ...state.pendingReleases,
            [key]: { ...pending, attempts: pending.attempts + 1 },
          },
        },
        value: undefined,
      }));
      devError('release_device', cause);
      return { status: 'failed' };
    }
  };

  const takeBindingForRelease = async (uid: string): Promise<PendingRelease | null> =>
    mutateState((state) => {
      if (state.binding?.uid !== uid || state.binding.ownershipVersion === null) {
        return {
          state: {
            ...state,
            desiredUid: state.desiredUid === uid ? null : state.desiredUid,
            binding: state.binding?.uid === uid ? null : state.binding,
          },
          value: null,
        };
      }
      const pending: PendingRelease = {
        uid,
        ownershipVersion: state.binding.ownershipVersion,
        createdAt: dependencies.now(),
        attempts: 0,
      };
      const key = `${uid}:${pending.ownershipVersion}`;
      return {
        state: {
          ...state,
          desiredUid: state.desiredUid === uid ? null : state.desiredUid,
          binding: null,
          pendingReleases: { ...state.pendingReleases, [key]: pending },
        },
        value: pending,
      };
    });

  const queueCurrentDeviceRelease = async (uid: string): Promise<PushDeviceReleaseResult> => {
    const pending = await takeBindingForRelease(uid);
    dependencies.clearTokenMemory();
    if (!pending) return { status: 'not-bound' };
    return releaseBinding(pending);
  };

  return {
    getInstallationId: async () => (await credentials()).installationId,
    syncCurrentDeviceBinding: (uid) => syncInternal(uid),
    refreshCurrentDeviceToken: (uid, token) =>
      syncInternal(uid, { force: true, token }),
    updatePushPermissionState: (uid) =>
      syncInternal(uid, { force: true }),
    queueCurrentDeviceRelease,
    retryPendingDeviceBindings: async (uid) => {
      const pending = Object.values((await readState()).pendingReleases);
      await Promise.allSettled(pending.map(releaseBinding));
      if (uid && authenticatedUid === uid) await syncInternal(uid);
    },
    setAuthenticatedUser: async (uid) => {
      if (uid === authenticatedUid) return;
      const previousUid = authenticatedUid;
      authenticatedUid = uid;
      const generation = ++authGeneration;

      if (previousUid && previousUid !== uid) {
        void queueCurrentDeviceRelease(previousUid);
      }
      if (!uid) {
        dependencies.clearTokenMemory();
        return;
      }
      await syncInternal(uid, { generation });
    },
    getAuthenticatedUser: () => authenticatedUid,
  };
}

const service = createPushDeviceRegistrationService(createDefaultDependencies());

export const getInstallationId = service.getInstallationId;
export const syncCurrentDeviceBinding = service.syncCurrentDeviceBinding;
export const refreshCurrentDeviceToken = service.refreshCurrentDeviceToken;
export const updatePushPermissionState = service.updatePushPermissionState;
export const queueCurrentDeviceRelease = service.queueCurrentDeviceRelease;
export const retryPendingDeviceBindings = service.retryPendingDeviceBindings;
export const setAuthenticatedPushUser = service.setAuthenticatedUser;
export const getAuthenticatedPushUser = service.getAuthenticatedUser;
