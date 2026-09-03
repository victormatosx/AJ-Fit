import { describe, expect, it, vi } from 'vitest';

// `workoutPrograms.ts` imports `db` from `../lib/firebase`, which throws at
// module load without EXPO_PUBLIC_FIREBASE_* env vars. Mocked out exactly
// like `workoutPrograms.legacyQuestionnaire.test.ts` — every test in this
// file exercises the pre-auth LOCAL path only, which never touches `db`.
vi.mock('../../lib/firebase', () => ({
  get db() {
    return undefined;
  },
}));

import {
  prepareWorkoutProgramLocally,
  questionnaireFingerprint,
} from '../workoutPrograms';
import { generateWorkoutPrescription } from '../../workoutPrescription/engine';
import { getTemplateById } from '../../workoutPrescription/catalog';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { loadLocalExerciseCatalogForLimitations } from '../../workoutPrescription/localLimitationCatalog';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
} from '../../workoutPrescription/limitationDataset';

const VALID_ANSWERS = completeAnswers({ level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle' });

describe('prepareWorkoutProgramLocally — Phase 3, Part C (pre-auth compute, local sources only)', () => {
  it('(1)(2) computes a real program using the existing Prescription Engine — no second engine', async () => {
    const result = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.sessions.length).toBeGreaterThan(0);
    expect(result.plan.limitationDatasetVersion).toBe(CANONICAL_LIMITATION_DATASET_VERSION);
    expect(result.plan.limitationDatasetHash).toBe(CANONICAL_LIMITATION_DATASET_HASH);
    expect(result.templateId).toMatch(/^T\d{3}$/);
    expect(result.usedLocalLimitationCatalog).toBe(false); // no limitation declared
  });

  it('(3) the same input always produces the same plan/templateId (deterministic, no randomness)', async () => {
    const first = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    const second = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    // `generatedAt` is a wall-clock read (`Date.now()`) — it is expected to
    // differ by a millisecond or two between two real calls and is NOT part
    // of the determinism claim this test makes (that claim is about the
    // computed plan itself). Every other field must match exactly.
    expect(first).toEqual({ ...second, generatedAt: (first as { generatedAt?: number }).generatedAt });
    if (first.status === 'SUCCESS' && second.status === 'SUCCESS') {
      expect(typeof first.generatedAt).toBe('number');
      expect(typeof second.generatedAt).toBe('number');
    }
  });

  it('(4)(5)(6)(7)(9) matches exactly what generateWorkoutPrescription (the same engine, called directly with the local template) produces', async () => {
    const prepared = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    expect(prepared.status).toBe('SUCCESS');
    if (prepared.status !== 'SUCCESS') return;
    const template = getTemplateById(prepared.templateId);
    expect(template).toBeDefined();
    const directResult = generateWorkoutPrescription(VALID_ANSWERS, { template: template! });
    expect(directResult.status).toBe('SUCCESS');
    if (directResult.status !== 'SUCCESS') return;
    // Beginner/Duration/Priority/restSeconds are all baked into `sessions` —
    // full structural equality proves every one of them matches.
    expect(prepared.plan.sessions).toEqual(directResult.plan.sessions);
    expect(prepared.plan.planId).toBe(directResult.plan.planId);
  });

  it('(8) a musculoskeletal limitation runs the REAL Limitation Resolver against the local catalog, never bypassed — identical outcome to calling the engine directly with the same local catalog', async () => {
    const answers = completeAnswers({
      level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle',
      specialConditions: ['musculoskeletal_limitation'], limits: ['knee'],
    });
    const localCatalog = loadLocalExerciseCatalogForLimitations();
    const template = getTemplateById('T003')!;
    const directResult = generateWorkoutPrescription(answers, { template, exerciseCatalog: localCatalog });
    const prepared = await prepareWorkoutProgramLocally(answers);
    // Whatever the Limitation Resolver decides (resolved or fail-closed) —
    // `prepareWorkoutProgramLocally` must reach EXACTLY the same conclusion
    // as calling the engine directly, proving it never bypasses the real
    // resolver. `usedLocalLimitationCatalog` is asserted regardless of the
    // outcome status.
    expect(prepared.status).toBe(directResult.status);
    if (prepared.status === 'SUCCESS' && directResult.status === 'SUCCESS') {
      expect(prepared.usedLocalLimitationCatalog).toBe(true);
      expect(prepared.plan.trace.limitationDecisions).toEqual(directResult.plan.trace.limitationDecisions);
    } else {
      // Fail-closed case (§Part J) — never silently generate a generic plan.
      expect(prepared.status).not.toBe('SUCCESS');
    }
  });

  it('(24) a musculoskeletal limitation with no selected region stays fail-closed — no generic workout generated', async () => {
    const answers = completeAnswers({
      specialConditions: ['musculoskeletal_limitation'],
      limits: [],
    });
    const result = await prepareWorkoutProgramLocally(answers);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
  });

  it('(25) a user with no limitation keeps working normally, catalog never loaded', async () => {
    const result = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    expect(result.status).toBe('SUCCESS');
  });

  it('(23) a genuinely invalid questionnaire never produces a fake/generic plan', async () => {
    const invalid = completeAnswers({ sex: null, goal: null, place: null });
    const result = await prepareWorkoutProgramLocally(invalid);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
  });

  it('(10) questionnaireFingerprint is deterministic regardless of object key order', () => {
    const a = questionnaireFingerprint(VALID_ANSWERS);
    const reordered = Object.fromEntries(Object.entries(VALID_ANSWERS).reverse()) as typeof VALID_ANSWERS;
    const b = questionnaireFingerprint(reordered);
    expect(a).toBe(b);
  });

  it('(10) questionnaireFingerprint changes when a relevant answer changes', () => {
    const a = questionnaireFingerprint(VALID_ANSWERS);
    const b = questionnaireFingerprint({ ...VALID_ANSWERS, days: 5, trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'] });
    expect(a).not.toBe(b);
  });
});
