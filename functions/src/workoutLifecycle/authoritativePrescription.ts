import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { buildPrescriptionGenerationContext } from './prescriptionContext';
import { localWorkoutTemplateDocumentV127 } from './templateDocumentV127';
import { generateWorkoutPrescriptionRouted, resolveActiveGenerationVersion } from './prescriptionEngine/workoutPrescription/generatePrescription';
import { PRESCRIPTION_VERSIONS_V127, type FinalWorkoutPlan, type QuestionnaireAnswers } from './prescriptionEngine/workoutPrescription/types';
import type { PrescriptionGenerationVersion } from './prescriptionEngine/workoutPrescription/generationVersion';
import type { CurrentTrainingLevel } from './prescriptionEngine/workoutLifecycle/types';

/**
 * Fase 11 (backend cutover) — the ONE authoritative dispatcher on the
 * backend. Mirrors `src/services/workoutPrograms.ts`'s
 * `prepareWorkoutProgramForActiveGeneration` exactly: v2 needs a Firestore
 * template pre-loaded before the (synchronous) engine call, v1.27 needs
 * none. Both branches funnel through `generateWorkoutPrescriptionRouted`
 * (`generatePrescription.ts`, the SAME file synced to both the client and
 * this backend — not a re-implementation), forcing the caller-resolved
 * `version` explicitly so no independent decision happens inside the
 * engine call itself.
 *
 * `version`/`currentTrainingLevel` are REQUIRED, caller-resolved
 * parameters — this function never calls `resolveActiveGenerationVersion`
 * itself for anything other than the one case where there is no existing
 * lifecycle/plan metadata to preserve (`resolveAuthoritativeGenerationVersionForNewLifecycle`,
 * used only by INITIALIZE). Every other operation (ADAPT, PREPARE/
 * LEVEL_PROMOTION, MIGRATE) must derive `version` from authoritative
 * Firestore-read metadata (the active program's `templateSourceVersion`,
 * or the hardcoded legacy-only `'v2'` for MIGRATE) — see
 * `authorizeMutation.ts`'s call sites, never from client input.
 */
export interface AuthoritativePlanResult {
  plan: FinalWorkoutPlan;
  templateMetadata: { version: number; sourceVersion: string; contentHash: string };
}

export async function generateAuthoritativePlan(
  answers: QuestionnaireAnswers,
  currentTrainingLevel: CurrentTrainingLevel,
  version: PrescriptionGenerationVersion,
  firestore: Firestore,
): Promise<AuthoritativePlanResult> {
  if (version === 'v1.27') {
    const result = generateWorkoutPrescriptionRouted(answers, currentTrainingLevel, {}, 'v1.27');
    if (result.status !== 'SUCCESS') {
      throw new HttpsError('failed-precondition', `authoritative_prescription_generation_failed:${result.status}`);
    }
    // Same Admin-SDK-write-safe `undefined`-stripping `generateCanonicalPlan`
    // already applied to the v2 result — sealing writes this straight into
    // Firestore, which rejects literal `undefined`.
    const plan = JSON.parse(JSON.stringify(result.plan)) as FinalWorkoutPlan;
    // `result.plan.templateId` is proven resolvable — `generateWorkoutPrescriptionV127`
    // only ever reaches `SUCCESS` after `getCanonicalTemplateV127ById` (the
    // same loader this call reuses) already resolved it once.
    const templateMetadata = localWorkoutTemplateDocumentV127(result.plan.templateId);
    return {
      plan,
      templateMetadata: {
        version: templateMetadata.version,
        sourceVersion: templateMetadata.sourceVersion,
        contentHash: templateMetadata.contentHash,
      },
    };
  }
  const { context, templateMetadata } = await buildPrescriptionGenerationContext(firestore, answers);
  const result = generateWorkoutPrescriptionRouted(answers, currentTrainingLevel, context, 'v2');
  if (result.status !== 'SUCCESS') {
    throw new HttpsError('failed-precondition', `authoritative_prescription_generation_failed:${result.status}`);
  }
  const plan = JSON.parse(JSON.stringify(result.plan)) as FinalWorkoutPlan;
  return { plan, templateMetadata };
}

/**
 * INITIALIZE only (rule §3: "INITIALIZE de nova geração usa a versão ativa
 * central") — no lifecycle/plan exists yet for a brand-new user, so there
 * is nothing authoritative to preserve; the central default decides, the
 * exact same `resolveGenerationVersion` the client's own first-generation
 * path (`generateAndPersistWorkoutProgram`) consults.
 */
export function resolveAuthoritativeGenerationVersionForNewLifecycle(): PrescriptionGenerationVersion {
  return resolveActiveGenerationVersion();
}

/**
 * ADAPT / PREPARE (rule §4: preserve the version of the corresponding
 * cycle/plan, never an implicit transition). `templateSourceVersion` is
 * authoritative Firestore data (`bundle.program`, read server-side by
 * `activeBundle`) — never anything the client's request carries.
 */
export function authoritativeGenerationVersionForActiveProgram(templateSourceVersion: unknown): PrescriptionGenerationVersion {
  return templateSourceVersion === PRESCRIPTION_VERSIONS_V127.templateLibrary ? 'v1.27' : 'v2';
}
