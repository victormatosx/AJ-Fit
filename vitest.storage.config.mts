import { defineConfig } from 'vitest/config';

// Scope: Storage Rules behavior tests. Requires the Storage emulator running
// (see the `test:rules` script — it wraps this config with
// `firebase emulators:exec --only firestore,storage`, which sets
// FIREBASE_STORAGE_EMULATOR_HOST for us).
//
// Kept separate from vitest.firestore.config.mts because the Storage rules
// tests drive the firebase compat API (the only surface
// `@firebase/rules-unit-testing` exposes for Storage), while the Firestore
// tests use the modular SDK.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['storage-tests/**/*.test.ts'],
    // Each test provisions emulator state and relies on `clearStorage()` in
    // beforeEach — parallel workers would race that shared state.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
