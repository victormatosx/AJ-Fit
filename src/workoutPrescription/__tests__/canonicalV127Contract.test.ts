import { describe, expect, it } from 'vitest';
import canonical from '../../../docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_33_peck_deck_runtime_id_fixed.json';
import { catalogInvariantErrors, TEMPLATE_LIBRARY_VERSION, WORKOUT_TEMPLATES } from '../catalog';

describe('future canonical v1.27 artifact', () => {
  it('has the complete, unique T001–T102 identity while runtime stays on v2', () => {
    expect(canonical.schema_version).toBe('1.33.0');
    const ids = canonical.workouts.map((workout) => workout.id);
    const expected = Array.from({ length: 102 }, (_, index) => `T${String(index + 1).padStart(3, '0')}`);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(102);
    expect(TEMPLATE_LIBRARY_VERSION).toBe('2.0.0');
    expect(WORKOUT_TEMPLATES).toHaveLength(90);
  });

  it('declares the eight families and each matching template profile', () => {
    const groups = [
      [1, 24, 'hypertrophy_body_composition'],
      [25, 48, 'strength'],
      [49, 72, 'conditioning'],
      [73, 78, 'pregnancy_fitness'],
      [79, 84, 'postpartum_return'],
      [85, 90, 'frailty_function'],
      [91, 96, 'beginner_adaptation'],
      [97, 102, 'beginner_adaptation'],
    ] as const;
    expect(Object.keys(canonical.families)).toHaveLength(11);
    expect(canonical.families['T001-T012']).toContain('Hipertrofia/Composição');
    expect(canonical.families['T013-T024']).toContain('Hipertrofia/Composição');
    expect(canonical.families['T025-T036']).toContain('Força');
    expect(canonical.families['T037-T048']).toContain('Força');
    expect(canonical.families['T049-T060']).toContain('Condicionamento');
    expect(canonical.families['T061-T072']).toContain('Condicionamento');
    expect(canonical.families['T073-T078']).toContain('Gestação');
    expect(canonical.families['T079-T084']).toContain('Pós-parto');
    expect(canonical.families['T085-T090']).toContain('Fragilidade');
    for (const [first, last, goal] of groups) {
      const members = canonical.workouts.slice(first - 1, last);
      expect(members).toHaveLength(last - first + 1);
      expect(members.every((workout) => workout.profile.primary_goal === goal)).toBe(true);
      if (first === 91 || first === 97) {
        expect(members.every((workout) => workout.profile.environment === (first === 91 ? 'gym' : 'home'))).toBe(true);
      }
    }
    expect(canonical.families['T091-T096']).toContain('Iniciante · Academia');
    expect(canonical.families['T097-T102']).toContain('Iniciante · Casa');
  });

  it('routes goal only to family and declares exactly two training modifiers', () => {
    const routing = canonical.design_notes.goal_routing;
    expect(routing.type).toBe('template_family_selection');
    expect(routing.rule).toEqual({
      hipertrofia: 'hypertrophy_composition',
      forca: 'strength',
      condicionamento: 'conditioning',
      default: 'hypertrophy_composition',
    });
    expect(routing.family_mapping).toEqual({
      hypertrophy_composition: 'T001-T024', strength: 'T025-T048', conditioning: 'T049-T072',
    });
    expect(routing.behavior).toContain('Objetivo participa somente da seleção da família do template.');
    expect(routing.behavior).toContain('Objetivo não modifica internamente um template depois que ele foi selecionado.');
    expect(canonical.design_notes.modifier_model_summary.actual_training_modifiers)
      .toEqual(['musculoskeletal_limitation', 'muscle_priority']);
  });

  it('does not retain the obsolete rationale', () => {
    expect(canonical.workouts.some((workout) => /dieta, cardio e volume são modificadores/i.test(workout.rationale))).toBe(false);
  });

  it('every session declares a type — a missing type crashes weeklySchedule.ts at runtime', () => {
    const sessionsMissingType = canonical.workouts.flatMap((workout) => workout.sessions
      .filter((session) => !('type' in session) || !session.type)
      .map((session) => `${workout.id}/${session.name}`));
    expect(sessionsMissingType).toEqual([]);
  });

  it('allows structurally valid future IDs and schema in the generic validator', () => {
    const sample = { ...WORKOUT_TEMPLATES[0], id: 'T091' as const };
    expect(catalogInvariantErrors({
      schema_version: '1.27.0', library: 'future-test', workouts: [sample],
    })).toEqual([]);
    expect(catalogInvariantErrors({
      schema_version: '1.27.0', library: 'future-test', workouts: [sample, sample],
    })).toContain('DUPLICATE_TEMPLATE_ID');
  });
});
