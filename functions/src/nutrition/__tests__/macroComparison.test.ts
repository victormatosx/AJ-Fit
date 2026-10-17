import { performance } from 'node:perf_hooks';
import { expect, it, vi } from 'vitest';
import { generateValidatedPlan } from '../generation/attempts';
import { validateAndBuildPlan } from '../generation/domain';
import { macroCases, macroEngine, macroPlan, macroProfile } from './fixtures/macroCorrection';

it('compares a fixed synthetic cohort without contacting any provider', async () => {
  const cases = macroCases();
  const results = [];
  for (const fixture of cases) {
    const restrictions = fixture.restrictions ?? { dietaryPattern: 'omnivore', excludedFoodNames: [] };
    const profile = { ...macroProfile, dietaryPattern: restrictions.dietaryPattern, excludedAllergens: fixture.allergens };
    const generatePlan = vi.fn().mockImplementation(async () => ({ output: generatePlan.mock.calls.length === 1 ? fixture.plan : macroPlan(),
      model: 'synthetic', usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, latencyMs: 0 }));
    let outcome: string;
    try {
      const value = await generateValidatedPlan({ generatePlan }, profile, macroEngine, 'health',
        { preferred: [], usual: [], excluded: [...restrictions.excludedFoodNames] });
      outcome = value.attempt > 1 ? 'retry' : value.validated.corrected ? 'corrected' : 'unchanged';
    } catch { outcome = 'safety'; }
    results.push({ name: fixture.name, outcome, calls: generatePlan.mock.calls.length });
  }
  // Timing is informational, never a flaky pass/fail threshold. Same pure fixture,
  // warmup and iteration count before/after; excludes provider, logging and I/O.
  const iterations = 10_000;
  const plan = macroCases()[2].plan;
  const run = () => { try { validateAndBuildPlan(plan, macroProfile.mealSlots, macroEngine); } catch { /* measured rejection */ } };
  for (let i = 0; i < 1000; i++) run();
  const started = performance.now();
  for (let i = 0; i < iterations; i++) run();
  console.info(JSON.stringify({ syntheticMacroComparison: results, calls: results.reduce((sum, r) => sum + r.calls, 0),
    timing: { iterations, totalMs: Number((performance.now() - started).toFixed(3)) } }));
  expect(results.map(({ outcome }) => outcome)).toEqual([
    'unchanged', 'corrected', 'corrected', 'retry', 'retry', 'retry', 'retry', 'retry', 'retry', 'safety', 'safety', 'safety',
  ]);
  expect(results.reduce((sum, entry) => sum + entry.calls, 0)).toBe(18);
});
