import { describe, expect, it, vi } from 'vitest';

// `localWorkoutTemplateDocumentV127`'s content-hash path pulls in
// `expo-crypto`, which under plain Node/vitest (no Expo/RN runtime) fails to
// resolve. Same Node-crypto-backed shim already established in
// `workoutLifecycleLongRun.integration.test.ts`/`workoutLifecycleApplication.
// integration.test.ts`.
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex'),
  };
});

import { localWorkoutTemplateDocumentV127 } from '../templateDocumentV127';

/**
 * Fase 10 (cutover) — `saveAndActivateWorkoutProgram`/`contentIdentityFor`
 * require `contentHash` to be a 64-hex-char string (`isProgramSnapshot`'s
 * `/^[a-f0-9]{64}$/` check, Fase 8) — this proves the locally-computed
 * v1.27 hash (via `expo-crypto`, not `node:crypto`) satisfies that shape,
 * is deterministic, and differs per template.
 */
describe('localWorkoutTemplateDocumentV127', () => {
  it('computes a real 64-hex-char sha256-shaped contentHash', async () => {
    const doc = await localWorkoutTemplateDocumentV127('T001');
    expect(doc.id).toBe('T001');
    expect(doc.sourceVersion).toBe('1.27.0');
    expect(/^[a-f0-9]{64}$/.test(doc.contentHash)).toBe(true);
  });

  it('is deterministic for the same template id', async () => {
    const first = await localWorkoutTemplateDocumentV127('T003');
    const second = await localWorkoutTemplateDocumentV127('T003');
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('differs across distinct templates', async () => {
    const t001 = await localWorkoutTemplateDocumentV127('T001');
    const t003 = await localWorkoutTemplateDocumentV127('T003');
    expect(t001.contentHash).not.toBe(t003.contentHash);
  });
});
