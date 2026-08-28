#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import {
  validateClosedProfileSet,
  type TechnicalProfileEntry,
} from './limitationProfilesPhase3';

type Region = 'knee' | 'hip' | 'back' | 'shoulder' | 'elbow' | 'wrist' | 'ankle_foot';

type ProposedDecision =
  | { status: 'compatible' | 'not_applicable' }
  | {
      status: 'adapt';
      adaptation: { kind: 'exercise_variant'; exerciseId: string };
    };

interface DecisionRow {
  exerciseId: string;
  region: Region;
  proposedDecision: ProposedDecision;
}

interface DecisionsArtifact {
  version: string;
  scope: { inputRows: number; decisionUnits: number; supportingChanges: number };
  supportingChanges: DecisionRow[];
  rows: DecisionRow[];
}

interface DatasetArtifact {
  generatedAt: string;
  sourceDatasets: Array<{ file: string; datasetVersion: string }>;
  closure: { remainingExternalActionCandidateIds: string[] };
  summary: {
    profileCount: number;
    pairCount: number;
    statusCounts: Record<string, number>;
    avoidWithoutSubstituteCount: number;
    actionCandidateCount: number;
    remainingExternalActionCandidateCount: number;
    cycleCount: number;
  };
  dependencies: {
    avoidWithoutSubstitute: Array<{ exerciseId: string; region: Region }>;
    cyclesByRegion: Array<{ region: Region; exerciseIds: string[] }>;
    globalCycles: string[][];
    cyclesBlocking: boolean;
    remainingExternalActionCandidateIds: string[];
  };
  validation: Record<string, unknown>;
  profiles: TechnicalProfileEntry[];
}

const ROOT = process.cwd();
const DECISIONS_PATH = join(
  ROOT,
  'docs/workout-modifiers/AJ_Fit_limitation_clinical_decisions_v1.json',
);
const DATASET_PATH = join(
  ROOT,
  'docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json',
);

const decisions = JSON.parse(readFileSync(DECISIONS_PATH, 'utf8')) as DecisionsArtifact;
const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8')) as DatasetArtifact;

if (decisions.rows.length !== 176 || decisions.scope.inputRows !== 176) {
  throw new Error(`CLINICAL_DECISIONS_ROWS_INVALID:${decisions.rows.length}`);
}
if (decisions.scope.decisionUnits !== 151) {
  throw new Error(`CLINICAL_DECISION_UNITS_INVALID:${decisions.scope.decisionUnits}`);
}
if (decisions.supportingChanges.length !== 3 || decisions.scope.supportingChanges !== 3) {
  throw new Error(`CLINICAL_SUPPORTING_CHANGES_INVALID:${decisions.supportingChanges.length}`);
}

const catalogIds = new Set(EXERCISES_SEED.map((exercise) => exercise.id));
const profileByExerciseId = new Map(dataset.profiles.map((entry) => [entry.exerciseId, entry]));
const seenKeys = new Set<string>();

function applyDecision(row: DecisionRow): void {
  const key = `${row.exerciseId}:${row.region}`;
  if (seenKeys.has(key)) throw new Error(`CLINICAL_DECISION_DUPLICATE:${key}`);
  seenKeys.add(key);

  if (!catalogIds.has(row.exerciseId)) throw new Error(`CLINICAL_SOURCE_MISSING:${row.exerciseId}`);
  const entry = profileByExerciseId.get(row.exerciseId);
  if (!entry) throw new Error(`CLINICAL_SOURCE_PROFILE_MISSING:${row.exerciseId}`);

  const decision = row.proposedDecision;
  if (decision.status === 'adapt') {
    const targetId = decision.adaptation.exerciseId;
    if (!catalogIds.has(targetId)) throw new Error(`CLINICAL_TARGET_MISSING:${targetId}`);
    if (!profileByExerciseId.has(targetId)) throw new Error(`CLINICAL_TARGET_PROFILE_MISSING:${targetId}`);
    if (targetId === row.exerciseId) throw new Error(`CLINICAL_TARGET_SELF_REFERENCE:${key}`);
    entry.limitationProfile.regions[row.region] = {
      status: 'adapt',
      adaptation: { kind: 'exercise_variant', exerciseId: targetId },
    };
    return;
  }

  entry.limitationProfile.regions[row.region] = { status: decision.status };
}

// Terminal supporting nodes must be established before rows that target them.
decisions.supportingChanges.forEach(applyDecision);
decisions.rows.forEach(applyDecision);

const validation = validateClosedProfileSet(dataset.profiles, catalogIds);
if (!validation.valid) {
  throw new Error(`CLINICAL_DATASET_INVALID:\n${validation.errors.join('\n')}`);
}

dataset.generatedAt = '2026-08-27';
const decisionSource = {
  file: 'AJ_Fit_limitation_clinical_decisions_v1.json',
  datasetVersion: decisions.version,
};
if (!dataset.sourceDatasets.some((source) => source.file === decisionSource.file)) {
  dataset.sourceDatasets.push(decisionSource);
}
dataset.closure.remainingExternalActionCandidateIds = validation.remainingExternalActionCandidateIds;
dataset.summary = {
  profileCount: dataset.profiles.length,
  pairCount: validation.pairCount,
  statusCounts: validation.statusCounts,
  avoidWithoutSubstituteCount: validation.avoidWithoutSubstitute.length,
  actionCandidateCount: validation.actionCandidateIds.length,
  remainingExternalActionCandidateCount: validation.remainingExternalActionCandidateIds.length,
  cycleCount: validation.globalCycles.length,
};
dataset.dependencies = {
  avoidWithoutSubstitute: validation.avoidWithoutSubstitute,
  cyclesByRegion: validation.cyclesByRegion,
  globalCycles: validation.globalCycles,
  cyclesBlocking: false,
  remainingExternalActionCandidateIds: validation.remainingExternalActionCandidateIds,
};
dataset.validation = {
  valid: validation.valid,
  errors: validation.errors,
  exactly76Profiles: dataset.profiles.length === 76,
  exactlySevenRegionsPerProfile: dataset.profiles.every(
    (entry) => Object.keys(entry.limitationProfile.regions).length === 7,
  ),
  exactly532Pairs: validation.pairCount === 532,
  zeroUnknown: validation.statusCounts.unknown === 0,
  allCatalogReferencesExist: true,
  noSelfReferences: true,
  noDuplicateIds: true,
  invalidEnums: 0,
  executableClosureComplete: validation.remainingExternalActionCandidateIds.length === 0,
  avoidWithoutSubstituteAccepted: true,
  cyclesDetectedButNonBlocking: true,
};

writeFileSync(DATASET_PATH, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: DATASET_PATH,
  rowsApplied: decisions.rows.length,
  supportingChangesApplied: decisions.supportingChanges.length,
  profilesModified: new Set([...decisions.supportingChanges, ...decisions.rows]
    .map((row) => row.exerciseId)).size,
  ...dataset.summary,
}, null, 2));
