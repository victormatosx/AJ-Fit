import type { Firestore } from 'firebase-admin/firestore';
import { EXERCISES_SEED } from '../prescriptionEngine/data/exercisesSeedData';

import { TEMPLATE_LIBRARY_ID,WORKOUT_TEMPLATES } from '../prescriptionEngine/workoutPrescription/catalog';
import { toWorkoutTemplateDocumentBody } from '../prescriptionEngine/workoutPrescription/templateDocument';
import { PRESCRIPTION_VERSIONS } from '../prescriptionEngine/workoutPrescription/types';

/**
 * Seeds the real, bundled prescription catalog (the full resistance-exercise catalog, the full
 * T001-T090 template library, and a matching limitation-dataset identity)
 * into the Firestore Emulator's global collections, so integration tests
 * exercise the actual backend canonical-generation path
 * (`authorizeMutation.ts`'s `generateCanonicalPlan`) against real data
 * instead of synthetic 2-exercise fixtures (docs/workout-lifecycle/v2/
 * decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md). Idempotent and
 * global (not user-scoped) — call once per test file, in `beforeAll`.
 */
export async function seedRealPrescriptionCatalog(db: Firestore): Promise<void> {
  const local = { exercises: EXERCISES_SEED };

  const exerciseBatch = db.batch();
  for (const exercise of local.exercises) {
    // Firestore rejects `undefined` field values; exercises without a
    // limitation profile carry `limitationProfile: undefined` here.

    exerciseBatch.set(
      db.collection('exercises').doc(exercise.id),
      exercise,
    );
  }
  await exerciseBatch.commit();

  const templateBatch = db.batch();
  for (const template of WORKOUT_TEMPLATES) {
    const body = toWorkoutTemplateDocumentBody(template, PRESCRIPTION_VERSIONS.templateLibrary, TEMPLATE_LIBRARY_ID);
    templateBatch.set(db.collection('workoutTemplates').doc(template.id), {
      ...body,
      // `isTemplateDocument` only requires a well-formed 64-char hex string,
      // not equality to any specific value — a real seed script would
      // derive this from the template body, which is out of scope here.
      contentHash: 'a'.repeat(64),
    });
  }
  await templateBatch.commit();
}
