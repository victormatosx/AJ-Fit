import { describe,expect,it } from 'vitest';

import { isRequestedSubstitutionEligible } from '../exerciseSubstitution';
import { EXERCISES_SEED } from '../prescriptionEngine/data/exercisesSeedData';
import { defaultQuiz,type Quiz } from '../prescriptionEngine/state/AppState';
import { equipmentContextFor } from '../prescriptionEngine/workoutPrescription/equipment';
import type { CatalogExercise } from '../prescriptionEngine/workoutPrescription/exerciseCatalog';

/**
 * Unit tests for the PURE decision core of the manual-substitution server
 * authority — `isRequestedSubstitutionEligible`. The Firestore-orchestrating
 * `applyExerciseSubstitutionHandler` itself needs the Firestore emulator to
 * exercise end-to-end (transaction semantics, auth, doc reads); this suite
 * covers the part that can never be trusted to the client: given a fixed
 * anchor/catalog/context, is the requested id actually eligible.
 */

const catalog = new Map<string, CatalogExercise>(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

function gymEquipmentContext() {
  const answers: Quiz = { ...defaultQuiz, place: 'gym', specialConditions: ['none'] };
  return equipmentContextFor(answers, 'gym');
}

function homeEquipmentContext(equipment: string[]) {
  const answers: Quiz = { ...defaultQuiz, place: 'home', equipment, specialConditions: ['none'] };
  return equipmentContextFor(answers, 'home');
}

describe('isRequestedSubstitutionEligible', () => {
  it('legacy accepts a real eligible candidate (barbell-back-squat -> bodyweight-squat at home)', () => {
    const eligible = isRequestedSubstitutionEligible({
      anchorExerciseId: 'barbell-back-squat',
      requestedExerciseId: 'bodyweight-squat',
      catalog,
      equipmentContext: homeEquipmentContext(['bodyweight']),
      effectiveExerciseIdsInSession: new Set(),
    });
    expect(eligible).toBe(true);
  });

  it('rejects a candidate not executable with the current equipment context', () => {
    const eligible = isRequestedSubstitutionEligible({
      anchorExerciseId: 'barbell-back-squat',
      requestedExerciseId: 'hack-squat-machine-variation',
      catalog,
      equipmentContext: homeEquipmentContext(['bodyweight']),
      effectiveExerciseIdsInSession: new Set(),
    });
    expect(eligible).toBe(false);
  });

  it('rejects a candidate already effectively present in another slot of the session', () => {
    const eligible = isRequestedSubstitutionEligible({
      anchorExerciseId: 'barbell-back-squat',
      requestedExerciseId: 'smith-machine-squat',
      catalog,
      equipmentContext: gymEquipmentContext(),
      effectiveExerciseIdsInSession: new Set(['smith-machine-squat']),
    });
    expect(eligible).toBe(false);
  });

  it('legacy rejects a mechanic-mismatched candidate reachable only via similarExerciseIds (hip-thrust -> cable-glute-kickback)', () => {
    const eligible = isRequestedSubstitutionEligible({
      anchorExerciseId: 'hip-thrust',
      requestedExerciseId: 'cable-glute-kickback',
      catalog,
      equipmentContext: gymEquipmentContext(),
      effectiveExerciseIdsInSession: new Set(),
    });
    expect(eligible).toBe(false);
  });

  it('rejects a request for an unknown anchor exercise id', () => {
    const eligible = isRequestedSubstitutionEligible({
      anchorExerciseId: 'does-not-exist',
      requestedExerciseId: 'bodyweight-squat',
      catalog,
      equipmentContext: gymEquipmentContext(),
      effectiveExerciseIdsInSession: new Set(),
    });
    expect(eligible).toBe(false);
  });

  it('rejects a request for an unknown requested exercise id', () => {
    const eligible = isRequestedSubstitutionEligible({
      anchorExerciseId: 'barbell-back-squat',
      requestedExerciseId: 'does-not-exist',
      catalog,
      equipmentContext: gymEquipmentContext(),
      effectiveExerciseIdsInSession: new Set(),
    });
    expect(eligible).toBe(false);
  });

  describe('reverting to the anchor ("voltar ao original")', () => {
    it('accepts reverting when the anchor is still safe/executable and not duplicated elsewhere', () => {
      const eligible = isRequestedSubstitutionEligible({
        anchorExerciseId: 'barbell-back-squat',
        requestedExerciseId: 'barbell-back-squat',
        catalog,
        equipmentContext: gymEquipmentContext(),
        effectiveExerciseIdsInSession: new Set(),
      });
      expect(eligible).toBe(true);
    });

    it('rejects reverting when the anchor is no longer equipment-executable', () => {
      const eligible = isRequestedSubstitutionEligible({
        anchorExerciseId: 'barbell-back-squat',
        requestedExerciseId: 'barbell-back-squat',
        catalog,
        equipmentContext: homeEquipmentContext(['bodyweight']),
        effectiveExerciseIdsInSession: new Set(),
      });
      expect(eligible).toBe(false);
    });

    it('rejects reverting when the anchor is already effectively present in another slot', () => {
      const eligible = isRequestedSubstitutionEligible({
        anchorExerciseId: 'barbell-back-squat',
        requestedExerciseId: 'barbell-back-squat',
        catalog,
        equipmentContext: gymEquipmentContext(),
        effectiveExerciseIdsInSession: new Set(['barbell-back-squat']),
      });
      expect(eligible).toBe(false);
    });
  });
});
