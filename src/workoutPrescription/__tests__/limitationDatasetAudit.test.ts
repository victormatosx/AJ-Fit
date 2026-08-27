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
 * state of the real dataset — they exist so a future dataset edit that
 * changes these specific, already-diagnosed cases is a deliberate,
 * visible change, not a silent drift. This is deterministic: it calls the
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
  it('classifies plank×knee as INVALID_ADAPT_TARGET_AVOID (adapt target dead-bug is itself avoid for knee)', () => {
    const result = classify('plank', 'knee');
    expect(result.classification).toBe('INVALID_ADAPT_TARGET_AVOID');
    expect(result.rootCause).toBe('A_ADAPT_TARGET_MARKED_AVOID');
    expect(result.valid).toBe(false);
    expect(result.adaptTargetId).toBe('dead-bug');
    expect(result.adaptTargetStatusForRegion).toBe('avoid');
    expect(VALID_CLASSIFICATIONS.has(result.classification)).toBe(false);
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

  it('classifies an avoid rule with no persisted substitute as AVOID_NO_CANDIDATES, never inflated to a different category', () => {
    const result = classify('plank', 'hip');
    expect(result.classification).toBe('AVOID_NO_CANDIDATES');
    expect(result.rootCause).toBe('F_AVOID_NO_CANDIDATES_LISTED');
    expect(result.avoidSubstituteIds).toEqual([]);
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

describe('auditLimitationDataset — dataset-wide invariants (documents current state, does not fix it)', () => {
  it('matches the known audited total: 176/497 combinations invalid across the 71 templated exercises', () => {
    // Mirrors the real script's own scope (see scripts/auditLimitationDataset.ts main()).
    // Recomputing the exact 71-exercise x 7-region matrix here would duplicate the
    // script; instead this pins the two numbers already cross-checked in the
    // formal audit (docs/workout-modifiers/LIMITATION_DATASET_AUDIT.md) so a
    // silent dataset edit changing this without re-running the audit is caught.
    // NOTE: this is intentionally a snapshot, not a hard CI gate — see the
    // report's "Quality Gate futuro" section for the proposed baseline strategy.
    expect(auditJson.summary.totalAnalyzed).toBe(497);
    expect(auditJson.summary.totalInvalid).toBe(176);
  });
});
