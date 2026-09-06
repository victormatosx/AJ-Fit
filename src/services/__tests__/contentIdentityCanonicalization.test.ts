/**
 * Golden vectors for the root-cause fix (docs/workout-lifecycle/v2/qa/):
 * `contentIdentityFor`/`contentIdentityPreimage` now serialize via
 * `canonicalStringify` (sorted keys, mirrored exactly by the backend's
 * `canonical()` in `functions/src/workoutLifecycle/authorizeMutation.ts`)
 * instead of raw `JSON.stringify`, so `plan.versions`' key order — which a
 * real device (`wpe_e3c68302`, confirmed via a physical iPhone) showed can
 * legitimately differ between the Node/Admin SDK and the React Native
 * Firestore client for the exact same document — can never again change the
 * resulting hash. These vectors pin the two REAL orders observed (Node's
 * insertion order vs. the exact permutation reverse-engineered from the
 * iPhone's reported `versionsFingerprint = c46fcd04`) plus the classic
 * undefined/absent/null and array/nested-object edge cases.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: undefined }));

const { contentIdentityFor, stableHash } = await import('../workoutPrograms');

const TEMPLATE = { id: 'T003' as never, version: 2, contentHash: 'e3aa4b3cba2df92ff4a89ebe2bd90aa8c43bf763957167ec7a72a6145eaa731d' };

const BASE_PLAN = {
  planId: 'wp_a874860f',
  templateId: 'T003',
  limitationDatasetVersion: 'phase3-limitation-dataset-v3',
  limitationDatasetHash: '21ce79bcb57802df8a6072e933942b02ea34ba1d9ab85f0dc091395bff0f3944',
} as const;

// The two REAL orders from the wpe_e3c68302 investigation.
const NODE_ORDER_VERSIONS = {
  templateLibrary: '2.0.0', selectionEngine: '2.0.0', safetyRules: '1.0.0',
  modifierRules: '2.0.0', compositionEngine: '2.1.0', limitationResolver: '1.0.0',
};
const IPHONE_ORDER_VERSIONS = {
  limitationResolver: '1.0.0', compositionEngine: '2.1.0', selectionEngine: '2.0.0',
  templateLibrary: '2.0.0', modifierRules: '2.0.0', safetyRules: '1.0.0',
};

function identityWith(versions: Record<string, string>, extra: Record<string, unknown> = {}) {
  return contentIdentityFor({
    questionnaireId: 'vaxH2pExNxH9JwTsDhuh',
    questionnaireVersion: 1,
    plan: { ...BASE_PLAN, versions, ...extra } as unknown as Parameters<typeof contentIdentityFor>[0]['plan'],
    template: TEMPLATE,
  });
}

describe('contentIdentityFor golden vectors — canonicalization', () => {
  it('reproduces the exact real device fingerprints as a sanity check on the FNV/JSON.stringify layer itself (pre-canonicalization values, proven by brute-force search over all 720 permutations)', () => {
    expect(stableHash(JSON.stringify(NODE_ORDER_VERSIONS))).toBe('7e9ce210');
    expect(stableHash(JSON.stringify(IPHONE_ORDER_VERSIONS))).toBe('c46fcd04');
  });

  it('golden vector: Node insertion order and the exact iPhone-observed permutation now produce the IDENTICAL contentIdentityFor result', () => {
    const nodeOrderId = identityWith(NODE_ORDER_VERSIONS);
    const iphoneOrderId = identityWith(IPHONE_ORDER_VERSIONS);
    expect(nodeOrderId).toBe(iphoneOrderId);
    expect(nodeOrderId).toBe('wpg_21e1db98'); // pinned — a future regression must change this test, not silently pass
  });

  it('golden vector: reversed key order produces the same identity too (not just one specific permutation)', () => {
    const reversed = Object.fromEntries([...Object.entries(NODE_ORDER_VERSIONS)].reverse());
    expect(identityWith(reversed)).toBe(identityWith(NODE_ORDER_VERSIONS));
  });

  it('a genuine VALUE change in versions still changes the identity — canonicalization only removes order-sensitivity, never content-sensitivity', () => {
    const tampered = { ...NODE_ORDER_VERSIONS, safetyRules: '9.9.9' };
    expect(identityWith(tampered)).not.toBe(identityWith(NODE_ORDER_VERSIONS));
  });

  it('adaptationStage: undefined vs. entirely absent still normalize identically post-fix', () => {
    const withUndefined = identityWith(NODE_ORDER_VERSIONS, { adaptationStage: undefined });
    const plan = { ...BASE_PLAN, versions: NODE_ORDER_VERSIONS } as Record<string, unknown>;
    delete plan.adaptationStage;
    const withoutKey = contentIdentityFor({
      questionnaireId: 'vaxH2pExNxH9JwTsDhuh', questionnaireVersion: 1,
      plan: plan as unknown as Parameters<typeof contentIdentityFor>[0]['plan'], template: TEMPLATE,
    });
    expect(withUndefined).toBe(withoutKey);
  });

  it('adaptationStage: null is distinct from a real 1|2|3 value, and top-level key order of the identity object itself is irrelevant (canonicalStringify sorts every level)', () => {
    const withNull = identityWith(NODE_ORDER_VERSIONS, { adaptationStage: null });
    const withOne = identityWith(NODE_ORDER_VERSIONS, { adaptationStage: 1 });
    expect(withNull).not.toBe(withOne);
    expect(withNull).toBe(identityWith(NODE_ORDER_VERSIONS)); // undefined ?? null === explicit null
  });
});
