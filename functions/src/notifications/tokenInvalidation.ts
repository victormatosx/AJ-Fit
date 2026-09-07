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
  const installationRef = db.collection(PUSH_INSTALLATIONS_COLLECTION)
    .doc(ownership.installationId);
  const tokenRef = db.collection(PUSH_TOKEN_OWNERS_COLLECTION)
    .doc(ownership.tokenHash);
  const deviceRef = db.collection('users').doc(ownership.uid)
    .collection(USER_DEVICES_COLLECTION).doc(ownership.installationId);

  return db.runTransaction(async (tx) => {
    const [installationSnapshot, tokenSnapshot, deviceSnapshot] = await Promise.all([
      tx.get(installationRef),
      tx.get(tokenRef),
      tx.get(deviceRef),
    ]);
    const installation = installationSnapshot.data();
    const token = tokenSnapshot.data();

    const exactInstallation =
      installation?.ownerUid === ownership.uid &&
      installation?.tokenHash === ownership.tokenHash &&
      installation?.ownershipVersion === ownership.ownershipVersion;
    const exactToken =
      token?.ownerUid === ownership.uid &&
      token?.installationId === ownership.installationId &&
      token?.tokenHash === ownership.tokenHash &&
      token?.ownershipVersion === ownership.ownershipVersion &&
      token?.active === true;

    if (!exactInstallation || !exactToken) return false;

    const expireAt = Timestamp.fromMillis(
      now.toMillis() + RELEASED_INSTALLATION_RETENTION_MS,
    );

    tx.set(installationRef, {
      pushEnabled: false,
      invalidAt: now,
      disabledAt: now,
      expireAt,
      updatedAt: now,
    }, { merge: true });

    if (
      deviceSnapshot.data()?.tokenHash === ownership.tokenHash &&
      deviceSnapshot.data()?.ownershipVersion === ownership.ownershipVersion
    ) {
      tx.set(deviceRef, {
        pushEnabled: false,
        invalidAt: now,
        disabledAt: now,
        expireAt,
        updatedAt: now,
      }, { merge: true });
    }

    // Delete the only raw-token record immediately. The installation and
    // delivery retain hashes/status for troubleshooting without retaining PII.
    tx.delete(tokenRef);
    return true;
  });
}
