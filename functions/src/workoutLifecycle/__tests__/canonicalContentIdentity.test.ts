/**
 * Golden vectors for the root-cause fix (docs/workout-lifecycle/v2/qa/):
 * `canonicalContentIdentity` now serializes via the file's existing
 * `canonical()` helper (sorted keys) instead of raw `JSON.stringify`,
 * mirroring the client's `contentIdentityPreimage`
 * (`src/services/workoutPrograms.ts`) exactly. These pin the two REAL
 * `plan.versions` key orders observed on a physical device (`wpe_e3c68302`)
 * — Node/Admin SDK's insertion order vs. the exact permutation reverse-
 * engineered from the iPhone's reported `versionsFingerprint = c46fcd04` —
 * proving client and backend now agree regardless of which order either
 * side's Firestore SDK happens to hand back.
 */
import { describe, expect, it } from 'vitest';
import { canonicalContentIdentity } from '../authorizeMutation';
import type { FinalWorkoutPlan } from '../prescriptionEngine/workoutPrescription/types';

const TEMPLATE_METADATA = { version: 2, contentHash: 'e3aa4b3cba2df92ff4a89ebe2bd90aa8c43bf763957167ec7a72a6145eaa731d' };

const BASE_PLAN = {
  planId: 'wp_a874860f',
  templateId: 'T003',
  limitationDatasetVersion: 'phase3-limitation-dataset-v3',
  limitationDatasetHash: '21ce79bcb57802df8a6072e933942b02ea34ba1d9ab85f0dc091395bff0f3944',
} as Partial<FinalWorkoutPlan>;

const NODE_ORDER_VERSIONS = {
  templateLibrary: '2.0.0', selectionEngine: '2.0.0', safetyRules: '1.0.0',
  modifierRules: '2.0.0', compositionEngine: '2.1.0', limitationResolver: '1.0.0',
};
const IPHONE_ORDER_VERSIONS = {
  limitationResolver: '1.0.0', compositionEngine: '2.1.0', selectionEngine: '2.0.0',
  templateLibrary: '2.0.0', modifierRules: '2.0.0', safetyRules: '1.0.0',
};

function identityWith(versions: Record<string, string>, extra: Record<string, unknown> = {}) {
  return canonicalContentIdentity({
    questionnaireId: 'vaxH2pExNxH9JwTsDhuh',
    questionnaireVersion: 1,
    plan: { ...BASE_PLAN, versions, ...extra } as unknown as FinalWorkoutPlan,
    templateMetadata: TEMPLATE_METADATA,
  });
}

describe('canonicalContentIdentity golden vectors — backend/client parity', () => {
  it('Node insertion order and the exact iPhone-observed permutation produce the IDENTICAL identity, and match the client-side pinned value exactly', () => {
    const nodeOrderId = identityWith(NODE_ORDER_VERSIONS);
    const iphoneOrderId = identityWith(IPHONE_ORDER_VERSIONS);
    expect(nodeOrderId).toBe(iphoneOrderId);
    // Pinned to the SAME value asserted client-side
    // (src/services/__tests__/contentIdentityCanonicalization.test.ts) —
    // proves client and backend are not just internally order-independent,
    // but mutually consistent with each other for identical logical input.
    expect(nodeOrderId).toBe('wpg_21e1db98');
  });

  it('reversed key order produces the same identity too', () => {
    const reversed = Object.fromEntries([...Object.entries(NODE_ORDER_VERSIONS)].reverse());
    expect(identityWith(reversed)).toBe(identityWith(NODE_ORDER_VERSIONS));
  });

  it('a genuine value change in versions still changes the identity', () => {
    const tampered = { ...NODE_ORDER_VERSIONS, safetyRules: '9.9.9' };
    expect(identityWith(tampered)).not.toBe(identityWith(NODE_ORDER_VERSIONS));
  });

  it('adaptationStage undefined vs. absent normalize identically; null differs from a real value', () => {
    const withUndefined = identityWith(NODE_ORDER_VERSIONS, { adaptationStage: undefined });
    const plan = { ...BASE_PLAN, versions: NODE_ORDER_VERSIONS } as Record<string, unknown>;
    delete plan.adaptationStage;
    const withoutKey = canonicalContentIdentity({
      questionnaireId: 'vaxH2pExNxH9JwTsDhuh', questionnaireVersion: 1,
      plan: plan as unknown as FinalWorkoutPlan, templateMetadata: TEMPLATE_METADATA,
    });
    expect(withUndefined).toBe(withoutKey);
    expect(identityWith(NODE_ORDER_VERSIONS, { adaptationStage: null })).toBe(withUndefined);
    expect(identityWith(NODE_ORDER_VERSIONS, { adaptationStage: 1 })).not.toBe(withUndefined);
  });
});
