/**
 * Generates the KNOWN-DEBT baseline the quality gate test
 * (src/workoutPrescription/__tests__/limitationDatasetQualityGate.test.ts)
 * compares against.
 *
 * IMPORTANT: this baseline represents DEBT, not an acceptance criterion.
 * It exists so CI can catch NEW regressions without being blocked by the
 * 176 combinations already known to be invalid (see
 * docs/workout-modifiers/LIMITATION_DATASET_AUDIT.md). It must be
 * regenerated (and, ideally, shrink) as remediation rows get resolved —
 * never grown to "make a new regression pass".
 *
 * Usage: npx tsx scripts/generateLimitationDatasetBaseline.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLocalExerciseCatalogForLimitations } from '../src/workoutPrescription/localLimitationCatalog';
import type { LimitationCatalogExercise } from '../src/workoutPrescription/limitationResolver';
import { LIMITATION_REGION_IDS } from '../src/types/exercise';
import templatesJson from '../docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json';
import { buildExerciseTemplateIndex, classifyPair, VALID_CLASSIFICATIONS } from './auditLimitationDataset';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

interface TemplateFile {
  workouts: Array<{ id: string; sessions: Array<{ exercises: Array<{ exercise_id: string }> }> }>;
}

function main() {
  const templates = (templatesJson as unknown as TemplateFile).workouts;
  const exerciseTemplates = buildExerciseTemplateIndex(templates);
  const usedExerciseIds = [...exerciseTemplates.keys()].sort();

  const catalogArr = loadLocalExerciseCatalogForLimitations();
  const catalog = new Map<string, LimitationCatalogExercise>(catalogArr.map((e) => [e.id, e]));

  const knownInvalid: Record<string, string> = {};
  for (const exerciseId of usedExerciseIds) {
    for (const region of LIMITATION_REGION_IDS) {
      const result = classifyPair(exerciseId, region, catalog, exerciseTemplates);
      if (!VALID_CLASSIFICATIONS.has(result.classification)) {
        knownInvalid[`${exerciseId}:${region}`] = result.classification;
      }
    }
  }

  const baseline = {
    generatedAt: new Date().toISOString(),
    note: 'KNOWN DEBT, not an acceptance target. See docs/workout-modifiers/LIMITATION_DATASET_AUDIT.md. Regenerate via `npx tsx scripts/generateLimitationDatasetBaseline.ts` only after a case is genuinely fixed (never to silence a new regression).',
    knownInvalidCount: Object.keys(knownInvalid).length,
    knownInvalid,
  };

  const path = resolve(REPO_ROOT, 'docs/workout-modifiers/limitation-dataset-baseline.json');
  writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path} — ${baseline.knownInvalidCount} known-invalid keys`);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) main();
