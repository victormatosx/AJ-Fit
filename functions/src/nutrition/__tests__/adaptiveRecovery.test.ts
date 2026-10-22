import { describe, expect, it, vi } from 'vitest';
import { recoveryEligible, recoveryReviewAllowed, type RecoveryEvent } from '../generation/adaptiveRecovery';
import { runReviewedGeneration, GenerationAttemptsExhausted, stageReservedUsd } from '../generation/attempts';
import { PlanValidationError } from '../generation/domain';
import { approveReview, rejectReview } from './reviewFixture';
import type { NutritionReviewRequest } from '../ai/review';

const eligibleHistory: RecoveryEvent[] = [
  { callNumber: 1, attempt: 1, role: 'creator', code: 'AI_MACRO_VALIDATION_FAILED', reviewStatus: null },
  { callNumber: 2, attempt: 2, role: 'creator', code: null, reviewStatus: null },
  { callNumber: 3, attempt: 2, role: 'reviewer', code: 'AI_REVIEW_REJECTED', reviewStatus: 'rejected' },
];
const result = { output: {}, model: 'mock', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } };
const context = { profile: {}, targets: {}, goal: 'health', foodNames: { preferred: [], usual: [], excluded: [] } } as unknown as Omit<NutritionReviewRequest, 'candidate' | 'candidateDigest' | 'evidence' | 'timeoutMs'>;
const run = (options = {}, validate = vi.fn().mockResolvedValue({ validated: {}, candidate: {}, evidence: [] }), review = vi.fn(approveReview)) => {
  const create = vi.fn().mockResolvedValue(result);
  return { create, review, promise: runReviewedGeneration({ generatePlan: create, reviewPlan: review }, create,
    validate, context, async () => {}, async () => {}, options) };
};
describe('strict adaptive credit admission', () => {
  it('accepts only the exact three-event prefix', () => {
    expect(recoveryEligible(eligibleHistory)).toBe(true);
    expect(recoveryReviewAllowed([...eligibleHistory, { callNumber: 4, attempt: 3, role: 'creator', code: null, reviewStatus: null }])).toBe(true);
  });
  it.each(['AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_RATE_LIMIT', 'AI_PROVIDER_REFUSAL', 'AI_SAFETY_VALIDATION_FAILED'])(
    'does not grant credit for infrastructure or permanent failure %s', code => {
      expect(recoveryEligible([{ ...eligibleHistory[0], code }, ...eligibleHistory.slice(1)])).toBe(false);
    });
  it.each([0, 1, 2])('rejects a missing, reordered or duplicated history event %i', index => {
    expect(recoveryEligible(eligibleHistory.filter((_, i) => i !== index))).toBe(false);
    const copy = structuredClone(eligibleHistory); copy[index].callNumber = 99;
    expect(recoveryEligible(copy)).toBe(false);
  });
  it('admits insufficient information only with its matching structured failure code', () => {
    const copy = structuredClone(eligibleHistory);
    copy[2] = { ...copy[2], code: 'AI_REVIEW_INSUFFICIENT_INFORMATION', reviewStatus: 'insufficient_information' };
    expect(recoveryEligible(copy)).toBe(true);
    copy[2].code = 'AI_REVIEW_SCHEMA_INVALID'; expect(recoveryEligible(copy)).toBe(false);
  });
  it('resumes an eligible checkpoint with the saved feedback and exact reservation', async () => {
    const f = run({ initialCallCount: 3, startAttempt: 3, initialReservedUsd: .02155,
      initialRecoveryHistory: eligibleHistory, initialFeedback: 'saved reviewer correction' });
    expect((await f.promise).review.calls).toBe(5);
    expect(f.create.mock.calls[0][1]).toBe('saved reviewer correction');
  });
  it('does not spend the final creator call for an inconsistent resumed attempt number', async () => {
    const f = run({ initialCallCount: 3, startAttempt: 1, initialRecoveryHistory: eligibleHistory });
    await expect(f.promise).rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(f.create).not.toHaveBeenCalled();
  });
  it('does not grant credit twice on resumption', async () => {
    const f = run({ initialCallCount: 3, startAttempt: 3, initialRecoveryHistory: eligibleHistory, initialRecoveryCreditUsed: true });
    await expect(f.promise).rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(f.create).not.toHaveBeenCalled();
  });
  it('does not create when the remaining dollars cannot cover both roles', async () => {
    const f = run({ initialCallCount: 2, initialReservedUsd: .04 - stageReservedUsd('creator') });
    await expect(f.promise).rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(f.create).not.toHaveBeenCalled();
  });
  it('never auto-approves a rejection on the fifth call', async () => {
    const f = run({ initialCallCount: 3, startAttempt: 3, initialRecoveryHistory: eligibleHistory }, undefined,
      vi.fn(rejectReview as typeof approveReview));
    await expect(f.promise).rejects.toMatchObject({ lastFailureCode: 'AI_REVIEW_INSUFFICIENT_INFORMATION' });
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.review).toHaveBeenCalledTimes(1);
  });
  it('does not spend the fifth call if the final creator fails deterministic validation', async () => {
    const validate = vi.fn().mockRejectedValue(new PlanValidationError('AI_MACRO_VALIDATION_FAILED', true, 'test'));
    const f = run({ initialCallCount: 3, startAttempt: 3, initialRecoveryHistory: eligibleHistory }, validate);
    await expect(f.promise).rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.review).not.toHaveBeenCalled();
  });
  it('stops before another paid call when checkpoint persistence fails', async () => {
    const infrastructure = Object.assign(new Error('Firestore unavailable'), { code: 14 });
    const f = run({ onProgress: async () => { throw infrastructure; } });
    await expect(f.promise).rejects.toBe(infrastructure);
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.review).not.toHaveBeenCalled();
  });
  it('does not retry a failed fifth review or recreate its candidate', async () => {
    const f = run({ initialCallCount: 3, startAttempt: 3, initialRecoveryHistory: eligibleHistory }, undefined,
      vi.fn().mockRejectedValue(new Error('network')));
    await expect(f.promise).rejects.toMatchObject({ lastFailureCode: 'AI_REVIEW_UNAVAILABLE' });
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.review).toHaveBeenCalledTimes(1);
  });
});
