import { defineConfig } from 'vitest/config';

// Scope: Firestore Rules behavior tests. Requires the Firestore emulator
// running (see the `test:rules` script — it wraps this config with
// `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST for us).
//
// Kept separate from vitest.config.mts so `npm test` continues to run in
// under a second and doesn't require the emulator or any Java runtime.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['firestore-tests/**/*.test.ts'],
    // Rules tests each provision Firestore state and rely on the emulator's
    // single-project isolation via `clearFirestore()` in beforeEach —
    // parallel workers would race that shared state.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
