import { describe, expect, it } from 'vitest';
import { toggleMultiSelection } from '../multiSelection';

const specialConditionsOptions = {
  exclusiveOption: 'none',
};

describe('special-conditions multi-selection', () => {
  it('removes none when a condition is selected', () => {
    expect(toggleMultiSelection(['none'], 'lipedema', specialConditionsOptions)).toEqual(['lipedema']);
  });

  it('preserves multiple conditions', () => {
    expect(toggleMultiSelection(['lipedema'], 'post_surgical', specialConditionsOptions)).toEqual([
      'lipedema',
      'post_surgical',
    ]);
  });

  it('selects only none when none is chosen', () => {
    expect(toggleMultiSelection(['lipedema', 'post_surgical'], 'none', specialConditionsOptions)).toEqual(['none']);
  });

  it('allows an empty selection when the final condition is removed', () => {
    expect(toggleMultiSelection(['lipedema'], 'lipedema', specialConditionsOptions)).toEqual([]);
  });
});
