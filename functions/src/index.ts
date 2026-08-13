import { backendHealth } from './health/backendHealth';

/**
 * AJ Fit Cloud Functions entry point.
 *
 * Every exported Cloud Function is wired here; the implementation itself
 * lives in its own module. This is Phase 3 of the Photo Vault backend
 * (docs/20_backend_functions_photo_vault.md): infrastructure foundation
 * only. Vault key creation/recovery and any Cloud KMS usage are NOT part
 * of this phase — they will be added as their own modules (e.g.
 * `src/photoVault/...`) in a later phase, without needing to reorganize
 * this file.
 */
export { backendHealth };
