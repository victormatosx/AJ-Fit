import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import {
  PUSH_INSTALLATIONS_COLLECTION,
  PUSH_TOKEN_OWNERS_COLLECTION,
  RELEASED_INSTALLATION_RETENTION_MS,
  USER_DEVICES_COLLECTION,
} from '../pushDevices/schema';

export interface DeliveryOwnershipSnapshot {
  uid: string;
  installationId: string;
  tokenHash: string;
  ownershipVersion: number;
}

export interface DeliveryOwnershipState {
  installationRef: FirebaseFirestore.DocumentReference;
  tokenRef: FirebaseFirestore.DocumentReference;
  deviceRef: FirebaseFirestore.DocumentReference;
  installation: FirebaseFirestore.DocumentData | undefined;
  token: FirebaseFirestore.DocumentData | undefined;
  device: FirebaseFirestore.DocumentData | undefined;
}

/**
 * Reads every ownership document before any write is queued. Keeping this
 * separate from `applyDeliveryTokenInvalidation` lets callers which already
 * own a transaction make delivery status and token invalidation one atomic
 * commit, including batches containing more than one invalid token.
 */
export async function readDeliveryOwnershipState(
  db: Firestore,
  tx: FirebaseFirestore.Transaction,
  ownership: DeliveryOwnershipSnapshot,
): Promise<DeliveryOwnershipState> {
  const installationRef = db.collection(PUSH_INSTALLATIONS_COLLECTION)
    .doc(ownership.installationId);
  const tokenRef = db.collection(PUSH_TOKEN_OWNERS_COLLECTION)
    .doc(ownership.tokenHash);
  const deviceRef = db.collection('users').doc(ownership.uid)
    .collection(USER_DEVICES_COLLECTION).doc(ownership.installationId);
  const [installationSnapshot, tokenSnapshot, deviceSnapshot] = await Promise.all([
    tx.get(installationRef),
    tx.get(tokenRef),
    tx.get(deviceRef),
  ]);
  return {
    installationRef,
    tokenRef,
    deviceRef,
    installation: installationSnapshot.data(),
    token: tokenSnapshot.data(),
    device: deviceSnapshot.data(),
  };
}

/** Applies an invalidation only to the exact delivery-era ownership tuple. */
export function applyDeliveryTokenInvalidation(
  tx: FirebaseFirestore.Transaction,
  state: DeliveryOwnershipState,
  ownership: DeliveryOwnershipSnapshot,
  now: Timestamp,
): boolean {
  const exactInstallation =
    state.installation?.ownerUid === ownership.uid &&
    state.installation?.tokenHash === ownership.tokenHash &&
    state.installation?.ownershipVersion === ownership.ownershipVersion;
  const exactToken =
    state.token?.ownerUid === ownership.uid &&
    state.token?.installationId === ownership.installationId &&
    state.token?.tokenHash === ownership.tokenHash &&
    state.token?.ownershipVersion === ownership.ownershipVersion &&
    state.token?.active === true;

  if (!exactInstallation || !exactToken) return false;

  const expireAt = Timestamp.fromMillis(
    now.toMillis() + RELEASED_INSTALLATION_RETENTION_MS,
  );
  tx.set(state.installationRef, {
    pushEnabled: false,
    invalidAt: now,
    disabledAt: now,
    expireAt,
    updatedAt: now,
  }, { merge: true });

  if (
    state.device?.tokenHash === ownership.tokenHash &&
    state.device?.ownershipVersion === ownership.ownershipVersion
  ) {
    tx.set(state.deviceRef, {
      pushEnabled: false,
      invalidAt: now,
      disabledAt: now,
      expireAt,
      updatedAt: now,
    }, { merge: true });
  }

  // Delete the only raw-token record immediately. The installation and
  // delivery retain hashes/status for troubleshooting without retaining PII.
  tx.delete(state.tokenRef);
  return true;
}

/**
 * Invalidates only if both private registries still describe the exact
 * ownership relationship captured by the original delivery. A stale ticket
 * or receipt can therefore never damage a later account binding.
 */
export async function invalidateDeliveryToken(
  db: Firestore,
  ownership: DeliveryOwnershipSnapshot,
  now: Timestamp,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const state = await readDeliveryOwnershipState(db, tx, ownership);
    return applyDeliveryTokenInvalidation(tx, state, ownership, now);
  });
}
