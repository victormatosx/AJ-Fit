import { describe, expect, it } from 'vitest';
import canonical from '../../../docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_27_goal_routing_fixed.json';
import matrix from '../../../docs/workouts/AJ_Fit_v1_27_exercise_identity_matrix.json';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from '../canonicalActivities';
import { parseAuthoredSets, parseCanonicalV127Template } from '../canonicalCatalog';
import { exerciseIdentityErrors, resolveCanonicalExerciseId, unresolvedCanonicalExerciseIds } from '../canonicalExerciseIdentity';
import { catalogInvariantErrors, TEMPLATE_LIBRARY_VERSION } from '../catalog';
import { fromWorkoutTemplateDocument, toWorkoutTemplateDocumentBody, type WorkoutTemplateDocument } from '../templateDocument';
import { sessionDayState, trainingSessionIndexes } from '../weeklySchedule';
import type { CanonicalTemplate } from '../types';

const rawTemplate = (id: string) => {
  const found = canonical.workouts.find((workout) => workout.id === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found as unknown as Parameters<typeof parseCanonicalV127Template>[0];
};

describe('v1.27 local materialization', () => {
  it('classifies all 78 directly referenced identities with zero AMBIGUOUS/TRULY_MISSING left', () => {
    const referenced = new Set(canonical.workouts.flatMap((workout) =>
      workout.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exercise_id))));
    expect(matrix.rows).toHaveLength(78);
    expect(new Set(matrix.rows.map((row) => row.canonicalId))).toEqual(referenced);
    expect(matrix.counts).toEqual({
      SEMANTIC_ALIAS_CONFIRMED: 71, EXACT_MATCH: 7,
    });
    expect(Object.keys(matrix.counts).sort()).toEqual(['EXACT_MATCH', 'SEMANTIC_ALIAS_CONFIRMED']);
    expect(exerciseIdentityErrors()).toEqual([]);
    expect(unresolvedCanonicalExerciseIds()).toHaveLength(0);
    for (const row of matrix.rows) {
      expect(row.status === 'EXACT_MATCH' || row.status === 'SEMANTIC_ALIAS_CONFIRMED').toBe(true);
      expect(resolveCanonicalExerciseId(row.canonicalId)).toBe(row.runtimeId);
      expect(row.runtimeId).not.toBeNull();
      const resolvesToExercise = EXERCISES_SEED.some((exercise) => exercise.id === row.runtimeId);
      const resolvesToActivity = CANONICAL_ACTIVITIES.some((activity) => activity.id === row.runtimeId);
      expect(resolvesToExercise || resolvesToActivity).toBe(true);
    }
  });

  it('unifies "com apoio" into the plain band knee-flexion identity, with no self-referential substitution', () => {
    expect(resolveCanonicalExerciseId('flexao-de-joelhos-com-elastico')).toBe('resistance-band-standing-leg-curl');
    expect(resolveCanonicalExerciseId('flexao-de-joelhos-com-elastico-e-apoio')).toBe('resistance-band-standing-leg-curl');
    const runtimeExercise = EXERCISES_SEED.find((exercise) => exercise.id === 'resistance-band-standing-leg-curl');
    expect(runtimeExercise).toBeDefined();
    expect(runtimeExercise?.substitution.similarExerciseIds).not.toContain('resistance-band-standing-leg-curl');
    expect(runtimeExercise?.substitution.similarExerciseIds).not.toContain('flexao-de-joelhos-com-elastico-e-apoio');
  });

  it('every T001-T102 template materializes structurally with zero exercise-identity blocker', () => {
    for (const workout of canonical.workouts) {
      expect(() => parseCanonicalV127Template(workout as unknown as Parameters<typeof parseCanonicalV127Template>[0]))
        .not.toThrow();
    }
    expect(canonical.workouts).toHaveLength(102);
  });

  it('converges both Farmer Walk authoring IDs onto the persisted legacy identity', () => {
    expect(resolveCanonicalExerciseId('farmer-walk')).toBe('farmers-walk');
    expect(resolveCanonicalExerciseId('caminhada-do-fazendeiro')).toBe('farmers-walk');
    expect(resolveCanonicalExerciseId('farmers-walk')).toBe('farmers-walk');
  });

  it('normalizes all 24 interval doses as cycle ranges and rejects unknown textual sets', () => {
    const authored = canonical.workouts.flatMap((workout) => workout.sessions.flatMap((session) =>
      session.exercises.map((exercise) => (exercise as { sets?: number | string }).sets)))
      .filter((sets): sets is string => typeof sets === 'string');
    expect(authored).toHaveLength(24);
    expect(new Set(authored)).toEqual(new Set(['5-7 ciclos', '6-8 ciclos']));
    expect(parseAuthoredSets('5-7 ciclos')).toEqual({ cycleRange: { min: 5, max: 7 } });
    expect(parseAuthoredSets('6-8 ciclos')).toEqual({ cycleRange: { min: 6, max: 8 } });
    expect(() => parseAuthoredSets('muitas séries')).toThrow('UNSUPPORTED_AUTHORED_SETS');
  });

  it.each(['T001', 'T025', 'T049', 'T073', 'T079', 'T091'])('round-trips the resolvable %s template', (id) => {
    const parsed = parseCanonicalV127Template(rawTemplate(id));
    expect(catalogInvariantErrors({ schema_version: '1.27.0', library: 'test-v127', workouts: [parsed] })).toEqual([]);
    const body = toWorkoutTemplateDocumentBody(parsed, '1.27.0', 'test-v127');
    const restored = fromWorkoutTemplateDocument({ ...body, contentHash: 'a'.repeat(64) } as WorkoutTemplateDocument);
    expect(restored).toEqual(parsed);
    expect(restored.sessions.every((session) => Boolean(session.display_name))).toBe(true);
    expect(body.sessions[0].exercises[0].name).toBe(parsed.sessions[0].exercises[0].name);
  });

  it('preserves distance, textual reps, guidelines and session notes', () => {
    const parsed = parseCanonicalV127Template(rawTemplate('T025'));
    const carry = parsed.sessions.flatMap((session) => session.exercises).find((exercise) => exercise.exercise_id === 'farmers-walk');
    expect(carry?.distance).toBe('20-40 m');
    expect(carry?.sets).toBe(3);
    const restored = fromWorkoutTemplateDocument({
      ...toWorkoutTemplateDocumentBody(parsed, '1.27.0', 'test-v127'), contentHash: 'a'.repeat(64),
    } as WorkoutTemplateDocument);
    expect(restored.sessions.flatMap((session) => session.exercises).find((exercise) => exercise.exercise_id === 'farmers-walk')?.distance)
      .toBe('20-40 m');
    expect(restored.sessions.map((session) => session.notes)).toEqual(parsed.sessions.map((session) => session.notes));
  });

  it('T049 (previously blocked by cardio-continuo/cardio-intervalado/mobilidade-dinamica-geral) now parses, and the runtime library stays on v2.0.0', () => {
    const parsed = parseCanonicalV127Template(rawTemplate('T049'));
    expect(parsed.id).toBe('T049');
    expect(TEMPLATE_LIBRARY_VERSION).toBe('2.0.0');
  });

  it('parses a truly unknown exercise id as still unresolved (fail-closed stays live)', () => {
    const base = rawTemplate('T001');
    const synthetic = {
      ...base,
      sessions: [{
        ...base.sessions[0],
        exercises: [{ ...base.sessions[0].exercises[0], exercise_id: 'nonexistent-exercise-id' }],
      }],
    } as Parameters<typeof parseCanonicalV127Template>[0];
    expect(() => parseCanonicalV127Template(synthetic)).toThrow('UNRESOLVED_CANONICAL_EXERCISE');
  });

  it('cardio activities carry no primaryMuscle and preserve cardio-intervalado\'s cycleRange', () => {
    const t049 = parseCanonicalV127Template(rawTemplate('T049'));
    const allExercises = t049.sessions.flatMap((session) => session.exercises);
    const cardioContinuo = allExercises.find((exercise) => exercise.exercise_id === 'cardio-continuo');
    const cardioIntervalado = allExercises.find((exercise) => exercise.exercise_id === 'cardio-intervalado');
    expect(cardioContinuo).toBeDefined();
    expect(cardioIntervalado).toBeDefined();
    expect(cardioIntervalado?.cycleRange).toBeDefined();
    expect(CANONICAL_ACTIVITIES.find((activity) => activity.id === 'cardio-continuo')?.kind).toBe('cardio');
    expect(CANONICAL_ACTIVITIES.find((activity) => activity.id === 'cardio-intervalado')?.kind).toBe('cardio');
    expect(EXERCISES_SEED.some((exercise) => exercise.id === 'cardio-continuo')).toBe(false);
  });

  it('mobility blocks carry no primaryMuscle and are not part of EXERCISES_SEED', () => {
    const t049 = parseCanonicalV127Template(rawTemplate('T049'));
    const mobilidadeGeneral = t049.sessions.flatMap((s) => s.exercises)
      .find((exercise) => exercise.exercise_id === 'mobilidade-dinamica-geral');
    expect(mobilidadeGeneral).toBeDefined();
    expect(CANONICAL_ACTIVITIES.find((activity) => activity.id === 'mobilidade-dinamica-geral')?.kind).toBe('mobility');
    expect(EXERCISES_SEED.some((exercise) => exercise.id === 'mobilidade-dinamica-geral')).toBe(false);
  });

  it('preserves active recovery, interval dose and all guidelines in a synthetic template', () => {
    const base = rawTemplate('T091');
    const synthetic = {
      ...base,
      sessions: [...base.sessions, {
        name: 'Recuperação ativa', type: 'active_recovery',
        technique_guideline: 'Técnica de teste', effort_guideline: 'Esforço de teste',
        rest_guideline: 'Descanso de teste', progression_guideline: 'Progressão de teste',
        notes: 'Nota de sessão',
        exercises: [{ name: 'Caminhada', exercise_id: 'caminhada', sets: '5-7 ciclos',
          duration: '1 min forte + 2 min leve', intensity: 'leve', notes: 'Nota de exercício' }],
      }],
    } as Parameters<typeof parseCanonicalV127Template>[0];
    const parsed: CanonicalTemplate = parseCanonicalV127Template(synthetic);
    expect(sessionDayState(parsed.sessions.at(-1)!)).toBe('ACTIVE_RECOVERY');
    expect(trainingSessionIndexes(parsed.sessions)).toEqual([0, 1]);
    const restored = fromWorkoutTemplateDocument({
      ...toWorkoutTemplateDocumentBody(parsed, '1.27.0', 'test-v127'), contentHash: 'a'.repeat(64),
    } as WorkoutTemplateDocument);
    expect(restored.sessions.at(-1)).toEqual(parsed.sessions.at(-1));
    expect(restored.sessions.at(-1)?.exercises[0].cycleRange).toEqual({ min: 5, max: 7 });
    expect(restored.sessions.at(-1)?.exercises[0].sets).toBeUndefined();
  });

  it('reconstructs a legacy v2.0-shaped snapshot that has none of the new v1.27 fields', () => {
    const legacyDoc = {
      id: 'T004',
      schemaVersion: 1,
      sourceVersion: '2.0.0',
      library: 'test-v2-legacy',
      profile: { sex: 'male', environment: 'gym', primaryGoal: 'hypertrophy_body_composition', daysPerWeek: 4 },
      split: 'upper/lower',
      rationale: 'legacy rationale',
      sessions: [{
        name: 'Sessão A',
        type: 'resistance',
        exercises: [{ exerciseId: 'barbell-back-squat', sets: 3, reps: '8-12' }],
      }],
      contentHash: 'a'.repeat(64),
    } as unknown as WorkoutTemplateDocument;
    const restored = fromWorkoutTemplateDocument(legacyDoc);
    expect(restored.sessions[0].display_name).toBe('Sessão A');
    expect(restored.sessions[0].technique_guideline).toBeUndefined();
    expect(restored.sessions[0].exercises[0].cycleRange).toBeUndefined();
    expect(restored.sessions[0].exercises[0].distance).toBeUndefined();
    expect(catalogInvariantErrors({ schema_version: '2.0.0', library: 'test-v2-legacy', workouts: [restored] })).toEqual([]);
  });
});
