import { describe, expect, it } from 'vitest';
import {
  applyDefer, canDefer, DEFERRAL_CONFIG, DEFERRAL_CONFIG_QA_ACCELERATED,
  isAutoActivationDue, isPromptable, resolveDeferralConfig,
} from '../deferral';
import type { DeferralView } from '../deferral';

const D0 = new Date('2026-01-01T00:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function fresh(): DeferralView {
  return { pendingEvolutionId: 'p1', status: 'READY', deferralCount: 0, nextPromptAt: null, autoActivateAt: null };
}

describe('state machine — allowed transitions', () => {
  it('NONE/READY is always promptable', () => {
    expect(isPromptable(fresh(), D0)).toBe(true);
  });

  it('READY -> DEFERRED (first defer)', () => {
    const result = applyDefer(fresh(), D0);
    expect(result).toEqual({
      deferralCount: 1,
      status: 'DEFERRED',
      nextPromptAt: new Date(D0.getTime() + 14 * MS_PER_DAY),
      autoActivateAt: null,
    });
  });

  it('DEFERRED (count=1) -> READY again once nextPromptAt elapses', () => {
    const deferred: DeferralView = { pendingEvolutionId: 'p1', status: 'DEFERRED', deferralCount: 1, nextPromptAt: new Date(D0.getTime() + 14 * MS_PER_DAY), autoActivateAt: null };
    expect(isPromptable(deferred, new Date(D0.getTime() + 14 * MS_PER_DAY))).toBe(true);
    expect(isPromptable(deferred, new Date(D0.getTime() + 13 * MS_PER_DAY))).toBe(false);
  });

  it('DEFERRED (count=1, window elapsed) -> DEFERRED (count=2, second/final window)', () => {
    const readyAgain: DeferralView = { pendingEvolutionId: 'p1', status: 'DEFERRED', deferralCount: 1, nextPromptAt: new Date(D0.getTime() + 14 * MS_PER_DAY), autoActivateAt: null };
    const now = new Date(D0.getTime() + 14 * MS_PER_DAY);
    const result = applyDefer(readyAgain, now);
    expect(result.deferralCount).toBe(2);
    expect(result.autoActivateAt).toEqual(new Date(now.getTime() + 14 * MS_PER_DAY));
    expect(result.nextPromptAt).toBeNull();
  });

  it('deferralCount=2 (final) is never promptable and auto-activates once its window elapses', () => {
    const final: DeferralView = { pendingEvolutionId: 'p1', status: 'DEFERRED', deferralCount: 2, nextPromptAt: null, autoActivateAt: new Date(D0.getTime() + 28 * MS_PER_DAY) };
    expect(isPromptable(final, new Date(D0.getTime() + 30 * MS_PER_DAY))).toBe(false);
    expect(isAutoActivationDue(final, new Date(D0.getTime() + 27 * MS_PER_DAY))).toBe(false);
    expect(isAutoActivationDue(final, new Date(D0.getTime() + 28 * MS_PER_DAY))).toBe(true);
    expect(isAutoActivationDue(final, new Date(D0.getTime() + 40 * MS_PER_DAY))).toBe(true); // late reconciliation still fires
  });
});

describe('state machine — forbidden transitions', () => {
  it('cannot defer a third time', () => {
    const final: DeferralView = { pendingEvolutionId: 'p1', status: 'DEFERRED', deferralCount: 2, nextPromptAt: null, autoActivateAt: new Date(D0.getTime() + 28 * MS_PER_DAY) };
    expect(canDefer(final, new Date(D0.getTime() + 40 * MS_PER_DAY))).toBe(false);
    expect(() => applyDefer(final, new Date(D0.getTime() + 40 * MS_PER_DAY))).toThrow('WORKOUT_LIFECYCLE_DEFERRAL_NOT_ALLOWED');
  });

  it('cannot defer while still inside the first window (not yet promptable again)', () => {
    const deferred: DeferralView = { pendingEvolutionId: 'p1', status: 'DEFERRED', deferralCount: 1, nextPromptAt: new Date(D0.getTime() + 14 * MS_PER_DAY), autoActivateAt: null };
    const tooSoon = new Date(D0.getTime() + 5 * MS_PER_DAY);
    expect(canDefer(deferred, tooSoon)).toBe(false);
    expect(() => applyDefer(deferred, tooSoon)).toThrow();
  });
});

describe('boundaries', () => {
  const D0plus14 = new Date(D0.getTime() + DEFERRAL_CONFIG.windowMs);

  it('13d 23:59:59.999 is not yet promptable; exactly 14d is', () => {
    const deferred: DeferralView = { pendingEvolutionId: 'p1', status: 'DEFERRED', deferralCount: 1, nextPromptAt: D0plus14, autoActivateAt: null };
    expect(isPromptable(deferred, new Date(D0plus14.getTime() - 1))).toBe(false);
    expect(isPromptable(deferred, D0plus14)).toBe(true);
  });

  it('27d 23:59:59.999 is not yet auto-activated; exactly 28d is (D0+14+14)', () => {
    const autoActivateAt = new Date(D0plus14.getTime() + DEFERRAL_CONFIG.windowMs);
    const final: DeferralView = { pendingEvolutionId: 'p1', status: 'DEFERRED', deferralCount: 2, nextPromptAt: null, autoActivateAt };
    expect(isAutoActivationDue(final, new Date(autoActivateAt.getTime() - 1))).toBe(false);
    expect(isAutoActivationDue(final, autoActivateAt)).toBe(true);
  });
});

describe('QA_ACCELERATED policy', () => {
  it('resolveDeferralConfig maps NORMAL/QA_ACCELERATED to the right constants', () => {
    expect(resolveDeferralConfig('NORMAL')).toBe(DEFERRAL_CONFIG);
    expect(resolveDeferralConfig('QA_ACCELERATED')).toBe(DEFERRAL_CONFIG_QA_ACCELERATED);
  });

  it('never changes maxDeferrals — still exactly two deferrals under QA', () => {
    expect(DEFERRAL_CONFIG_QA_ACCELERATED.maxDeferrals).toBe(DEFERRAL_CONFIG.maxDeferrals);
  });

  it('applyDefer under QA_ACCELERATED uses the compressed window, not the 14-day one', () => {
    const result = applyDefer(fresh(), D0, DEFERRAL_CONFIG_QA_ACCELERATED);
    expect(result.nextPromptAt).toEqual(new Date(D0.getTime() + DEFERRAL_CONFIG_QA_ACCELERATED.windowMs));
    expect(result.nextPromptAt).not.toEqual(new Date(D0.getTime() + DEFERRAL_CONFIG.windowMs));
  });

  it('defaults to NORMAL when no config is passed (production behavior unchanged)', () => {
    const result = applyDefer(fresh(), D0);
    expect(result.nextPromptAt).toEqual(new Date(D0.getTime() + DEFERRAL_CONFIG.windowMs));
  });
});

describe('idempotent-shape guarantee', () => {
  it('applyDefer is a pure function of (pending, now) — same input, same output', () => {
    const pending = fresh();
    expect(applyDefer(pending, D0)).toEqual(applyDefer(pending, D0));
  });
});
