/**
 * Fase 8 §8 — audits `contentIdentityFor` (the `workoutPrograms/{contentIdentity}`
 * Firestore id, real/exported production code, not reimplemented here) and
 * proves it cannot collide between a v2.0.0 and a hypothetical v1.27.0
 * program for the same templateId/questionnaire, because BOTH
 * `plan.versions` (the full `PRESCRIPTION_VERSIONS`-shaped object,
 * `templateLibrary` included) and `template.contentHash` (the actual
 * document content hash — a v1.27 template body is structurally different
 * from its v2.0 namesake, so its content hash always differs too)
 * participate in the hashed preimage (`contentIdentityPreimage`).
 */
import { describe,expect,it,vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: undefined }));

const { contentIdentityFor } = await import('../workoutPrograms');

const V2_VERSIONS = {
  templateLibrary: '2.0.0', selectionEngine: '2.0.0', safetyRules: '1.0.0',
  modifierRules: '2.0.0', compositionEngine: '2.1.0', limitationResolver: '1.0.0',
};

const V127_VERSIONS = {
  templateLibrary: '1.27.0', selectionEngine: '3.0.0', safetyRules: '1.0.0',
  modifierRules: '3.0.0', compositionEngine: '3.0.0', limitationResolver: '2.0.0',
};

function identityFor(versions: Record<string, string>, templateContentHash: string) {
  return contentIdentityFor({
    questionnaireId: 'q1',
    questionnaireVersion: 1,
    plan: {
      planId: 'wp_same',
      templateId: 'T091',
      versions,
    } as unknown as Parameters<typeof contentIdentityFor>[0]['plan'],
    template: { id: 'T091' as never, version: 1, contentHash: templateContentHash },
  });
}

describe('contentIdentityFor — v2 vs v1.27 non-collision (Fase 8 §8)', () => {
  it('the SAME templateId/questionnaire never collides across library versions, even with an identical (contrived) template content hash', () => {
    const sameContentHash = 'a'.repeat(64);
    const v2Identity = identityFor(V2_VERSIONS, sameContentHash);
    const v127Identity = identityFor(V127_VERSIONS, sameContentHash);
    // versions.templateLibrary alone (embedded by value in the hashed
    // preimage) is sufficient to guarantee non-collision.
    expect(v2Identity).not.toBe(v127Identity);
  });

  it('realistic case: v1.27 template bodies are structurally different, so their real contentHash also differs — a second, independent reason these can never collide', () => {
    const v2ContentHash = 'a'.repeat(64);
    const v127ContentHash = 'b'.repeat(64); // a real v1.27 T091 document hashes differently from the v2 T091 body — different schema/session shape.
    const v2Identity = identityFor(V2_VERSIONS, v2ContentHash);
    const v127Identity = identityFor(V127_VERSIONS, v127ContentHash);
    expect(v2Identity).not.toBe(v127Identity);
  });

  it('is still fully deterministic/idempotent within one library version (same inputs -> same id, unaffected by this audit)', () => {
    const first = identityFor(V2_VERSIONS, 'a'.repeat(64));
    const second = identityFor(V2_VERSIONS, 'a'.repeat(64));
    expect(first).toBe(second);
    const firstV127 = identityFor(V127_VERSIONS, 'b'.repeat(64));
    const secondV127 = identityFor(V127_VERSIONS, 'b'.repeat(64));
    expect(firstV127).toBe(secondV127);
  });

  it('historical ids are never affected: a plain v2.0.0 identity computation returns exactly the same value as the existing golden-vector test expects', () => {
    // Cross-check against the pinned golden vector in
    // contentIdentityCanonicalization.test.ts (same shape, same inputs).
    const identity = contentIdentityFor({
      questionnaireId: 'vaxH2pExNxH9JwTsDhuh',
      questionnaireVersion: 1,
      plan: {
        planId: 'wp_a874860f',
        templateId: 'T003',
        versions: V2_VERSIONS,
      } as unknown as Parameters<typeof contentIdentityFor>[0]['plan'],
      template: { id: 'T003' as never, version: 2, contentHash: 'e3aa4b3cba2df92ff4a89ebe2bd90aa8c43bf763957167ec7a72a6145eaa731d' },
    });
    expect(identity).toBe('wpg_bc19d587');
  });
});
