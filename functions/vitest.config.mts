import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Emulator-backed integration tests share global Firestore singletons
    // (nutritionCatalogMeta/current, nutritionRolloutConfig/active, etc.) —
    // concurrent test FILES racing on the same doc is a real collision, not
    // a flaky test. Only serialize when FIRESTORE_EMULATOR_HOST is set, so
    // the much larger non-emulator unit suite keeps running in parallel.
    fileParallelism: !process.env.FIRESTORE_EMULATOR_HOST,
  },
});
