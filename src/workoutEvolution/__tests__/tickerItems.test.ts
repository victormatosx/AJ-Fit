import { describe, expect, it } from 'vitest';
import { buildEvolutionTickerContent, type TickerTranslate } from '../tickerItems';
import type { EvolutionViewModel, ProgressingSummary } from '../types';

// Deterministic stand-in for react-i18next's `t` — echoes the key (plus
// interpolated options) instead of resolving real copy, so assertions read
// the exact key/args the adapter picked without depending on locale files.
const t: TickerTranslate = (key, options) => (options ? `${key}:${JSON.stringify(options)}` : key);

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
    ...overrides,
  };
}

const PENDING = {
  type: 'CYCLE_EVOLUTION' as const,
  quality: 'GOOD' as const,
  fromLevel: 'INTERMEDIATE' as const,
  toLevel: 'INTERMEDIATE' as const,
  deferralCount: 0 as const,
  nextPromptAt: null,
  autoActivateAt: null,
  sessionsCompletedAtEarn: 20,
};

describe('buildEvolutionTickerContent — non-marquee states', () => {
  it('LOADING is a static line, never a marquee', () => {
    const content = buildEvolutionTickerContent({ kind: 'LOADING' }, t);
    expect(content).toEqual({ mode: 'STATIC', text: 'state.loading' });
  });

  it('ERROR is a static line, never a marquee', () => {
    const content = buildEvolutionTickerContent({ kind: 'ERROR', message: 'boom' }, t);
    expect(content).toEqual({ mode: 'STATIC', text: 'state.error' });
  });

  it('UNAVAILABLE hides the surface entirely — no permanent empty block', () => {
    const content = buildEvolutionTickerContent({ kind: 'UNAVAILABLE' }, t);
    expect(content).toEqual({ mode: 'HIDDEN' });
  });
});

describe('buildEvolutionTickerContent — PROGRESSING marquee', () => {
  it('never surfaces cycleNumber in the marquee', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('MARQUEE');
    if (content.mode !== 'MARQUEE') return;
    const joined = content.items.map((i) => `${i.label} ${i.value}`).join(' ');
    expect(joined).not.toContain('4');
    expect(joined).not.toMatch(/cycle/i);
  });

  it('omits null dimensions instead of rendering zero/placeholder', () => {
    const vm: EvolutionViewModel = {
      kind: 'PROGRESSING',
      summary: summary({ proximity: null, activeDays: null, sessionsCompleted: null, adherenceQuality: null }),
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('MARQUEE');
    if (content.mode !== 'MARQUEE') return;
    const joined = JSON.stringify(content.items);
    expect(joined).not.toContain('ticker.labels.activeDays');
    expect(joined).not.toContain('ticker.labels.sessions');
    expect(joined).not.toContain('ticker.labels.adherence');
    expect(joined).toContain('state.evaluationPaused');
  });

  it('surfaces activeDays/sessionsCompleted/adherence/proximity from the real summary only, each as label+value', () => {
    const vm: EvolutionViewModel = { kind: 'PROGRESSING', summary: summary() };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('MARQUEE');
    if (content.mode !== 'MARQUEE') return;
    expect(content.items).toEqual([
      { label: 'activePrescription', value: 'level.INTERMEDIATE' },
      { label: 'ticker.labels.activeDays', value: '12' },
      { label: 'ticker.labels.sessions', value: '8' },
      { label: 'ticker.labels.adherence', value: 'ticker.values.adherence.GOOD' },
      { label: 'ticker.labels.proximity', value: 'ticker.values.proximity.ON_TRACK' },
    ]);
  });

  it('never invents a synthetic percentage for adherence/proximity', () => {
    const vm: EvolutionViewModel = {
      kind: 'PROGRESSING',
      summary: summary({ adherenceQuality: 'HIGH', proximity: 'READY' }),
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('MARQUEE');
    if (content.mode !== 'MARQUEE') return;
    expect(JSON.stringify(content.items)).not.toMatch(/%|\d{2,3}%/);
  });

  it('surfaces earnedLevel !== activeLevel as its own label+value item instead of hiding it', () => {
    const vm: EvolutionViewModel = {
      kind: 'PROGRESSING',
      summary: summary({ earnedLevel: 'ADVANCED', activeLevel: 'INTERMEDIATE' }),
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('MARQUEE');
    if (content.mode !== 'MARQUEE') return;
    expect(content.items).toContainEqual({ label: 'ticker.labels.earnedLevel', value: 'level.ADVANCED' });
  });

  it('gives the free-standing evaluation-paused status no separate label', () => {
    const vm: EvolutionViewModel = {
      kind: 'PROGRESSING',
      summary: summary({ proximity: null }),
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('MARQUEE');
    if (content.mode !== 'MARQUEE') return;
    expect(content.items).toContainEqual({ label: '', value: 'state.evaluationPaused' });
  });

  it('drops the in-progress copy once a post-discard projection has real progression data', () => {
    const before = buildEvolutionTickerContent({
      kind: 'PROGRESSING',
      summary: summary({ proximity: null, activeDays: null, sessionsCompleted: null, adherenceQuality: null }),
    }, t);
    const after = buildEvolutionTickerContent({
      kind: 'PROGRESSING',
      summary: summary({ proximity: 'BUILDING', activeDays: 3, sessionsCompleted: 1 }),
    }, t);
    expect(JSON.stringify(before)).toContain('state.evaluationPaused');
    expect(JSON.stringify(after)).not.toContain('state.evaluationPaused');
  });
});

describe('buildEvolutionTickerContent — ACTION states reach the same unlock flow', () => {
  it('EVOLUTION_READY (cycle) becomes an ACTION with the cycle-ready headline', () => {
    const vm: EvolutionViewModel = {
      kind: 'EVOLUTION_READY',
      summary: summary(),
      pending: PENDING,
      canDefer: true,
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content).toMatchObject({
      mode: 'ACTION',
      icon: 'trophy',
      headline: 'unlock.cycleReadyCard',
      ctaLabel: 'ticker.viewEvolution',
      accessibilityLabel: 'ticker.accessibility.openEvolution',
    });
  });

  it('EVOLUTION_READY (level promotion) uses the trophy icon and level-ready headline', () => {
    const vm: EvolutionViewModel = {
      kind: 'EVOLUTION_READY',
      summary: summary(),
      pending: { ...PENDING, type: 'LEVEL_PROMOTION' },
      canDefer: true,
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content).toMatchObject({ icon: 'trophy', headline: 'unlock.levelReadyCard' });
  });

  it('EVOLUTION_READY (motivational renewal) uses the sparkles icon, never a level/cycle claim', () => {
    const vm: EvolutionViewModel = {
      kind: 'EVOLUTION_READY',
      summary: summary(),
      pending: { ...PENDING, type: 'MOTIVATIONAL_RENEWAL' },
      canDefer: true,
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content).toMatchObject({ icon: 'sparkles', headline: 'motivationalRenewal.cardReady' });
  });

  it('EVOLUTION_DEFERRED keeps the same headline family as READY, still an ACTION', () => {
    const vm: EvolutionViewModel = { kind: 'EVOLUTION_DEFERRED', summary: summary(), pending: PENDING };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('ACTION');
  });

  it('AUTO_ACTIVATION_NOTICE becomes an ACTION with its own copy/CTA/a11y label', () => {
    const vm: EvolutionViewModel = {
      kind: 'AUTO_ACTIVATION_NOTICE',
      summary: summary(),
      activatedType: 'LEVEL_PROMOTION',
      activationEventId: 'evt-1',
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content).toMatchObject({
      mode: 'ACTION',
      icon: 'sparkles',
      headline: 'auto.card.LEVEL_PROMOTION',
      ctaLabel: 'ticker.viewChanges',
      accessibilityLabel: 'ticker.accessibility.openAutoActivation',
    });
  });

  it('carries the earnedLevel note into the ACTION content instead of dropping it', () => {
    const vm: EvolutionViewModel = {
      kind: 'EVOLUTION_READY',
      summary: summary({ earnedLevel: 'ADVANCED', activeLevel: 'INTERMEDIATE' }),
      pending: { ...PENDING, type: 'LEVEL_PROMOTION' },
      canDefer: true,
    };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('ACTION');
    if (content.mode !== 'ACTION') return;
    expect(content.earnedLevelNote).toContain('careerLevel');
    expect(content.earnedLevelNote).toContain('level.ADVANCED');
  });

  it('omits the earnedLevel note when earned and active levels match', () => {
    const vm: EvolutionViewModel = { kind: 'EVOLUTION_READY', summary: summary(), pending: PENDING, canDefer: true };
    const content = buildEvolutionTickerContent(vm, t);
    expect(content.mode).toBe('ACTION');
    if (content.mode !== 'ACTION') return;
    expect(content.earnedLevelNote).toBeNull();
  });
});
