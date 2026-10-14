import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/home/CycleProgressBlock.tsx', 'utf8');

/**
 * Regression test for the known flexible-schedule streak-unit bug flagged in
 * `docs/superpowers/plans/2026-10-07-home-redesign.md` (Task 21's "Known
 * follow-up"): a `flexible`-schedule streak counts consecutive WEEKS, not
 * days (`src/home/streak.ts`), but this component always rendered the fixed
 * "dias"/"days" unit text regardless of `streak.unit`.
 */
describe('CycleProgressBlock streak unit', () => {
  it('branches the visible unit text on streak.unit, never hardcoding the days key', () => {
    expect(source).toContain("t(streak?.unit === 'weeks' ? 'evoRing.streakUnitWeeks' : 'evoRing.streakUnit')");
  });

  it('branches the accessibility label the same way', () => {
    const rowIdx = source.indexOf('accessibilityLabel={`${t(\'evoRing.streakLabel\')}');
    expect(rowIdx).toBeGreaterThan(-1);
    expect(source.slice(rowIdx, rowIdx + 200)).toContain("streak?.unit === 'weeks' ? 'evoRing.streakUnitWeeks' : 'evoRing.streakUnit'");
  });
});
