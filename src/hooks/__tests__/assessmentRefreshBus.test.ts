import { describe, expect, it, vi } from 'vitest';

import {
  publishAssessmentRefresh,
  subscribeToAssessmentRefresh,
} from '../assessmentRefreshBus';

describe('assessment refresh bus', () => {
  it('refreshes every mounted consumer for the same user immediately', () => {
    const first = vi.fn();
    const second = vi.fn();
    const otherUser = vi.fn();
    const unsubscribeFirst = subscribeToAssessmentRefresh('uid-a', first);
    const unsubscribeSecond = subscribeToAssessmentRefresh('uid-a', second);
    const unsubscribeOther = subscribeToAssessmentRefresh('uid-b', otherUser);

    publishAssessmentRefresh('uid-a');

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(otherUser).not.toHaveBeenCalled();

    unsubscribeFirst();
    unsubscribeSecond();
    unsubscribeOther();
  });

  it('excludes the saving instance because it performs its own awaited refresh', () => {
    const savingInstance = vi.fn();
    const progressInstance = vi.fn();
    const unsubscribeSaving = subscribeToAssessmentRefresh('uid-a', savingInstance);
    const unsubscribeProgress = subscribeToAssessmentRefresh('uid-a', progressInstance);

    publishAssessmentRefresh('uid-a', savingInstance);

    expect(savingInstance).not.toHaveBeenCalled();
    expect(progressInstance).toHaveBeenCalledOnce();

    unsubscribeSaving();
    unsubscribeProgress();
  });

  it('does not refresh an instance after it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAssessmentRefresh('uid-a', listener);
    unsubscribe();

    publishAssessmentRefresh('uid-a');

    expect(listener).not.toHaveBeenCalled();
  });
});
