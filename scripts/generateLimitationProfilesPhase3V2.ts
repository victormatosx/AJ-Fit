#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import {
  LIMITATION_REGIONS,
  PHASE3_EXTERNAL_PRODUCT_PROFILES,
  buildPhase3V2Profiles,
  validateClosedProfileSet,
  type TechnicalProfileEntry,
} from './limitationProfilesPhase3';

type V1Artifact = {
  datasetVersion: string;
  dependencies: { externalCandidatesWithoutV3Profile: string[] };
  profiles: TechnicalProfileEntry[];
};

const ROOT = process.cwd();
const V1_PATH = join(ROOT, 'docs/workout-modifiers/exercise-limitations/12_LIMITATION_PROFILES_TECHNICAL_v1.json');
const OUTPUT_PATH = join(ROOT, 'docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json');
const v1 = JSON.parse(readFileSync(V1_PATH, 'utf8')) as V1Artifact;
const profiles = buildPhase3V2Profiles(v1.profiles);
const validation = validateClosedProfileSet(
  profiles,
  new Set(EXERCISES_SEED.map((exercise) => exercise.id)),
);
if (!validation.valid) {
  validation.errors.forEach((error) => console.error(`ERROR: ${error}`));
  process.exit(1);
}

const externalProfileIds = PHASE3_EXTERNAL_PRODUCT_PROFILES.map((entry) => entry.exerciseId).sort();
const sourceAuxiliaryExternalCandidateIds = v1.dependencies.externalCandidatesWithoutV3Profile
  .filter((id) => !externalProfileIds.includes(id))
  .sort();
const artifact = {
  datasetVersion: 'phase3-limitation-profiles-v2',
  generatedAt: '2026-08-26',
  sourceDatasets: [
    { file: '12_LIMITATION_PROFILES_TECHNICAL_v1.json', datasetVersion: v1.datasetVersion },
    { file: '11_GENERALIZED_CONSERVATIVE_LIMITATION_DATASET_v3.json', datasetVersion: '3.0.0-generalized-conservative' },
  ],
  target: {
    collection: 'exercises',
    field: 'limitationProfile',
    writeMode: 'field_update_only',
    deletesAllowed: false,
  },
  governance: {
    reviewStatus: 'approved',
    reviewBasis: 'product_policy',
    professionalApprovalClaimed: false,
    reviewedAtIncluded: false,
    reviewedByIncluded: false,
    meaning: 'Regra aprovada para comportamento conservador do produto; não constitui liberação clínica universal.',
    futureReviewBasis: 'professional_review',
  },
  resolutionPolicy: {
    avoidWithoutSubstituteValid: true,
    avoidWithoutSubstituteOutcome: 'NO_SAFE_SUBSTITUTION',
    recursiveSubstitution: false,
    candidateFailureBehavior: 'TRY_NEXT_ORIGINAL_CANDIDATE',
    followCandidateSubstitutes: false,
    futureCycleProtection: 'visitedExerciseIds',
    cyclesBlockPersistence: false,
  },
  schema: {
    schemaVersion: 1,
    protocolVersion: 'musculoskeletal-v1',
    regions: [...LIMITATION_REGIONS],
  },
  closure: {
    originalProfileCount: v1.profiles.length,
    addedProfileCount: externalProfileIds.length,
    addedProfileIds: externalProfileIds,
    remainingExternalActionCandidateIds: validation.remainingExternalActionCandidateIds,
    sourceAuxiliaryExternalCandidateIdsNotPersisted: sourceAuxiliaryExternalCandidateIds,
    note: 'Listas auxiliares da V3 não são persistidas em adapt; somente adaptation.exerciseId e substituteExerciseIds formam o fechamento executável.',
  },
  externalProfileDecisionDerivation: {
    'cable-biceps-curl': ['hammer-curl', 'ez-bar-biceps-curl', 'seated-dumbbell-curl'],
    'cable-glute-kickback': ['glute-bridge', 'hip-thrust'],
    'iso-lateral-pulldown-machine': ['bar-lat-pulldown', 'resistance-band-lat-pulldown', 'v-bar-pulldown'],
    'lying-leg-raise': ['floor-crunch'],
    'machine-lateral-raise': ['dumbbell-lateral-raise'],
  },
  summary: {
    profileCount: profiles.length,
    pairCount: validation.pairCount,
    statusCounts: validation.statusCounts,
    avoidWithoutSubstituteCount: validation.avoidWithoutSubstitute.length,
    actionCandidateCount: validation.actionCandidateIds.length,
    remainingExternalActionCandidateCount: validation.remainingExternalActionCandidateIds.length,
    cycleCount: validation.globalCycles.length,
  },
  dependencies: {
    avoidWithoutSubstitute: validation.avoidWithoutSubstitute,
    cyclesByRegion: validation.cyclesByRegion,
    globalCycles: validation.globalCycles,
    cyclesBlocking: false,
    remainingExternalActionCandidateIds: validation.remainingExternalActionCandidateIds,
  },
  validation: {
    valid: validation.valid,
    errors: validation.errors,
    exactly76Profiles: profiles.length === 76,
    exactlySevenRegionsPerProfile: profiles.every((entry) => Object.keys(entry.limitationProfile.regions).length === 7),
    exactly532Pairs: validation.pairCount === 532,
    zeroUnknown: validation.statusCounts.unknown === 0,
    allCatalogReferencesExist: true,
    noSelfReferences: true,
    noDuplicateIds: true,
    invalidEnums: 0,
    executableClosureComplete: validation.remainingExternalActionCandidateIds.length === 0,
    avoidWithoutSubstituteAccepted: true,
    cyclesDetectedButNonBlocking: true,
  },
  profiles,
};

writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_PATH, ...artifact.summary, closure: artifact.closure }, null, 2));
