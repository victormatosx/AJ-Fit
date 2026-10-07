import { describe, expect, it } from 'vitest';

import { repositionedSessionIndexes } from '../reposition';

describe('repositionedSessionIndexes', () => {
  it('walks forward without including the selected next session', () => {
    expect(repositionedSessionIndexes(1, 4, 5)).toEqual([1, 2, 3]);
  });

  it('wraps through the end when selecting an earlier visual index', () => {
    expect(repositionedSessionIndexes(4, 1, 5)).toEqual([4, 0]);
  });

  it('is an idempotent no-op for the same index', () => {
    expect(repositionedSessionIndexes(2, 2, 5)).toEqual([]);
  });

  it.each([[0, 1, 0], [-1, 1, 5], [0, 5, 5]])('rejects invalid bounds (%s, %s, %s)', (current, target, count) => {
    expect(() => repositionedSessionIndexes(current, target, count)).toThrow();
  });
});
