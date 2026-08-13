import { backendHealth } from './health/backendHealth';
import { createVault } from './photoVault/createVault';
import { recoverVaultKey } from './photoVault/recoverVaultKey';
import { cleanupPhotoVaultOrphans } from './photoVault/cleanupOrphans';

/**
 * AJ Fit Cloud Functions entry point.
 *
 * Every exported Cloud Function is wired here; the implementation itself
 * lives in its own module.
 *
 * Only authenticated, policy-enforcing callables are exported. The KMS
 * wrap/unwrap layer stays internal — it is never given an endpoint of its
 * own, so nothing can ask the backend to encrypt or decrypt arbitrary bytes.
 *
 * NOTE: this codebase does not contain the billing/RevenueCat functions,
 * which are being developed in parallel on another branch. Deploy Photo
 * Vault functions BY NAME (`--only functions:createVault,...`), never with a
 * bare `--only functions`, which would try to remove functions that are live
 * in production but absent here.
 */
export { backendHealth, cleanupPhotoVaultOrphans, createVault, recoverVaultKey };
