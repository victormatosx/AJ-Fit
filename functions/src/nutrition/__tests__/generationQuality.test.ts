import { describe, expect, it, vi } from 'vitest';
// Exercise the published policy without modifying the preserved adaptive runtime.
vi.mock('../ai/config', async importOriginal => ({
  ...await importOriginal<typeof import('../ai/config')>(), MAX_AI_CALLS: 4, MAX_JOB_RESERVED_USD: .03,
}));
import { generateValidatedPlan, type AttemptAudit } from '../generation/attempts';
import { generateValidatedMealAlternative } from '../generation/alternative';
import { inspectFoodEvidence } from '../generation/reviewEvidence';
import { candidateDigest } from '../ai/review';
import type { NutritionProfile } from '../shared/types/nutrition';
import { macroEngine, macroPlan, macroProfile, macroFood } from './fixtures/macroCorrection';
import { approveReview, rejectReview } from './reviewFixture';

const names = { preferred: [], usual: [], excluded: [] };
const profile = { ...macroProfile, excludedSubstances: ['gluten'] } as NutritionProfile;
const response = (output: unknown) => ({ output, model: 'mock', latencyMs: 1,
  usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 } });
const unverified = () => {
  const plan = macroPlan();
  plan.meals[1].foods[0].name = 'Aveia em flocos sem glúten';
  plan.meals[1].foods[0].ingredients = [{ name: 'aveia', origin: 'plant' }];
  return plan;
};
const run = (provider: Parameters<typeof generateValidatedPlan>[0], options = {}, audit?: (a: AttemptAudit) => Promise<void>) =>
  generateValidatedPlan(provider, profile, macroEngine, 'health', names, audit, undefined, options);

describe('quality repair under the four-call published policy (mocked AI only)', () => {
  it('locates the failed food, retains the exact candidate, then independently reviews the repaired candidate in three calls', async () => {
    const bad = unverified(); const good = macroPlan(); const audits: AttemptAudit[] = [];
    const provider = { generatePlan: vi.fn().mockResolvedValueOnce(response(bad)).mockResolvedValueOnce(response(good)),
      reviewPlan: vi.fn(approveReview) };
    const saved = await run(provider, {}, async a => { audits.push(a); });
    const feedback = JSON.parse(provider.generatePlan.mock.calls[1][0].feedback);
    expect(feedback).toMatchObject({ failureCode: 'AI_EVIDENCE_INSUFFICIENT',
      foodFailure: { scope: 'flattened_food', itemIndex: 1, reason: 'unverified_product_composition' }, previousPlan: bad });
    expect(provider.reviewPlan).toHaveBeenCalledTimes(1);
    expect(provider.reviewPlan.mock.calls[0][0].candidate).toEqual(good);
    expect(saved.review.candidateDigest).toBe(candidateDigest(provider.reviewPlan.mock.calls[0][0].candidate));
    expect(saved.review.calls).toBe(3);
    expect(audits.map(a => [a.role, a.callNumber, a.code])).toEqual([
      ['creator', 1, 'AI_EVIDENCE_INSUFFICIENT'], ['creator', 2, null], ['reviewer', 3, null],
    ]);
    // Private food failure details never become operation audit fields.
    expect(audits.every(a => !('foodFailure' in a))).toBe(true);
  });
  it('checkpoints and restores the diagnostic without replaying a paid creator call', async () => {
    let history: unknown; let feedback: string | undefined;
    const first = { generatePlan: vi.fn().mockResolvedValue(response(unverified())), reviewPlan: vi.fn(approveReview) };
    await expect(run(first, { onProgress: async (h: unknown, f: string | undefined) => {
      history = h; feedback = f; throw new Error('CHECKPOINT_STOP_TEST');
    } })).rejects.toThrow('CHECKPOINT_STOP_TEST');
    const resumed = { generatePlan: vi.fn().mockResolvedValue(response(macroPlan())), reviewPlan: vi.fn(approveReview) };
    const saved = await run(resumed, { startAttempt: 2, initialCallCount: 1, initialReservedUsd: .0072,
      initialRecoveryHistory: history, initialFeedback: feedback });
    expect(resumed.generatePlan.mock.calls[0][0].feedback).toBe(feedback);
    expect(JSON.parse(feedback!).foodFailure.itemIndex).toBe(1);
    expect(resumed.generatePlan).toHaveBeenCalledTimes(1);
    expect(saved.review.calls).toBe(3);
  });
  it('does not depend on a fifth call when a real review decision would reject the repaired candidate', async () => {
    const provider = { generatePlan: vi.fn().mockResolvedValueOnce(response(unverified())).mockResolvedValue(response(macroPlan())),
      reviewPlan: vi.fn(rejectReview) };
    await expect(run(provider)).rejects.toMatchObject({ lastFailureCode: 'AI_REVIEW_INSUFFICIENT_INFORMATION' });
    expect(provider.generatePlan).toHaveBeenCalledTimes(2);
    expect(provider.reviewPlan).toHaveBeenCalledTimes(1);
  });
  it('maps alternative failures across option order, with independently reviewed corrected options', async () => {
    const good = { recommendedOptionIndex: 0, options: [{ foods: [macroFood()] }, { foods: [macroFood()] }] };
    const bad = structuredClone(good); bad.options[1].foods[0] = unverified().meals[1].foods[0];
    const provider = { generatePlan: vi.fn(), generateMealAlternative: vi.fn().mockResolvedValueOnce(response(bad)).mockResolvedValueOnce(response(good)),
      reviewPlan: vi.fn(approveReview) };
    const saved = await generateValidatedMealAlternative(provider, profile, 'breakfast', macroEngine.mealTargets[0], [], 'health', names, undefined);
    expect(JSON.parse(provider.generateMealAlternative.mock.calls[1][0].feedback)).toMatchObject({
      foodFailure: { scope: 'flattened_food', itemIndex: 1, reason: 'unverified_product_composition' }, previousPlan: bad,
    });
    expect(saved.review.calls).toBe(3);
    expect(provider.reviewPlan.mock.calls[0][0].candidate).toEqual(good);
  });
  it.each([
    ['milk allergy', { excludedAllergens: ['milk'] }, 'Leite', 'dairy', 'restriction_violation'],
    ['vegan', { dietaryPattern: 'vegan' }, 'Ovo', 'egg', 'restriction_violation'],
    ['vegetarian', { dietaryPattern: 'vegetarian' }, 'Carne', 'plant', 'restriction_violation'],
    ['multiple restrictions', { dietaryPattern: 'vegan', excludedSubstances: ['gluten'], excludedAllergens: ['soy'] }, 'Soja', 'plant', 'restriction_violation'],
    ['unselected supplement', {}, 'Proteina vegetal', 'plant', 'supplement_not_selected'],
    ['gluten ingredient', { excludedSubstances: ['gluten'] }, 'Trigo', 'plant', 'incompatible_substance'],
  ])('keeps %s blocked and gives a localized diagnostic', async (_label, patch, name, origin, reason) => {
    const item = { ...macroFood(), name, ingredients: [{ name, origin }] } as ReturnType<typeof macroFood>;
    await expect(inspectFoodEvidence([macroFood(), item], { ...macroProfile, ...patch } as NutritionProfile, names))
      .rejects.toMatchObject({ code: 'AI_CONTENT_SAFETY_MISMATCH', retryable: true,
        foodFailure: { scope: 'flattened_food', itemIndex: 1, reason } });
  });
  it('keeps a relabelled oats product blocked even after removing its unsupported absence claim', async () => {
    const item = unverified().meals[1].foods[0]; item.name = 'Aveia';
    await expect(inspectFoodEvidence([item], profile, names)).rejects.toMatchObject({ code: 'AI_EVIDENCE_INSUFFICIENT' });
  });
  it('does not interpret an explicit broth absence in a preparation note as a commercial product', async () => {
    const item = { ...macroFood(), name: 'Feijão carioca cozido', preparationNote: 'Cozido em água, sem caldo industrializado.',
      ingredients: [{ name: 'Feijão carioca', origin: 'plant' as const }, { name: 'Água', origin: 'mineral' as const }] };
    await expect(inspectFoodEvidence([item], profile, names)).resolves.toEqual([]);
  });
  it.each([
    ['with actual broth', 'Cozido com caldo industrializado.', 'Feijão'],
    ['contradictory ingredients', 'Cozido sem caldo industrializado.', 'Caldo industrializado'],
    ['separate commercial claim', 'Sem caldo industrializado; produto certificado.', 'Feijão'],
    ['unsupported absence label', 'Sem caldo industrializado; sem glúten no rótulo.', 'Feijão'],
    ['hidden supplement', 'Sem caldo industrializado; misturado com whey.', 'Feijão'],
  ])('still requires evidence for %s', async (_label, note, ingredient) => {
    const item = { ...macroFood(), name: 'Feijão cozido', preparationNote: note,
      ingredients: [{ name: ingredient, origin: 'plant' as const }] };
    await expect(inspectFoodEvidence([item], { ...profile, supplements: ['whey_or_protein'] }, names))
      .rejects.toMatchObject({ code: 'AI_EVIDENCE_INSUFFICIENT' });
  });
});
