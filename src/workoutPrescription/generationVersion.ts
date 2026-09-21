/**
 * Fase 8-11 — the ONE central point deciding between the legacy
 * v2.0.0/T001-T090 generation pipeline (`engine.ts`) and the v1.27/
 * T001-T102 pipeline (`engineV127.ts`). This exact file is synced verbatim
 * to Cloud Functions (`scripts/syncPrescriptionEngineToFunctions.cjs`),
 * so the client and the backend-authoritative dispatcher
 * (`functions/src/workoutLifecycle/authoritativePrescription.ts`) always
 * agree on the default — never two independently-configured switches.
 *
 * Fase 11 fixed the one remaining P0 that blocked this default from
 * meaning anything end to end: the backend's own authoritative
 * recomputation (`authorizeMutation.ts`'s `generateCanonicalPlan`, ADR-016)
 * used to hardcode v2 regardless of this value — INITIALIZE now consults
 * `resolveActiveGenerationVersion` (via this same module) exactly like the
 * client, and ADAPT/PREPARE/evolution/promotion preserve whichever version
 * the user's ACTIVE program already has (never re-derived from this
 * default), so an existing plan can never silently regress across a
 * mutation. Do not scatter `TEMPLATE_LIBRARY_VERSION === '...'`-style
 * checks anywhere else — every "which pipeline" decision must route
 * through `resolveGenerationVersion`.
 */

export type PrescriptionGenerationVersion = 'v2' | 'v1.27';

/**
 * `override` exists only for tests and other non-production internal
 * tooling — never a remote flag, never `process.env`, never persisted
 * anywhere. No production caller passes it, so every real invocation
 * resolves to the hardcoded default below.
 */
export function resolveGenerationVersion(override?: PrescriptionGenerationVersion): PrescriptionGenerationVersion {
  if (override) return override;
  // The one line a cutover changes. Fase 11: no open P0/P1 remained after
  // the backend-authoritative fix — default flipped to v1.27.
  return 'v1.27';
}

export function isLegacyGenerationVersion(version: PrescriptionGenerationVersion): boolean {
  return version === 'v2';
}
