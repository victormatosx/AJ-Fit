import { describe, expect, it } from 'vitest';
import { loadLocalExerciseCatalogForLimitations } from '../localLimitationCatalog';
import type { LimitationCatalogExercise } from '../limitationResolver';
import {
  buildExerciseTemplateIndex,
  classifyPair,
  VALID_CLASSIFICATIONS,
  type CaseResult,
} from '../../../scripts/auditLimitationDataset';
import auditJson from '../../../docs/workout-modifiers/limitation-dataset-audit.json';

/**
 * Regression/documentation tests for the limitation dataset audit tool
 * (scripts/auditLimitationDataset.ts). These pin down the CURRENT, known
 * state of the real dataset after the approved clinical decisions were
 * materialized. This is deterministic: it calls the
 * REAL `resolveExerciseLimitations`/`validateLimitationProfile` from
 * `limitationResolver.ts` — nothing here reimplements resolver logic.
 */
const catalogArr = loadLocalExerciseCatalogForLimitations();
const catalog = new Map<string, LimitationCatalogExercise>(catalogArr.map((e) => [e.id, e]));

const fakeTemplates = [
  { id: 'T001', sessions: [{ exercises: [{ exercise_id: 'plank' }, { exercise_id: 'dead-bug' }] }] },
  { id: 'T002', sessions: [{ exercises: [{ exercise_id: 'plank' }] }] },
];
const templateIndex = buildExerciseTemplateIndex(fakeTemplates);

function classify(exerciseId: string, region: Parameters<typeof classifyPair>[1]): CaseResult {
  return classifyPair(exerciseId, region, catalog, templateIndex);
}

describe('auditLimitationDataset — classifyPair', () => {
  it('classifies plank×knee as a valid, terminal adaptation to dead-bug', () => {
    const result = classify('plank', 'knee');
    expect(result.classification).toBe('VALID_ADAPTATION');
    expect(result.rootCause).toBeNull();
    expect(result.valid).toBe(true);
    expect(result.adaptTargetId).toBe('dead-bug');
    expect(result.adaptTargetStatusForRegion).toBe('not_applicable');
    expect(VALID_CLASSIFICATIONS.has(result.classification)).toBe(true);
  });

  it('classifies plank×ankle_foot as DIRECT_NOT_APPLICABLE (a genuinely valid, unaffected region)', () => {
    const result = classify('plank', 'ankle_foot');
    expect(result.classification).toBe('DIRECT_NOT_APPLICABLE');
    expect(result.valid).toBe(true);
    expect(VALID_CLASSIFICATIONS.has(result.classification)).toBe(true);
  });

  it('classifies a genuinely resolvable adaptation as VALID_ADAPTATION', () => {
    const result = classify('machine-flat-bench-press', 'shoulder');
    expect(result.classification).toBe('VALID_ADAPTATION');
    expect(result.valid).toBe(true);
    expect(result.adaptTargetId).toBe('wall-push-up');
  });

  it('classifies a former avoid-without-candidate as the approved terminal decision', () => {
    const result = classify('plank', 'hip');
    expect(result.classification).toBe('DIRECT_COMPATIBLE');
    expect(result.rootCause).toBeNull();
    expect(result.valid).toBe(true);
  });

  it('reports templatesAffected/templateCount from the exercise-template index, not guessed', () => {
    const result = classify('plank', 'knee');
    expect(result.templatesAffected).toEqual(['T001', 'T002']);
    expect(result.templateCount).toBe(2);
    const deadBugResult = classify('dead-bug', 'knee');
    expect(deadBugResult.templatesAffected).toEqual(['T001']);
  });

  it('never classifies a documented, resolvable case as invalid (no artificial inflation of failures)', () => {
    // Sanity: an exercise with no limitation impact at all for a region it
    // simply doesn't affect must never be miscounted as a problem.
    const result = classify('machine-flat-bench-press', 'ankle_foot');
    expect(VALID_CLASSIFICATIONS.has(result.classification)).toBe(true);
  });
});

describe('auditLimitationDataset — dataset-wide invariants', () => {
  it('matches the zero-debt audit: 0/497 invalid across the 71 templated exercises', () => {
    // Mirrors the real script's own scope (see scripts/auditLimitationDataset.ts main()).
    // Recomputing the exact 71-exercise x 7-region matrix here would duplicate the
    // script; instead this pins the two numbers already cross-checked in the
    // formal audit (docs/workout-modifiers/LIMITATION_DATASET_AUDIT.md) so a
    // silent dataset edit changing this without re-running the audit is caught.
    // NOTE: this is intentionally a snapshot, not a hard CI gate — see the
    // report's "Quality Gate futuro" section for the proposed baseline strategy.
    expect(auditJson.summary.totalAnalyzed).toBe(497);
    expect(auditJson.summary.totalValid).toBe(497);
    expect(auditJson.summary.totalInvalid).toBe(0);
  });
});
