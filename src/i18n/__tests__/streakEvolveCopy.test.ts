import { describe, expect, it } from 'vitest';

import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';
import { STREAK_FLAME_TIERS, STREAK_MILESTONES } from '../../home/streakFlameTiers';

const LOCALES = { 'pt-BR': ptBR, en, es } as const;

/** Guards against a tier shipping without copy — the real failure mode. */

type StreakBlock = {
  evolve: Record<string, string>;
  color: Record<string, string>;
  colorCap: Record<string, string>;
  tier: Record<string, string>;
};

// The daily activity streak has a single unit (days), so the old
// weeks-variant keys were removed along with the obligations/weeks split.
const EVOLVE_KEYS = [
  'label', 'daysInRow', 'title', 'next', 'max',
  'before', 'now', 'nextMilestone', 'nextDays', 'none', 'continue',
];

describe('streak evolve copy', () => {
  it.each(Object.keys(LOCALES))('%s defines every key the screen renders', (locale) => {
    const streak = (LOCALES[locale as keyof typeof LOCALES] as { streak: StreakBlock }).streak;
    expect(streak).toBeTruthy();
    for (const key of EVOLVE_KEYS) {
      expect(streak.evolve[key], `${locale} streak.evolve.${key}`).toBeTruthy();
    }
    // Every tier needs a sentence-case colour, a capitalised colour and a name.
    for (const tier of STREAK_FLAME_TIERS) {
      expect(streak.color[tier.id], `${locale} streak.color.${tier.id}`).toBeTruthy();
      expect(streak.colorCap[tier.id], `${locale} streak.colorCap.${tier.id}`).toBeTruthy();
      expect(streak.tier[tier.id], `${locale} streak.tier.${tier.id}`).toBeTruthy();
    }
  });

  it.each(Object.keys(LOCALES))('%s keeps the interpolation placeholders intact', (locale) => {
    const { evolve } = (LOCALES[locale as keyof typeof LOCALES] as { streak: StreakBlock }).streak;
    expect(evolve.title).toContain('{{color}}');
    for (const key of ['next']) {
      expect(evolve[key], `${locale} streak.evolve.${key}`).toContain('{{count}}');
      expect(evolve[key], `${locale} streak.evolve.${key}`).toContain('{{color}}');
    }
    for (const key of ['nextDays']) {
      expect(evolve[key], `${locale} streak.evolve.${key}`).toContain('{{count}}');
    }
    // The max-tier line must NOT interpolate — there is no next milestone.
    expect(evolve.max).not.toContain('{{');
  });

  it('has no hardcoded Portuguese left in the English and Spanish blocks', () => {
    expect((en as { streak: StreakBlock }).streak.evolve.continue).toBe('Continue');
    expect((en as { streak: StreakBlock }).streak.color.ember).toBe('orange');
    expect((es as { streak: StreakBlock }).streak.color.ember).toBe('naranja');
    // New tiers must be translated too, not left as English placeholders.
    expect((en as { streak: StreakBlock }).streak.color.plasma).toBe('cyan');
    expect((es as { streak: StreakBlock }).streak.color.plasma).toBe('cian');
    expect((es as { streak: StreakBlock }).streak.color.stellar).toBe('blanca');
    expect((en as { streak: StreakBlock }).streak.evolve.label).toBe('STREAK');
  });

  it('can phrase every milestone transition in every locale', () => {
    for (const locale of Object.keys(LOCALES)) {
      const streak = (LOCALES[locale as keyof typeof LOCALES] as { streak: StreakBlock }).streak;
      for (const milestone of STREAK_MILESTONES) {
        const tier = STREAK_FLAME_TIERS.find((candidate) => candidate.min === milestone);
        expect(tier, `tier for milestone ${milestone}`).toBeTruthy();
        expect(streak.color[tier!.id]).toBeTruthy();
        expect(streak.colorCap[tier!.id]).toBeTruthy();
      }
    }
  });
});
