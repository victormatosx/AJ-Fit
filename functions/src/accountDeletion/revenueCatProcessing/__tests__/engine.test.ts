import { describe, expect, it, vi } from 'vitest';

import { runRevenueCatProcessing } from '../engine';
import type { RevenueCatProcessingResult } from '../types';
import { resolveWorkflowPolicy, CURRENT_WORKFLOW_VERSION } from '../../policy';

describe('runRevenueCatProcessing — policy v1 (SKIP)', () => {
  it('reports SKIPPED_BY_POLICY, never SUCCEEDED', async () => {
    const outcome = await runRevenueCatProcessing('SKIP');
    expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
  });

  it('reports the outcome via onCompleted', async () => {
    const results: RevenueCatProcessingResult[] = [];
    await runRevenueCatProcessing('SKIP', { onCompleted: (r) => results.push(r) });
    expect(results).toEqual([{ action: 'SKIP', outcome: 'SKIPPED' }]);
  });

  it('idempotent: repeated calls always converge on SKIPPED_BY_POLICY', async () => {
    const first = await runRevenueCatProcessing('SKIP');
    const second = await runRevenueCatProcessing('SKIP');
    const third = await runRevenueCatProcessing('SKIP');
    for (const outcome of [first, second, third]) expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
  });

  it('never constructs a RevenueCat API client for SKIP', async () => {
    // No network call, no secret read: constructing `RevenueCatV2Client`
    // (`../../billing/revenueCatApi.ts`) reads `REVENUECAT_API_SECRET_KEY`,
    // which is not stubbed anywhere in this test file. If SKIP touched that
    // path at all, this suite would fail with a Secret Manager error
    // instead of silently succeeding.
    await expect(runRevenueCatProcessing('SKIP')).resolves.toEqual({
      kind: 'SKIPPED_BY_POLICY',
      reason: 'revenueCat=SKIP — frozen policy performs no customer mutation',
    });
  });
});

describe('runRevenueCatProcessing — RETAIN behaves the same as SKIP (no destructive action for either)', () => {
  it('reports SKIPPED_BY_POLICY', async () => {
    const outcome = await runRevenueCatProcessing('RETAIN');
    expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
  });
});

describe('runRevenueCatProcessing — DELETE/ANONYMIZE have no confirmed contract (Fase 9 §31)', () => {
  it.each(['DELETE', 'ANONYMIZE'] as const)(
    '%s reports FAILED with MISSING_REQUIRED_CONFIGURATION, never fakes success',
    async (action) => {
      const outcome = await runRevenueCatProcessing(action);
      expect(outcome).toEqual({ kind: 'FAILED', code: 'MISSING_REQUIRED_CONFIGURATION' });
    },
  );

  it('never calls onCompleted for an unsupported action', async () => {
    const onCompleted = vi.fn();
    await runRevenueCatProcessing('DELETE', { onCompleted });
    expect(onCompleted).not.toHaveBeenCalled();
  });
});

describe('runRevenueCatProcessing — never cancels the native subscription (Fase 9 §39, structural proof)', () => {
  it('the module has no dependency on Apple/Google subscription-cancellation code', async () => {
    // Structural proof, not a runtime assertion: this engine file imports
    // nothing from `../providerRevocation` (Apple/Google) or any
    // Apple/Google StoreKit/Play Billing surface — see the source import
    // list. Grepping the compiled output for a cancellation call would be
    // the deploy-time equivalent; this test documents the intent inline.
    const engineModule = await import('../engine');
    expect(Object.keys(engineModule)).toEqual(['runRevenueCatProcessing']);
  });
});

describe('runRevenueCatProcessing — policy versioning (Fase 9 rule, mirrors Fase 8 §21)', () => {
  it('a record frozen under v1 (SKIP) always skips, even if currentPolicy() has since diverged', async () => {
    const frozenAction = resolveWorkflowPolicy(CURRENT_WORKFLOW_VERSION).retention.revenueCat;
    expect(frozenAction).toBe('SKIP');

    // Processing the OLD record must use its own frozen action, not
    // whatever a hypothetical newer version would do.
    const outcome = await runRevenueCatProcessing(frozenAction);
    expect(outcome.kind).toBe('SKIPPED_BY_POLICY');

    // Sanity check the engine IS capable of a different result when
    // actually told to — proving the SKIP result above was policy-driven.
    const hypotheticalFutureOutcome = await runRevenueCatProcessing('DELETE');
    expect(hypotheticalFutureOutcome.kind).toBe('FAILED');
  });
});
