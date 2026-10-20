import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { computeWeeklyFrequency } from '../weeklyFrequency';

const SNAPSHOT = readFileSync('src/home/useWorkoutActivitySnapshot.ts', 'utf8');
const HEATMAP = readFileSync('src/components/home/FrequencyHeatmap.tsx', 'utf8');
const HOME = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
const APP_SHELL = readFileSync('src/screens/AppShell.tsx', 'utf8');
const LOCALES = ['pt-BR', 'en', 'es'] as const;

/**
 * "Frequência desta semana" — wiring, not arithmetic.
 *
 * The arithmetic is pinned by `weeklyFrequency.test.ts`. What this file pins
 * is that the Home actually shows THAT metric, computed from the right data,
 * without disturbing the two neighbouring metrics it is easy to confuse it
 * with: the 30-day heatmap and the Chama 2.0 streak.
 */
describe('the Home computes the weekly frequency from credited performed days', () => {
  it('derives it in the activity snapshot, reusing the already-fetched dates', () => {
    expect(SNAPSHOT).toContain('computeWeeklyFrequency');
    // Same `completedDates` the week overview uses — which this hook builds
    // from `performedDates`, never from scheduled dates.
    expect(SNAPSHOT).toContain('performedLocalDates: completedDates');
    expect(SNAPSHOT).toContain('goal: input.prescribedTrainingFrequency');
    expect(SNAPSHOT).toContain('setCompletedDates(new Set(dates.performedDates))');
  });

  it('adds no Firestore read of its own', () => {
    // It must be a `useMemo` over data already in the hook, not a new fetch.
    const start = SNAPSHOT.indexOf('const weeklyFrequency = useMemo(');
    expect(start).toBeGreaterThan(-1);
    const block = SNAPSHOT.slice(start, SNAPSHOT.indexOf('return {', start));
    expect(block).not.toContain('await');
    expect(block).not.toContain('getDocs');
    expect(block).not.toContain('listCompleted');
  });

  it('is plumbed AppShell -> HomeScreen -> FrequencyHeatmap', () => {
    expect(APP_SHELL).toContain('weeklyFrequency={activitySnapshot.weeklyFrequency}');
    expect(HOME).toContain('weeklyFrequency={weeklyFrequency ?? null}');
    expect(HEATMAP).toContain('weeklyFrequency = null,');
  });
});

describe('it renders inside the existing section, with existing tokens', () => {
  it('lives in the frequency section above the 30-day grid, not in a new card', () => {
    const sectionTitle = HEATMAP.indexOf("t('activity.frequency.title')");
    const weeklyRow = HEATMAP.indexOf("t('activity.frequency.weekly.label')");
    const grid = HEATMAP.indexOf('cellSizeForWidth');
    expect(sectionTitle).toBeGreaterThan(-1);
    expect(weeklyRow).toBeGreaterThan(sectionTitle);
    // Rendered before the grid markup, inside the same wrapper View.
    expect(weeklyRow).toBeLessThan(HEATMAP.lastIndexOf('borderRadius: 8'));
    expect(grid).toBeGreaterThan(-1);
  });

  it('reuses the section’s own colours and label component — no new palette', () => {
    const start = HEATMAP.indexOf("{weeklyFrequency && weeklyFrequency.percent !== null && (");
    const block = HEATMAP.slice(start, HEATMAP.indexOf('<View style={{ flexDirection: \'row\', alignItems: \'center\', justifyContent: \'center\'', start));
    expect(block).toContain('MonoLabel');
    expect(block).toContain("'#4da3ff'");
    expect(block).toContain("'rgba(255,255,255,0.5)'");
    expect(block).toContain("'rgba(255,255,255,0.05)'");
    // A discreet bar, not a chart.
    expect(block).toContain('height: 3');
    expect(block).toContain('accessibilityRole="progressbar"');
  });

  it('never renders a misleading 0% when the goal is unusable', () => {
    expect(HEATMAP).toContain('weeklyFrequency.percent !== null');
    // The guard must be on `percent`, not merely on the object existing.
    expect(HEATMAP).not.toContain('{weeklyFrequency && (');
  });
});

describe('the 30-day heatmap and the streak keep their own semantics', () => {
  it('does not replace or remove the 30-day grid or its summary', () => {
    expect(HEATMAP).toContain("t('activity.frequency.summaryCurrent'");
    expect(HEATMAP).toContain("t('activity.frequency.summaryPeriod'");
    expect(HEATMAP).toContain('GRID_ROWS');
    expect(HOME).toContain('sessionsLast30Days={frequencyWindow?.completedCount ?? null}');
  });

  it('never feeds the streak from the weekly frequency, or vice-versa', () => {
    const start = HEATMAP.indexOf("{weeklyFrequency && weeklyFrequency.percent !== null && (");
    const block = HEATMAP.slice(start, start + 1600);
    expect(block).not.toContain('dailyStreak');
    expect(block).not.toContain('streak');
    // And the snapshot's weekly computation never sees nutrition.
    const memo = SNAPSHOT.slice(SNAPSHOT.indexOf('const weeklyFrequency = useMemo('));
    expect(memo).not.toContain('nutrition');
  });
});

describe('translations exist in every locale, additively', () => {
  for (const locale of LOCALES) {
    it(`${locale} has the two new keys and keeps the pre-existing ones`, () => {
      const json = JSON.parse(readFileSync(`src/i18n/resources/${locale}/home.json`, 'utf8'));
      const frequency = json.activity.frequency;
      expect(typeof frequency.weekly.label).toBe('string');
      expect(frequency.weekly.summary).toContain('{{trained}}');
      expect(frequency.weekly.summary).toContain('{{goal}}');
      // Untouched neighbours.
      expect(typeof frequency.title).toBe('string');
      expect(typeof frequency.summaryCurrent).toBe('string');
      // The daily-limit copy is forward-looking ONLY on the pilot's own key.
      // "Volte amanhã" is a promise the new model keeps (any day is
      // trainable) and the legacy one does not — a Mon/Wed/Fri account
      // finishing Monday is not back tomorrow — so the published key must
      // keep its neutral sentence.
      expect(json.schedule.completedTodayFree.body).toMatch(/amanh|tomorrow|mañana/i);
      expect(json.schedule.completedToday.body).not.toMatch(/amanh|tomorrow|mañana/i);
    });
  }
});

describe('the product examples, end to end through the pure module', () => {
  const at = (dates: string[], goal: number) => computeWeeklyFrequency({
    todayLocalDate: '2026-10-25', // Sunday of the Mon 19 – Sun 25 week
    goal,
    performedLocalDates: new Set(dates),
  });

  it('meta 5, 3 dias = 60%', () => {
    expect(at(['2026-10-19', '2026-10-21', '2026-10-23'], 5).percent).toBe(60);
  });

  it('meta 5, 4 dias = 80%', () => {
    const result = at(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'], 5);
    expect(result.percent).toBe(80);
    expect(result.trainedDays).toBe(4);
    expect(result.goal).toBe(5);
  });

  it('meta 5, 5 dias = 100%', () => {
    expect(at(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'], 5).percent).toBe(100);
  });

  it('a weekend-only week still counts — recommended days are irrelevant', () => {
    expect(at(['2026-10-24', '2026-10-25'], 5).percent).toBe(40);
  });

  it('an unusable goal yields null, never 0%', () => {
    expect(at(['2026-10-19'], 0).percent).toBeNull();
  });
});
