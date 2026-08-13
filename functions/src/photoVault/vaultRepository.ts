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
