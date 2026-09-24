import { describe, expect, it } from 'vitest';
import type { EvolutionSummaryPresentationCache } from '../../lib/evolutionSummaryPresentationCache';
import { buildEvolutionTickerContent } from '../tickerItems';
import { nextViewModelAfterLoad } from '../loadReducer';
import {
  viewModelFromEvolutionPresentationCache,
  viewModelWhileEvolutionRefreshes,
} from '../presentationCachePolicy';
import type { EvolutionViewModel } from '../types';

const cached: EvolutionSummaryPresentationCache = {
  schemaVersion: 1,
  uid: 'A',
  programInstanceId: 'program-A',
  updatedAt: 1,
  summary: {
    activeLevel: 'INTERMEDIATE', cycleNumber: 3, proximity: 'ON_TRACK',
    activeDays: 12, sessionsCompleted: 7, adherenceQuality: 'GOOD',
  },
};
const t = (key: string) => key;

describe('Evolution presentation cache policy', () => {
  it('feeds the existing SUMMARY_READY visual path and cannot produce a CTA', () => {
    const viewModel = viewModelFromEvolutionPresentationCache(cached);
    expect(viewModel).toMatchObject({ kind: 'SUMMARY_READY', source: 'CACHE' });
    expect(buildEvolutionTickerContent(viewModel, t).mode).toBe('MARQUEE');
    expect(viewModel.kind === 'SUMMARY_READY' && viewModel.summary.earnedLevel).toBeNull();
  });

  it('keeps cached content on a remote error, marks it unavailable, and never becomes authoritative', () => {
    const viewModel = viewModelFromEvolutionPresentationCache(cached);
    expect(nextViewModelAfterLoad(viewModel, { status: 'failure' })).toEqual({
      ...viewModel,
      noticeUnavailable: true,
    });
  });

  it.each(['EVOLUTION_READY', 'EVOLUTION_DEFERRED', 'AUTO_ACTIVATION_NOTICE'] as const)(
    'turns stale %s into actionless SUMMARY_READY during post-workout/foreground refresh',
    (kind) => {
      const summary = { ...viewModelFromEvolutionPresentationCache(cached).summary, earnedLevel: 'INTERMEDIATE' as const };
      const pending = {
        type: 'CYCLE_EVOLUTION' as const, quality: 'GOOD' as const,
        fromLevel: 'INTERMEDIATE' as const, toLevel: 'INTERMEDIATE' as const,
        deferralCount: 0 as const, nextPromptAt: null, autoActivateAt: null,
        sessionsCompletedAtEarn: 7,
      };
      const actionable = (kind === 'EVOLUTION_READY'
        ? { kind, summary, pending, canDefer: true }
        : kind === 'EVOLUTION_DEFERRED'
          ? { kind, summary, pending }
          : { kind, summary, activatedType: 'CYCLE_EVOLUTION', activationEventId: 'event-1' }
      ) satisfies EvolutionViewModel;
      expect(viewModelWhileEvolutionRefreshes(actionable)).toEqual({
        kind: 'SUMMARY_READY', source: 'CURRENT_SESSION', summary,
      });
    },
  );

  it('does not turn LOADING, ERROR, or cached SUMMARY_READY into a different source', () => {
    const cacheView = viewModelFromEvolutionPresentationCache(cached);
    for (const viewModel of [
      { kind: 'LOADING' },
      { kind: 'ERROR', message: 'offline' },
      cacheView,
    ] as EvolutionViewModel[]) {
      expect(viewModelWhileEvolutionRefreshes(viewModel)).toBe(viewModel);
    }
  });
});
