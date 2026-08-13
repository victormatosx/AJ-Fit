import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { requireRecentAuth } from '../lib/auth';
import { logFunctionError, logInfo } from '../lib/logger';
import { VaultCryptoError } from './errors';
import { validatePhotoVault } from './schema';
import { unwrapVaultKey } from './vaultKeyCrypto';
import { readVaultDocument } from './vaultRepository';

/**
 * Returns the caller's existing Vault Key, for a new device.
 *
 * This is the most sensitive operation in the backend: it hands back the key
 * that decrypts every photo the user owns. It therefore requires RECENT
 * authentication — a valid but old ID Token is not enough, so a stolen
 * device with a live session cannot extract the key without re-proving the
 * account credential.
 *
 * It never creates a vault. A user without one gets `not-found`; creation is
 * a separate, explicit operation.
 */
const SCOPE = 'photoVault.recoverVaultKey';

export interface RecoverVaultKeyResponse {
  /** The raw Vault Key, base64. */
  vaultKey: string;
  vaultKeyVersion: number;
}

export async function handleRecoverVaultKey(
  request: CallableRequest,
): Promise<RecoverVaultKeyResponse> {
  // Enforces both authentication and freshness. The uid comes from the
  // verified token — a `uid` in `request.data` is ignored entirely, so a
  // caller can only ever reach their own vault.
  const uid = requireRecentAuth(request);

  let vaultKey: Buffer | undefined;

  try {
    const document = await readVaultDocument(uid);

    if (!document) {
      logInfo(SCOPE, 'no vault for user');
      throw new HttpsError('not-found', 'This account does not have a photo vault.');
    }

    // The document is backend-written, so a schema violation means stored
    // data drifted or was corrupted — never a client input problem.
    const problems = validatePhotoVault(document);
    if (problems.length > 0) {
      logFunctionError(SCOPE, new Error('stored vault document failed validation'), {
        problemCount: problems.length,
      });
      throw new HttpsError('data-loss', 'The photo vault could not be read.');
    }

    vaultKey = await unwrapVaultKey(document.wrappedVaultKey);

    logInfo(SCOPE, 'vault key recovered');

    return {
      vaultKey: vaultKey.toString('base64'),
      vaultKeyVersion: document.vaultKeyVersion,
    };
  } catch (err) {
    // Deliberate policy outcomes pass through untouched; everything else is
    // flattened so KMS/Firestore internals never reach the client.
    if (err instanceof HttpsError) {
      throw err;
    }

    logFunctionError(SCOPE, err, {
      kind: err instanceof VaultCryptoError ? err.code : 'UNKNOWN',
    });
    throw new HttpsError('internal', 'Could not recover the photo vault key.');
  } finally {
    // Best effort — see the note in createVault about GC guarantees.
    vaultKey?.fill(0);
  }
}

export const recoverVaultKey = onCall(handleRecoverVaultKey);
