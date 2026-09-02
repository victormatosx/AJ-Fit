import type { PendingEvolution } from './types';

/** Fase 4 domain constants (docs progression/09_DEFERRAL.md, ADR-009). */
export const DEFERRAL_CONFIG = {
  windowDays: 14,
  maxDeferrals: 2,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DeferralView {
  pendingEvolutionId: string;
  status: 'READY' | 'DEFERRED';
  deferralCount: 0 | 1 | 2;
  nextPromptAt: Date | null;
  autoActivateAt: Date | null;
}

/**
 * Whether the pending evolution should currently be offered to the user
 * (first time, or a deferred one whose window has elapsed). Never true once
 * the second deferral window has started — at that point only auto-activation
 * applies (docs §27/§29).
 */
export function isPromptable(pending: DeferralView, now: Date): boolean {
  if (pending.deferralCount === 0) return true;
  if (pending.deferralCount === 1) return pending.nextPromptAt != null && now.getTime() >= pending.nextPromptAt.getTime();
  return false;
}

/** A deferral is only accepted while promptable and under the maximum (docs §29). */
export function canDefer(pending: DeferralView, now: Date): boolean {
  return pending.deferralCount < DEFERRAL_CONFIG.maxDeferrals && isPromptable(pending, now);
}

export interface DeferralTransition {
  deferralCount: 1 | 2;
  status: 'DEFERRED';
  nextPromptAt: Date | null;
  autoActivateAt: Date | null;
}

/**
 * Pure transition for a defer action. The first deferral opens a second
 * prompt window (`nextPromptAt`); the second (and final) deferral opens the
 * auto-activation deadline (`autoActivateAt`) instead — there is no third
 * window (docs §26/§28/§29).
 */
export function applyDefer(pending: DeferralView, now: Date): DeferralTransition {
  if (!canDefer(pending, now)) throw new Error('WORKOUT_LIFECYCLE_DEFERRAL_NOT_ALLOWED');
  const deferralCount = (pending.deferralCount + 1) as 1 | 2;
  const windowEnd = new Date(now.getTime() + DEFERRAL_CONFIG.windowDays * MS_PER_DAY);
  return deferralCount === 1
    ? { deferralCount, status: 'DEFERRED', nextPromptAt: windowEnd, autoActivateAt: null }
    : { deferralCount, status: 'DEFERRED', nextPromptAt: null, autoActivateAt: windowEnd };
}

/** Auto-activation is due once the second deferral's window has fully elapsed — reconciled on any trusted runtime entry, not on a wall-clock deadline callback (docs §30-32). */
export function isAutoActivationDue(pending: DeferralView, now: Date): boolean {
  return pending.deferralCount >= DEFERRAL_CONFIG.maxDeferrals
    && pending.autoActivateAt != null
    && now.getTime() >= pending.autoActivateAt.getTime();
}

export function toDeferralView(pending: Pick<PendingEvolution<Date>, 'pendingEvolutionId' | 'status' | 'deferralCount' | 'nextPromptAt' | 'autoActivateAt'>): DeferralView {
  return {
    pendingEvolutionId: pending.pendingEvolutionId,
    status: pending.status,
    deferralCount: pending.deferralCount,
    nextPromptAt: pending.nextPromptAt,
    autoActivateAt: pending.autoActivateAt,
  };
}
