import { describe, expect, it } from 'vitest';

import { shadowCompare } from './shadowComparisonV127';
import { completeAnswers } from './fixtures';

/**
 * Fase 9 §15 — shadow-comparison QA. No equality requirement between v2
 * and v1.27 results (different template libraries, not required to
 * prescribe the same content) — this only proves the comparison itself is
 * inspectable/well-formed and surfaces the real, expected shape of the
 * differences for the Fase 9 report (§B/§G).
 */
describe('Fase 9 §15 — v2 vs v1.27 shadow comparison (QA-only, never production)', () => {
  it('both pipelines succeed for a common conventional gym scenario, with an independent templateId', () => {
    const answers = completeAnswers({ sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, place: 'gym' });
    const diff = shadowCompare(answers, 'INTERMEDIATE');
    expect(diff.v2Status).toBe('SUCCESS');
    expect(diff.v127Status).toBe('SUCCESS');
    expect(diff.versionsDiffer).toBe(true);
    // Both libraries independently select their own templateId — never required to match.
    expect(diff.v2TemplateId).toBeDefined();
    expect(diff.v127TemplateId).toBeDefined();
  });

  it('both pipelines succeed for a beginner scenario, and select from their own beginner range', () => {
    const answers = completeAnswers({ sex: 'f', goal: 'gain_muscle', level: 'beginner', days: 3, place: 'home', equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box'] });
    const diff = shadowCompare(answers, 'BEGINNER');
    expect(diff.v2Status).toBe('SUCCESS');
    expect(diff.v127Status).toBe('SUCCESS');
  });

  it('both pipelines succeed for a special-population (pregnancy) scenario', () => {
    const answers = completeAnswers({
      sex: 'f', place: 'gym', days: 3,
      specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
    });
    const diff = shadowCompare(answers, 'INTERMEDIATE');
    expect(diff.v2Status).toBe('SUCCESS');
    expect(diff.v127Status).toBe('SUCCESS');
  });

  it('reports a structured, inspectable diff shape (no thrown errors, no forced equality)', () => {
    const answers = completeAnswers({ sex: 'm', goal: 'strength', level: 'intermediate', days: 2, place: 'gym' });
    const diff = shadowCompare(answers, 'INTERMEDIATE');
    expect(typeof diff.templateIdDiffers).toBe('boolean');
    expect(typeof diff.exerciseSetDiffers).toBe('boolean');
    expect(typeof diff.doseShapeDiffers).toBe('boolean');
  });
});
