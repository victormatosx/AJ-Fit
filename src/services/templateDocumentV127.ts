import { getCanonicalTemplateV127ById } from '../workoutPrescription/canonicalCatalog';
import { toWorkoutTemplateDocumentBody, type WorkoutTemplateDocument, type WorkoutTemplateDocumentBody } from '../workoutPrescription/templateDocument';
import { PRESCRIPTION_VERSIONS_V127, type TemplateId } from '../workoutPrescription/types';

/**
 * Fase 10 (cutover) §2 — v1.27 templates are never Firestore documents (they
 * are the bundled local canonical catalog, `canonicalCatalog.ts`), so
 * `prepareWorkoutProgram`'s Firestore-`loadTemplate` ceremony is
 * unnecessary for this library: `getCanonicalTemplateV127ById` resolves
 * synchronously from the already-imported JSON. This module only computes
 * the same `{id, version, sourceVersion, contentHash}` metadata shape
 * `saveAndActivateWorkoutProgram`/`contentIdentityFor` need (see
 * `templateDocument.ts`'s `WorkoutTemplateDocument`), purely locally.
 *
 * `expo-crypto` (not `node:crypto`) on purpose: this file lives under
 * `src/services/`, not `src/workoutPrescription/`, and is deliberately
 * NEVER added to `scripts/syncPrescriptionEngineToFunctions.cjs`'s file
 * list — it is client-only. Cloud Functions still compute v2's contentHash
 * with `node:crypto`'s `createHash('sha256')` (`scripts/seedWorkoutTemplates.ts`);
 * this is the equivalent for a runtime that never has that module.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function localTemplateContentHashV127(body: WorkoutTemplateDocumentBody): Promise<string> {
  const Crypto = await import('expo-crypto');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, stableJson(body));
}

/**
 * Fully local, no Firestore read. Throws the same `UNRESOLVED_CANONICAL_
 * EXERCISE`/`INVALID_CANONICAL_TEMPLATE`/`UNKNOWN_CANONICAL_V127_TEMPLATE`
 * errors as `getCanonicalTemplateV127ById` for a template that still has a
 * blocked exercise identity — callers must only invoke this with a
 * `templateId` a SUCCESSFUL `generateWorkoutPrescriptionV127` call already
 * proved resolves cleanly (it necessarily calls the same loader internally).
 */
export async function localWorkoutTemplateDocumentV127(templateId: TemplateId): Promise<WorkoutTemplateDocument> {
  const template = getCanonicalTemplateV127ById(templateId);
  const body = toWorkoutTemplateDocumentBody(template, PRESCRIPTION_VERSIONS_V127.templateLibrary, 'workout_templates_T001_T102_canonical');
  const contentHash = await localTemplateContentHashV127(body);
  return { ...body, contentHash };
}
