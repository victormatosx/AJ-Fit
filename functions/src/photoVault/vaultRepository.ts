import { db } from '../lib/firebaseAdmin';
import { type PhotoVaultDocument, assertValidPhotoVault } from './schema';

/**
 * Firestore access for the backend-only vault document.
 *
 * Path: users/{uid}/privateSecurity/photoVault
 *
 * The client is denied all access to this document by Security Rules; the
 * Admin SDK used here bypasses those rules, which is exactly why every write
 * goes through `assertValidPhotoVault` first — this module is the only place
 * the closed schema is actually enforced.
 *
 * The uid is always supplied by the caller from `request.auth.uid`. Nothing
 * here reads a path, a uid or a document id from client input.
 */

const PRIVATE_SECURITY_COLLECTION = 'privateSecurity';
const PHOTO_VAULT_DOCUMENT = 'photoVault';

function vaultRef(uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection(PRIVATE_SECURITY_COLLECTION)
    .doc(PHOTO_VAULT_DOCUMENT);
}

/** gRPC status code for ALREADY_EXISTS, returned by `create()` on collision. */
const FIRESTORE_ALREADY_EXISTS = 6;

export class VaultAlreadyExistsError extends Error {
  constructor() {
    super('VAULT_ALREADY_EXISTS');
    this.name = 'VaultAlreadyExistsError';
  }
}

/**
 * Creates the vault document, failing if the user already has one.
 *
 * Uses `DocumentReference.create()` rather than a transaction: it carries a
 * server-side "must not exist" precondition, so two concurrent calls can
 * never both succeed. That is the atomicity this needs — a transaction would
 * add a read-modify-write cycle without strengthening the guarantee, and
 * would risk re-running on retry.
 *
 * Never last-write-wins: silently replacing a vault key would permanently
 * orphan every photo already encrypted with the previous one.
 */
export async function createVaultDocument(
  uid: string,
  document: PhotoVaultDocument,
): Promise<void> {
  assertValidPhotoVault(document);

  try {
    await vaultRef(uid).create(document);
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === FIRESTORE_ALREADY_EXISTS) {
      throw new VaultAlreadyExistsError();
    }
    throw err;
  }
}

/**
 * Deletes the vault document — Fase 12.5 (`VAULT_KEY_DESTRUCTION`).
 *
 * This document (`wrappedVaultKey` + `kmsKeyVersion`) is the ONLY backend
 * copy of the user's wrapped Vault Key — confirmed by the Fase 12.5
 * cryptographic audit: `createVault.ts` generates the raw DEK in function
 * memory, wraps it once via the shared project-wide KMS KEK
 * (`kmsClient.ts`'s `photo-vault-kek` — never per-user, never destroyed
 * here), and persists only the wrapped ciphertext, here. `recoverVaultKey.ts`
 * re-reads and re-unwraps this exact same document — there is no separate
 * recovery blob, backup, or legacy-key document anywhere in the schema.
 * Deleting this document is therefore sufficient, on its own, to make the
 * Vault Key permanently unrecoverable (crypto-shredding: the sole wrapped
 * ciphertext is gone, so KMS has nothing left to unwrap for this uid) —
 * without touching the shared KEK, which every other user's vault still
 * depends on.
 *
 * Plain Firestore `.delete()` is naturally idempotent — deleting an
 * already-absent document succeeds silently, never throws "not found".
 * `FIRESTORE_CLEANUP` (Fase 6) deliberately never touches this document
 * (non-recursive delete of `users/{uid}`, see `firestoreCleanup/resources.ts`) —
 * this repository function is the only writer that removes it.
 */
export async function deleteVaultDocument(uid: string): Promise<void> {
  await vaultRef(uid).delete();
}

/** Reads the vault document, or null when the user has no vault yet. */
export async function readVaultDocument(uid: string): Promise<PhotoVaultDocument | null> {
  const snapshot = await vaultRef(uid).get();
  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data();

  // Firestore hands timestamps back as `Timestamp`, not `Date`. Normalize
  // before validating so the stored document is checked against the same
  // closed schema that gated the write.
  return {
    ...data,
    createdAt: data?.createdAt?.toDate?.() ?? data?.createdAt,
    updatedAt: data?.updatedAt?.toDate?.() ?? data?.updatedAt,
  } as PhotoVaultDocument;
}
