import { defineConfig } from 'vitest/config';

// Scope: MFA recovery integration tests that talk to the REAL Firestore
// Emulator through firebase-admin, rather than to the deterministic fake.
//
// Kept in a separate config (and a separate `__integration__` directory, which
// `vitest.config.mts`'s `src/**/__tests__/**` glob deliberately does not
// match) so that `npm test` keeps running in under two seconds and needs
// neither the emulator nor a Java runtime.
//
// Run via the root `test:mfa-recovery:emulator` script, which wraps this with
// `firebase emulators:exec` — that is what sets FIRESTORE_EMULATOR_HOST and
// GCLOUD_PROJECT. The suite refuses to run without them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__integration__/**/*.test.ts'],
    // These tests share one emulator database and clear it between cases;
    // parallel workers would race that shared state.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
