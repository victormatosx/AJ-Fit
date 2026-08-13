import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Scope: pure TS domain logic only (src/lib/**), zero React Native/Expo
// runtime involved — see docs/08_log_de_evolucao.md for why Vitest was
// chosen over Jest/jest-expo for this suite.
export default defineConfig({
  resolve: {
    // Metro selects .native.ts/.web.ts automatically. Vitest runs in Node and
    // needs the native implementation selected explicitly before tests mock
    // its platform APIs.
    alias: {
      './providers/google': fileURLToPath(
        new URL('./src/services/providers/google.native.ts', import.meta.url),
      ),
      './providers/apple': fileURLToPath(
        new URL('./src/services/providers/apple.native.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
