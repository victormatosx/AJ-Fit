import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { WORKOUT_TEMPLATES } from '../catalog';
import { V127_TEMPLATE_PROFILES } from '../selectorV127';
import type { EquipmentId } from '../../types/exercise';

/**
 * Fase 9 §11, revisited per the follow-up instruction: the questionnaire
 * does not collect an equipment inventory at all — the product rule is
 * simply `gym -> gym template`, `home -> home template`, so every `home`
 * template must be executable at home BY DEFINITION (no inventory-gating
 * modifier is appropriate or wanted; see Fase 9 report §G blocker #1's
 * correction).
 *
 * "Executable at home" here means: no exercise tagged with a fixed
 * gym-only equipment class (`machine`, `smith_machine`, `hack_machine`,
 * `leg_press`, `roman_chair`, `cable`). `dumbbell`/`barbell`/`bench`/
 * `resistance_band`/`mini_band`/`chair`/`step`/`ez_bar` are all common,
 * plausible home equipment and are not flagged.
 *
 * Fix applied at the canonical source (docs/workouts/
 * AJ_Fit_T001_T102_workouts_canonical_v1_27_goal_routing_fixed.json), not
 * the runtime: the 27 Home templates that authored `panturrilha-em-pe`
 * (-> `standing-calf-raise-machine`, equipment: machine) now author
 * `panturrilha-com-apoio` (-> `supported-calf-raise`, equipment:
 * bodyweight) instead — the semantically equivalent, already-cataloged
 * home variant of the same exercise (same primary muscle, same movement
 * pattern family). Gym templates keep `panturrilha-em-pe` unchanged (51
 * usages, untouched).
 */
const exerciseById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
const GYM_ONLY_EQUIPMENT: readonly EquipmentId[] = ['machine', 'smith_machine', 'hack_machine', 'leg_press', 'roman_chair', 'cable'];

function gymOnlyEquipmentByTemplate(templateId: (typeof V127_TEMPLATE_PROFILES)[number]['id']) {
  const template = getCanonicalTemplateV127ById(templateId);
  const found = new Set<string>();
  for (const session of template.sessions) {
    for (const exercise of session.exercises) {
      const seed = exerciseById.get(exercise.exercise_id);
      if (!seed) continue; // cardio/mobility activity — no equipment concept
      for (const item of seed.equipment) if ((GYM_ONLY_EQUIPMENT as readonly string[]).includes(item)) found.add(item);
    }
  }
  return found;
}

describe('Fase 9 §11 — Home templates are executable at home by definition (fixed at the canonical source)', () => {
  const homeProfiles = V127_TEMPLATE_PROFILES.filter((profile) => profile.environment === 'home');

  it('51 v1.27 Home templates exist', () => {
    expect(homeProfiles).toHaveLength(51);
  });

  it('no v1.27 Home template contains a gym-exclusive-equipment exercise anymore (regression proof)', () => {
    const offenders = homeProfiles
      .map((profile) => ({ id: profile.id, equipment: [...gymOnlyEquipmentByTemplate(profile.id)] }))
      .filter((entry) => entry.equipment.length > 0);
    expect(offenders).toEqual([]);
  });

  it('panturrilha-com-apoio (supported-calf-raise, bodyweight) replaced panturrilha-em-pe in exactly the 27 previously affected Home templates', () => {
    const KNOWN_AFFECTED = [
      'T009', 'T010', 'T011', 'T012', 'T021', 'T022', 'T023', 'T024', 'T033', 'T034', 'T035', 'T036',
      'T044', 'T045', 'T046', 'T047', 'T048', 'T057', 'T058', 'T059', 'T060', 'T069', 'T070', 'T071', 'T072', 'T078', 'T084',
    ] as const;
    for (const id of KNOWN_AFFECTED) {
      const template = getCanonicalTemplateV127ById(id);
      const exerciseIds = template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exercise_id));
      expect(exerciseIds).not.toContain('standing-calf-raise-machine');
      expect(exerciseIds).toContain('supported-calf-raise');
    }
  });

  it('gym templates keep the machine variant unchanged (51 usages of standing-calf-raise-machine remain in gym templates)', () => {
    const gymProfiles = V127_TEMPLATE_PROFILES.filter((profile) => profile.environment === 'gym');
    let usages = 0;
    for (const profile of gymProfiles) {
      const template = getCanonicalTemplateV127ById(profile.id);
      for (const session of template.sessions) {
        for (const exercise of session.exercises) {
          if (exercise.exercise_id === 'standing-calf-raise-machine') usages += 1;
        }
      }
    }
    expect(usages).toBe(51);
  });

  it('v2 baseline: never placed a gym-exclusive-equipment exercise in any of its 45 Home templates either', () => {
    const homeV2 = WORKOUT_TEMPLATES.filter((template) => template.profile.environment === 'home');
    expect(homeV2).toHaveLength(45);
    let offenderUsages = 0;
    for (const template of homeV2) {
      for (const session of template.sessions) {
        for (const exercise of session.exercises) {
          const seed = exerciseById.get(exercise.exercise_id);
          if (seed && (GYM_ONLY_EQUIPMENT as readonly string[]).some((item) => seed.equipment.includes(item as EquipmentId))) offenderUsages += 1;
        }
      }
    }
    expect(offenderUsages).toBe(0);
  });
});
