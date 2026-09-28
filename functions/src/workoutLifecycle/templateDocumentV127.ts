import { createHash } from 'node:crypto';

import { getCanonicalTemplateV127ById } from './prescriptionEngine/workoutPrescription/canonicalCatalog';
import { toWorkoutTemplateDocumentBody, type WorkoutTemplateDocument, type WorkoutTemplateDocumentBody } from './prescriptionEngine/workoutPrescription/templateDocument';
import { PRESCRIPTION_VERSIONS_V127, type TemplateId } from './prescriptionEngine/workoutPrescription/types';

/**
 * Fase 11 (backend cutover) — backend mirror of `src/services/
 * templateDocumentV127.ts`. v1.27 templates are never Firestore documents
 * (bundled local canonical catalog only), so there is nothing to load here
 * — only the same `{id, version, sourceVersion, contentHash}` metadata
 * shape `sealTargetProgram`/`contentIdentityFor` need, computed purely
 * locally with `node:crypto` (this runtime always has it; the client uses
 * `expo-crypto` instead — see that file's doc comment). `stableJson` is
 * copied verbatim (byte-for-byte, same sorted-key algorithm) from the
 * client module so the SAME template content hashes to the SAME
 * `contentHash` on both sides — this is exactly what Fase 11's client/
 * backend `planId`/`contentIdentity` parity requirement depends on.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function localTemplateContentHashV127(body: WorkoutTemplateDocumentBody): string {
  return createHash('sha256').update(stableJson(body)).digest('hex');
}

/**
 * Throws the same `UNRESOLVED_CANONICAL_EXERCISE`/`INVALID_CANONICAL_TEMPLATE`/
 * `UNKNOWN_CANONICAL_V127_TEMPLATE` errors as `getCanonicalTemplateV127ById`
 * for a template whose authored exercises still reference a blocked
 * identity — callers must only invoke this with a `templateId` a
 * SUCCESSFUL `generateWorkoutPrescriptionV127` call already proved
 * resolves cleanly (it necessarily calls the same loader internally).
 */
export function localWorkoutTemplateDocumentV127(templateId: TemplateId): WorkoutTemplateDocument {
  const template = getCanonicalTemplateV127ById(templateId);
  const body = toWorkoutTemplateDocumentBody(template, PRESCRIPTION_VERSIONS_V127.templateLibrary, 'workout_templates_T001_T102_canonical');
  return { ...body, contentHash: localTemplateContentHashV127(body) };
}
