import { defineConfig } from 'vitest/config';

// Scope: pure TS domain logic only (src/lib/**), zero React Native/Expo
// runtime involved — see docs/08_log_de_evolucao.md for why Vitest was
// chosen over Jest/jest-expo for this suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
