import { describe, expect, it } from 'vitest';

import decisionsJson from '../../../docs/workout-modifiers/AJ_Fit_limitation_clinical_decisions_v1.json';
import datasetJson from '../../../docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json';
import templatesJson from '../../../docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json';
import { LIMITATION_REGION_IDS, type LimitationRegionId } from '../../types/exercise';
import { buildExerciseTemplateIndex, classifyPair, VALID_CLASSIFICATIONS } from '../../../scripts/auditLimitationDataset';
import { loadLocalExerciseCatalogForLimitations } from '../localLimitationCatalog';
import {
  resolveExerciseLimitations,
  validateLimitationProfile,
  type LimitationCatalogExercise,
} from '../limitationResolver';

type Decision =
  | { status: 'compatible' | 'not_applicable' }
  | { status: 'adapt'; adaptation: { kind: 'exercise_variant'; exerciseId: string } };

interface DecisionRow {
  exerciseId: string;
  region: LimitationRegionId;
  proposedDecision: Decision;
}

interface DecisionsArtifact {
  scope: { inputRows: number; decisionUnits: number; supportingChanges: number };
  supportingChanges: DecisionRow[];
  rows: DecisionRow[];
}

interface TemplateArtifact {
  workouts: Array<{
    id: string;
    sessions: Array<{ exercises: Array<{ exercise_id: string }> }>;
  }>;
}

const decisions = decisionsJson as unknown as DecisionsArtifact;
const dataset = datasetJson as unknown as {
  dependencies: {
    cyclesByRegion: Array<{ region: LimitationRegionId; exerciseIds: string[] }>;
  };
};
const templates = (templatesJson as unknown as TemplateArtifact).workouts;
const exerciseTemplates = buildExerciseTemplateIndex(templates);
const usedExerciseIds = [...exerciseTemplates.keys()].sort();
const catalogArray = loadLocalExerciseCatalogForLimitations();
const catalog = new Map<string, LimitationCatalogExercise>(
  catalogArray.map((exercise) => [exercise.id, exercise]),
);

function expectedRule(decision: Decision): object {
  return decision.status === 'adapt'
    ? {
        status: 'adapt',
        adaptation: {
          kind: 'exercise_variant',
          exerciseId: decision.adaptation.exerciseId,
        },
      }
    : { status: decision.status };
}

describe('approved limitation clinical decisions v1', () => {
  it('materializes all 176 rows and all 3 supporting changes exactly', () => {
    expect(decisions.scope).toEqual(expect.objectContaining({
      inputRows: 176,
      decisionUnits: 151,
      supportingChanges: 3,
    }));
    expect(decisions.rows).toHaveLength(176);
    expect(decisions.supportingChanges).toHaveLength(3);

    for (const row of [...decisions.supportingChanges, ...decisions.rows]) {
      const source = catalog.get(row.exerciseId);
      expect(source, `${row.exerciseId} must exist`).toBeDefined();
      const validation = validateLimitationProfile(row.exerciseId, source?.limitationProfile);
      expect(validation.valid, `${row.exerciseId} must have a valid profile`).toBe(true);
      if (validation.valid) {
        expect(validation.profile.regions[row.region]).toEqual(expectedRule(row.proposedDecision));
      }
    }
  });

  it('proves every one of the 89 approved adapt rows has a direct terminal target accepted by the real resolver', () => {
    const adaptRows = decisions.rows.filter(
      (row): row is DecisionRow & { proposedDecision: Extract<Decision, { status: 'adapt' }> } =>
        row.proposedDecision.status === 'adapt',
    );
    expect(adaptRows).toHaveLength(89);

    for (const row of adaptRows) {
      const targetId = row.proposedDecision.adaptation.exerciseId;
      expect(targetId).not.toBe(row.exerciseId);
      const target = catalog.get(targetId);
      expect(target, `${row.exerciseId}:${row.region} target ${targetId} must exist`).toBeDefined();
      expect(target?.status).toBe('active');
      expect(target?.availability.workoutGeneration).toBe(true);
      expect(target?.availability.substitution).toBe(true);

      const targetValidation = validateLimitationProfile(targetId, target?.limitationProfile);
      expect(targetValidation.valid, `${targetId} profile must be valid`).toBe(true);
      if (targetValidation.valid) {
        expect(['compatible', 'not_applicable']).toContain(
          targetValidation.profile.regions[row.region].status,
        );
      }

      const result = resolveExerciseLimitations({
        exerciseId: row.exerciseId,
        regions: [row.region],
        catalog,
        isExecutable: () => true,
      });
      expect(result.status, `${row.exerciseId}:${row.region} -> ${targetId}`).toBe('RESOLVED');
      if (result.status === 'RESOLVED') expect(result.exercise.id).toBe(targetId);
    }
  });

  it('keeps all 71 reachable exercises valid across all 7 regions', () => {
    expect(usedExerciseIds).toHaveLength(71);
    expect(LIMITATION_REGION_IDS).toHaveLength(7);
    const invalid: string[] = [];
    for (const exerciseId of usedExerciseIds) {
      for (const region of LIMITATION_REGION_IDS) {
        const result = classifyPair(exerciseId, region, catalog, exerciseTemplates);
        if (!VALID_CLASSIFICATIONS.has(result.classification)) {
          invalid.push(`${exerciseId}:${region}:${result.classification}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it('has no same-region runtime adaptation cycles', () => {
    expect(dataset.dependencies.cyclesByRegion).toEqual([]);
  });
});
