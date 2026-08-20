import { describe, expect, it } from 'vitest';
import { nextValueForIdentity } from '../quizIdentityScope';

const A_ANSWERS: { sex: string | null; goal: string | null } = { sex: 'm', goal: 'cut' };
const RESET: { sex: string | null; goal: string | null } = { sex: null, goal: null };

describe('nextValueForIdentity (regression: cross-account quiz leak)', () => {
  it('keeps the current value when the uid is unchanged (same account, unrelated re-render)', () => {
    expect(nextValueForIdentity('uidA', 'uidA', A_ANSWERS, RESET)).toBe(A_ANSWERS);
  });

  it('keeps the value across an unauthenticated -> unauthenticated re-render', () => {
    expect(nextValueForIdentity(null, null, A_ANSWERS, RESET)).toBe(A_ANSWERS);
  });

  it('resets on logout: uidA -> null', () => {
    expect(nextValueForIdentity('uidA', null, A_ANSWERS, RESET)).toBe(RESET);
  });

  it('resets on a fast account switch: uidA -> uidB, never carrying A into B', () => {
    expect(nextValueForIdentity('uidA', 'uidB', A_ANSWERS, RESET)).toBe(RESET);
  });

  it('resets on a fresh login: null -> uidB', () => {
    expect(nextValueForIdentity(null, 'uidB', A_ANSWERS, RESET)).toBe(RESET);
  });
});
