import { describe, expect, it } from 'vitest';

import {
  completeSession,
  isValidSessionIndex,
  readSessionSuggestion,
  selectSession,
  suggestionAfter,
  type SessionSuggestion,
} from '../sessionSuggestion';

const COUNT = 3; // A=0, B=1, C=2
const fresh = (overrides: Partial<SessionSuggestion> = {}): SessionSuggestion =>
  ({ suggestedSessionIndex: 0, version: 0, lastSelectedSessionIndex: null, ...overrides });

const applied = (transition: ReturnType<typeof selectSession>) => {
  if (transition.status === 'REJECTED') throw new Error(`unexpected rejection: ${transition.reason}`);
  return transition.suggestion;
};

describe('the circular rotation from the spec', () => {
  it('selecting A suggests B', () => {
    expect(applied(selectSession(fresh(), 0, COUNT)).suggestedSessionIndex).toBe(1);
  });

  it('selecting B suggests C', () => {
    expect(applied(selectSession(fresh(), 1, COUNT)).suggestedSessionIndex).toBe(2);
  });

  it('selecting C wraps back to A', () => {
    expect(applied(selectSession(fresh(), 2, COUNT)).suggestedSessionIndex).toBe(0);
  });

  it('walks A → B → C → A through consecutive selections', () => {
    let state = fresh();
    for (const [picked, expected] of [[0, 1], [1, 2], [2, 0], [0, 1]] as const) {
      state = applied(selectSession(state, picked, COUNT));
      expect(state.suggestedSessionIndex).toBe(expected);
    }
  });

  it('honours an out-of-order pick: offered A, user takes B, next is C', () => {
    const state = applied(selectSession(fresh({ suggestedSessionIndex: 0 }), 1, COUNT));
    expect(state.suggestedSessionIndex).toBe(2);
    // …and then taking C makes it A.
    expect(applied(selectSession(state, 2, COUNT)).suggestedSessionIndex).toBe(0);
  });

  it('works for any rotation size, including a single-session program', () => {
    expect(suggestionAfter(0, 1)).toBe(0);
    expect(suggestionAfter(4, 5)).toBe(0);
    expect(suggestionAfter(0, 0)).toBe(0);
  });
});

describe('selection does not need completion, and is not completion', () => {
  it('records the chosen session without any completion concept', () => {
    const state = applied(selectSession(fresh(), 1, COUNT));
    expect(state.lastSelectedSessionIndex).toBe(1);
    // Nothing in the returned shape can express "completed".
    expect(Object.keys(state).sort()).toEqual(['lastSelectedSessionIndex', 'suggestedSessionIndex', 'version']);
  });

  it('keeps the suggestion after the selected session is abandoned', () => {
    // Abandoning writes nothing here, so the pointer is simply untouched.
    const state = applied(selectSession(fresh(), 1, COUNT));
    expect(state.suggestedSessionIndex).toBe(2);
  });
});

describe('no double advance — the core invariant', () => {
  it('completing the session just selected does not advance again', () => {
    const afterSelect = applied(selectSession(fresh(), 1, COUNT));
    expect(afterSelect.suggestedSessionIndex).toBe(2);
    const afterComplete = completeSession(afterSelect, { sessionIndex: 1, sessionCount: COUNT });
    expect(afterComplete.status).toBe('UNCHANGED');
    expect(afterComplete.status !== 'REJECTED' && afterComplete.suggestion.suggestedSessionIndex).toBe(2);
  });

  it('re-selecting the same session is a no-op, never a second step', () => {
    const once = applied(selectSession(fresh(), 1, COUNT));
    const twice = selectSession(once, 1, COUNT);
    expect(twice.status).toBe('UNCHANGED');
    expect(twice.status !== 'REJECTED' && twice.suggestion.suggestedSessionIndex).toBe(2);
    expect(twice.status !== 'REJECTED' && twice.suggestion.version).toBe(once.version);
  });

  it('is idempotent across repeated completions of the same session', () => {
    let state = applied(selectSession(fresh(), 0, COUNT));
    for (let i = 0; i < 5; i += 1) {
      const transition = completeSession(state, { sessionIndex: 0, sessionCount: COUNT });
      if (transition.status !== 'REJECTED') state = transition.suggestion;
      expect(state.suggestedSessionIndex).toBe(1);
    }
  });

  it('advances on a completion the user never explicitly selected', () => {
    // Started straight from the offered card: the pointer still moves once.
    const transition = completeSession(fresh({ suggestedSessionIndex: 0 }), { sessionIndex: 0, sessionCount: COUNT });
    expect(transition.status).toBe('APPLIED');
    expect(transition.status === 'APPLIED' && transition.suggestion.suggestedSessionIndex).toBe(1);
    expect(transition.status === 'APPLIED' && transition.suggestion.version).toBe(0);
  });
});

describe('late finalize versus a newer selection', () => {
  it('preserves the most recent selection and refuses the stale completion', () => {
    const afterB = applied(selectSession(fresh(), 1, COUNT));         // version 1, suggests C
    const afterC = applied(selectSession(afterB, 2, COUNT));           // version 2, suggests A
    const late = completeSession(afterC, { sessionIndex: 1, sessionCount: COUNT, startedFromVersion: 1 });
    expect(late).toEqual({ status: 'REJECTED', reason: 'STALE_SUGGESTION_VERSION' });
    // The user's latest intent stands.
    expect(afterC.suggestedSessionIndex).toBe(0);
  });

  it('accepts a completion started from the current version', () => {
    const afterB = applied(selectSession(fresh(), 1, COUNT));
    const transition = completeSession(afterB, { sessionIndex: 1, sessionCount: COUNT, startedFromVersion: afterB.version });
    expect(transition.status).toBe('UNCHANGED');
  });

  it('treats an execution with no recorded version as current (legacy)', () => {
    const state = fresh({ suggestedSessionIndex: 2, version: 9 });
    const transition = completeSession(state, { sessionIndex: 0, sessionCount: COUNT });
    expect(transition.status).toBe('APPLIED');
    expect(transition.status === 'APPLIED' && transition.suggestion.suggestedSessionIndex).toBe(1);
  });
});

describe('version is monotonic', () => {
  it('increments once per applied selection and never on completion', () => {
    let state = fresh();
    state = applied(selectSession(state, 0, COUNT));
    expect(state.version).toBe(1);
    state = applied(selectSession(state, 1, COUNT));
    expect(state.version).toBe(2);
    const completed = completeSession(state, { sessionIndex: 1, sessionCount: COUNT });
    expect(completed.status !== 'REJECTED' && completed.suggestion.version).toBe(2);
  });
});

describe('invalid input is refused, never coerced into a different session', () => {
  it('rejects out-of-range selections', () => {
    for (const index of [-1, 3, 1.5, Number.NaN]) {
      expect(selectSession(fresh(), index, COUNT)).toEqual({ status: 'REJECTED', reason: 'SESSION_INDEX_OUT_OF_RANGE' });
    }
  });

  it('rejects out-of-range completions', () => {
    expect(completeSession(fresh(), { sessionIndex: 7, sessionCount: COUNT }))
      .toEqual({ status: 'REJECTED', reason: 'SESSION_INDEX_OUT_OF_RANGE' });
  });

  it('validates indices against the real rotation size', () => {
    expect(isValidSessionIndex(2, COUNT)).toBe(true);
    expect(isValidSessionIndex(3, COUNT)).toBe(false);
    expect(isValidSessionIndex('1', COUNT)).toBe(false);
  });
});

describe('readSessionSuggestion — legacy state keeps its place', () => {
  it('adopts the legacy nextSessionIndex when the new field is absent', () => {
    expect(readSessionSuggestion({ nextSessionIndex: 2 }, COUNT)).toEqual({
      suggestedSessionIndex: 2, version: 0, lastSelectedSessionIndex: null,
    });
  });

  it('prefers the new field once present', () => {
    expect(readSessionSuggestion({ suggestedSessionIndex: 1, nextSessionIndex: 2, suggestionVersion: 4 }, COUNT))
      .toEqual({ suggestedSessionIndex: 1, version: 4, lastSelectedSessionIndex: null });
  });

  it('degrades a corrupted or out-of-range pointer to session 0 instead of blocking', () => {
    for (const stored of [{}, null, undefined, { nextSessionIndex: 99 }, { nextSessionIndex: -1 },
      { suggestedSessionIndex: 'B' }]) {
      expect(readSessionSuggestion(stored as never, COUNT).suggestedSessionIndex).toBe(0);
    }
  });

  it('ignores a negative or non-integer stored version', () => {
    expect(readSessionSuggestion({ nextSessionIndex: 0, suggestionVersion: -3 }, COUNT).version).toBe(0);
    expect(readSessionSuggestion({ nextSessionIndex: 0, suggestionVersion: 1.5 }, COUNT).version).toBe(0);
  });

  it('survives a program switch that shrinks the rotation', () => {
    // Index 4 was valid for a 5-session program; the new one has 3.
    expect(readSessionSuggestion({ nextSessionIndex: 4 }, 3).suggestedSessionIndex).toBe(0);
  });
});
