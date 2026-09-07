import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { requireActiveAccount } from '../accountDeletion/activeAccountGuard';
import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  PUSH_INSTALLATIONS_COLLECTION,
  PUSH_PERMISSION_STATUSES,
  RELEASED_INSTALLATION_RETENTION_MS,
  PUSH_TOKEN_OWNERS_COLLECTION,
  USER_DEVICES_COLLECTION,
  type PushDeviceMutationResponse,
  type PushPermissionStatus,
  type PushPlatform,
  type ReleasePushDeviceInput,
  type SyncPushDeviceInput,
} from './schema';

const SCOPE = 'pushDevices';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_TOKEN_PATTERN = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,220}\]$/;
const NATIVE_TOKEN_PATTERN = /^[A-Za-z0-9:_-]{8,4096}$/;
const LAST_SEEN_THROTTLE_MS = 6 * 60 * 60 * 1000;
// The dispatcher requires an unexpired lease as well as `active`. Logout
// releases only this account's ownership; it deliberately does not unregister
// the native provider token because a subsequent account can reuse the same
// installation. The lease is the bounded backstop for offline cleanup.
const OWNERSHIP_LEASE_MS = 30 * 24 * 60 * 60 * 1000;

interface PushDeviceDependencies {
  db: Firestore;
  now(): Timestamp;
  requireActive(uid: string, db: Firestore): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseInstallationCredentials(value: unknown): {
  installationId: string;
  installationSecret: string;
} {
  if (!isRecord(value)) throw new HttpsError('invalid-argument', 'invalid_device_request');
  const installationId = value.installationId;
  const installationSecret = value.installationSecret;
  if (
    typeof installationId !== 'string' ||
    !UUID_PATTERN.test(installationId) ||
    typeof installationSecret !== 'string' ||
    !UUID_PATTERN.test(installationSecret)
  ) {
    throw new HttpsError('invalid-argument', 'invalid_installation_credentials');
  }
  return { installationId: installationId.toLowerCase(), installationSecret };
}

function parseSyncInput(value: unknown): SyncPushDeviceInput {
  const credentials = parseInstallationCredentials(value);
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'installationId',
    'installationSecret',
    'sessionBindingId',
    'expectedOwnershipVersion',
    'platform',
    'permissionStatus',
    'expoPushToken',
    'nativePushToken',
  ])) {
    throw new HttpsError('invalid-argument', 'unexpected_device_fields');
  }

  const platform = value.platform;
  const permissionStatus = value.permissionStatus;
  if (typeof value.sessionBindingId !== 'string' || !UUID_PATTERN.test(value.sessionBindingId)) {
    throw new HttpsError('invalid-argument', 'invalid_session_binding');
  }
  if (
    typeof value.expectedOwnershipVersion !== 'number' ||
    !Number.isSafeInteger(value.expectedOwnershipVersion) ||
    value.expectedOwnershipVersion < 0
  ) {
    throw new HttpsError('invalid-argument', 'invalid_expected_ownership_version');
  }
  if (platform !== 'ios' && platform !== 'android') {
    throw new HttpsError('invalid-argument', 'invalid_device_platform');
  }
  if (!PUSH_PERMISSION_STATUSES.includes(permissionStatus as PushPermissionStatus)) {
    throw new HttpsError('invalid-argument', 'invalid_permission_status');
  }

  const expoPushToken = value.expoPushToken;
  const nativePushToken = value.nativePushToken;
  const granted = permissionStatus === 'granted';
  if (granted) {
    if (
      typeof expoPushToken !== 'string' ||
      !EXPO_TOKEN_PATTERN.test(expoPushToken) ||
      !isRecord(nativePushToken) ||
      !hasOnlyKeys(nativePushToken, ['type', 'data']) ||
      nativePushToken.type !== platform ||
      typeof nativePushToken.data !== 'string' ||
      !NATIVE_TOKEN_PATTERN.test(nativePushToken.data)
    ) {
      throw new HttpsError('invalid-argument', 'valid_push_tokens_required');
    }
  } else if (expoPushToken !== undefined || nativePushToken !== undefined) {
    throw new HttpsError('invalid-argument', 'disabled_device_must_not_include_tokens');
  }

  return {
    ...credentials,
    sessionBindingId: value.sessionBindingId,
    expectedOwnershipVersion: value.expectedOwnershipVersion,
    platform: platform as PushPlatform,
    permissionStatus: permissionStatus as PushPermissionStatus,
    ...(granted
      ? {
          expoPushToken: expoPushToken as string,
          nativePushToken: {
            type: platform as PushPlatform,
            data: (nativePushToken as Record<string, unknown>).data as string,
          },
        }
      : {}),
  };
}

function parseReleaseInput(value: unknown): ReleasePushDeviceInput {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'installationId',
    'installationSecret',
    'ownerUid',
    'ownershipVersion',
  ])) {
    throw new HttpsError('invalid-argument', 'unexpected_device_fields');
  }
  const credentials = parseInstallationCredentials(value);
  if (
    typeof value.ownerUid !== 'string' ||
    value.ownerUid.length === 0 ||
    value.ownerUid.length > 128 ||
    value.ownerUid.includes('/')
  ) {
    throw new HttpsError('invalid-argument', 'invalid_owner_uid');
  }
  if (
    typeof value.ownershipVersion !== 'number' ||
    !Number.isSafeInteger(value.ownershipVersion) ||
    value.ownershipVersion < 1
  ) {
    throw new HttpsError('invalid-argument', 'invalid_ownership_version');
  }
  return {
    ...credentials,
    ownerUid: value.ownerUid,
    ownershipVersion: value.ownershipVersion,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashesEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function existingString(data: DocumentData | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' ? value : null;
}

function timestampOr(data: DocumentData | undefined, key: string, fallback: Timestamp): Timestamp {
  const value = data?.[key];
  return value instanceof Timestamp ? value : fallback;
}

function lastSeenAt(data: DocumentData | undefined, now: Timestamp): Timestamp {
  const previous = data?.lastSeenAt;
  return previous instanceof Timestamp && now.toMillis() - previous.toMillis() < LAST_SEEN_THROTTLE_MS
    ? previous
    : now;
}

function assertInstallationProof(
  installationData: DocumentData | undefined,
  tokenOwnerData: DocumentData | undefined,
  secretHash: string,
): void {
  const establishedHash =
    existingString(installationData, 'installationSecretHash') ??
    existingString(tokenOwnerData, 'installationSecretHash');
  if ((installationData || tokenOwnerData) && !establishedHash) {
    throw new HttpsError('permission-denied', 'installation_proof_missing');
  }
  if (establishedHash && !hashesEqual(establishedHash, secretHash)) {
    throw new HttpsError('permission-denied', 'installation_proof_mismatch');
  }
}

export function createPushDeviceHandlers(
  dependencies: PushDeviceDependencies = {
    db: defaultDb,
    now: Timestamp.now,
    requireActive: requireActiveAccount,
  },
) {
  const sync = async (
    request: CallableRequest<unknown>,
  ): Promise<PushDeviceMutationResponse> => {
    const uid = requireAuth(request);
    const input = parseSyncInput(request.data);
    await dependencies.requireActive(uid, dependencies.db);

    const now = dependencies.now();
    const leaseExpiresAt = Timestamp.fromMillis(now.toMillis() + OWNERSHIP_LEASE_MS);
    const secretHash = sha256(input.installationSecret);
    const sessionBindingHash = sha256(input.sessionBindingId);
    const tokenHash = input.expoPushToken ? sha256(input.expoPushToken) : null;
    const nativeTokenHash = input.nativePushToken ? sha256(input.nativePushToken.data) : null;
    const installationRef = dependencies.db
      .collection(PUSH_INSTALLATIONS_COLLECTION)
      .doc(input.installationId);
    const userRef = dependencies.db.collection('users').doc(uid);

    try {
      const result = await dependencies.db.runTransaction(async (transaction) => {
        const userSnapshot = await transaction.get(userRef);
        if (!userSnapshot.exists) {
          throw new HttpsError('failed-precondition', 'user_not_found');
        }

        const installationSnapshot = await transaction.get(installationRef);
        const installationData = installationSnapshot.data();
        const previousTokenHash = existingString(installationData, 'tokenHash');
        const previousOwnerUid = existingString(installationData, 'ownerUid');
        const previousOwnershipVersion =
          typeof installationData?.ownershipVersion === 'number' &&
          Number.isSafeInteger(installationData.ownershipVersion)
            ? installationData.ownershipVersion
            : 0;

        const previousTokenRef = previousTokenHash
          ? dependencies.db.collection(PUSH_TOKEN_OWNERS_COLLECTION).doc(previousTokenHash)
          : null;
        const nextTokenRef = tokenHash
          ? dependencies.db.collection(PUSH_TOKEN_OWNERS_COLLECTION).doc(tokenHash)
          : null;

        const previousTokenSnapshot = previousTokenRef
          ? await transaction.get(previousTokenRef)
          : null;
        const nextTokenSnapshot = nextTokenRef && nextTokenRef.path !== previousTokenRef?.path
          ? await transaction.get(nextTokenRef)
          : previousTokenSnapshot;
        const nextTokenData = nextTokenSnapshot?.data();

        assertInstallationProof(installationData, nextTokenData, secretHash);
        const claimedInstallation = existingString(nextTokenData, 'installationId');
        if (claimedInstallation && claimedInstallation !== input.installationId) {
          throw new HttpsError('already-exists', 'token_owned_by_another_installation');
        }

        // Compare-and-swap fence for sync itself. Without this, a response
        // from A that was delayed in transit could overwrite a newer B sync.
        if (previousOwnershipVersion !== input.expectedOwnershipVersion) {
          return {
            stale: true as const,
            created: false,
            ownerChanged: false,
            ownershipVersion: previousOwnershipVersion,
            pushEnabled: installationData?.pushEnabled === true,
            tokenChanged: false,
          };
        }

        const indexedOwnerUid = existingString(nextTokenData, 'ownerUid');
        const priorOwners = new Set(
          [previousOwnerUid, indexedOwnerUid].filter(
            (owner): owner is string => owner !== null && owner !== uid,
          ),
        );
        const ownerChanged = priorOwners.size > 0;
        const tokenChanged = previousTokenHash !== tokenHash ||
          existingString(installationData, 'nativeTokenHash') !== nativeTokenHash;
        const ownershipChanged =
          previousOwnerUid !== uid ||
          tokenChanged ||
          existingString(installationData, 'platform') !== input.platform;
        const sessionChanged =
          existingString(installationData, 'sessionBindingHash') !== sessionBindingHash;
        const ownershipVersion = Math.max(
          1,
          previousOwnershipVersion + (ownershipChanged || sessionChanged ? 1 : 0),
        );
        const pushEnabled = input.permissionStatus === 'granted' && tokenHash !== null;
        const createdAt = timestampOr(installationData, 'createdAt', now);
        const seenAt = lastSeenAt(installationData, now);
        const tokenUpdatedAt = tokenChanged
          ? now
          : timestampOr(installationData, 'tokenUpdatedAt', now);
        const previousInvalidAt = previousTokenHash === tokenHash
          ? installationData?.invalidAt ?? null
          : null;
        const effectiveEnabled = pushEnabled && previousInvalidAt === null;

        for (const priorOwnerUid of priorOwners) {
          transaction.delete(
            dependencies.db.collection('users').doc(priorOwnerUid)
              .collection(USER_DEVICES_COLLECTION).doc(input.installationId),
          );
        }
        if (previousTokenRef && previousTokenRef.path !== nextTokenRef?.path) {
          transaction.delete(previousTokenRef);
        }

        const deviceProjection = {
          installationId: input.installationId,
          platform: input.platform,
          permissionStatus: input.permissionStatus,
          pushEnabled: effectiveEnabled,
          tokenHash,
          nativeTokenType: input.nativePushToken?.type ?? null,
          createdAt,
          updatedAt: now,
          lastSeenAt: seenAt,
          tokenUpdatedAt,
          leaseExpiresAt,
          ownershipVersion,
          disabledAt: effectiveEnabled ? null : now,
          invalidAt: previousInvalidAt,
          expireAt: leaseExpiresAt,
        };

        transaction.set(installationRef, {
          ...deviceProjection,
          installationSecretHash: secretHash,
          sessionBindingHash,
          ownerUid: uid,
          nativeTokenHash,
          releasedAt: null,
        });
        transaction.set(
          userRef.collection(USER_DEVICES_COLLECTION).doc(input.installationId),
          deviceProjection,
        );

        if (nextTokenRef && input.expoPushToken && input.nativePushToken && effectiveEnabled) {
          transaction.set(nextTokenRef, {
            tokenHash,
            expoPushToken: input.expoPushToken,
            nativeTokenHash,
            nativeTokenType: input.nativePushToken.type,
            installationId: input.installationId,
            installationSecretHash: secretHash,
            ownerUid: uid,
            ownershipVersion,
            platform: input.platform,
            active: true,
            createdAt: timestampOr(nextTokenData, 'createdAt', now),
            updatedAt: now,
            tokenUpdatedAt,
            leaseExpiresAt,
            invalidAt: null,
            expireAt: leaseExpiresAt,
          });
        } else if (previousTokenRef) {
          transaction.delete(previousTokenRef);
        }

        return {
          stale: false as const,
          created: !installationSnapshot.exists,
          ownerChanged,
          ownershipVersion,
          pushEnabled: effectiveEnabled,
          tokenChanged,
        };
      });

      if (result.stale) {
        logInfo(SCOPE, 'push_device_sync_fenced', {
          uid,
          installationId: input.installationId,
          expectedOwnershipVersion: input.expectedOwnershipVersion,
          ownershipVersion: result.ownershipVersion,
        });
        return {
          installationId: input.installationId,
          status: 'stale-sync',
          ownerChanged: false,
          ownershipVersion: result.ownershipVersion,
          pushEnabled: result.pushEnabled,
          tokenChanged: false,
        };
      }

      logInfo(
        SCOPE,
        result.ownerChanged
          ? 'push_device_ownership_transferred'
          : result.created
            ? 'push_device_registered'
            : 'push_device_updated',
        {
          uid,
          installationId: input.installationId,
          platform: input.platform,
          pushEnabled: result.pushEnabled,
          ownerChanged: result.ownerChanged,
          tokenChanged: result.tokenChanged,
        },
      );
      return {
        installationId: input.installationId,
        status: 'synced',
        ownerChanged: result.ownerChanged,
        ownershipVersion: result.ownershipVersion,
        pushEnabled: result.pushEnabled,
        tokenChanged: result.tokenChanged,
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logFunctionError(SCOPE, error, { uid, operation: 'sync' });
      throw new HttpsError('internal', 'push_device_sync_failed');
    }
  };

  const release = async (
    request: CallableRequest<unknown>,
  ): Promise<PushDeviceMutationResponse> => {
    const input = parseReleaseInput(request.data);
    const authenticatedUid = request.auth?.uid ?? null;
    if (authenticatedUid && authenticatedUid !== input.ownerUid) {
      throw new HttpsError('permission-denied', 'release_owner_mismatch');
    }
    // Logout never waits for this network call. If Auth has already cleared,
    // App Check + installation proof + exact ownership version form a
    // narrowly-scoped capability which can only release this binding.
    const uid = input.ownerUid;
    const secretHash = sha256(input.installationSecret);
    const now = dependencies.now();
    const installationRef = dependencies.db
      .collection(PUSH_INSTALLATIONS_COLLECTION)
      .doc(input.installationId);

    try {
      const result = await dependencies.db.runTransaction(async (transaction) => {
        const installationSnapshot = await transaction.get(installationRef);
        const installationData = installationSnapshot.data();
        const ownerUid = existingString(installationData, 'ownerUid');
        const tokenHash = existingString(installationData, 'tokenHash');
        const tokenRef = tokenHash
          ? dependencies.db.collection(PUSH_TOKEN_OWNERS_COLLECTION).doc(tokenHash)
          : null;
        const tokenSnapshot = tokenRef ? await transaction.get(tokenRef) : null;

        assertInstallationProof(installationData, tokenSnapshot?.data(), secretHash);
        const currentOwnershipVersion =
          typeof installationData?.ownershipVersion === 'number'
            ? installationData.ownershipVersion
            : 0;
        if (
          !installationSnapshot.exists ||
          ownerUid !== uid ||
          currentOwnershipVersion !== input.ownershipVersion
        ) {
          return {
            status: installationSnapshot.exists ? 'stale-release' as const : 'already-released' as const,
            ownershipVersion: currentOwnershipVersion || input.ownershipVersion,
          };
        }

        transaction.delete(
          dependencies.db.collection('users').doc(uid)
            .collection(USER_DEVICES_COLLECTION).doc(input.installationId),
        );
        if (
          tokenRef &&
          existingString(tokenSnapshot?.data(), 'installationId') === input.installationId &&
          existingString(tokenSnapshot?.data(), 'ownerUid') === uid &&
          tokenSnapshot?.data()?.ownershipVersion === input.ownershipVersion
        ) {
          transaction.delete(tokenRef);
        }

        if (installationSnapshot.exists) {
          transaction.set(installationRef, {
            ...installationData,
            ownerUid: null,
            tokenHash: null,
            nativeTokenHash: null,
            nativeTokenType: null,
            permissionStatus: 'not-determined',
            pushEnabled: false,
            updatedAt: now,
            disabledAt: now,
            releasedAt: now,
            leaseExpiresAt: now,
            expireAt: Timestamp.fromMillis(now.toMillis() + RELEASED_INSTALLATION_RETENTION_MS),
          });
        }

        return { status: 'released' as const, ownershipVersion: currentOwnershipVersion };
      });

      logInfo(SCOPE, result.status === 'stale-release' ? 'push_device_release_fenced' : 'push_device_released', {
        uid,
        installationId: input.installationId,
        status: result.status,
      });
      return {
        installationId: input.installationId,
        status: result.status,
        ownershipVersion: result.ownershipVersion,
        ownerChanged: false,
        pushEnabled: false,
        tokenChanged: result.status === 'released',
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logFunctionError(SCOPE, error, { uid, operation: 'release' });
      throw new HttpsError('internal', 'push_device_release_failed');
    }
  };

  return { sync, release };
}

const handlers = createPushDeviceHandlers();
export const syncPushDeviceHandler = handlers.sync;
export const releasePushDeviceHandler = handlers.release;
