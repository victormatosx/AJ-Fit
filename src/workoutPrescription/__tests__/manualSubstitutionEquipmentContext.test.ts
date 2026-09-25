import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { PRESCRIPTION_VERSIONS_V127 } from '../types';
import { completeAnswers } from './fixtures';
import {
  isExerciseExecutable,
  manualSubstitutionEquipmentContext,
} from '../equipment';

/**
 * Equipment-inventory follow-up audit: the equipment-inventory question is
 * no longer shown to any user (`onboarding/steps.ts`'s `isApplicableStep`
 * hardcodes `equipment` to never applicable), so a brand-new user's
 * `answers.equipment` is always `[]` — never `undefined`, never populated.
 * Manual substitution used to call `equipmentContextFor` directly, which
 * collapsed that `[]` into a `{'bodyweight'}`-only context, silently
 * rejecting every dumbbell/band/bench candidate for a v1.27 `home` user
 * even though the automatic (limitation-driven) substitution path and
 * cycle-evolution path already treat the full home kit as available via
 * `unrestrictedEquipmentContext`. These tests pin the fixed behavior.
 */
const V127_VERSION = PRESCRIPTION_VERSIONS_V127.templateLibrary;
const LEGACY_VERSION = '2.0.0';

const exerciseById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

function requireExercise(id: string) {
  const exercise = exerciseById.get(id);
  if (!exercise) throw new Error(`fixture exercise missing: ${id}`);
  return exercise;
}

describe('manualSubstitutionEquipmentContext', () => {
  it('a brand-new v1.27 Home user (answers.equipment: []) is NOT collapsed to bodyweight-only — dumbbell/band/bench substitutes stay eligible', () => {
    const newUserAnswers = completeAnswers({ place: 'home', equipment: [] });
    const context = manualSubstitutionEquipmentContext(newUserAnswers, 'home', V127_VERSION);

    // Real catalog substitutes from the manual-substitution table that
    // require non-bodyweight home equipment — these were the ones the bug
    // silently made unreachable.
    expect(isExerciseExecutable(requireExercise('goblet-squat'), context)).toBe(true); // dumbbell
    expect(isExerciseExecutable(requireExercise('bulgarian-split-squat-dumbbell'), context)).toBe(true); // dumbbell + bench
    expect(isExerciseExecutable(requireExercise('resistance-band-shoulder-press'), context)).toBe(true); // resistance_band
    expect(isExerciseExecutable(requireExercise('lateral-band-walk'), context)).toBe(true); // mini_band
    expect(isExerciseExecutable(requireExercise('bent-over-row-smith-machine'), context)).toBe(false); // smith_machine (gym-only) stays excluded
  });

  it('gym-exclusive equipment (machine/cable/smith_machine) remains inelegible at Home even under the v1.27 unrestricted context', () => {
    const newUserAnswers = completeAnswers({ place: 'home', equipment: [] });
    const context = manualSubstitutionEquipmentContext(newUserAnswers, 'home', V127_VERSION);

    expect(isExerciseExecutable(requireExercise('machine-lateral-raise'), context)).toBe(false);
    expect(isExerciseExecutable(requireExercise('cable-biceps-curl'), context)).toBe(false);
    expect(isExerciseExecutable(requireExercise('smith-machine-squat'), context)).toBe(false);
  });

  it('Academia (gym) is unaffected: every exercise stays executable, v1.27 or legacy, regardless of answers.equipment', () => {
    const gymAnswers = completeAnswers({ place: 'gym', equipment: [] });
    const v127Context = manualSubstitutionEquipmentContext(gymAnswers, 'gym', V127_VERSION);
    const legacyContext = manualSubstitutionEquipmentContext(gymAnswers, 'gym', LEGACY_VERSION);

    expect(isExerciseExecutable(requireExercise('machine-lateral-raise'), v127Context)).toBe(true);
    expect(isExerciseExecutable(requireExercise('machine-lateral-raise'), legacyContext)).toBe(true);
  });

  it('a pre-v1.27 (legacy v2) Home program keeps the old answers.equipment-driven behavior unchanged (backward compatibility)', () => {
    const legacyAnswersWithGear = completeAnswers({ place: 'home', equipment: ['bodyweight', 'dumbbells'] });
    const legacyContext = manualSubstitutionEquipmentContext(legacyAnswersWithGear, 'home', LEGACY_VERSION);

    // Declared equipment (dumbbells) is honored...
    expect(isExerciseExecutable(requireExercise('goblet-squat'), legacyContext)).toBe(true);
    // ...but anything not declared (resistance band) is still rejected, exactly
    // like `equipmentContextFor` always behaved for v2.
    expect(isExerciseExecutable(requireExercise('resistance-band-shoulder-press'), legacyContext)).toBe(false);

    // And a legacy user who genuinely never answered (equipment: []) keeps the
    // pre-fix bodyweight-only collapse — this is the documented, intentional
    // v2 behavior the audit explicitly said to preserve, not the bug.
    const legacyNewUserAnswers = completeAnswers({ place: 'home', equipment: [] });
    const legacyNewUserContext = manualSubstitutionEquipmentContext(legacyNewUserAnswers, 'home', LEGACY_VERSION);
    expect(isExerciseExecutable(requireExercise('goblet-squat'), legacyNewUserContext)).toBe(false);
  });

  it('an unknown/missing templateSourceVersion (e.g. undefined) is treated as non-v1.27, preserving the legacy fallback rather than silently unlocking equipment', () => {
    const newUserAnswers = completeAnswers({ place: 'home', equipment: [] });
    const context = manualSubstitutionEquipmentContext(newUserAnswers, 'home', undefined);
    expect(isExerciseExecutable(requireExercise('goblet-squat'), context)).toBe(false);
  });
});
