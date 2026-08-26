#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import {
  LIMITATION_REGIONS,
  convertV3ToProfiles,
  validateTechnicalProfiles,
  type V3Dataset,
} from './limitationProfilesPhase3';

const ROOT = process.cwd();
const SOURCE_PATH = join(ROOT, 'docs/workout-modifiers/exercise-limitations/11_GENERALIZED_CONSERVATIVE_LIMITATION_DATASET_v3.json');
const OUTPUT_PATH = join(ROOT, 'docs/workout-modifiers/exercise-limitations/12_LIMITATION_PROFILES_TECHNICAL_v1.json');

const v3 = JSON.parse(readFileSync(SOURCE_PATH, 'utf8')) as V3Dataset;
const profiles = convertV3ToProfiles(v3);
const validation = validateTechnicalProfiles(v3, profiles, new Set(EXERCISES_SEED.map((exercise) => exercise.id)));
if (!validation.valid) {
  validation.errors.forEach((error) => console.error(`ERROR: ${error}`));
  process.exit(1);
}

const artifact = {
  datasetVersion: 'phase3-limitation-profiles-v1',
  sourceDataset: {
    file: '11_GENERALIZED_CONSERVATIVE_LIMITATION_DATASET_v3.json',
    datasetVersion: v3.datasetVersion,
    protocolVersion: v3.sourceProtocol,
    decisionOrigin: 'generalized_conservative_product_decision_v3',
  },
  target: {
    collection: 'exercises',
    field: 'limitationProfile',
    writeMode: 'field_update_only',
    deletesAllowed: false,
  },
  governance: {
    reviewStatus: 'draft',
    professionalApprovalClaimed: false,
    reviewedAtIncluded: false,
    reviewedByIncluded: false,
    note: 'O contrato atual reserva approved para revisão profissional completa; a V3 é decisão de produto e permanece draft.',
  },
  schema: {
    schemaVersion: 1,
    protocolVersion: 'musculoskeletal-v1',
    regions: [...LIMITATION_REGIONS],
  },
  summary: {
    profileCount: profiles.length,
    pairCount: validation.pairCount,
    statusCounts: validation.statusCounts,
    adaptCount: validation.adaptCount,
    avoidCount: validation.avoidCount,
    avoidWithoutSubstituteCount: validation.avoidWithoutSubstitute.length,
    referencedCandidateCount: validation.referencedCandidateIds.length,
    externalCandidateCount: validation.externalCandidateIds.length,
    actionReferencedCandidateCount: validation.actionReferencedCandidateIds.length,
    externalActionCandidateCount: validation.externalActionCandidateIds.length,
    cycleCount: validation.globalCycles.length,
  },
  sourceDiscrepancies: validation.warnings.filter((warning) => warning.startsWith('V3 summary.')),
  dependencies: {
    avoidWithoutSubstitute: validation.avoidWithoutSubstitute,
    externalCandidatesWithoutV3Profile: validation.externalCandidateIds,
    externalActionCandidatesWithoutV3Profile: validation.externalActionCandidateIds,
    cyclesByRegion: validation.cyclesByRegion,
    globalCycles: validation.globalCycles,
  },
  validation: {
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    exactly71Profiles: profiles.length === 71,
    exactlySevenRegionsPerProfile: profiles.every((entry) => Object.keys(entry.limitationProfile.regions).length === 7),
    exactly497Pairs: validation.pairCount === 497,
    zeroUnknown: validation.statusCounts.unknown === 0,
    allCatalogReferencesExist: true,
    noSelfReferences: true,
    noDuplicateCandidateIds: true,
  },
  profiles,
};

writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_PATH, ...artifact.summary, warnings: validation.warnings }, null, 2));
