import { describe,expect,it } from 'vitest';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import {
  MUSCLE_PRIORITY_TARGETS_V127,
  normalizeMusclePriorityInputV127,
  primaryMuscleForRuntimeIdV127,
  primaryMuscleMatchesAnyTargetV127,
  type MusclePriorityTargetV127,
} from '../canonicalMusclePriorityV127';
import { composeTemplateV127 } from '../compositionV127';
import { applyMusclePriorityV127 } from '../musclePriorityV127';
import type { FinalWorkoutExercise,FinalWorkoutSession,TemplateId } from '../types';

// One confirmed-real EXERCISES_SEED id per canonical target, audited
// directly against exercisesSeedData.ts's `target.primaryMuscle`.
const REAL_ID_FOR_TARGET: Record<MusclePriorityTargetV127, string> = {
  chest: 'machine-flat-bench-press',
  back: 'bar-lat-pulldown',
  shoulders: 'dumbbell-lateral-raise',
  biceps: 'ez-bar-biceps-curl',
  triceps: 'cable-triceps-pushdown',
  quads: 'barbell-back-squat',
  hamstrings: 'lying-leg-curl-machine',
  glutes: 'hip-thrust',
  calves: 'standing-calf-raise-machine',
  core: 'plank',
};

function exercise(id: string, overrides: Partial<FinalWorkoutExercise> = {}): FinalWorkoutExercise {
  return { exerciseId: id, sourceExerciseId: id, sets: 3, reps: '8-12', ...overrides };
}

function session(exercises: FinalWorkoutExercise[], overrides: Partial<FinalWorkoutSession> = {}): FinalWorkoutSession {
  return { name: 'Sessão', type: 'resistance', exercises, ...overrides };
}

describe('normalizeMusclePriorityInputV127 — boundary normalization', () => {
  it('passes the 10 canonical targets through unchanged', () => {
    expect(normalizeMusclePriorityInputV127([...MUSCLE_PRIORITY_TARGETS_V127])).toEqual([...MUSCLE_PRIORITY_TARGETS_V127]);
  });

  it('expands legacy "arms" to biceps + triceps (never forearms)', () => {
    expect(normalizeMusclePriorityInputV127(['arms'])).toEqual(['biceps', 'triceps']);
  });

  it('drops "none" and any unrecognized value without throwing', () => {
    expect(normalizeMusclePriorityInputV127(['none'])).toEqual([]);
    expect(normalizeMusclePriorityInputV127(['not-a-real-target'])).toEqual([]);
    expect(normalizeMusclePriorityInputV127(['abs'])).toEqual([]); // catalog vocabulary, not questionnaire vocabulary
  });

  it('deduplicates (e.g. "arms" + "biceps" both resolving to biceps)', () => {
    expect(normalizeMusclePriorityInputV127(['arms', 'biceps'])).toEqual(['biceps', 'triceps']);
  });
});

describe('primaryMuscleMatchesAnyTargetV127 / primaryMuscleForRuntimeIdV127 — classification', () => {
  it.each(MUSCLE_PRIORITY_TARGETS_V127)('target "%s" is satisfied by its audited real exercise, primary-muscle only', (target) => {
    const id = REAL_ID_FOR_TARGET[target];
    const primaryMuscle = primaryMuscleForRuntimeIdV127(id);
    expect(primaryMuscle).not.toBeNull();
    expect(primaryMuscleMatchesAnyTargetV127(primaryMuscle!, [target])).toBe(true);
  });

  it('secondaryMuscles never trigger a match — only primaryMuscle (the one existing project precedent, composition.ts\'s legacy priorityCandidates)', () => {
    // machine-flat-bench-press: primary chest, secondary front_deltoid+triceps.
    // "shoulders" and "triceps" must NOT match it even though its
    // secondaryMuscles include front_deltoid/triceps.
    const primaryMuscle = primaryMuscleForRuntimeIdV127('machine-flat-bench-press');
    expect(primaryMuscle).toBe('chest');
    expect(primaryMuscleMatchesAnyTargetV127(primaryMuscle!, ['shoulders'])).toBe(false);
    expect(primaryMuscleMatchesAnyTargetV127(primaryMuscle!, ['triceps'])).toBe(false);
    expect(primaryMuscleMatchesAnyTargetV127(primaryMuscle!, ['chest'])).toBe(true);
  });

  it('cardio/mobility activities (CANONICAL_ACTIVITIES) have no primaryMuscle at all', () => {
    expect(primaryMuscleForRuntimeIdV127('cardio-leve')).toBeNull();
    expect(primaryMuscleForRuntimeIdV127('mobilidade-geral')).toBeNull();
  });
});

describe('applyMusclePriorityV127 — core invariants', () => {
  it('no priority (empty targets) returns the exact same sessions array', () => {
    const sessions = [session([exercise('machine-flat-bench-press'), exercise('bar-lat-pulldown')])];
    const result = applyMusclePriorityV127(sessions, []);
    expect(result.sessions).toBe(sessions);
    expect(result.decisions).toEqual([]);
  });

  it('a single priority moves matching exercises before the rest, preserving relative order within each group', () => {
    const chest1 = exercise('machine-flat-bench-press', { notes: 'chest1' });
    const back1 = exercise('bar-lat-pulldown', { notes: 'back1' });
    const chest2 = exercise('iso-lateral-incline-chest-press-machine', { notes: 'chest2' });
    const back2 = exercise('v-bar-pulldown', { notes: 'back2' });
    const sessions = [session([back1, chest1, back2, chest2])];
    const result = applyMusclePriorityV127(sessions, ['chest']);
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['chest1', 'chest2', 'back1', 'back2']);
    expect(result.decisions).toEqual([{ sessionIndex: 0, reordered: true, prioritizedExerciseIds: ['machine-flat-bench-press', 'iso-lateral-incline-chest-press-machine'] }]);
  });

  it('two priorities are treated as a single merged bucket (audited: muscleFocus has no rank semantics) — either matching target moves the exercise up', () => {
    const chest = exercise('machine-flat-bench-press', { notes: 'chest' });
    const back = exercise('bar-lat-pulldown', { notes: 'back' });
    const shoulders = exercise('dumbbell-lateral-raise', { notes: 'shoulders' });
    const sessions = [session([shoulders, chest, back])];
    const result = applyMusclePriorityV127(sessions, ['chest', 'back']);
    // chest and back both prioritized, keep their original relative order (chest before back, as in the source); shoulders (unmatched) moves after.
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['chest', 'back', 'shoulders']);
  });

  it('stable order within prioritized: multiple matches for the same target keep source order', () => {
    const chestA = exercise('machine-flat-bench-press', { notes: 'A' });
    const other = exercise('cable-triceps-pushdown', { notes: 'other' });
    const chestB = exercise('iso-lateral-incline-chest-press-machine', { notes: 'B' });
    const sessions = [session([chestA, other, chestB])];
    const result = applyMusclePriorityV127(sessions, ['chest']);
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['A', 'B', 'other']);
  });

  it('stable order within non-prioritized: unmatched exercises keep their original relative order too', () => {
    const chest = exercise('machine-flat-bench-press', { notes: 'chest' });
    const triceps = exercise('cable-triceps-pushdown', { notes: 'triceps' });
    const back = exercise('bar-lat-pulldown', { notes: 'back' });
    const sessions = [session([triceps, back, chest])];
    const result = applyMusclePriorityV127(sessions, ['chest']);
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['chest', 'triceps', 'back']);
  });

  it('an exercise matching two selected priority targets appears exactly once, not duplicated', () => {
    // dumbbell-stiff-leg-deadlift: primary hamstrings — matches both "hamstrings" priority alone;
    // proves no duplication when a slot could conceptually satisfy multiple targets.
    const hinge = exercise('dumbbell-stiff-leg-deadlift', { notes: 'hinge' });
    const other = exercise('cable-triceps-pushdown', { notes: 'other' });
    const sessions = [session([other, hinge])];
    const result = applyMusclePriorityV127(sessions, ['hamstrings', 'glutes']);
    expect(result.sessions[0].exercises).toHaveLength(2);
    expect(result.sessions[0].exercises.filter((e) => e.exerciseId === 'dumbbell-stiff-leg-deadlift')).toHaveLength(1);
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['hinge', 'other']);
  });

  it('core priority matches the catalog\'s "abs" primaryMuscle via explicit core<->abs mapping', () => {
    const core = exercise('plank', { notes: 'core' });
    const other = exercise('bar-lat-pulldown', { notes: 'other' });
    const sessions = [session([other, core])];
    const result = applyMusclePriorityV127(sessions, ['core']);
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['core', 'other']);
  });

  it('legacy "arms" input (already normalized to biceps+triceps upstream) prioritizes both bicep and tricep exercises', () => {
    const biceps = exercise('ez-bar-biceps-curl', { notes: 'biceps' });
    const triceps = exercise('cable-triceps-pushdown', { notes: 'triceps' });
    const back = exercise('bar-lat-pulldown', { notes: 'back' });
    const sessions = [session([back, biceps, triceps])];
    const targets = normalizeMusclePriorityInputV127(['arms']);
    const result = applyMusclePriorityV127(sessions, targets);
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['biceps', 'triceps', 'back']);
  });

  it('no match in the session: keeps the exact same session object, no error, nothing inserted', () => {
    const s = session([exercise('cable-triceps-pushdown'), exercise('bar-lat-pulldown')]);
    const sessions = [s];
    const result = applyMusclePriorityV127(sessions, ['chest']);
    expect(result.sessions[0]).toBe(s);
    expect(result.decisions).toEqual([{ sessionIndex: 0, reordered: false, prioritizedExerciseIds: [] }]);
  });

  it('cardio/mobility activity slots never move, at any position, and are excluded from classification', () => {
    const warmup = exercise('mobilidade-geral', { duration: '10 min', sets: undefined, reps: undefined });
    const back = exercise('bar-lat-pulldown', { notes: 'back' });
    const chest = exercise('machine-flat-bench-press', { notes: 'chest' });
    const cardio = exercise('cardio-leve', { duration: '15 min', sets: undefined, reps: undefined });
    const sessions = [session([warmup, back, chest, cardio])];
    const result = applyMusclePriorityV127(sessions, ['chest']);
    const ids = result.sessions[0].exercises.map((e) => e.exerciseId);
    // warmup stays at index 0, cardio stays at index 3 — only the two
    // resistance slots between them are reordered.
    expect(ids[0]).toBe('mobilidade-geral');
    expect(ids[3]).toBe('cardio-leve');
    expect(ids[1]).toBe('machine-flat-bench-press');
    expect(ids[2]).toBe('bar-lat-pulldown');
    expect(result.sessions[0].exercises[0]).toBe(warmup);
    expect(result.sessions[0].exercises[3]).toBe(cardio);
  });

  it('multiple sessions are handled independently, and unaffected sessions keep the same object reference', () => {
    const affected = session([exercise('bar-lat-pulldown', { notes: 'back' }), exercise('machine-flat-bench-press', { notes: 'chest' })]);
    const unaffected = session([exercise('cable-triceps-pushdown')]);
    const sessions = [affected, unaffected];
    const result = applyMusclePriorityV127(sessions, ['chest']);
    expect(result.sessions[1]).toBe(unaffected);
    expect(result.sessions[0]).not.toBe(affected);
    expect(result.sessions[0].exercises.map((e) => e.notes)).toEqual(['chest', 'back']);
  });
});

describe('applyMusclePriorityV127 — invariants: only order changes', () => {
  it('exerciseId set, sets, reps, duration, distance, cycleRange, intensity, notes, session count/type/guidelines are all identical before/after — only order differs', () => {
    const template = getCanonicalTemplateV127ById('T001');
    const baseline = composeTemplateV127(template);
    const prioritized = composeTemplateV127(template, { musclePriority: ['chest', 'back'] });
    expect(baseline.status).toBe('COMPOSED');
    expect(prioritized.status).toBe('COMPOSED');
    if (baseline.status !== 'COMPOSED' || prioritized.status !== 'COMPOSED') return;

    expect(prioritized.sessions).toHaveLength(baseline.sessions.length);
    for (let sessionIndex = 0; sessionIndex < baseline.sessions.length; sessionIndex += 1) {
      const before = baseline.sessions[sessionIndex];
      const after = prioritized.sessions[sessionIndex];
      expect(after.name).toBe(before.name);
      expect(after.type).toBe(before.type);
      expect(after.displayName).toBe(before.displayName);
      expect(after.techniqueGuideline).toBe(before.techniqueGuideline);
      expect(after.effortGuideline).toBe(before.effortGuideline);
      expect(after.restGuideline).toBe(before.restGuideline);
      expect(after.progressionGuideline).toBe(before.progressionGuideline);
      expect(after.notes).toBe(before.notes);
      expect(after.cardioFinisher).toEqual(before.cardioFinisher);
      expect(after.exercises).toHaveLength(before.exercises.length);

      const byId = (exercises: FinalWorkoutExercise[]) => new Map(exercises.map((e) => [e.exerciseId, e]));
      const beforeById = byId(before.exercises);
      const afterById = byId(after.exercises);
      expect(new Set(afterById.keys())).toEqual(new Set(beforeById.keys()));
      for (const [id, beforeExercise] of beforeById) {
        const afterExercise = afterById.get(id)!;
        expect(afterExercise.sourceExerciseId).toBe(beforeExercise.sourceExerciseId);
        expect(afterExercise.sets).toBe(beforeExercise.sets);
        expect(afterExercise.reps).toBe(beforeExercise.reps);
        expect(afterExercise.duration).toBe(beforeExercise.duration);
        expect(afterExercise.distance).toBe(beforeExercise.distance);
        expect(afterExercise.cycles).toBe(beforeExercise.cycles);
        expect(afterExercise.cycleRange).toEqual(beforeExercise.cycleRange);
        expect(afterExercise.intensity).toBe(beforeExercise.intensity);
        expect(afterExercise.notes).toBe(beforeExercise.notes);
        expect(afterExercise.restSeconds).toBe(beforeExercise.restSeconds);
      }
    }
  });

  it('no exerciseId is duplicated within any session, before or after prioritization', () => {
    for (const id of ['T001', 'T025', 'T049', 'T073', 'T085', 'T091'] as TemplateId[]) {
      const template = getCanonicalTemplateV127ById(id);
      const result = composeTemplateV127(template, { musclePriority: ['chest', 'back'] });
      expect(result.status).toBe('COMPOSED');
      if (result.status !== 'COMPOSED') continue;
      for (const s of result.sessions) {
        const ids = s.exercises.map((e) => e.exerciseId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});
