import { describe, expect, it, vi } from 'vitest';

// Same Node-crypto-backed `expo-crypto` shim the sibling
// `templateDocumentV127.test.ts` already establishes — the local v1.27
// content hash is computed through it.
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex'),
  };
});

// `workoutPrograms` reaches React Native through its Firestore client, which
// Vitest cannot parse — mocked with an explicit export list, the same shape
// `workoutLifecycleReconcileDecisionReuse.test.ts` already establishes.
// `loadWorkoutTemplate` is the only member this suite exercises; the rest
// exist solely so the module under test can import them.
const loadWorkoutTemplate = vi.fn();
vi.mock('../workoutPrograms', () => ({
  contentIdentityFor: vi.fn(),
  loadActiveWorkoutProgram: vi.fn(),
  loadWorkoutTemplate: (...args: unknown[]) => loadWorkoutTemplate(...args),
  prepareWorkoutProgram: vi.fn(),
  saveAndActivateWorkoutProgram: vi.fn(),
  withoutUndefined: vi.fn((value: unknown) => value),
}));

import { localWorkoutTemplateDocumentV127 as serverLocalTemplate }
  from '../../../functions/src/workoutLifecycle/templateDocumentV127';
import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import type { PendingEvolution } from '../../workoutLifecycle/types';
import { localWorkoutTemplateDocumentV127 } from '../templateDocumentV127';
import { resolvePendingEvolutionTemplate } from '../pendingEvolutionTemplate';

/** v1.27 ids inside the v2 catalog's range, plus the beginner family outside it. */
const SHARED_RANGE_IDS = ['T002', 'T003', 'T005'] as const;
const BEGINNER_FAMILY_IDS = ['T092', 'T094', 'T102'] as const;

function pendingFor(overrides: Partial<PendingEvolution>): PendingEvolution {
  return {
    targetTemplateId: 'T002',
    targetTemplateVersion: 2,
    targetTemplateSourceVersion: '1.27.0',
    targetTemplateContentHash: 'a'.repeat(64),
    ...overrides,
  } as PendingEvolution;
}

describe('pending template resolution — v1.27 reads the local canonical catalog', () => {
  it.each([...SHARED_RANGE_IDS, ...BEGINNER_FAMILY_IDS])(
    'resolves %s locally and never touches Firestore',
    async (id) => {
      loadWorkoutTemplate.mockClear();
      const resolved = await resolvePendingEvolutionTemplate(
        pendingFor({ targetTemplateId: id, targetTemplateSourceVersion: '1.27.0' }),
      );
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(id);
      expect(resolved!.sourceVersion).toBe('1.27.0');
      expect(loadWorkoutTemplate).not.toHaveBeenCalled();
    },
  );

  /**
   * THE invariant the activation guard depends on: the hash a Pending carries
   * was computed by the AUTHORITY (Cloud Function, `node:crypto`), and the
   * client must recompute exactly the same value from the bundled catalog
   * (`expo-crypto`). If these two ever drift, every v1.27 activation breaks
   * again with `TEMPLATE_CHANGED`.
   */
  it.each([...SHARED_RANGE_IDS, ...BEGINNER_FAMILY_IDS])(
    'computes the same identity the authority sealed for %s',
    async (id) => {
      const client = await localWorkoutTemplateDocumentV127(id as never);
      const server = serverLocalTemplate(id as never);
      expect(client.contentHash).toBe(server.contentHash);
      expect(client.version).toBe(server.version);
      expect(client.sourceVersion).toBe(server.sourceVersion);
    },
  );

  /**
   * Regression guard for the bug this fixes: reading a v1.27 Pending's
   * template out of `workoutTemplates/*` can never satisfy the identity
   * check, because that collection holds the 2.0.0 library. Documents WHY
   * the Firestore branch must not be used for v1.27.
   */
  it.each(SHARED_RANGE_IDS)('disagrees with the Firestore v2 document for %s', async (id) => {
    const local = await localWorkoutTemplateDocumentV127(id as never);
    const seeded = (buildSeedDocuments() as { id: string; contentHash: string; sourceVersion: string }[])
      .find((doc) => doc.id === id);
    expect(seeded, `${id} deveria existir no catalogo v2`).toBeTruthy();
    expect(seeded!.sourceVersion).toBe('2.0.0');
    expect(seeded!.contentHash).not.toBe(local.contentHash);
  });

  it.each(BEGINNER_FAMILY_IDS)('has no Firestore document at all for %s', (id) => {
    const seeded = (buildSeedDocuments() as { id: string }[]).find((doc) => doc.id === id);
    expect(seeded).toBeUndefined();
  });
});

describe('pending template resolution — genuinely incompatible templates stay rejected', () => {
  it('rejects a v1.27 id the local catalog cannot resolve', async () => {
    loadWorkoutTemplate.mockClear();
    const resolved = await resolvePendingEvolutionTemplate(
      pendingFor({ targetTemplateId: 'T999', targetTemplateSourceVersion: '1.27.0' }),
    );
    // Same meaning a missing Firestore document already had: not resolvable.
    expect(resolved).toBeNull();
    expect(loadWorkoutTemplate).not.toHaveBeenCalled();
  });

  it('surfaces a changed catalog body as a different hash', async () => {
    // The guard compares `contentHash`; a Pending carrying any other value
    // than today's catalog hash can never match it.
    const resolved = await resolvePendingEvolutionTemplate(
      pendingFor({ targetTemplateId: 'T002', targetTemplateContentHash: 'b'.repeat(64) }),
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.contentHash).not.toBe('b'.repeat(64));
  });

  it('keeps a v1.27 template version mismatch visible to the guard', async () => {
    const resolved = await resolvePendingEvolutionTemplate(
      pendingFor({ targetTemplateId: 'T002', targetTemplateVersion: 999 }),
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.version).not.toBe(999);
  });
});

describe('pending template resolution — other libraries are untouched', () => {
  it.each(['2.0.0', '1.3.0'])('still reads Firestore for library %s', async (library) => {
    loadWorkoutTemplate.mockClear();
    loadWorkoutTemplate.mockResolvedValue({
      id: 'T002', version: 2, sourceVersion: library, contentHash: 'c'.repeat(64),
    });
    const resolved = await resolvePendingEvolutionTemplate(
      pendingFor({ targetTemplateSourceVersion: library }),
    );
    expect(loadWorkoutTemplate).toHaveBeenCalledWith('T002');
    expect(resolved!.sourceVersion).toBe(library);
  });

  it('still rejects a missing Firestore document', async () => {
    loadWorkoutTemplate.mockClear();
    loadWorkoutTemplate.mockResolvedValue(null);
    const resolved = await resolvePendingEvolutionTemplate(
      pendingFor({ targetTemplateSourceVersion: '2.0.0' }),
    );
    expect(resolved).toBeNull();
  });

  it('falls back to Firestore for a legacy Pending with no library recorded', async () => {
    loadWorkoutTemplate.mockClear();
    loadWorkoutTemplate.mockResolvedValue({
      id: 'T002', version: 2, sourceVersion: '2.0.0', contentHash: 'd'.repeat(64),
    });
    const pending = pendingFor({});
    delete (pending as { targetTemplateSourceVersion?: string }).targetTemplateSourceVersion;
    await resolvePendingEvolutionTemplate(pending);
    expect(loadWorkoutTemplate).toHaveBeenCalledWith('T002');
  });
});
