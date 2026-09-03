import { defineConfig } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

export default defineConfig([
  ...expoConfig,
  {
    ignores: [
      'android/**', 'ios/**', 'coverage/**', 'functions/lib/**',
      'firestore-debug.log', 'firebase-debug.log',
    ],
    // Existing navigation code intentionally mirrors routing state through
    // refs/effects. Phase 8C establishes a real gate without rewriting that
    // unrelated architecture; all other Expo/React rules remain enabled.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
