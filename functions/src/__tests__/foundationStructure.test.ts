import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const functionsRoot = path.resolve(__dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(path.join(functionsRoot, relativePath), 'utf8');
}

/**
 * Source with comments stripped, for assertions about what the CODE does.
 * Without this, prose like "nothing takes a uid" trips a check meant to find
 * an actual `uid` parameter.
 */
function readCode(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Photo Vault backend foundation — Phase 3 structural guarantees', () => {
  it('never carries a service account JSON file in the repo', () => {
    // A real service account key file always has this literal marker.
    const suspects = ['src/lib/firebaseAdmin.ts', 'package.json'];

    for (const file of suspects) {
      expect(read(file)).not.toContain('"type": "service_account"');
      expect(read(file)).not.toContain('private_key');
    }
  });

  it('initializes firebase-admin with no arguments (Application Default Credentials only)', () => {
    const source = read('src/lib/firebaseAdmin.ts');

    expect(source).toContain('initializeApp()');
    expect(source).not.toMatch(/initializeApp\(\s*\{/);
    expect(source).not.toContain('credential.cert');
    expect(source).not.toContain('serviceAccount');
    expect(source).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
  });

  it('implements no vault key rotation or destruction yet (Phase 7 boundary)', () => {
    // Phase 6 legitimately added createVault/recoverVaultKey. Rotation and
    // destruction remain unimplemented — they need their own design for
    // re-encrypting or orphaning existing photos.
    const forbidden = ['rotateVaultKey', 'destroyVault'];

    for (const file of [
      'src/index.ts',
      'src/lib/firebaseAdmin.ts',
      'src/lib/auth.ts',
      'src/lib/logger.ts',
      'src/health/backendHealth.ts',
      'src/photoVault/schema.ts',
      'src/photoVault/kmsClient.ts',
      'src/photoVault/vaultKeyCrypto.ts',
      'src/photoVault/errors.ts',
      'src/photoVault/createVault.ts',
      'src/photoVault/recoverVaultKey.ts',
      'src/photoVault/vaultRepository.ts',
    ]) {
      const source = read(file);
      for (const token of forbidden) {
        expect(source, `${file} must not reference "${token}" yet`).not.toContain(token);
      }
    }
  });

  it('publishes the intended billing, promotion, health and Photo Vault functions', () => {
    const source = read('src/index.ts');

    // Match the export statements themselves, not prose in the file's JSDoc.
    const groupedExports = [...source.matchAll(/export\s*\{([^}]*)\}/g)]
      .flatMap((match) => match[1].split(','))
      .map((name) => name.trim())
      .filter(Boolean);
    const constantExports = [...source.matchAll(/^export const (\w+)/gm)].map(
      (match) => match[1],
    );
    const exported = [...groupedExports, ...constantExports]
      .sort();

    expect(exported).toEqual([
      'adminCreatePromoCode',
      'adminGetCoupon',
      'adminGetUser',
      'adminListCoupons',
      'adminListPromoCodes',
      'adminListUsers',
      'adminSetPromoCodeActive',
      'adminUpdatePromoCode',
      'applyExerciseSubstitution',
      'authorizePromoPurchase',
      'authorizeWorkoutLifecycleMutation',
      'backendHealth',
      'cleanupPendingAccountDeletions',
      'cleanupPhotoVaultOrphans',
      'confirmCommercialGate',
      'createVault',
      'dispatchTestNotification',
      'evaluateDailyWorkoutNotifications',
      'onAccountDeletionRequested',
      'onTrustedWorkoutLifecycleEventCreated',
      'reconcileNotificationReceipts',
      'recordWorkoutLifecycleTelemetry',
      'recoverVaultKey',
      'releasePushDevice',
      'requestAccountDeletion',
      'retryNotificationDispatches',
      'revenueCatWebhook',
      'syncPushDevice',
      'validatePromoCode',
    ]);
  });

  it('never gives wrap/unwrap an endpoint of their own', () => {
    // An endpoint that wraps or unwraps arbitrary bytes would turn the KEK
    // into an oracle. Only the two policy-enforcing callables may reach it.
    const entrypoint = readCode('src/index.ts');
    expect(entrypoint).not.toContain('wrapVaultKey');
    expect(entrypoint).not.toContain('unwrapVaultKey');

    for (const file of ['src/photoVault/vaultKeyCrypto.ts', 'src/photoVault/kmsClient.ts']) {
      const source = readCode(file);
      expect(source, `${file} must not export a callable`).not.toContain('onCall');
      expect(source, `${file} must not export an HTTP function`).not.toContain('onRequest');
    }
  });

  it('reads the uid only from the verified token, never from the request body', () => {
    for (const file of ['src/photoVault/createVault.ts', 'src/photoVault/recoverVaultKey.ts']) {
      const source = readCode(file);

      // A uid taken from `request.data` would let any caller name someone
      // else's vault.
      expect(source, `${file} must not read a uid from request.data`).not.toMatch(
        /request\.data/,
      );
      expect(source, `${file} must derive the uid from a guard`).toMatch(
        /requireAuth\(request\)|requireRecentAuth\(request\)/,
      );
    }
  });

  it('requires recent authentication to recover the vault key', () => {
    const source = readCode('src/photoVault/recoverVaultKey.ts');

    expect(source).toContain('requireRecentAuth');
    // Creation deliberately does not demand it; recovery always must.
    expect(readCode('src/photoVault/createVault.ts')).not.toContain('requireRecentAuth');
  });

  it('never persists or returns the plaintext vault key from storage', () => {
    const repository = readCode('src/photoVault/vaultRepository.ts');

    // The repository only ever handles the wrapped form.
    expect(repository).not.toContain('unwrapVaultKey');
    expect(repository).not.toContain('randomBytes');
    expect(repository).toContain('assertValidPhotoVault');
  });

  it('keeps the KMS layer internal: no callable/HTTP surface, no uid, no Firestore', () => {
    for (const file of ['src/photoVault/vaultKeyCrypto.ts', 'src/photoVault/kmsClient.ts']) {
      const source = readCode(file);

      // These modules encapsulate KMS only. Authorization, uid handling and
      // persistence belong to the Phase 6 callable that will wrap them.
      expect(source, `${file} must not be an endpoint`).not.toContain('onCall(');
      expect(source, `${file} must not be an endpoint`).not.toContain('onRequest(');
      expect(source, `${file} must not take a uid`).not.toMatch(/\buid\b/);
      expect(source, `${file} must not touch Firestore`).not.toContain('firebase-admin');
      expect(source, `${file} must not touch Firestore`).not.toContain('getFirestore');
    }
  });

  it('never hardcodes a project id in the KMS configuration', () => {
    const source = read('src/photoVault/kmsClient.ts');

    // The project must come from the managed runtime environment so the same
    // code runs against a future staging project untouched.
    expect(source).not.toContain('ajfit-2f321');
    expect(source).toContain('GCLOUD_PROJECT');
  });

  it('pins the KMS key ring and crypto key as backend constants', () => {
    const source = read('src/photoVault/kmsClient.ts');

    // A client-influenced resource name would let a caller ask the backend to
    // decrypt against a key it controls.
    expect(source).toContain("KMS_KEY_RING = 'ajfit-photo-vault'");
    expect(source).toContain("KMS_CRYPTO_KEY = 'photo-vault-kek'");
  });

  it('never performs I/O or holds key material in the vault schema module', () => {
    const source = read('src/photoVault/schema.ts');

    // The schema is a pure data contract: no Firestore, no crypto, no
    // network. Enforcement of those belongs to Phase 5's functions.
    expect(source).not.toContain('firebaseAdmin');
    expect(source).not.toContain('firebase-admin');
    expect(source).not.toContain('getFirestore');
    expect(source).not.toContain('node:crypto');
    expect(source).not.toContain('randomBytes');
  });

  it('enforces App Check on every approved mobile callable', () => {
    const protectedDefinitions = [
      ['src/index.ts', 'validatePromoCode'],
      ['src/index.ts', 'authorizePromoPurchase'],
      ['src/index.ts', 'recordWorkoutLifecycleTelemetry'],
      ['src/index.ts', 'authorizeWorkoutLifecycleMutation'],
      ['src/index.ts', 'applyExerciseSubstitution'],
      ['src/photoVault/createVault.ts', 'createVault'],
      ['src/photoVault/recoverVaultKey.ts', 'recoverVaultKey'],
      ['src/billing/confirmCommercialGate.ts', 'confirmCommercialGate'],
      ['src/accountDeletion/requestAccountDeletion.ts', 'requestAccountDeletion'],
      ['src/index.ts', 'syncPushDevice'],
      ['src/index.ts', 'releasePushDevice'],
      ['src/index.ts', 'dispatchTestNotification'],
    ] as const;

    for (const [file, functionName] of protectedDefinitions) {
      const source = readCode(file);
      const definition = new RegExp(
        `export\\s+const\\s+${functionName}\\s*=\\s*onCall\\([\\s\\S]*?enforceAppCheck\\s*:\\s*true`,
      );
      expect(source, `${functionName} must enforce App Check`).toMatch(definition);
    }

    const allEndpointSources = [
      'src/index.ts',
      'src/health/backendHealth.ts',
      'src/photoVault/createVault.ts',
      'src/photoVault/recoverVaultKey.ts',
      'src/photoVault/cleanupOrphans.ts',
      'src/billing/confirmCommercialGate.ts',
      'src/accountDeletion/requestAccountDeletion.ts',
      'src/accountDeletion/immediateDispatch.ts',
      'src/accountDeletion/reconciliation/scheduler.ts',
    ].map(readCode).join('\n');

    expect(allEndpointSources.match(/enforceAppCheck\s*:\s*true/g)).toHaveLength(12);
    expect(allEndpointSources).not.toMatch(/consumeAppCheckToken\s*:\s*true/);
  });

  it('exports backendHealth from the entrypoint', () => {
    const source = read('src/index.ts');

    expect(source).toMatch(/export\s*\{[^}]*\bbackendHealth\b[^}]*\}/);
  });

  it('firebase.json declares the functions codebase without touching Firestore/Storage rules config', () => {
    const firebaseJson = JSON.parse(read('../firebase.json')) as Record<string, unknown>;

    expect(firebaseJson.functions).toBeDefined();
    expect(firebaseJson.firestore).toBeDefined();
    expect(firebaseJson.storage).toBeDefined();
  });

  it('has a .firebaserc with a production alias and no implicit default project', () => {
    const rcPath = path.resolve(functionsRoot, '..', '.firebaserc');
    expect(existsSync(rcPath)).toBe(true);

    const rc = JSON.parse(readFileSync(rcPath, 'utf8')) as {
      projects?: Record<string, string>;
    };

    expect(rc.projects?.production).toBe('ajfit-2f321');
    expect(rc.projects?.default).toBeUndefined();
  });

  it('does not commit compiled output (lib/) to git-tracked source', () => {
    const gitignore = read('.gitignore');
    expect(gitignore).toContain('lib/');
  });
});
