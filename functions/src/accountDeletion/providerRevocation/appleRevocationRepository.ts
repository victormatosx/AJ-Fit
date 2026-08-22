/**
 * Backend-only, temporary storage for Apple revocation material — Fase 3
 * §14/§15.
 *
 * Path (conceptual — no live Cloud Function creates this document in this
 * phase): `accountDeletions/{deletionId}/privateSecurity/appleProviderRevocation`.
 * Scoped to the DELETION record, not to `users/{uid}` — it must survive
 * `users/{uid}` being hard-deleted by `FIRESTORE_CLEANUP`, exactly like the
 * deletion record itself (Fase 1 report §6). Mirrors
 * `functions/src/photoVault/vaultRepository.ts`'s shape: an interface the
 * orchestration layer depends on, plus one Admin-SDK-backed implementation
 * that a client/UI can never reach directly (no Firestore Rule ever grants
 * this path to anyone — Admin SDK bypasses rules regardless, and no rule
 * exists here to bypass).
 *
 * Lifecycle: written once, right after a successful token exchange;
 * deleted (best-effort) as soon as the Apple sub-step reaches ANY
 * terminal-acceptable status (`SUCCEEDED`) or terminal-failed status
 * (`FAILED_TERMINAL`, e.g. retry budget exhausted) — never kept beyond
 * that. This is not a general-purpose credential store.
 */

import { db } from '../../lib/firebaseAdmin';

export interface ApplePendingRevocationMaterial {
  /** KMS ciphertext — see `appleTokenCrypto.ts`. The plaintext refresh token never reaches this module. */
  wrappedRefreshToken: string;
  kmsKeyVersion: string;
  /** Epoch millis this material was written — informational only in this phase (no expiry worker exists yet). */
  createdAtMs: number;
}

export interface AppleRevocationMaterialRepository {
  save(deletionId: string, material: ApplePendingRevocationMaterial): Promise<void>;
  read(deletionId: string): Promise<ApplePendingRevocationMaterial | null>;
  /** Best-effort — a failure to clear must never fail the step that already reached a terminal status. */
  clear(deletionId: string): Promise<void>;
}

function isValidMaterial(data: unknown): data is ApplePendingRevocationMaterial {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.wrappedRefreshToken === 'string' &&
    d.wrappedRefreshToken.length > 0 &&
    typeof d.kmsKeyVersion === 'string' &&
    d.kmsKeyVersion.length > 0 &&
    typeof d.createdAtMs === 'number'
  );
}

const PRIVATE_SECURITY_COLLECTION = 'privateSecurity';
const APPLE_REVOCATION_DOCUMENT = 'appleProviderRevocation';

function materialRef(deletionId: string) {
  return db
    .collection('accountDeletions')
    .doc(deletionId)
    .collection(PRIVATE_SECURITY_COLLECTION)
    .doc(APPLE_REVOCATION_DOCUMENT);
}

export class FirestoreAppleRevocationMaterialRepository implements AppleRevocationMaterialRepository {
  async save(deletionId: string, material: ApplePendingRevocationMaterial): Promise<void> {
    await materialRef(deletionId).set(material);
  }

  async read(deletionId: string): Promise<ApplePendingRevocationMaterial | null> {
    const snapshot = await materialRef(deletionId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    return isValidMaterial(data) ? data : null;
  }

  async clear(deletionId: string): Promise<void> {
    await materialRef(deletionId).delete();
  }
}
