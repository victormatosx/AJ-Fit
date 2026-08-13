import { KeyManagementServiceClient } from '@google-cloud/kms';

import { VaultCryptoError } from './errors';

/**
 * Cloud KMS wiring for the Photo Vault KEK.
 *
 * The KEK never leaves KMS: this module only ever asks KMS to encrypt or
 * decrypt on its behalf. There is no key material in this file, in the
 * environment, or anywhere in the repository.
 *
 * The KeyRing/CryptoKey names are BACKEND CONSTANTS on purpose — they are
 * never read from user input, from a request body, or from a mutable
 * document. A client that could influence the resource name could ask the
 * backend to decrypt against a key it controls.
 *
 * These names are not secrets (see docs/20_backend_functions_photo_vault.md).
 */

/**
 * Same region as the deployed Cloud Functions (us-central1) so the KEK sits
 * next to the only workload that uses it: no cross-region hop on the hot
 * path, and one region to reason about operationally.
 */
export const KMS_LOCATION = 'us-central1';

/** Dedicated to the Photo Vault — never shared with billing, secrets or other features. */
export const KMS_KEY_RING = 'ajfit-photo-vault';

/** Symmetric KEK that wraps each user's Vault Key (DEK). */
export const KMS_CRYPTO_KEY = 'photo-vault-kek';

/**
 * Resolves the GCP project from the managed runtime environment. Cloud
 * Functions sets these; nothing is hardcoded, so the same code runs against
 * a future staging project without edits.
 */
export function resolveProjectId(): string {
  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new VaultCryptoError(
      'KMS_CONFIGURATION_ERROR',
      'no project id in the runtime environment',
    );
  }

  return projectId;
}

/** Fully-qualified CryptoKey resource name used for encrypt/decrypt. */
export function cryptoKeyName(projectId = resolveProjectId()): string {
  return (
    `projects/${projectId}/locations/${KMS_LOCATION}` +
    `/keyRings/${KMS_KEY_RING}/cryptoKeys/${KMS_CRYPTO_KEY}`
  );
}

let client: KeyManagementServiceClient | undefined;

/**
 * Lazily-created singleton. Authentication is Application Default
 * Credentials from the function's runtime service account — no key file,
 * no JSON, no GOOGLE_APPLICATION_CREDENTIALS pointing anywhere.
 */
export function getKmsClient(): KeyManagementServiceClient {
  if (!client) {
    client = new KeyManagementServiceClient();
  }
  return client;
}

/** Test seam: lets unit tests inject a stub instead of reaching Cloud KMS. */
export function setKmsClientForTesting(stub: KeyManagementServiceClient | undefined): void {
  client = stub;
}
