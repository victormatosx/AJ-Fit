import { describe, expect, it } from 'vitest';
import { buildHomeEvoTickerItems, type HomeEvoTickerTranslate } from '../homeEvoTickerItems';
import type { EvolutionViewModel, ProgressingSummary } from '../../../workoutEvolution/types';
import type { Streak } from '../../../home/streak';

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

const STREAK: Streak = { scheduleMode: 'fixed', unit: 'obligations', current: 5, complete: true };

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
      'home:evoTicker.streak:{"count":5}',
      'home:evoTicker.activeDays:{"count":12,"required":85}',
      'home:evoTicker.adherence:{"percent":80}',
      'home:evoTicker.cycle:{"number":4}',
      'home:evoTicker.level:{"level":"evolution:level.INTERMEDIATE"}',
      'home:evoTicker.sessions30d:{"count":10}',
    ]);
  });

  it('omits the streak item when streak is null, never showing a fabricated 0', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const items = buildHomeEvoTickerItems(vm, null, 10, t);
    expect(items.some((i) => i.startsWith('home:evoTicker.streak'))).toBe(false);
  });

  it('omits the activeDays item when summary.activeDays is null', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary({ activeDays: null }) };
    const items = buildHomeEvoTickerItems(vm, STREAK, 10, t);
    expect(items.some((i) => i.startsWith('home:evoTicker.activeDays'))).toBe(false);
  });

  it('omits the adherence item when summary.adherenceRatio is null', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary({ adherenceRatio: null }) };
    const items = buildHomeEvoTickerItems(vm, STREAK, 10, t);
    expect(items.some((i) => i.startsWith('home:evoTicker.adherence'))).toBe(false);
  });

  it('omits the sessions30d item when sessionsLast30Days is null', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const items = buildHomeEvoTickerItems(vm, STREAK, null, t);
    expect(items.some((i) => i.startsWith('home:evoTicker.sessions30d'))).toBe(false);
  });

  it('always includes cycle and level, regardless of other nullability', () => {
    const vm: EvolutionViewModel = {
      kind: 'PROGRESSING',
      summary: summary({ activeDays: null, adherenceRatio: null }),
    };
    const items = buildHomeEvoTickerItems(vm, null, null, t);
    expect(items).toEqual([
      'home:evoTicker.cycle:{"number":4}',
      'home:evoTicker.level:{"level":"evolution:level.INTERMEDIATE"}',
    ]);
  });
});
