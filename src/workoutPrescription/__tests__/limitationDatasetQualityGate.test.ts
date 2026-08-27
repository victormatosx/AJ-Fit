import { describe, expect, it } from 'vitest';
import { loadLocalExerciseCatalogForLimitations } from '../localLimitationCatalog';
import { validateLimitationProfile, type LimitationCatalogExercise } from '../limitationResolver';
import { LIMITATION_REGION_IDS } from '../../types/exercise';
import templatesJson from '../../../docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json';
import baseline from '../../../docs/workout-modifiers/limitation-dataset-baseline.json';
import { buildExerciseTemplateIndex, classifyPair, VALID_CLASSIFICATIONS } from '../../../scripts/auditLimitationDataset';

/**
 * Quality gate for the exercise limitation dataset
 * (docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json).
 *
 * The known-debt baseline is zero. This gate fails on:
 *
 *   - a NEW invalid combination not already in the baseline (regression);
 *   - a baseline combination whose FAILURE CATEGORY silently changed
 *     (someone edited the rule without re-running the audit/baseline);
 *   - any structurally broken reference (missing adapt target, self-
 *     reference) — these must never occur, baseline or not.
 *
 * Reducing debt (fixing a case so it becomes valid) always passes; when
 * that happens, regenerate the baseline via
 * `npx tsx scripts/generateLimitationDatasetBaseline.ts` in the SAME PR so
 * the lower count becomes the new floor (docs/workout-modifiers/
 * LIMITATION_DATASET_AUDIT.md §Quality Gate futuro — the baseline must only
 * ever represent debt, never normalize it as acceptable).
 */
interface TemplateFile {
  workouts: Array<{ id: string; sessions: Array<{ exercises: Array<{ exercise_id: string }> }> }>;
}

const templates = (templatesJson as unknown as TemplateFile).workouts;
const exerciseTemplates = buildExerciseTemplateIndex(templates);
const usedExerciseIds = [...exerciseTemplates.keys()].sort();

const catalogArr = loadLocalExerciseCatalogForLimitations();
const catalog = new Map<string, LimitationCatalogExercise>(catalogArr.map((e) => [e.id, e]));

describe('Limitation dataset quality gate — zero-debt baseline', () => {
  const currentInvalid = new Map<string, string>();
  for (const exerciseId of usedExerciseIds) {
    for (const region of LIMITATION_REGION_IDS) {
      const result = classifyPair(exerciseId, region, catalog, exerciseTemplates);
      if (!VALID_CLASSIFICATIONS.has(result.classification)) {
        currentInvalid.set(`${exerciseId}:${region}`, result.classification);
      }
    }
  }
  const knownInvalid = baseline.knownInvalid as Record<string, string>;

  it('never introduces a NEW invalid combination beyond the known baseline', () => {
    const newRegressions = [...currentInvalid.keys()].filter((key) => !(key in knownInvalid));
    expect(newRegressions, `New limitation failures not in the baseline (regenerate the baseline only if these are genuinely resolved, never to hide a regression): ${newRegressions.join(', ')}`).toEqual([]);
  });

  it('flags any baseline case whose failure category silently changed', () => {
    const changed = [...currentInvalid.entries()]
      .filter(([key, classification]) => key in knownInvalid && knownInvalid[key] !== classification)
      .map(([key, classification]) => `${key}: ${knownInvalid[key]} -> ${classification}`);
    expect(changed, `Baseline entries changed category without a baseline regeneration: ${changed.join(', ')}`).toEqual([]);
  });

  it('the baseline count matches what is actually persisted (baseline is not stale)', () => {
    expect(baseline.knownInvalidCount).toBe(Object.keys(knownInvalid).length);
  });

  it('keeps the reachable limitation debt at zero', () => {
    expect(baseline.knownInvalidCount).toBe(0);
    expect(currentInvalid.size).toBe(0);
  });

  it('resolved debt is welcome and never blocks CI (documents current count, does not enforce it)', () => {
    // Informational only: a lower number here than `knownInvalidCount` means
    // progress was made and the baseline should be regenerated in this PR.
    expect(currentInvalid.size).toBeLessThanOrEqual(baseline.knownInvalidCount);
  });
});

describe('Limitation dataset quality gate — hard structural invariants (never allowed, no baseline exception)', () => {
  const profiledExercises = [...catalog.values()].filter((e) => e.limitationProfile != null);

  it('every `adapt` target referenced by any profiled exercise exists in the catalog', () => {
    const brokenReferences: string[] = [];
    for (const exercise of profiledExercises) {
      const validation = validateLimitationProfile(exercise.id, exercise.limitationProfile);
      if (!validation.valid) continue;
      for (const region of LIMITATION_REGION_IDS) {
        const rule = validation.profile.regions[region];
        if (rule.status === 'adapt' && !catalog.has(rule.adaptation.exerciseId)) {
          brokenReferences.push(`${exercise.id}.${region} -> adapt -> '${rule.adaptation.exerciseId}' (missing)`);
        }
      }
    }
    expect(brokenReferences).toEqual([]);
  });

  it('every `avoid` substitute referenced by any profiled exercise exists in the catalog', () => {
    const brokenReferences: string[] = [];
    for (const exercise of profiledExercises) {
      const validation = validateLimitationProfile(exercise.id, exercise.limitationProfile);
      if (!validation.valid) continue;
      for (const region of LIMITATION_REGION_IDS) {
        const rule = validation.profile.regions[region];
        if (rule.status === 'avoid') {
          for (const substituteId of rule.substituteExerciseIds) {
            if (!catalog.has(substituteId)) brokenReferences.push(`${exercise.id}.${region} -> avoid -> '${substituteId}' (missing)`);
          }
        }
      }
    }
    expect(brokenReferences).toEqual([]);
  });

  it('no rule self-references its own exercise (adapt target or avoid substitute)', () => {
    const selfReferences: string[] = [];
    for (const exercise of profiledExercises) {
      const validation = validateLimitationProfile(exercise.id, exercise.limitationProfile);
      if (!validation.valid) continue;
      for (const region of LIMITATION_REGION_IDS) {
        const rule = validation.profile.regions[region];
        if (rule.status === 'adapt' && rule.adaptation.exerciseId === exercise.id) {
          selfReferences.push(`${exercise.id}.${region} adapts to itself`);
        }
        if (rule.status === 'avoid' && rule.substituteExerciseIds.includes(exercise.id)) {
          selfReferences.push(`${exercise.id}.${region} lists itself as its own substitute`);
        }
      }
    }
    expect(selfReferences).toEqual([]);
  });

  it('every exercise actually used by T001-T090 that requires a limitation profile either has one or is a tracked baseline gap', () => {
    // Today all 40 unreviewed exercises are unused by any template (see the
    // audit report §Cobertura); this pins that fact so a future template
    // edit that newly reaches one of them is caught explicitly, rather than
    // silently reintroducing MISSING_PROFILE failures.
    const missingProfileButUsed = usedExerciseIds.filter((id) => {
      const exercise = catalog.get(id);
      return exercise && exercise.limitationProfile == null;
    });
    expect(missingProfileButUsed).toEqual([]);
  });
});
