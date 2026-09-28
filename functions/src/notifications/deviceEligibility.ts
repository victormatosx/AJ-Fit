import { FieldPath, type Firestore, type Timestamp } from 'firebase-admin/firestore';

import {
  PUSH_INSTALLATIONS_COLLECTION,
  PUSH_TOKEN_OWNERS_COLLECTION,
  USER_DEVICES_COLLECTION,
} from '../pushDevices/schema';
import type { DeviceExclusionReason } from './schema';

export const DEVICE_PAGE_SIZE = 25;
export const MAX_ELIGIBLE_DEVICES = 20;
export const MAX_SCANNED_DEVICES = 500;

export interface EligibleDevice {
  installationId: string;
  tokenHash: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  ownershipVersion: number;
}
export interface ExcludedDevice {
  installationId: string;
  reason: DeviceExclusionReason;
}

export interface DeviceEligibilityResult {
  eligible: EligibleDevice[];
  excluded: ExcludedDevice[];
  scannedCount: number;
  scanLimitReached: boolean;
}

interface Candidate {
  installationId: string;
  tokenHash: string;
  platform: 'ios' | 'android';
  ownershipVersion: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validOwnershipVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function expired(value: unknown, now: Timestamp): boolean {
  return typeof (value as { toMillis?: unknown } | null)?.toMillis !== 'function' ||
    (value as Timestamp).toMillis() <= now.toMillis();
}

function projectionCandidate(
  installationId: string,
  data: Record<string, unknown>,
  now: Timestamp,
): Candidate | DeviceExclusionReason {
  if (data.pushEnabled !== true) return 'PUSH_DISABLED';
  if (data.permissionStatus !== 'granted') return 'PERMISSION_REVOKED';
  if (data.disabledAt !== null || data.invalidAt !== null) return 'PUSH_DISABLED';
  if (expired(data.leaseExpiresAt, now)) return 'LEASE_EXPIRED';
  if (typeof data.tokenHash !== 'string' || data.tokenHash.length !== 64) return 'NO_TOKEN';
  if (data.platform !== 'ios' && data.platform !== 'android') return 'INSTALLATION_MISMATCH';
  if (!validOwnershipVersion(data.ownershipVersion)) return 'INSTALLATION_MISMATCH';
  return {
    installationId,
    tokenHash: data.tokenHash,
    platform: data.platform,
    ownershipVersion: data.ownershipVersion,
  };
}

async function verifyPage(
  uid: string,
  candidates: Candidate[],
  db: Firestore,
  now: Timestamp,
): Promise<{ eligible: EligibleDevice[]; excluded: ExcludedDevice[] }> {
  if (candidates.length === 0) return { eligible: [], excluded: [] };

  const installationSnapshots = await db.getAll(...candidates.map(({ installationId }) =>
    db.collection(PUSH_INSTALLATIONS_COLLECTION).doc(installationId),
  ));
  const tokenCandidates: Candidate[] = [];
  const excluded: ExcludedDevice[] = [];

  installationSnapshots.forEach((snapshot, index) => {
    const candidate = candidates[index]!;
    const data = snapshot.data();
    if (!isRecord(data)) {
      excluded.push({ installationId: candidate.installationId, reason: 'RELEASED' });
      return;
    }
    if (data.ownerUid !== uid) {
      excluded.push({ installationId: candidate.installationId, reason: 'OWNER_MISMATCH' });
      return;
    }
    if (
      data.tokenHash !== candidate.tokenHash ||
      data.platform !== candidate.platform ||
      data.ownershipVersion !== candidate.ownershipVersion
    ) {
      excluded.push({ installationId: candidate.installationId, reason: 'INSTALLATION_MISMATCH' });
      return;
    }
    if (data.pushEnabled !== true || data.permissionStatus !== 'granted') {
      excluded.push({ installationId: candidate.installationId, reason: 'PUSH_DISABLED' });
      return;
    }
    if (data.releasedAt !== null || data.disabledAt !== null || data.invalidAt !== null) {
      excluded.push({ installationId: candidate.installationId, reason: 'RELEASED' });
      return;
    }
    if (expired(data.leaseExpiresAt, now)) {
      excluded.push({ installationId: candidate.installationId, reason: 'LEASE_EXPIRED' });
      return;
    }
    tokenCandidates.push(candidate);
  });

  if (tokenCandidates.length === 0) return { eligible: [], excluded };

  const tokenSnapshots = await db.getAll(...tokenCandidates.map(({ tokenHash }) =>
    db.collection(PUSH_TOKEN_OWNERS_COLLECTION).doc(tokenHash),
  ));
  const eligible: EligibleDevice[] = [];

  tokenSnapshots.forEach((snapshot, index) => {
    const candidate = tokenCandidates[index]!;
    const data = snapshot.data();
    if (
      !isRecord(data) ||
      data.tokenHash !== candidate.tokenHash ||
      data.ownerUid !== uid ||
      data.installationId !== candidate.installationId ||
      data.ownershipVersion !== candidate.ownershipVersion
    ) {
      excluded.push({ installationId: candidate.installationId, reason: 'OWNER_MISMATCH' });
      return;
    }
    if (
      data.active !== true ||
      data.invalidAt !== null ||
      expired(data.leaseExpiresAt, now) ||
      typeof data.expoPushToken !== 'string' ||
      data.expoPushToken.length === 0
    ) {
      excluded.push({ installationId: candidate.installationId, reason: 'TOKEN_INVALID' });
      return;
    }
    eligible.push({ ...candidate, expoPushToken: data.expoPushToken });
  });

  return { eligible, excluded };
}

/**
 * Pages through the raw-token-free user projection until the real send limit
 * is filled. Expired/disabled records therefore cannot starve a valid device
 * later in the collection, while MAX_SCANNED_DEVICES remains a hard bound.
 */
export async function loadEligibleDevices(
  uid: string,
  db: Firestore,
  now: Timestamp,
): Promise<DeviceEligibilityResult> {
  const eligible: EligibleDevice[] = [];
  const excluded: ExcludedDevice[] = [];
  let scannedCount = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let exhausted = false;

  // This is the final common gate for every dispatch mode, including direct
  // operational sends, QA previews and retries. A coherent legacy device
  // triplet must not remain sendable after an out-of-band profile deletion,
  // and a deletion lock must stop sends before push cleanup reaches it.
  // Read failures intentionally throw so dispatch fails closed.
  const [user, deletionLock] = await db.getAll(
    db.collection('users').doc(uid),
    db.collection('accountDeletionLocks').doc(uid),
  );
  if (!user.exists || deletionLock.exists) {
    return {
      eligible,
      excluded,
      scannedCount,
      scanLimitReached: false,
    };
  }

  while (
    eligible.length < MAX_ELIGIBLE_DEVICES &&
    scannedCount < MAX_SCANNED_DEVICES &&
    !exhausted
  ) {
    const remaining = MAX_SCANNED_DEVICES - scannedCount;
    let query = db.collection('users').doc(uid).collection(USER_DEVICES_COLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(Math.min(DEVICE_PAGE_SIZE, remaining));
    if (cursor) query = query.startAfter(cursor);

    const page = await query.get();
    if (page.empty) break;
    scannedCount += page.size;
    cursor = page.docs[page.docs.length - 1];
    exhausted = page.size < Math.min(DEVICE_PAGE_SIZE, remaining);

    const candidates: Candidate[] = [];
    for (const document of page.docs) {
      const data = document.data();
      const candidate = projectionCandidate(document.id, data, now);
      if (typeof candidate === 'string') {
        excluded.push({ installationId: document.id, reason: candidate });
      } else {
        candidates.push(candidate);
      }
    }

    const verified = await verifyPage(uid, candidates, db, now);
    eligible.push(...verified.eligible.slice(0, MAX_ELIGIBLE_DEVICES - eligible.length));
    excluded.push(...verified.excluded);
  }

  return {
    eligible,
    excluded,
    scannedCount,
    scanLimitReached: scannedCount >= MAX_SCANNED_DEVICES && !exhausted,
  };
}
