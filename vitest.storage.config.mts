import { defineConfig } from 'vitest/config';

// Scope: Storage Rules behavior tests. Requires BOTH the Storage and
// Firestore emulators running (see `test:rules`/`test:rules:storage` —
// both now wrap this config with `firebase emulators:exec --only
// firestore,storage`). Firestore became required starting Fase 7
// (docs/13_assinaturas_e_billing.md §10/§11): `storage.rules`'
// `hasServerPremium()` reads `users/{uid}.subscription.entitlementActive`
// via Cloud Storage for Firebase's cross-service Firestore access
// (`firestore.get`/`firestore.exists`), so any test touching a
// progressPhotos create/delete path needs a live Firestore emulator to
// seed that document against, exactly like the Firestore rules tests do.
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
