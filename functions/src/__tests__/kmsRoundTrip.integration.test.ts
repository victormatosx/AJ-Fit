/**
 * OPT-IN integration check against the REAL Cloud KMS KEK.
 *
 * Skipped by default. It only runs when both variables are set:
 *
 *   PHOTO_VAULT_KMS_INTEGRATION=1 \
 *   GCLOUD_PROJECT=<project-id> \
 *   npx vitest run src/__tests__/kmsRoundTrip.integration.test.ts
 *
 * Prerequisites: `scripts/setup-photo-vault-kms.sh --apply` has been run for
 * that project, and the caller holds ADC with
 * roles/cloudkms.cryptoKeyEncrypterDecrypter on the key
 * (`gcloud auth application-default login`).
 *
 * Safety properties, by construction:
 *   - the key material is random bytes generated here, never a real user's
 *     Vault Key;
 *   - nothing is persisted — no Firestore write, no file, no env var;
 *   - nothing is logged: the assertions compare buffers, they never print
 *     them, and a failure message would show only lengths;
 *   - the buffers are zeroed in `finally`.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { VAULT_KEY_BYTES, unwrapVaultKey, wrapVaultKey } from '../photoVault/vaultKeyCrypto';
import { cryptoKeyName } from '../photoVault/kmsClient';

const enabled =
  process.env.PHOTO_VAULT_KMS_INTEGRATION === '1' &&
  Boolean(process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT);

describe.skipIf(!enabled)('Cloud KMS round trip (real KEK)', () => {
  it('wraps and unwraps a throwaway 32-byte key without altering it', async () => {
    const original = randomBytes(VAULT_KEY_BYTES);
    let restored: Buffer | undefined;

    try {
      const { wrappedVaultKey, kmsKeyVersion } = await wrapVaultKey(original);

      // Sanity: the ciphertext must not be the plaintext in disguise.
      expect(Buffer.from(wrappedVaultKey, 'base64').equals(original)).toBe(false);

      // The version comes from the KMS response, never fabricated.
      expect(kmsKeyVersion).toContain('/cryptoKeyVersions/');

      restored = await unwrapVaultKey(wrappedVaultKey);

      // `equals` returns a boolean — a mismatch reports true/false, never bytes.
      expect(restored.equals(original)).toBe(true);
      expect(restored.length).toBe(VAULT_KEY_BYTES);
    } finally {
      original.fill(0);
      restored?.fill(0);
    }
  });

  it('reports the resource name it is exercising (no key material)', () => {
    expect(cryptoKeyName()).toMatch(
      /^projects\/[^/]+\/locations\/us-central1\/keyRings\/ajfit-photo-vault\/cryptoKeys\/photo-vault-kek$/,
    );
  });
});
