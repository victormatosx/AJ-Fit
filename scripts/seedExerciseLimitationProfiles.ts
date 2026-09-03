#!/usr/bin/env -S node --import tsx
/** Default-safe Firestore diff/apply tool. This phase executes it without --confirm. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import {
  LIMITATION_REGIONS,
  LIMITATION_STATUSES,
  profilesEqual,
  validateClosedProfileSet,
  type LimitationProfile,
  type LimitationStatus,
  type TechnicalProfileEntry,
} from './limitationProfilesPhase3';

type Action = 'CREATE_PROFILE' | 'UPDATE_PROFILE' | 'UNCHANGED' | 'BLOCKED' | 'ERROR';
type Artifact = {
  datasetVersion: string;
  governance: { reviewStatus: string; reviewBasis: string };
  dependencies: {
    remainingExternalActionCandidateIds: string[];
    globalCycles: string[][];
    cyclesBlocking: boolean;
  };
  resolutionPolicy: {
    avoidWithoutSubstituteValid: boolean;
    recursiveSubstitution: boolean;
    cyclesBlockPersistence: boolean;
  };
  schema: { schemaVersion: number; protocolVersion: string; regions: string[] };
  summary: {
    profileCount: number;
    pairCount: number;
    statusCounts: Record<LimitationStatus, number>;
    avoidWithoutSubstituteCount: number;
    remainingExternalActionCandidateCount: number;
    cycleCount: number;
  };
  validation: { valid: boolean; errors: string[] };
  profiles: TechnicalProfileEntry[];
};

const EXPECTED_CATALOG_COUNT = 116;
const EXPECTED_PROFILE_COUNT = 76;
const EXPECTED_PAIR_COUNT = 532;
const EXPECTED_STATUS_COUNTS: Record<LimitationStatus, number> = {
  compatible: 66,
  adapt: 138,
  avoid: 114,
  not_applicable: 214,
  unknown: 0,
};
const ROOT = process.cwd();
const DATASET_PATH = join(ROOT, 'docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json');
const DRY_RUN_REPORT_PATH = join(ROOT, 'docs/workout-modifiers/exercise-limitations/17_PHASE3_V2_FIRESTORE_DRY_RUN_REPORT.json');
const WRITE_RESULT_PATH = join(ROOT, 'docs/workout-modifiers/exercise-limitations/19_PHASE4_FIRESTORE_WRITE_RESULT.json');

function parseArgs(argv: string[]) {
  const confirm = argv.includes('--confirm');
  const projectIndex = argv.indexOf('--project');
  const projectOverride = projectIndex >= 0 ? argv[projectIndex + 1] : undefined;
  return { confirm, projectOverride };
}

function defaultProjectId(): string {
  const config = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8')) as { projects?: { production?: string } };
  if (!config.projects?.production) throw new Error('projects.production ausente em .firebaserc');
  return config.projects.production;
}

function structurallyCompleteProfile(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<LimitationProfile>;
  if (profile.schemaVersion !== 1 || profile.protocolVersion !== 'musculoskeletal-v1') return false;
  if (profile.reviewStatus !== 'approved' || !profile.reviewBasis) return false;
  if (!profile.regions || Object.keys(profile.regions).length !== 7) return false;
  return LIMITATION_REGIONS.every((region) => {
    const status = profile.regions?.[region]?.status;
    return status !== 'unknown' && (LIMITATION_STATUSES as readonly string[]).includes(status ?? '');
  });
}

function withoutLimitationProfile(data: Record<string, unknown>): Record<string, unknown> {
  const { limitationProfile: _omitted, ...rest } = data;
  return rest;
}

function statusCountsFor(entries: TechnicalProfileEntry[]): Record<LimitationStatus, number> {
  const counts: Record<LimitationStatus, number> = {
    compatible: 0,
    adapt: 0,
    avoid: 0,
    not_applicable: 0,
    unknown: 0,
  };
  for (const entry of entries) {
    for (const region of LIMITATION_REGIONS) counts[entry.limitationProfile.regions[region].status] += 1;
  }
  return counts;
}

function preflightArtifact(artifact: Artifact): void {
  const catalogIds = new Set(EXERCISES_SEED.map((exercise) => exercise.id));
  const validation = validateClosedProfileSet(artifact.profiles, catalogIds, EXPECTED_PROFILE_COUNT);
  const errors = [...validation.errors];
  if (!artifact.validation.valid || artifact.validation.errors.length) errors.push('artifact.validation não está válido/limpo');
  if (artifact.datasetVersion !== 'phase3-limitation-profiles-v2') errors.push(`datasetVersion inesperado: ${artifact.datasetVersion}`);
  if (artifact.governance.reviewStatus !== 'approved' || artifact.governance.reviewBasis !== 'product_policy') {
    errors.push('governança esperada: approved + product_policy');
  }
  if (artifact.schema.schemaVersion !== 1 || artifact.schema.protocolVersion !== 'musculoskeletal-v1') {
    errors.push('schemaVersion/protocolVersion inesperados');
  }
  if (!profilesEqual(artifact.schema.regions, [...LIMITATION_REGIONS])) errors.push('ordem/conjunto de regiões inesperado');
  if (validation.pairCount !== EXPECTED_PAIR_COUNT) errors.push(`pares=${validation.pairCount}; esperado=${EXPECTED_PAIR_COUNT}`);
  if (!profilesEqual(validation.statusCounts, EXPECTED_STATUS_COUNTS)) errors.push('distribuição de status diverge do baseline aprovado');
  if (!profilesEqual(artifact.summary.statusCounts, validation.statusCounts)) errors.push('summary.statusCounts diverge dos profiles');
  if (artifact.summary.profileCount !== EXPECTED_PROFILE_COUNT || artifact.summary.pairCount !== EXPECTED_PAIR_COUNT) {
    errors.push('summary profileCount/pairCount inválido');
  }
  if (artifact.summary.avoidWithoutSubstituteCount !== validation.avoidWithoutSubstitute.length) {
    errors.push('summary avoidWithoutSubstituteCount diverge dos profiles');
  }
  if (artifact.summary.remainingExternalActionCandidateCount !== 0
      || validation.remainingExternalActionCandidateIds.length !== 0
      || artifact.dependencies.remainingExternalActionCandidateIds.length !== 0) {
    errors.push('fechamento transitivo executável incompleto');
  }
  if (!artifact.resolutionPolicy.avoidWithoutSubstituteValid
      || artifact.resolutionPolicy.recursiveSubstitution
      || artifact.resolutionPolicy.cyclesBlockPersistence) {
    errors.push('política V1 de avoid/ciclos não está formalizada');
  }
  if (errors.length) throw new Error(`preflight local falhou antes de acessar o Firestore:\n- ${errors.join('\n- ')}`);
}

async function main() {
  const { confirm, projectOverride } = parseArgs(process.argv.slice(2));
  const projectId = projectOverride ?? defaultProjectId();
  const artifact = JSON.parse(readFileSync(DATASET_PATH, 'utf8')) as Artifact;
  preflightArtifact(artifact);
  const reportPath = confirm ? WRITE_RESULT_PATH : DRY_RUN_REPORT_PATH;

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const snapshot = await db.collection('exercises').get();
  const existing = new Map(snapshot.docs.map((document) => [document.id, document.data()]));
  const catalogCountValid = snapshot.size === EXPECTED_CATALOG_COUNT;
  const plans: Array<{ exerciseId: string; action: Action; reason: string; changedFields: string[] }> = [];

  for (const entry of artifact.profiles) {
    const current = existing.get(entry.exerciseId);
    if (!current) {
      plans.push({ exerciseId: entry.exerciseId, action: 'BLOCKED', reason: 'exercise document inexistente', changedFields: [] });
    } else if (!('limitationProfile' in current)) {
      plans.push({ exerciseId: entry.exerciseId, action: 'CREATE_PROFILE', reason: 'campo limitationProfile ausente', changedFields: ['limitationProfile'] });
    } else if (profilesEqual(current.limitationProfile, entry.limitationProfile)) {
      plans.push({ exerciseId: entry.exerciseId, action: 'UNCHANGED', reason: 'profile idêntico', changedFields: [] });
    } else {
      plans.push({ exerciseId: entry.exerciseId, action: 'UPDATE_PROFILE', reason: 'profile existente diverge do artefato', changedFields: ['limitationProfile'] });
    }
  }

  if (!catalogCountValid) {
    for (const plan of plans) {
      if (plan.action !== 'BLOCKED') Object.assign(plan, { action: 'BLOCKED', reason: `collection tem ${snapshot.size}, esperado ${EXPECTED_CATALOG_COUNT}` });
    }
  }

  const existingProfileCount = snapshot.docs.filter((document) => 'limitationProfile' in document.data()).length;
  const externalCandidateProfiles = artifact.dependencies.remainingExternalActionCandidateIds.map((exerciseId) => ({
    exerciseId,
    exists: existing.has(exerciseId),
    hasLimitationProfile: 'limitationProfile' in (existing.get(exerciseId) ?? {}),
    hasStructurallyCompleteProfile: structurallyCompleteProfile(existing.get(exerciseId)?.limitationProfile),
  }));
  const actionCounts = Object.fromEntries((['CREATE_PROFILE', 'UPDATE_PROFILE', 'UNCHANGED', 'BLOCKED', 'ERROR'] as Action[])
    .map((action) => [action, plans.filter((plan) => plan.action === action).length])) as Record<Action, number>;
  const report = {
    executedAt: new Date().toISOString(),
    mode: confirm ? 'CONFIRM' : 'DRY_RUN',
    projectId,
    datasetVersion: artifact.datasetVersion,
    firestore: {
      collection: 'exercises',
      documentCount: snapshot.size,
      expectedDocumentCount: EXPECTED_CATALOG_COUNT,
      catalogCountValid,
      existingLimitationProfileCount: existingProfileCount,
      nonTargetDocumentCount: snapshot.size - artifact.profiles.length,
      nonTargetDocumentsModified: 0,
    },
    actionCounts,
    plans,
    externalCandidateProfiles,
    externalCandidatesWithoutSufficientProfile: externalCandidateProfiles
      .filter((candidate) => !candidate.hasStructurallyCompleteProfile)
      .map((candidate) => candidate.exerciseId),
    cycles: artifact.dependencies.globalCycles,
    governance: {
      proposedReviewStatus: artifact.governance.reviewStatus,
      reviewBasis: artifact.governance.reviewBasis,
      professionalApprovalClaimed: false,
      note: 'approved + product_policy aprova comportamento conservador do produto, não liberação clínica universal.',
    },
    resolutionPolicy: artifact.resolutionPolicy,
    writeSafety: {
      firestoreWriteExecuted: false,
      deletesExecuted: 0,
      documentReplacementUsed: false,
      onlyFieldPlanned: 'limitationProfile',
    },
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: reportPath, ...report.firestore, actionCounts, remainingExternalActionCandidates: report.externalCandidatesWithoutSufficientProfile.length, cycles: report.cycles.length, cyclesBlocking: artifact.dependencies.cyclesBlocking }, null, 2));

  if (!confirm) {
    console.log('DRY RUN concluído — nenhuma escrita no Firestore.');
    return;
  }
  if (actionCounts.BLOCKED || actionCounts.ERROR) throw new Error('write bloqueado pelo plano inválido');

  const writable = plans.filter((plan) => plan.action === 'CREATE_PROFILE' || plan.action === 'UPDATE_PROFILE');
  const batch = db.batch();
  for (const plan of writable) {
    const profile = artifact.profiles.find((entry) => entry.exerciseId === plan.exerciseId)?.limitationProfile;
    if (!profile) throw new Error(`profile ausente para ${plan.exerciseId}`);
    batch.update(db.collection('exercises').doc(plan.exerciseId), { limitationProfile: profile });
  }
  if (writable.length) await batch.commit();

  const readBackSnapshot = await db.collection('exercises').get();
  const readBackEntries: TechnicalProfileEntry[] = [];
  const readBackErrors: string[] = [];
  let nonProfileFieldsUnchanged = 0;
  for (const document of readBackSnapshot.docs) {
    const after = document.data();
    const before = existing.get(document.id);
    if (before && profilesEqual(withoutLimitationProfile(before), withoutLimitationProfile(after))) {
      nonProfileFieldsUnchanged += 1;
    } else {
      readBackErrors.push(`${document.id}: campo fora de limitationProfile foi alterado`);
    }
    if ('limitationProfile' in after) {
      readBackEntries.push({ exerciseId: document.id, limitationProfile: after.limitationProfile as LimitationProfile });
    }
  }
  const expectedById = new Map(artifact.profiles.map((entry) => [entry.exerciseId, entry.limitationProfile]));
  for (const entry of readBackEntries) {
    const expected = expectedById.get(entry.exerciseId);
    if (!expected) readBackErrors.push(`${entry.exerciseId}: profile inesperado fora do conjunto de 76`);
    else if (!profilesEqual(entry.limitationProfile, expected)) readBackErrors.push(`${entry.exerciseId}: profile diverge semanticamente do artefato`);
  }
  for (const exerciseId of expectedById.keys()) {
    if (!readBackEntries.some((entry) => entry.exerciseId === exerciseId)) readBackErrors.push(`${exerciseId}: profile ausente no read-back`);
  }
  const readBackStatusCounts = statusCountsFor(readBackEntries);
  const approvedCount = readBackEntries.filter((entry) => entry.limitationProfile.reviewStatus === 'approved').length;
  const productPolicyCount = readBackEntries.filter((entry) => entry.limitationProfile.reviewBasis === 'product_policy').length;
  const schemaVersionCount = readBackEntries.filter((entry) => entry.limitationProfile.schemaVersion === 1).length;
  const protocolVersionCount = readBackEntries.filter((entry) => entry.limitationProfile.protocolVersion === 'musculoskeletal-v1').length;
  const sevenRegionCount = readBackEntries.filter((entry) => Object.keys(entry.limitationProfile.regions).length === 7).length;
  if (readBackSnapshot.size !== EXPECTED_CATALOG_COUNT) readBackErrors.push(`read-back documents=${readBackSnapshot.size}`);
  if (readBackEntries.length !== EXPECTED_PROFILE_COUNT) readBackErrors.push(`read-back profiles=${readBackEntries.length}`);
  if (!profilesEqual(readBackStatusCounts, EXPECTED_STATUS_COUNTS)) readBackErrors.push('read-back statusCounts divergente');
  if ([approvedCount, productPolicyCount, schemaVersionCount, protocolVersionCount, sevenRegionCount]
      .some((count) => count !== EXPECTED_PROFILE_COUNT)) readBackErrors.push('read-back de governança/schema/regiões incompleto');
  if (nonProfileFieldsUnchanged !== EXPECTED_CATALOG_COUNT) readBackErrors.push('campos não relacionados não permaneceram idênticos');

  Object.assign(report, {
    readBack: {
      documentCount: readBackSnapshot.size,
      profileCount: readBackEntries.length,
      withoutProfileCount: readBackSnapshot.size - readBackEntries.length,
      pairCount: readBackEntries.length * LIMITATION_REGIONS.length,
      statusCounts: readBackStatusCounts,
      approvedCount,
      productPolicyCount,
      schemaVersionCount,
      protocolVersionCount,
      sevenRegionCount,
      unknownCount: readBackStatusCounts.unknown,
      semanticEqualityCount: readBackEntries.filter((entry) => profilesEqual(entry.limitationProfile, expectedById.get(entry.exerciseId))).length,
      nonProfileFieldsUnchanged,
      errors: readBackErrors,
      valid: readBackErrors.length === 0,
    },
  });
  console.log(`CONFIRM concluído: ${writable.length} campo(s) limitationProfile atualizado(s), 0 deletes.`);
  report.writeSafety.firestoreWriteExecuted = true;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (readBackErrors.length) throw new Error(`read-back falhou:\n- ${readBackErrors.join('\n- ')}`);
}

main().catch((error) => {
  console.error('Falha no seed de limitationProfile:', error);
  process.exit(1);
});
