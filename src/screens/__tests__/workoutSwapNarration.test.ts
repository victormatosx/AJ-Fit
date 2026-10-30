import { describe, expect, it } from 'vitest';
import {
  buildSwapNarration,
  changeFragments,
  restRange,
  spokenDivision,
  totalExercises,
  totalSets,
  type LooseTranslate,
  type SwapNarrationInput,
  type SwapNarrationSession,
} from '../workoutSwapNarration';
import type { WorkoutSwapComparison } from '../workoutSwapPreview';

/**
 * Echoes the key and its interpolations instead of real copy, so these tests
 * assert WHICH line the script chose and WHAT data it fed in — never the
 * wording, which belongs to i18n and is checked for completeness separately
 * in `workoutSwapFlow.test.ts`.
 */
const t: LooseTranslate = (key, opts) =>
  `${key}(${Object.entries(opts ?? {}).map(([k, v]) => `${k}=${String(v)}`).join('|')})`;

function session(overrides: Partial<SwapNarrationSession> = {}): SwapNarrationSession {
  return {
    letter: 'A',
    muscleGroups: ['Peitoral', 'Tríceps'],
    exerciseCount: 6,
    setCount: 18,
    restSeconds: [60, 60, 90],
    ...overrides,
  };
}

function comparison(overrides: Partial<WorkoutSwapComparison> = {}): WorkoutSwapComparison {
  return {
    frequency: { from: 3, to: 5, changed: true },
    sessionCount: { from: 3, to: 5, changed: true },
    exerciseCount: { from: 18, to: 30, changed: true },
    split: { from: 'Full Body', to: 'Upper/Lower', changed: true },
    ...overrides,
  };
}

function input(overrides: Partial<SwapNarrationInput> = {}): SwapNarrationInput {
  return {
    firstName: 'Lucas',
    comparison: comparison(),
    scheduleMode: 'fixed',
    frequency: 5,
    trainingDayLabels: ['SEG', 'TER', 'QUA', 'QUI', 'SEX'],
    restDayCount: 2,
    split: 'Upper/Lower',
    sessions: [session(), session({ letter: 'B', muscleGroups: ['Dorsal', 'Bíceps'] })],
    ...overrides,
  };
}

describe('totals', () => {
  it('sums exercises and sets across sessions', () => {
    const sessions = [session({ exerciseCount: 6, setCount: 18 }), session({ exerciseCount: 5, setCount: 15 })];
    expect(totalExercises(sessions)).toBe(11);
    expect(totalSets(sessions)).toBe(33);
    expect(totalExercises([])).toBe(0);
    expect(totalSets([])).toBe(0);
  });
});

describe('spokenDivision', () => {
  it('names at most two muscle groups per session so the line stays one sentence', () => {
    expect(spokenDivision([
      session({ letter: 'A', muscleGroups: ['Peitoral', 'Tríceps', 'Ombros', 'Abdômen'] }),
    ])).toBe('A: Peitoral, Tríceps');
  });

  it('joins the sessions in order', () => {
    expect(spokenDivision([
      session({ letter: 'A', muscleGroups: ['Peitoral'] }),
      session({ letter: 'B', muscleGroups: ['Dorsal'] }),
      session({ letter: 'C', muscleGroups: ['Quadríceps'] }),
    ])).toBe('A: Peitoral · B: Dorsal · C: Quadríceps');
  });

  it('gives a session with no catalogued target its letter alone, never an invented group', () => {
    expect(spokenDivision([
      session({ letter: 'A', muscleGroups: [] }),
      session({ letter: 'B', muscleGroups: ['Dorsal'] }),
    ])).toBe('A · B: Dorsal');
  });
});

describe('restRange', () => {
  it('reports the real min and max of the prescribed rest', () => {
    expect(restRange([session({ restSeconds: [60, 90, 75] })])).toEqual({ min: 60, max: 90 });
  });

  it('collapses to a single value when every exercise rests the same', () => {
    expect(restRange([session({ restSeconds: [60, 60] })])).toEqual({ min: 60, max: 60 });
  });

  it('ignores the deliberate zero of a mobility slot rather than reporting 0s rest', () => {
    expect(restRange([session({ restSeconds: [0, 0, 90] })])).toEqual({ min: 90, max: 90 });
  });

  it('is null when nothing prescribes rest', () => {
    expect(restRange([session({ restSeconds: [0, 0] })])).toBeNull();
    expect(restRange([])).toBeNull();
  });
});

describe('changeFragments', () => {
  it('reports only metrics that actually moved', () => {
    const fragments = changeFragments(t, comparison({
      sessionCount: { from: 3, to: 3, changed: false },
      split: { from: 'Upper/Lower', to: 'Upper/Lower', changed: false },
    }));
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toContain('changeExercisesMore');
    expect(fragments[0]).toContain('count=12');
  });

  it('is empty when nothing changed — the line is then dropped entirely', () => {
    expect(changeFragments(t, {
      frequency: { from: 4, to: 4, changed: false },
      sessionCount: { from: 4, to: 4, changed: false },
      exerciseCount: { from: 24, to: 24, changed: false },
      split: { from: 'Upper/Lower', to: 'Upper/Lower', changed: false },
    })).toEqual([]);
  });

  it('distinguishes a reduction from an increase and always reports a positive magnitude', () => {
    const fewer = changeFragments(t, comparison({
      sessionCount: { from: 5, to: 3, changed: true },
      exerciseCount: { from: 30, to: 18, changed: true },
      split: { from: 'A', to: 'A', changed: false },
    }));
    expect(fewer[0]).toContain('changeSessionsFewer');
    expect(fewer[0]).toContain('count=2');
    expect(fewer[1]).toContain('changeExercisesFewer');
    expect(fewer[1]).toContain('count=12');
  });
});

describe('buildSwapNarration', () => {
  it('narrates frequency, days, division, volume, differences and the closing, in order', () => {
    const lines = buildSwapNarration(t, input());
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('aj.intro(');
    expect(lines[0]).toContain('name=Lucas');
    expect(lines[0]).toContain('count=5');
    expect(lines[1]).toContain('aj.daysFixed');
    expect(lines[1]).toContain('days=SEG, TER, QUA, QUI, SEX');
    expect(lines[1]).toContain('rest=2');
    expect(lines[2]).toContain('aj.division');
    expect(lines[2]).toContain('split=Upper/Lower');
    expect(lines[3]).toContain('aj.volumeRestRange');
    expect(lines[4]).toContain('aj.changes');
    expect(lines[5]).toContain('aj.closing');
  });

  it('greets without a name when the profile has none', () => {
    const lines = buildSwapNarration(t, input({ firstName: null }));
    expect(lines[0]).toContain('aj.introNoName');
    expect(lines[0]).not.toContain('name=');
  });

  it('speaks the flexible schedule instead of inventing weekdays', () => {
    const lines = buildSwapNarration(t, input({ scheduleMode: 'flexible', trainingDayLabels: [] }));
    expect(lines[1]).toContain('aj.daysFlexible');
    expect(lines.join(' ')).not.toContain('daysFixed');
  });

  it('uses the single-rest line when every exercise rests the same', () => {
    const lines = buildSwapNarration(t, input({
      sessions: [session({ restSeconds: [60, 60] })],
    }));
    expect(lines.some((line) => line.includes('aj.volumeSingleRest'))).toBe(true);
    expect(lines.some((line) => line.includes('aj.volumeRestRange'))).toBe(false);
  });

  it('falls back to the rest-free volume line when nothing prescribes rest', () => {
    const lines = buildSwapNarration(t, input({
      sessions: [session({ restSeconds: [0, 0] })],
    }));
    expect(lines.some((line) => /aj\.volume\(/.test(line))).toBe(true);
  });

  it('drops the differences line when the swap changed no metric', () => {
    const lines = buildSwapNarration(t, input({
      comparison: {
        frequency: { from: 5, to: 5, changed: false },
        sessionCount: { from: 5, to: 5, changed: false },
        exerciseCount: { from: 30, to: 30, changed: false },
        split: { from: 'Upper/Lower', to: 'Upper/Lower', changed: false },
      },
    }));
    expect(lines.some((line) => line.includes('aj.changes'))).toBe(false);
    // The intro and the closing always survive, so the moment is never silent.
    expect(lines[0]).toContain('aj.intro');
    expect(lines[lines.length - 1]).toContain('aj.closing');
  });

  it('drops the day line rather than speaking an empty weekday list', () => {
    const lines = buildSwapNarration(t, input({ trainingDayLabels: [] }));
    expect(lines.some((line) => line.includes('daysFixed'))).toBe(false);
  });

  it('survives a plan whose sessions could not be resolved, without a fabricated line', () => {
    const lines = buildSwapNarration(t, input({ sessions: [] }));
    expect(lines.some((line) => line.includes('aj.division'))).toBe(false);
    expect(lines.some((line) => line.includes('aj.volume'))).toBe(false);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('never emits a blank line', () => {
    for (const lines of [
      buildSwapNarration(t, input()),
      buildSwapNarration(t, input({ sessions: [] })),
      buildSwapNarration(t, input({ firstName: null, trainingDayLabels: [] })),
    ]) {
      expect(lines.every((line) => line.trim().length > 0)).toBe(true);
    }
  });
});
