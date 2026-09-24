import { describe, expect, it } from 'vitest';

import { applyMusculoskeletalLimitationV127 } from '../musculoskeletalLimitationV127';
import type { FinalWorkoutExercise, FinalWorkoutSession, TemplateEnvironment } from '../types';

/**
 * Fase 4b — per-region `limitationProfile` coverage. Confirms the hypothesis
 * from the "cable-crossover-fly/knee still blocks" investigation was real
 * for one specific slice (the source's OWN unconditional family/similar
 * candidate search could otherwise silently run for a `pending` active
 * region) and proves the fix: `hasPendingActiveRegion` in
 * `musculoskeletalLimitationV127.ts` now blocks an exercise ONLY when one of
 * the user's ACTUALLY ACTIVE regions has no reviewed decision (`pending`) —
 * never for a region the user doesn't have, and never treating `pending` as
 * safe.
 */

const GYM: TemplateEnvironment = 'gym';

function exercise(id: string, overrides: Partial<FinalWorkoutExercise> = {}): FinalWorkoutExercise {
  return { exerciseId: id, sourceExerciseId: id, sets: 3, reps: '10-12', ...overrides } as FinalWorkoutExercise;
}
function session(exercises: FinalWorkoutExercise[]): FinalWorkoutSession {
  return { name: 'Sessão', exercises } as FinalWorkoutSession;
}

describe('per-region limitationProfile coverage — cable-crossover-fly', () => {
  it('1. activeRegions=[knee] does NOT produce PROFILE_COVERAGE_MISSING — knee is explicitly not_applicable', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('cable-crossover-fly')])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions).toEqual([]);
    expect(result.sessions[0].exercises[0].exerciseId).toBe('cable-crossover-fly');
  });

  it('2. activeRegions=[shoulder] BLOCKS — shoulder is pending, never decided', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('cable-crossover-fly')])], GYM, ['shoulder']);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:0:cable-crossover-fly']);
    expect(result.decisions[0]).toMatchObject({ outcome: 'BLOCKED', reasonCode: 'PROFILE_COVERAGE_MISSING' });
  });

  it('3. activeRegions=[wrist] BLOCKS — wrist is pending, never decided', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('cable-crossover-fly')])], GYM, ['wrist']);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:0:cable-crossover-fly']);
  });

  it('4. activeRegions=[knee, shoulder] BLOCKS by shoulder even though knee alone would be fine', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('cable-crossover-fly')])], GYM, ['knee', 'shoulder']);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:0:cable-crossover-fly']);
  });

  it('never silently accepts a same-family candidate for the pending region (defense in depth: pec-deck-machine-fly shares cable-crossover-fly\'s chest_fly group)', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('cable-crossover-fly')])], GYM, ['shoulder']);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    // The block must happen BEFORE any candidate is even evaluated — proving
    // the family/similar search for the pending region never ran at all.
    expect(result.decisions[0]).toMatchObject({ candidatesEvaluated: [] });
  });
});

describe('per-region limitationProfile coverage — dumbbell-fly', () => {
  it('5. activeRegions=[knee] has valid coverage (not_applicable) — no block', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('dumbbell-fly')])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions).toEqual([]);
  });

  it('6. activeRegions=[shoulder] BLOCKS — shoulder is pending', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('dumbbell-fly')])], GYM, ['shoulder']);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:0:dumbbell-fly']);
  });
});

describe('per-region limitationProfile coverage — dumbbell-rear-delt-fly', () => {
  it('7. activeRegions=[shoulder] resolves through the already-decided adapt rule (cable-rear-delt-fly), since shoulder is NOT pending for this exercise', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('dumbbell-rear-delt-fly')])], GYM, ['shoulder']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0].exerciseId).toBe('cable-rear-delt-fly');
    expect(result.decisions[0]).toMatchObject({ outcome: 'SUBSTITUTED', substituteExerciseId: 'cable-rear-delt-fly', candidateOrigin: 'preferred' });
  });

  it('8. activeRegions=[wrist] BLOCKS while wrist is pending', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('dumbbell-rear-delt-fly')])], GYM, ['wrist']);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:0:dumbbell-rear-delt-fly']);
  });
});

describe('per-region coverage does not weaken fail-closed for already-covered regions', () => {
  it('activeRegions=[knee, wrist] on dumbbell-rear-delt-fly still blocks (wrist pending) even though knee alone is fine', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('dumbbell-rear-delt-fly')])], GYM, ['knee', 'wrist']);
    expect(result.status).toBe('BLOCKED');
  });

  it('a fully-decided exercise (leg-press-45) is completely unaffected by the pending mechanism — no regression', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('leg-press-45')])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0]).toMatchObject({ outcome: 'SUBSTITUTED', substituteExerciseId: 'chair-sit-to-stand' });
  });
});
