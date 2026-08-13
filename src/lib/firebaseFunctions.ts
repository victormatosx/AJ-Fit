import { getFunctions, type Functions } from 'firebase/functions';
import { app } from './firebase';

/**
 * Callable Functions client for AJ Fit.
 *
 * The region is pinned explicitly. The Photo Vault functions are deployed to
 * us-central1 (docs/20_backend_functions_photo_vault.md); relying on the SDK
 * default would silently point at a different region if that default ever
 * changed, producing `not-found` at runtime rather than a build error.
 */
export const FUNCTIONS_REGION = 'us-central1';

export const functions: Functions = getFunctions(app, FUNCTIONS_REGION);
