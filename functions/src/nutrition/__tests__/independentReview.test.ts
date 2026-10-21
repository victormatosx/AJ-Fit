import { describe, expect, it, vi } from 'vitest';
import { generateValidatedPlan, GenerationAttemptsExhausted, stageReservedUsd } from '../generation/attempts';
import { generateValidatedMealAlternative } from '../generation/alternative';
import { NutritionAiProviderError, OpenAiNutritionProvider, type AiResult, type NutritionAiProvider } from '../ai/provider';
import { candidateDigest, parseNutritionReview, REVIEW_CHECKS, type NutritionReviewRequest } from '../ai/review';
import { AI_STAGE_LIMITS, MAX_AI_CALLS, MAX_JOB_RESERVED_USD } from '../ai/config';
import { normalizeFoodLogRecord } from '../shared/nutrition/foodLog/normalize';
import { catalogNutritionRevision } from '../shared/nutrition/catalog/binding';
import { CatalogSearchSession, type CatalogCandidate } from '../catalogLinking/search';
import type { NutritionEngineOutput, NutritionProfile } from '../shared/types/nutrition';
import { approveReview } from './reviewFixture';
import { buildAiOperationMetrics, buildAiMetricsByRole, type AiOperationFact } from '../observability/metrics';

// Synthetic macros test contracts and flow, never certify real food composition.
const n = { kcal: 400, proteinG: 20, carbsG: 50, fatG: 13, fiberG: 6 };
const range = (target: number) => ({ target, min: target * .95, max: target * 1.05 });
const mealTarget = { slot: 'lunch' as const, kcal: range(n.kcal), proteinG: range(n.proteinG),
  carbsG: range(n.carbsG), fatG: range(n.fatG), fiberG: range(n.fiberG) };
const profile = { mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'vegetarian', excludedAllergens: [],
  excludedSubstances: [], excludedFoodIds: [], preferredFoodIds: [], usualFoodIds: [],
  supplements: ['whey_or_protein'], varietyPreference: 'indifferent' } as unknown as NutritionProfile;
const engine = { mealTargets: profile.mealSlots.map(slot => ({ ...mealTarget, slot })), energy: { targetKcal: 800 },
  macros: { proteinG: 40, carbsG: 100, fatG: 26, fiberG: 12 } } as NutritionEngineOutput;
const names = { preferred: ['Mandioca cozida'], usual: [], excluded: [] };
const food = (name = 'Mandioca cozida', origin = 'plant') => ({ name, quantity: 100, unit: 'g', preparationNote: '',
  ingredients: [{ name, origin }], allergens: [] as string[], estimatedNutrition: { ...n } });
const plan = (item = food()) => ({ meals: profile.mealSlots.map(slot => ({ slot, foods: [item] })) });
const result = (output: unknown): AiResult => ({ output, model: 'mock', latencyMs: 1,
  usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 } });
function provider(output: unknown = plan()) {
  return { generatePlan: vi.fn().mockResolvedValue(result(output)), reviewPlan: vi.fn(approveReview) };
}
function reject(request: NutritionReviewRequest, status = 'rejected') {
  return result({ candidateDigest: request.candidateDigest, status,
    checks: Object.fromEntries(REVIEW_CHECKS.map(k => [k, true])), requiresRegeneration: true,
    issues: [{ category: 'preferences', severity: 'medium', mealIndex: 0, optionIndex: 0, foodIndex: 0,
      reason: 'Preferência não atendida quando compatível.', suggestedCorrection: 'Incluir mandioca.' }] });
}
const run = (p: NutritionAiProvider, patch: Partial<NutritionProfile> = {}, options = {}) => generateValidatedPlan(
  p, { ...profile, ...patch }, engine, 'health', names, undefined, undefined, options);
function catalog(name: string, absent: string[], patterns = ['vegetarian']): CatalogSearchSession {
  const f = normalizeFoodLogRecord({ source: { type: 'off', sourceId: '12345678', sourceName: 'Synthetic fixture' },
    name, brand: { name: 'Marca' }, category: 'other', status: 'active', nutritionPer100g: { ...n },
    provenance: { license: 'odbl_share_alike', attributionRequired: true, attributionText: 'Synthetic' } }, 'review-fixture');
  f.safetyEvidence = { schemaVersion: 1, nutritionRevision: catalogNutritionRevision(f), reference: 'Synthetic reviewed label',
    absentSubstances: absent as never[], dietaryPatterns: patterns as never[], compositionReviewed: true };
  const c: CatalogCandidate = { collection: 'foodLogCatalog', food: { ...f, createdAt: null, updatedAt: null } };
  return new CatalogSearchSession({ page: async collection => ({ candidates: collection === c.collection ? [c] : [], nextCursor: null }),
    get: async () => c }, Date.now() + 10_000, 100, 20);
}

describe('creator + independently contracted reviewer', () => {
  it('approves vegetarian ordinary food absent from any catalog, carrying desired food names', async () => {
    const p = provider(); const saved = await run(p);
    expect(saved.review.calls).toBe(2);
    expect(saved.validated.meals[0].options[0].foods[0].name).toBe('Mandioca cozida');
    expect(p.reviewPlan.mock.calls[0][0].foodNames.preferred).toEqual(names.preferred);
    expect(p.reviewPlan.mock.calls[0][0].candidate).toEqual(plan());
  });
  it('blocks meat misdeclared as plant before even consulting a permissive reviewer', async () => {
    const p = provider(plan(food('Carne bovina', 'plant')));
    await expect(run(p)).rejects.toMatchObject({ code: 'AI_RETRY_EXHAUSTED', lastFailureCode: 'AI_CONTENT_SAFETY_MISMATCH' });
    expect(p.reviewPlan).not.toHaveBeenCalled();
  });
  it('generates a lactose-excluded plan without catalog evidence for ordinary foods', async () => {
    await expect(run(provider(), { excludedSubstances: ['lactose'] })).resolves.toMatchObject({ review: { calls: 2 } });
  });
  it('permits zero-lactose whey only with exact product evidence from the backend', async () => {
    const p = provider(plan(food('Whey sem lactose Marca', 'dairy')));
    const saved = await run(p, { excludedSubstances: ['lactose'] }, { catalogSession: catalog('Whey sem lactose', ['lactose']) });
    expect(saved.review.evidence).toHaveLength(2);
    expect(p.reviewPlan.mock.calls[0][0].evidence).toEqual(saved.review.evidence);
  });
  it.each(['Whey sem lactose Marca', 'Proteina vegetal Marca', 'Iogurte sem lactose Marca'])(
    'never lets an approving reviewer manufacture proof for unknown commercial product %s', async name => {
      const p = provider(plan(food(name)));
      await expect(run(p, { excludedSubstances: ['lactose'] })).rejects.toMatchObject({ lastFailureCode: 'AI_EVIDENCE_INSUFFICIENT' });
      expect(p.reviewPlan).not.toHaveBeenCalled();
    });
  it.each(['Whey isolado', 'Whey hidrolisado'])(
    'keeps unverified commercial dairy %s unknown rather than inventing proof of lactose presence or absence', async name => {
      await expect(run(provider(plan(food(name, 'dairy'))), { excludedSubstances: ['lactose'] }))
        .rejects.toMatchObject({ lastFailureCode: 'AI_EVIDENCE_INSUFFICIENT' });
    });
  it('no longer auto-rejects ordinary dairy under lactose exclusion — defers to the independent reviewer (2026-10-21 fix)', async () => {
    // Lactose intolerance is not a blanket dairy ban (round brief §7): plain,
    // ordinary dairy foods must reach the reviewer's own `lactose` check
    // instead of being hard-blocked by a determinism that cannot tell a
    // tolerable preparation from an unsafe one.
    await expect(run(provider(plan(food('Iogurte tradicional', 'dairy'))), { excludedSubstances: ['lactose'] }))
      .resolves.toMatchObject({ review: { calls: 2 } });
    await expect(run(provider(plan(food('Leite integral', 'dairy'))), { excludedSubstances: ['lactose'] }))
      .resolves.toMatchObject({ review: { calls: 2 } });
  });
  it.each([
    ['lactose', 'Whey sem lactose', 'Lactose'],
    ['gluten', 'Pao sem gluten', 'Farinha de trigo'],
  ] as const)('never lets verified %s absence override an explicitly incompatible proposed ingredient', async (substance, name, ingredient) => {
    const item = food(`${name} Marca`); item.ingredients = [{ name: ingredient, origin: 'plant' }];
    const p = provider(plan(item));
    await expect(run(p, { excludedSubstances: [substance] }, { catalogSession: catalog(name, [substance]) }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_CONTENT_SAFETY_MISMATCH' });
    expect(p.reviewPlan).not.toHaveBeenCalled();
  });
  it('allows compatible verified plant protein under lactose exclusion', async () => {
    await expect(run(provider(plan(food('Proteina vegetal Marca'))), { excludedSubstances: ['lactose'] },
      { catalogSession: catalog('Proteina vegetal', ['lactose']) })).resolves.toMatchObject({ review: { calls: 2 } });
  });
  it('preserves the legacy milk allergy independently from verified lactose absence', async () => {
    await expect(run(provider(plan(food('Whey sem lactose Marca', 'dairy'))),
      { excludedAllergens: ['milk'] }, { catalogSession: catalog('Whey sem lactose', ['lactose', 'milk']) }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_CONTENT_SAFETY_MISMATCH' });
  });
  it('recognizes milk protein derivatives even if the creator misclassifies their origin', async () => {
    await expect(run(provider(plan(food('Caseinato de sodio', 'plant'))), { excludedAllergens: ['milk'] }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_CONTENT_SAFETY_MISMATCH' });
  });
  it('allows gluten-excluded cassava and rejects wheat independently of reviewer approval', async () => {
    await expect(run(provider(), { excludedSubstances: ['gluten'] })).resolves.toBeTruthy();
    await expect(run(provider(plan(food('Pao de trigo'))), { excludedSubstances: ['gluten'] }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_CONTENT_SAFETY_MISMATCH' });
  });
  it('allows an explicitly composed homemade preparation without turning the catalog into an allowed-food list', async () => {
    const item = food('Pao caseiro de arroz');
    item.ingredients = [{ name: 'Farinha de arroz', origin: 'plant' }, { name: 'Agua', origin: 'mineral' }];
    await expect(run(provider(plan(item)), { excludedSubstances: ['lactose', 'gluten'] })).resolves.toBeTruthy();
  });
  it('does not let a homemade label hide an unverified commercial ingredient', async () => {
    const item = food('Pao caseiro de arroz');
    item.ingredients = [{ name: 'Farinha de arroz', origin: 'plant' }, { name: 'Iogurte sem lactose Marca', origin: 'dairy' }];
    await expect(run(provider(plan(item)), { excludedSubstances: ['lactose'] }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_EVIDENCE_INSUFFICIENT' });
  });
  it('does not let a homemade label or an unrestricted profile confer invented certification', async () => {
    const item = food('Pao caseiro certificado por laudo');
    item.ingredients = [{ name: 'Farinha de arroz', origin: 'plant' }, { name: 'Agua', origin: 'mineral' }];
    await expect(run(provider(plan(item)), { dietaryPattern: 'omnivore' }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_EVIDENCE_INSUFFICIENT' });
  });
  it('rejects malformed backend evidence rather than accepting a truthy string as a reviewed composition', async () => {
    const session = catalog('Whey sem lactose', ['lactose']);
    const candidate = await session.reader.get('foodLogCatalog', 'unused');
    candidate!.food.safetyEvidence!.compositionReviewed = 'false' as unknown as boolean;
    await expect(run(provider(plan(food('Whey sem lactose Marca', 'dairy'))), { excludedSubstances: ['lactose'] }, { catalogSession: session }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_EVIDENCE_INSUFFICIENT' });
  });
  it('does not introduce supplements when the user did not select them', async () => {
    await expect(run(provider(plan(food('Proteina vegetal'))), { dietaryPattern: 'omnivore', supplements: [] }))
      .rejects.toMatchObject({ lastFailureCode: 'AI_CONTENT_SAFETY_MISMATCH' });
  });
  it('rejects an animal ingredient under veganism even if the food name sounds plant-based', async () => {
    const output = plan(); output.meals[0].foods[0].ingredients.push({ name: 'Leite', origin: 'dairy' });
    await expect(run(provider(output), { dietaryPattern: 'vegan' })).rejects.toMatchObject({ lastFailureCode: 'AI_CONTENT_SAFETY_MISMATCH' });
  });
  it('regenerates after rejection with structured feedback, and reviews the corrected plan', async () => {
    const p = provider(); p.reviewPlan.mockImplementationOnce(async req => reject(req) as Awaited<ReturnType<typeof approveReview>>);
    const r = await run(p);
    expect(r.attempt).toBe(2); expect(r.review.calls).toBe(4);
    expect(JSON.parse(p.generatePlan.mock.calls[1][0].feedback).reviewer.status).toBe('rejected');
    expect(p.generatePlan.mock.calls.every(([req]) => req.fallback === false)).toBe(true);
  });
  it.each(['rejected', 'insufficient_information'])('does not approve when attempts end after reviewer status=%s', async status => {
    const p = provider(); p.reviewPlan.mockImplementation(async req => reject(req, status) as Awaited<ReturnType<typeof approveReview>>);
    await expect(run(p)).rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(p.generatePlan).toHaveBeenCalledTimes(2); expect(p.reviewPlan).toHaveBeenCalledTimes(2);
  });
  it('retries malformed review without paying for duplicate creation and never defaults to approval', async () => {
    const p = provider(); p.reviewPlan.mockResolvedValue(result({ status: 'approved' }) as Awaited<ReturnType<typeof approveReview>>);
    await expect(run(p)).rejects.toMatchObject({ lastFailureCode: 'AI_REVIEW_SCHEMA_INVALID' });
    expect(p.generatePlan).toHaveBeenCalledTimes(1); expect(p.reviewPlan).toHaveBeenCalledTimes(3);
  });
  it('does not recreate a diet after transient reviewer unavailability', async () => {
    const p = provider(); p.reviewPlan.mockRejectedValueOnce(new Error('network'));
    await expect(run(p)).resolves.toMatchObject({ review: { calls: 3 } });
    expect(p.generatePlan).toHaveBeenCalledTimes(1);
  });
  it('classifies permanent reviewer outage separately from creator refusal', async () => {
    const p = provider(); p.reviewPlan.mockRejectedValue(new Error('network'));
    await expect(run(p)).rejects.toMatchObject({ lastFailureCode: 'AI_REVIEW_UNAVAILABLE' });
    const q = provider(); q.generatePlan.mockRejectedValue(new NutritionAiProviderError('AI_PROVIDER_REFUSAL', true));
    await expect(run(q)).rejects.toMatchObject({ lastFailureCode: 'AI_PROVIDER_REFUSAL' });
    expect(q.generatePlan).toHaveBeenCalledTimes(3); expect(q.reviewPlan).not.toHaveBeenCalled();
  });
  it('fails closed when no reviewer implementation is configured', async () => {
    const p = provider(); await expect(run({ generatePlan: p.generatePlan })).rejects.toMatchObject({ code: 'AI_REVIEW_UNAVAILABLE' });
    expect(p.generatePlan).not.toHaveBeenCalled();
  });
  it('enforces a total call ceiling across resumptions and respects the cost envelope', async () => {
    const p = provider(); await expect(run(p, {}, { initialCallCount: 3 })).rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(p.generatePlan).not.toHaveBeenCalled();
    expect(MAX_AI_CALLS * Math.max(stageReservedUsd('creator'), stageReservedUsd('reviewer'))).toBeLessThan(MAX_JOB_RESERVED_USD);
    expect(AI_STAGE_LIMITS.creator.outputTokens).toBe(8000); expect(AI_STAGE_LIMITS.reviewer.outputTokens).toBe(1500);
  });
  it('keeps the 90s creator ceiling and reserves part of the existing alternative deadline for review', async () => {
    const p = provider(); await run(p, {}, { deadline: Date.now() + 110_000 });
    expect(AI_STAGE_LIMITS.creator.timeoutMs).toBe(90_000);
    expect(p.generatePlan.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(75_000);
    expect(p.reviewPlan.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(30_000);
  });
  it('reviews the final deterministically scaled portions, not a stale uncorrected draft', async () => {
    const output = plan(); for (const m of output.meals) for (const key of Object.keys(n)) m.foods[0].estimatedNutrition[key as keyof typeof n] *= 1.04;
    const p = provider(output); const r = await run(p);
    const reviewed = p.reviewPlan.mock.calls[0][0].candidate as ReturnType<typeof plan>;
    expect(reviewed.meals[0].foods[0].quantity).toBe(r.validated.meals[0].options[0].foods[0].quantity);
    expect(r.review.candidateDigest).toBe(candidateDigest(reviewed));
  });
  it('reviews every meal alternative and keeps the existing response shape', async () => {
    const p = { ...provider(), generateMealAlternative: vi.fn().mockResolvedValue(result({
      recommendedOptionIndex: 0, options: [{ foods: [food()] }, { foods: [food('Feijao cozido')] }] })) };
    const r = await generateValidatedMealAlternative(p, profile, 'lunch', mealTarget, [], 'health', names, undefined);
    expect(r.validated.options).toHaveLength(2); expect(r.review.calls).toBe(2);
    expect((p.reviewPlan.mock.calls[0][0].candidate as { options: unknown[] }).options).toHaveLength(2);
  });
  it('rejects stale digests, partial checks and contradictory approvals', async () => {
    const approved = (await approveReview({ candidateDigest: 'abc' } as NutritionReviewRequest)).output;
    expect(() => parseNutritionReview(approved, 'different')).toThrow();
    expect(() => parseNutritionReview({ ...approved, checks: {} }, 'abc')).toThrow();
    expect(() => parseNutritionReview({ ...approved, requiresRegeneration: true }, 'abc')).toThrow();
    expect(() => parseNutritionReview(null, 'abc')).toThrow();
  });
  it('bounds input before HTTP and never silently truncates restrictions', async () => {
    const fetcher = vi.fn<typeof fetch>(); const p = new OpenAiNutritionProvider('test', fetcher);
    await expect(p.generatePlan({ profile, engine, goal: 'health', foodNames: { ...names, excluded: ['x'.repeat(64000)] } }))
      .rejects.toMatchObject({ code: 'AI_COST_LIMIT_EXCEEDED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('counts a normal creator/reviewer pair once, without inventing a retry or dropping either cost', () => {
    const common = { generationId: 'one-job', operation: 'full_plan' as const, attemptNumber: 1,
      fallbackUsed: false, latencyMs: 10, inputTokens: 100, outputTokens: 50, failureCode: null };
    const facts: AiOperationFact[] = [
      { ...common, agentRole: 'creator', resultStatus: 'created', estimatedCostUsd: .0013 },
      { ...common, agentRole: 'reviewer', resultStatus: 'validated', estimatedCostUsd: .00075 },
    ];
    expect(buildAiOperationMetrics(facts)).toMatchObject({ requests: 1, attempts: 2, successRate: 1, retryRate: 0 });
    expect(buildAiOperationMetrics(facts).totalEstimatedCostUsd).toBeCloseTo(.00205);
    expect(buildAiMetricsByRole(facts).creator.attempts).toBe(1);
    expect(buildAiMetricsByRole(facts).reviewer.attempts).toBe(1);
    expect(buildAiOperationMetrics([{ ...facts[0], resultStatus: 'pending', estimatedCostUsd: null }, facts[1]]).totalEstimatedCostUsd).toBeNull();
  });
  it('classifies malformed reviewer transport bodies as invalid response, never as approval', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON', { status: 200 }));
    await expect(new OpenAiNutritionProvider('test', fetcher).reviewPlan({ profile, goal: 'health', foodNames: names,
      targets: engine, candidate: plan(), candidateDigest: 'digest', evidence: [] }))
      .rejects.toMatchObject({ code: 'AI_REVIEW_SCHEMA_INVALID' });
  });
  it('uses a separate stateless reviewer HTTP call, its own schema and the cheap model', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed',
      output: [{ content: [{ type: 'refusal', refusal: 'opaque review refusal' }] }],
      usage: { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 0 } } })));
    const p = new OpenAiNutritionProvider('test', fetcher);
    await expect(p.reviewPlan({ profile, goal: 'health', foodNames: names, targets: engine,
      candidate: plan(), candidateDigest: 'digest', evidence: [] })).rejects.toMatchObject({ code: 'AI_REVIEW_PROVIDER_REFUSAL', result: { usage: { inputTokens: 12 } } });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.model).toBe('gpt-6-luna'); expect(body.max_output_tokens).toBe(1500);
    expect(body.previous_response_id).toBeUndefined(); expect(body.store).toBe(false);
    expect(body.service_tier).toBe('default'); expect(body.truncation).toBe('disabled');
    expect(body.input[1].content).toContain('Evaluate; never create');
  });
  it('includes physical context in the alternative creator HTTP request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed',
      output: [{ content: [{ type: 'output_text', text: '{}' }] }] })));
    const physicalContext = { ageYears: 30, weightKg: 70, heightCm: 170, sex: 'female' };
    await new OpenAiNutritionProvider('test', fetcher).generateMealAlternative({ profile,
      target: engine.mealTargets[0], goal: 'health', foodNames: names, avoidFoodNames: [], physicalContext });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(JSON.parse(body.input[2].content).physicalContext).toEqual(physicalContext);
  });
});
