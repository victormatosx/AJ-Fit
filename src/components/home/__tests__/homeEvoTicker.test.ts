import { describe, expect, it } from 'vitest';
import { buildHomeEvoTickerItems, type HomeEvoTickerTranslate } from '../homeEvoTickerItems';
import type { EvolutionViewModel, ProgressingSummary } from '../../../workoutEvolution/types';
import type { DailyActivityStreak } from '../../../home/dailyActivityStreak';

// Deterministic stand-in for react-i18next's `t` — echoes the key (plus
// interpolated options) instead of resolving real copy, so assertions read
// the exact key/args the builder picked without depending on locale files.
// Mirrors `workoutEvolution/__tests__/tickerItems.test.ts`'s own `t` fixture.
const t: HomeEvoTickerTranslate = (key, options) => (options ? `${key}:${JSON.stringify(options)}` : key);

function summary(overrides: Partial<ProgressingSummary> = {}): ProgressingSummary {
  return {
    earnedLevel: 'INTERMEDIATE',
    activeLevel: 'INTERMEDIATE',
    cycleNumber: 4,
    proximity: 'ON_TRACK',
    activeDays: 12,
    sessionsCompleted: 8,
    adherenceQuality: 'GOOD',
    isHistoryComplete: true,
    adherenceRatio: 0.8,
    requiredActiveDays: 85,
    pausedAtLocalDate: null,
    intermediateCyclesEarned: null,
    ...overrides,
  };
}

// The ticker's streak item is now the DAILY ACTIVITY streak (a workout OR a
// food entry on a calendar day), which has a single unit — so the old
// obligations/weeks split no longer applies to this surface.
const STREAK: DailyActivityStreak = { current: 5, complete: true };

describe('buildHomeEvoTickerItems — non-marquee view model kinds', () => {
  it('LOADING yields no items', () => {
    expect(buildHomeEvoTickerItems({ kind: 'LOADING' }, STREAK, 10, t)).toEqual([]);
  });

  it('ERROR yields no items', () => {
    expect(buildHomeEvoTickerItems({ kind: 'ERROR', message: 'boom' }, STREAK, 10, t)).toEqual([]);
  });

  it('UNAVAILABLE yields no items', () => {
    expect(buildHomeEvoTickerItems({ kind: 'UNAVAILABLE' }, STREAK, 10, t)).toEqual([]);
  });
});

describe('buildHomeEvoTickerItems — item presence, each gated on its own real data', () => {
  it('includes all 6 items when every input is available', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const items = buildHomeEvoTickerItems(vm, STREAK, 10, t);
    expect(items).toEqual([
      { label: 'home:evoTicker.streakLabel', value: 'home:evoTicker.streakValue:{"count":5}' },
      { label: 'home:evoTicker.activeDaysLabel', value: 'home:evoTicker.activeDaysValue:{"count":12,"required":85}' },
      { label: 'home:evoTicker.adherenceLabel', value: 'home:evoTicker.adherenceValue:{"percent":80}' },
      { label: 'home:evoTicker.cycleLabel', value: 'home:evoTicker.cycleValue:{"number":4}' },
      { label: 'home:evoTicker.levelLabel', value: 'home:evoTicker.levelValue:{"level":"evolution:level.INTERMEDIATE"}' },
      { label: 'home:evoTicker.sessions30dLabel', value: 'home:evoTicker.sessions30dValue:{"count":10}' },
    ]);
  });

  it('always renders the streak in days — the daily streak has no second unit', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const items = buildHomeEvoTickerItems(vm, { current: 3, complete: true }, 10, t);
    expect(items[0]).toEqual({ label: 'home:evoTicker.streakLabel', value: 'home:evoTicker.streakValue:{"count":3}' });
  });

  it('renders a lower-bound streak without pretending it is exact', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const items = buildHomeEvoTickerItems(vm, { current: 520, complete: false }, 10, t);
    expect(items[0]).toEqual({ label: 'home:evoTicker.streakLabel', value: 'home:evoTicker.streakValue:{"count":520}' });
  });

  it('omits the streak item when streak is null, never showing a fabricated 0', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const items = buildHomeEvoTickerItems(vm, null, 10, t);
    expect(items.some((i) => i.label === 'home:evoTicker.streakLabel')).toBe(false);
  });

  it('omits the activeDays item when summary.activeDays is null', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary({ activeDays: null }) };
    const items = buildHomeEvoTickerItems(vm, STREAK, 10, t);
    expect(items.some((i) => i.label === 'home:evoTicker.activeDaysLabel')).toBe(false);
  });

  it('omits the adherence item when summary.adherenceRatio is null', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary({ adherenceRatio: null }) };
    const items = buildHomeEvoTickerItems(vm, STREAK, 10, t);
    expect(items.some((i) => i.label === 'home:evoTicker.adherenceLabel')).toBe(false);
  });

  it('omits the sessions30d item when sessionsLast30Days is null', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const items = buildHomeEvoTickerItems(vm, STREAK, null, t);
    expect(items.some((i) => i.label === 'home:evoTicker.sessions30dLabel')).toBe(false);
  });

  it('always includes cycle and level, regardless of other nullability', () => {
    const vm: EvolutionViewModel = {
      kind: 'PROGRESSING',
      summary: summary({ activeDays: null, adherenceRatio: null }),
    };
    const items = buildHomeEvoTickerItems(vm, null, null, t);
    expect(items).toEqual([
      { label: 'home:evoTicker.cycleLabel', value: 'home:evoTicker.cycleValue:{"number":4}' },
      { label: 'home:evoTicker.levelLabel', value: 'home:evoTicker.levelValue:{"level":"evolution:level.INTERMEDIATE"}' },
    ]);
  });
});
