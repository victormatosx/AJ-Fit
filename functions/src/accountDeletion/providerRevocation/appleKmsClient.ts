import { KeyManagementServiceClient } from '@google-cloud/kms';

/**
 * Cloud KMS wiring for the temporary Apple refresh-token encryption key.
 *
 * Deliberately a SEPARATE KeyRing/CryptoKey from the Photo Vault's KEK
 * (`functions/src/photoVault/kmsClient.ts`) — different security domain
 * (short-lived, workflow-scoped revocation material vs. long-lived
 * per-user photo encryption), different blast radius if ever compromised,
 * and no reason to couple their rotation/IAM policies. Mirrors that
 * module's structure exactly otherwise — see its doc comment for the
 * rationale this repeats: the KEK never leaves KMS, resource names are
 * backend constants never influenced by client input, and names are not
 * secrets.
 *
 * PENDING PROVISIONING (Fase 3 report §"secrets necessários"): this KeyRing/
 * CryptoKey does not necessarily exist in the GCP project yet — creating it
 * is an infrastructure change outside this phase's scope (no GCP/Firebase
 * configuration was altered while implementing Fase 3).
 */

export const APPLE_REVOCATION_KMS_LOCATION = 'us-central1';
export const APPLE_REVOCATION_KMS_KEY_RING = 'ajfit-account-deletion';
export const APPLE_REVOCATION_KMS_CRYPTO_KEY = 'apple-provider-revocation-kek';

export class AppleRevocationKmsConfigurationError extends Error {
  constructor(reason: string) {
    super(`Apple revocation KMS configuration invalid: ${reason}`);
    this.name = 'AppleRevocationKmsConfigurationError';
  }
}

export function resolveProjectId(): string {
  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new AppleRevocationKmsConfigurationError('no project id in the runtime environment');
  }

  return projectId;
}

export function appleRevocationCryptoKeyName(projectId = resolveProjectId()): string {
  return (
    `projects/${projectId}/locations/${APPLE_REVOCATION_KMS_LOCATION}` +
    `/keyRings/${APPLE_REVOCATION_KMS_KEY_RING}/cryptoKeys/${APPLE_REVOCATION_KMS_CRYPTO_KEY}`
  );
}

let client: KeyManagementServiceClient | undefined;

export function getAppleRevocationKmsClient(): KeyManagementServiceClient {
  if (!client) {
    client = new KeyManagementServiceClient();
  }
  return client;
}

/** Test seam: lets unit tests inject a stub instead of reaching Cloud KMS. */
export function setAppleRevocationKmsClientForTesting(
  stub: KeyManagementServiceClient | undefined,
): void {
  client = stub;
}
