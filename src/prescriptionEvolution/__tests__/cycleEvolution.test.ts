import { describe, expect, it } from 'vitest';
import { equipmentContextFor, unrestrictedEquipmentContext, type EquipmentContext } from '../../workoutPrescription/equipment';
import type { LimitationCatalogExercise } from '../../workoutPrescription/limitationResolver';
import type { FinalWorkoutExercise, FinalWorkoutSession } from '../../workoutPrescription/types';
import type { QuestionnaireAnswers } from '../../workoutPrescription/types';
import { buildRecentSlotHistory, evolveCycle } from '../cycleEvolution';

const OPEN_EQUIPMENT: EquipmentContext = { environment: 'gym', availableEquipment: new Set(['bodyweight', 'dumbbell', 'barbell', 'cable', 'machine']) };

function makeExercise(input: {
  id: string;
  group: string;
  pattern?: string;
  mechanic?: 'compound' | 'isolation';
  primaryMuscle?: string;
  equipment?: string[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  similar?: string[];
}): LimitationCatalogExercise {
  return {
    id: input.id,
    name: { en: input.id, pt: input.id },
    slug: input.id,
    status: 'active',
    target: { primaryMuscle: (input.primaryMuscle ?? 'chest') as never, secondaryMuscles: [] },
    movement: { pattern: (input.pattern ?? 'horizontal_push') as never, mechanic: input.mechanic ?? 'compound', laterality: 'bilateral' },
    equipment: (input.equipment ?? ['barbell']) as never,
    execution: {},
    substitution: { group: input.group, similarExerciseIds: input.similar ?? [] },
    difficulty: input.difficulty ?? 'intermediate',
    availability: { workoutGeneration: true, manualSelection: true, substitution: true },
  } as unknown as LimitationCatalogExercise;
}

/**
 * A "family" of 6 mutually-equivalent chest-press variants plus a 5-member
 * squat-pattern family. Base sessions below only use half of each family, so
 * every eligible slot has multiple genuinely free (non-duplicate) candidates
 * to choose among — real tie-break room for the determinism-vs-cycle-identity
 * tests, not just a single forced choice.
 */
function buildCatalog(): Map<string, LimitationCatalogExercise> {
  const chest = ['chest-a', 'chest-b', 'chest-c', 'chest-d', 'chest-e', 'chest-f'].map((id) =>
    makeExercise({ id, group: 'horizontal_chest_press', pattern: 'horizontal_push', primaryMuscle: 'chest' }));
  const squat = ['squat-a', 'squat-b', 'squat-c', 'squat-d', 'squat-e'].map((id) =>
    makeExercise({ id, group: 'squat_pattern', pattern: 'squat', primaryMuscle: 'quads' }));
  const isolated = ['iso-a'].map((id) => // no group peers, no similarExerciseIds -> zero candidates, always preserved
    makeExercise({ id, group: 'unique_isolation', pattern: 'unique_pattern', primaryMuscle: 'calves' }));
  const all = [...chest, ...squat, ...isolated];
  return new Map(all.map((exercise) => [exercise.id, exercise]));
}

function slot(exerciseId: string, overrides: Partial<FinalWorkoutExercise> = {}): FinalWorkoutExercise {
  return { exerciseId, sourceExerciseId: exerciseId, sets: 3, reps: '10', restSeconds: 90, ...overrides };
}

function session(name: string, exercises: FinalWorkoutExercise[]): FinalWorkoutSession {
  return { name, type: 'strength', exercises };
}

function baseSessions(): FinalWorkoutSession[] {
  return [
    session('A', [slot('chest-a'), slot('chest-b'), slot('chest-c'), slot('iso-a')]),
    session('B', [slot('squat-a'), slot('squat-b'), slot('chest-d')]),
  ];
}

function evolve(overrides: Partial<Parameters<typeof evolveCycle>[0]> = {}) {
  return evolveCycle({
    sessions: baseSessions(),
    targetCycleIdentity: 'cycle-1',
    limitationRegions: [],
    equipmentContext: OPEN_EQUIPMENT,
    catalog: buildCatalog(),
    recentSlotHistory: buildRecentSlotHistory([]),
    ...overrides,
  });
}

describe('movement anchors', () => {
  it('never substitutes the first exercise of any session', () => {
    for (let i = 0; i < 10; i += 1) {
      const result = evolve({ targetCycleIdentity: `cycle-${i}` });
      expect(result.sessions[0].exercises[0].exerciseId).toBe('chest-a');
      expect(result.sessions[1].exercises[0].exerciseId).toBe('squat-a');
    }
  });
});

describe('novelty target ~20-30%', () => {
  it('changes roughly a quarter of eligible slots when abundant safe candidates exist', () => {
    // eligible slots: session A has 3 (idx 1,2,3), session B has 2 (idx 1,2) = 5 total.
    const result = evolve();
    expect(result.eligibleSlots).toBe(5);
    // round(5*0.25) = 1 (clamped to at least 1)
    expect(result.changedSlots).toBeGreaterThanOrEqual(1);
    expect(result.changeRatio).toBeLessThanOrEqual(0.5); // small-N rounding tolerance, never runs away
  });
});

describe('safety-constrained novelty falls back gracefully', () => {
  it('when a slot has zero safe candidates, it is preserved and a warning is recorded if the target is not reached', () => {
    const oneSlot: FinalWorkoutSession[] = [session('A', [slot('chest-a'), slot('iso-a')])]; // iso-a has no peers at all
    const result = evolveCycle({
      sessions: oneSlot,
      targetCycleIdentity: 'cycle-1',
      limitationRegions: [],
      equipmentContext: OPEN_EQUIPMENT,
      catalog: buildCatalog(),
      recentSlotHistory: buildRecentSlotHistory([]),
    });
    expect(result.eligibleSlots).toBe(1);
    expect(result.changedSlots).toBe(0);
    expect(result.sessions[0].exercises[1].exerciseId).toBe('iso-a'); // preserved
    expect(result.warnings).toContain('NOVELTY_TARGET_NOT_REACHED_SAFETY_CONSTRAINED');
  });

  it('safety always wins: a limitation-incompatible candidate is never chosen even if it would reach the target', () => {
    const catalog = buildCatalog();
    // Give chest-b an "approved compatible for elbow" profile so it's clearly the only safe swap for chest-c.
    catalog.set('chest-c', { ...catalog.get('chest-c')!, id: 'chest-c' });
    const result = evolveCycle({
      sessions: [session('A', [slot('chest-a'), slot('chest-b')])],
      targetCycleIdentity: 'cycle-1',
      limitationRegions: ['elbow'],
      equipmentContext: OPEN_EQUIPMENT,
      catalog,
      recentSlotHistory: buildRecentSlotHistory([]),
    });
    // None of the synthetic fixtures carry an approved limitationProfile, so with a declared region every candidate is unsafe -> preserved.
    expect(result.changedSlots).toBe(0);
    expect(result.sessions[0].exercises[1].exerciseId).toBe('chest-b');
  });
});

describe('duplicate prevention', () => {
  it('never produces two slots with the same exerciseId within a single session', () => {
    for (let i = 0; i < 20; i += 1) {
      const result = evolve({ targetCycleIdentity: `cycle-${i}` });
      for (const session of result.sessions) {
        const ids = session.exercises.map((e) => e.exerciseId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('allows the same exercise to legitimately appear in two different sessions (e.g. squats on Lower A and Lower B)', () => {
    const sessions: FinalWorkoutSession[] = [
      session('Lower A', [slot('squat-a'), slot('squat-b')]),
      session('Lower B', [slot('squat-a'), slot('squat-b')]),
    ];
    const result = evolveCycle({
      sessions,
      targetCycleIdentity: 'cycle-shared',
      limitationRegions: [],
      equipmentContext: OPEN_EQUIPMENT,
      catalog: buildCatalog(),
      recentSlotHistory: buildRecentSlotHistory([]),
    });
    // squat-a (index 0) is the anchor in both sessions and is never touched —
    // the identical repeated pair must not be treated as a plan-wide conflict.
    expect(result.sessions[0].exercises[0].exerciseId).toBe('squat-a');
    expect(result.sessions[1].exercises[0].exerciseId).toBe('squat-a');
  });
});

describe('determinism', () => {
  it('same input -> exact same output, every time', () => {
    const first = evolve();
    const second = evolve();
    expect(first).toEqual(second);
  });

  it('a different targetCycleIdentity can select a different subset/candidates', () => {
    const outcomes = new Set(
      Array.from({ length: 8 }, (_, i) => JSON.stringify(evolve({ targetCycleIdentity: `cycle-${i}` }).sessions)),
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

describe('anti-ping-pong', () => {
  it('avoids immediately reusing the variant from the last cycle when a fresher one is safe', () => {
    // Cycle 1: chest-a(anchor) chest-b. Simulate that chest-c was used in cycle N-1's slot 1.
    const priorSessions: FinalWorkoutSession[] = [session('A', [slot('chest-a'), slot('chest-c')])];
    const history = buildRecentSlotHistory([priorSessions]);
    const result = evolveCycle({
      sessions: [session('A', [slot('chest-a'), slot('chest-b')])],
      targetCycleIdentity: 'cycle-N',
      limitationRegions: [],
      equipmentContext: OPEN_EQUIPMENT,
      catalog: buildCatalog(),
      recentSlotHistory: history,
    });
    if (result.changedSlots > 0) {
      expect(result.sessions[0].exercises[1].exerciseId).not.toBe('chest-c');
    }
  });

  it('falls back to the recently-used variant when it is the only safe option', () => {
    const tinyCatalog = new Map([
      ['chest-a', makeExercise({ id: 'chest-a', group: 'g', similar: ['chest-b'] })],
      ['chest-b', makeExercise({ id: 'chest-b', group: 'g', similar: ['chest-a'] })],
    ]);
    const priorSessions: FinalWorkoutSession[] = [session('A', [slot('chest-b'), slot('chest-b')])];
    // chest-a is the only slot-1 exercise; its only candidate is chest-b, which was used last cycle.
    const result = evolveCycle({
      sessions: [session('A', [slot('placeholder-anchor'), slot('chest-a')])],
      targetCycleIdentity: 'cycle-N',
      limitationRegions: [],
      equipmentContext: OPEN_EQUIPMENT,
      catalog: new Map([...tinyCatalog, ['placeholder-anchor', makeExercise({ id: 'placeholder-anchor', group: 'anchor-only' })]]),
      recentSlotHistory: buildRecentSlotHistory([priorSessions]),
    });
    expect(result.sessions[0].exercises[1].exerciseId).toBe('chest-b');
  });
});

describe('ordering is never shuffled', () => {
  it('session count, order, and exercise slot count/order are always preserved', () => {
    const before = baseSessions();
    const result = evolve();
    expect(result.sessions.length).toBe(before.length);
    result.sessions.forEach((session, i) => {
      expect(session.name).toBe(before[i].name);
      expect(session.exercises.length).toBe(before[i].exercises.length);
    });
  });
});

describe('volume invariants', () => {
  it('preserves sets/reps/restSeconds exactly for every slot, changed or not', () => {
    const result = evolve();
    result.sessions.forEach((session, sessionIndex) => {
      session.exercises.forEach((exercise, exerciseIndex) => {
        const original = baseSessions()[sessionIndex].exercises[exerciseIndex];
        expect(exercise.sets).toBe(original.sets);
        expect(exercise.reps).toBe(original.reps);
        expect(exercise.restSeconds).toBe(original.restSeconds);
      });
    });
  });

  it('total prescribed sets across the plan is exactly unchanged', () => {
    const before = baseSessions().flatMap((s) => s.exercises).reduce((sum, e) => sum + (e.sets ?? 0), 0);
    const result = evolve();
    const after = result.sessions.flatMap((s) => s.exercises).reduce((sum, e) => sum + (e.sets ?? 0), 0);
    expect(after).toBe(before);
  });
});

describe('long-run multi-cycle simulation (C1..C8)', () => {
  it('stays stable across 8 successive evolutions: no runaway change ratio, no duplicates, session/exercise counts fixed', () => {
    let sessions = baseSessions();
    const history: FinalWorkoutSession[][] = [];
    const ratios: number[] = [];
    for (let cycle = 1; cycle <= 8; cycle += 1) {
      const result = evolveCycle({
        sessions,
        targetCycleIdentity: `cycle-${cycle}`,
        limitationRegions: [],
        equipmentContext: OPEN_EQUIPMENT,
        catalog: buildCatalog(),
        recentSlotHistory: buildRecentSlotHistory(history),
      });
      for (const session of result.sessions) {
        const ids = session.exercises.map((e) => e.exerciseId);
        expect(new Set(ids).size).toBe(ids.length); // no duplicates within a session this cycle
      }
      expect(result.sessions.length).toBe(2);
      expect(result.sessions[0].exercises.length).toBe(4);
      expect(result.sessions[1].exercises.length).toBe(3);
      const totalSets = result.sessions.flatMap((s) => s.exercises).reduce((sum, e) => sum + (e.sets ?? 0), 0);
      expect(totalSets).toBe(21); // frozen: 3 sets * 7 exercises, never grows
      ratios.push(result.changeRatio);
      history.unshift(sessions);
      sessions = result.sessions;
    }
    expect(ratios.every((ratio) => ratio <= 0.6)).toBe(true); // no runaway novelty inflation across cycles
  });
});

describe('equipment independence — v1.27 cycle evolution ignores answers.equipment', () => {
  // A single home-environment session with one eligible slot (the anchor at
  // index 0 is never touched), whose candidate pool contains one dumbbell
  // variant, one resistance-band variant, and one gym-only machine variant
  // that must never be reachable from a home program regardless of context.
  function equipmentCatalog(): Map<string, LimitationCatalogExercise> {
    const anchor = makeExercise({ id: 'anchor-ex', group: 'unrelated', pattern: 'vertical_pull', primaryMuscle: 'lats' });
    const source = makeExercise({ id: 'row-source', group: 'row_family', pattern: 'horizontal_pull', primaryMuscle: 'upper_back', equipment: ['dumbbell'] });
    const dumbbellCandidate = makeExercise({ id: 'row-dumbbell-candidate', group: 'row_family', pattern: 'horizontal_pull', primaryMuscle: 'upper_back', equipment: ['dumbbell'] });
    const bandCandidate = makeExercise({ id: 'row-band-candidate', group: 'row_family', pattern: 'horizontal_pull', primaryMuscle: 'upper_back', equipment: ['resistance_band'] });
    const gymOnlyCandidate = makeExercise({ id: 'row-machine-candidate', group: 'row_family', pattern: 'horizontal_pull', primaryMuscle: 'upper_back', equipment: ['machine'] });
    return new Map([anchor, source, dumbbellCandidate, bandCandidate, gymOnlyCandidate].map((exercise) => [exercise.id, exercise]));
  }

  function homeSessions(): FinalWorkoutSession[] {
    return [session('Home A', [slot('anchor-ex'), slot('row-source')])];
  }

  function evolveHome(equipmentContext: EquipmentContext) {
    return evolveCycle({
      sessions: homeSessions(),
      targetCycleIdentity: 'cycle-equipment-1',
      limitationRegions: [],
      equipmentContext,
      catalog: equipmentCatalog(),
      recentSlotHistory: buildRecentSlotHistory([]),
    });
  }

  const answersWithNoEquipment = { equipment: [] } as unknown as QuestionnaireAnswers;
  const answersWithFullEquipment = { equipment: ['dumbbells', 'bands', 'bench_or_box', 'barbell', 'bodyweight'] } as unknown as QuestionnaireAnswers;

  it('sanity check: the legacy v2 mechanism (equipmentContextFor) IS sensitive to answers.equipment for the same home program', () => {
    const withNoEquipment = evolveHome(equipmentContextFor(answersWithNoEquipment, 'home'));
    const withFullEquipment = evolveHome(equipmentContextFor(answersWithFullEquipment, 'home'));
    // No home-compatible candidate is available -> the slot is preserved.
    expect(withNoEquipment.sessions[0].exercises[1].exerciseId).toBe('row-source');
    // dumbbell/resistance-band candidates become eligible -> a substitution happens.
    expect(withFullEquipment.sessions[0].exercises[1].exerciseId).not.toBe('row-source');
  });

  it('v1.27 mechanism (unrestrictedEquipmentContext) produces the identical cycle evolution regardless of answers.equipment', () => {
    const userWithNoEquipment = evolveHome(unrestrictedEquipmentContext('home'));
    const userWithFullEquipment = evolveHome(unrestrictedEquipmentContext('home'));
    expect(userWithFullEquipment.sessions).toEqual(userWithNoEquipment.sessions);
    expect(userWithFullEquipment.substitutions).toEqual(userWithNoEquipment.substitutions);
  });

  it('v1.27 mechanism still never introduces gym-only equipment into a home program', () => {
    const result = evolveHome(unrestrictedEquipmentContext('home'));
    const ids = result.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('row-machine-candidate');
  });
});
