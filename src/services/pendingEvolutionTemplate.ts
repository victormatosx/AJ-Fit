import { localWorkoutTemplateDocumentV127 } from './templateDocumentV127';
import { loadWorkoutTemplate } from './workoutPrograms';
import type { PendingEvolution } from '../workoutLifecycle/types';
import type { WorkoutTemplateDocument } from '../workoutPrescription/templateDocument';
import { PRESCRIPTION_VERSIONS_V127, type TemplateId } from '../workoutPrescription/types';

/**
 * Resolves the template a Pending Evolution was prepared against from THE
 * SAME source the preparing authority used, chosen by the library version
 * the authority itself sealed onto the Pending
 * (`targetTemplateSourceVersion`) — never by a client-side default.
 *
 * v1.27 templates are the bundled local canonical catalog and are never
 * Firestore documents (see `services/templateDocumentV127.ts`), while
 * `workoutTemplates/*` holds the v2 library (`scripts/seedWorkoutTemplates.ts`
 * seeds `AJ_Fit_T001_T090_workouts_reformed_v2_0.json`). Reading a v1.27
 * Pending's template out of Firestore therefore compared two different
 * libraries: for an id inside T001-T090 the document existed but hashed
 * differently (its body is the 2.0.0 body, not the 1.27.0 one), and for the
 * beginner family T091-T102 no document existed at all. Either way
 * `activatePendingEvolution`'s identity check rejected a Pending the
 * authority had just produced, so no v1.27 evolution could ever be
 * activated — the real end-to-end blocker this resolves.
 *
 * The integrity guarantee is unchanged, only re-pointed at the right
 * catalog: `version` and `contentHash` are still compared, so a template
 * that genuinely changed between PREPARE and ACTIVATE (an app update
 * shipping a different canonical body) still hashes differently and is
 * still rejected, and an id the local catalog cannot resolve — unknown, or
 * carrying a blocked exercise identity — is treated exactly like a missing
 * Firestore document.
 *
 * `activatePendingEvolution` (workoutLifecycleApplication.ts) is the only
 * production caller; it lives in its own module so the routing and the
 * rejection paths stay directly testable without standing up the whole
 * lifecycle orchestrator.
 */
export async function resolvePendingEvolutionTemplate(
  pending: PendingEvolution,
): Promise<WorkoutTemplateDocument | null> {
  if (pending.targetTemplateSourceVersion === PRESCRIPTION_VERSIONS_V127.templateLibrary) {
    try {
      return await localWorkoutTemplateDocumentV127(pending.targetTemplateId as TemplateId);
    } catch {
      // `getCanonicalTemplateV127ById` throws for an unknown template id or
      // one whose exercise identities are still blocked. Both mean "this
      // Pending's content can no longer be resolved", which is precisely
      // what a null (missing) document already means for the v2 path.
      return null;
    }
  }
  // Every other library (v1.3 / v2.0) keeps reading the Firestore template
  // document, byte-for-byte the previous behaviour — including a legacy
  // Pending with no `targetTemplateSourceVersion` recorded at all.
  return loadWorkoutTemplate(pending.targetTemplateId as TemplateId);
}
