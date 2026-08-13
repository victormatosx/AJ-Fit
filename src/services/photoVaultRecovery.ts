import { auth } from '../lib/firebase';
import { PhotoVaultError, isPhotoVaultError } from '../lib/photoVaultErrors';
import type { StoredVaultKey } from '../lib/photoVaultKeyStorage';
import { recoverPhotoVaultKey } from './photoVault';
import {
  ReauthenticationCancelledError,
  reauthenticateCurrentUser,
  type ReauthenticationRequest,
} from './reauthentication';

/**
 * Reauthenticate-then-recover, for the new-device path.
 *
 * Kept out of `services/photoVault.ts` on purpose: reauthentication reaches
 * the Google/Apple provider modules, and the vault service should not carry
 * that dependency just to expose this composition.
 *
 * This is still a service, not UI. It receives an already-collected
 * credential request (`{ provider: 'password', password }`, `'google'` or
 * `'apple'`) and never renders or prompts anything itself — the screen
 * decides how to obtain the credential.
 *
 * Providers are not reimplemented here: `reauthenticateCurrentUser` is the
 * project's single reauthentication path (docs/12 §5), already covering
 * password, Google and Apple with their existing nonce/credential handling.
 */
export async function reauthenticateAndRecoverVaultKey(
  request: ReauthenticationRequest,
): Promise<StoredVaultKey> {
  try {
    await reauthenticateCurrentUser(request);
  } catch (err) {
    if (err instanceof ReauthenticationCancelledError) {
      // Cancelling is a normal user choice, not a failure to report loudly.
      throw new PhotoVaultError('vaultReauthRequired');
    }
    throw new PhotoVaultError('vaultReauthRequired');
  }

  // Reauthentication mints a token with a fresh `auth_time`, but the SDK may
  // still hold the previous one. Force a refresh so the callable carries the
  // updated claim the backend checks — without this, recovery would be
  // rejected right after a successful reauthentication.
  try {
    await auth.currentUser?.getIdToken(true);
  } catch {
    throw new PhotoVaultError('vaultReauthRequired');
  }

  try {
    return await recoverPhotoVaultKey();
  } catch (err) {
    if (isPhotoVaultError(err)) throw err;
    throw new PhotoVaultError('vaultRecoveryFailed');
  }
}
