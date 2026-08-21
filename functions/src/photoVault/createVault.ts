import { randomBytes } from 'node:crypto';

import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { requireAuth, requireVerifiedEmailForPrivateAccess } from '../lib/auth';
import { requireActiveAccount } from '../accountDeletion/activeAccountGuard';
import { logFunctionError, logInfo } from '../lib/logger';
import { VaultCryptoError } from './errors';
import {
  CURRENT_ENCRYPTION_VERSION,
  VAULT_ALGORITHM,
  type PhotoVaultDocument,
} from './schema';
import { VAULT_KEY_BYTES, wrapVaultKey } from './vaultKeyCrypto';
import { VaultAlreadyExistsError, createVaultDocument } from './vaultRepository';

/**
 * Creates the caller's Photo Vault key.
 *
 * The Vault Key (DEK) is generated here, wrapped by the KMS-held KEK, and
 * only the wrapped form is persisted. The plaintext key is returned once, to
 * the authenticated caller over the callable channel's TLS, and is never
 * stored or logged on the backend.
 *
 * Idempotent by refusal: a user who already has a vault gets
 * `already-exists`. Silently minting a second key would permanently orphan
 * every photo encrypted with the first one.
 */
const SCOPE = 'photoVault.createVault';

/** The first version of a freshly created vault key. */
const INITIAL_VAULT_KEY_VERSION = 1;

export interface CreateVaultResponse {
  /** The raw Vault Key, base64. The client stores it in secure device storage. */
  vaultKey: string;
  vaultKeyVersion: number;
}

export async function handleCreateVault(
  request: CallableRequest,
): Promise<CreateVaultResponse> {
  // The uid comes exclusively from the verified token. Anything in
  // `request.data` (including a `uid` field) is ignored entirely.
  const uid = requireAuth(request);
  requireVerifiedEmailForPrivateAccess(request);

  // Fase 5: an account with a pending/in-progress deletion is not a normal
  // account — never mint a new vault key for it, even if the deletion
  // workflow hasn't reached VAULT_KEY_DESTRUCTION yet.
  await requireActiveAccount(uid);

  // CSPRNG — never Math.random, never derived from uid, email, password or
  // any token. `randomBytes` is Node's cryptographically secure source.
  const vaultKey = randomBytes(VAULT_KEY_BYTES);

  try {
    const { wrappedVaultKey, kmsKeyVersion } = await wrapVaultKey(vaultKey);

    // The function's server clock, not FieldValue.serverTimestamp(): a
    // sentinel cannot be validated, and this document is backend-only, so
    // there is no untrusted writer whose clock could be in play.
    const now = new Date();
    const document: PhotoVaultDocument = {
      wrappedVaultKey,
      encryptionVersion: CURRENT_ENCRYPTION_VERSION,
      vaultKeyVersion: INITIAL_VAULT_KEY_VERSION,
      kmsKeyVersion,
      algorithm: VAULT_ALGORITHM,
      createdAt: now,
      updatedAt: now,
    };

    // Validates the closed schema and fails atomically if a vault exists.
    await createVaultDocument(uid, document);

    logInfo(SCOPE, 'vault created');

    return {
      vaultKey: vaultKey.toString('base64'),
      vaultKeyVersion: INITIAL_VAULT_KEY_VERSION,
    };
  } catch (err) {
    if (err instanceof VaultAlreadyExistsError) {
      // Not an error condition worth alarming on: the client asks for this
      // whenever it is unsure whether the user already has a vault.
      logInfo(SCOPE, 'vault already exists');
      throw new HttpsError('already-exists', 'This account already has a photo vault.');
    }

    // Everything below is unexpected. The cause is logged (sanitized by the
    // logger) but never returned: KMS and Firestore errors carry project,
    // key and IAM details.
    logFunctionError(SCOPE, err, {
      kind: err instanceof VaultCryptoError ? err.code : 'UNKNOWN',
    });
    throw new HttpsError('internal', 'Could not create the photo vault.');
  } finally {
    // Best effort only: V8 may already have copied this buffer and the GC
    // gives no guarantee the original bytes are gone. Documented limitation.
    vaultKey.fill(0);
  }
}

export const createVault = onCall(
  { enforceAppCheck: true },
  handleCreateVault,
);
