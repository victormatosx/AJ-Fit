import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/home/CycleProgressBlock.tsx', 'utf8');

/**
 * Successor to the flexible-schedule streak-unit regression test
 * (`docs/superpowers/plans/2026-10-07-home-redesign.md`, Task 21).
 *
 * The original bug: the "Sequência" row rendered a hardcoded "dias" unit
 * while `computeStreak` could be counting consecutive WEEKS for a
 * `flexible` schedule — so a 3-week streak read as "3 dias". The old fix was
 * to branch the unit text on `streak.unit`.
 *
 * That branch is now GONE, and deliberately so: the row no longer shows the
 * obligations/weeks streak at all. It shows the DAILY ACTIVITY streak
 * (`src/home/dailyActivityStreak.ts`) — consecutive calendar days with a
 * workout or a food entry — which has exactly one unit. Hardcoding "dias" is
 * therefore correct now.
 *
 * The misstatement risk did not disappear, it INVERTED: it would come back
 * the moment this row went back to reading the obligations/weeks `streak`
 * while still printing a days label. That is what the tests below guard.
 */
describe('CycleProgressBlock streak unit', () => {
  /** The whole "Sequência" row, isolated so assertions can't match elsewhere. */
  function streakRow(): string {
    const start = source.indexOf("accessibilityLabel={`${t('evoRing.streakLabel')}");
    expect(start, 'streak row not found').toBeGreaterThan(-1);
    const end = source.indexOf('</Row>', start);
    expect(end, 'streak row end not found').toBeGreaterThan(-1);
    return source.slice(start, end);
  }

  it('renders the days unit unconditionally, because the daily streak has only one unit', () => {
    expect(streakRow()).toContain("t('evoRing.streakUnit'");
    expect(streakRow()).not.toContain('streakUnitWeeks');
  });

  /**
   * The number is rendered by `CountUp`, separately from this label, so the
   * label has to agree with it on its own. Without the count, i18next cannot
   * select a plural form and a one-day streak reads "1 dias".
   */
  it('passes the count so a one-day streak reads "1 dia", not "1 dias"', () => {
    const row = streakRow();
    expect((row.match(/t\('evoRing\.streakUnit', \{ count: dailyStreak\?\.current \?\? 0 \}\)/g) ?? []))
      // Once in the visible label, once in the accessibility label.
      .toHaveLength(2);
    // And the catalogue actually HAS both forms, in every locale.
    for (const locale of ['pt-BR', 'en', 'es']) {
      const home = JSON.parse(readFileSync(`src/i18n/resources/${locale}/home.json`, 'utf8'));
      expect(home.evoRing.streakUnit_one, locale).toBeTruthy();
      expect(home.evoRing.streakUnit_other, locale).toBeTruthy();
      expect(home.evoRing.streakUnit_one, locale).not.toBe(home.evoRing.streakUnit_other);
      // The unsuffixed key must be gone, or i18next resolves it and never
      // selects a plural at all.
      expect(home.evoRing.streakUnit, locale).toBeUndefined();
      expect(home.evoTicker.streakValue, locale).toBeUndefined();
      expect(home.evoTicker.streakValue_one, locale).toContain('{{count}}');
      expect(home.evoTicker.streakValue_other, locale).toContain('{{count}}');
    }
  });

  it('feeds the row from the daily activity streak, never from the obligations/weeks streak', () => {
    const row = streakRow();
    expect(row).toContain('dailyStreak?.current');
    // The guard that matters: pairing the obligations/weeks value with a
    // hardcoded days label is exactly the original bug.
    expect(row).not.toMatch(/[^y]streak\?\.current/);
  });

  it('drives the flame from the same daily value shown as the number', () => {
    expect(streakRow()).toContain('<StreakFlame days={dailyStreak?.current ?? 0}');
  });

  it('still accepts the obligations/weeks streak for the other schedule metrics', () => {
    // It must remain a prop — adherence and the cycle metrics depend on it —
    // it just must not drive the Sequência row any more.
    expect(source).toContain('streak: Streak | null;');
    expect(source).toContain('dailyStreak: DailyActivityStreak | null;');
  });
});
