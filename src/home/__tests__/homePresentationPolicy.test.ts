import { describe, expect, it } from 'vitest';
import { buildFrequencyWindow } from '../frequencyHeatmap';
import { canUseTodayActions, canWriteHomePresentationSnapshot, chooseHomeFrequencyPresentation, shouldUseSnapshotPlaceholders } from '../homePresentationPolicy';
import type { HomeInitialReadiness } from '../homeInitialReadiness';

const readiness: HomeInitialReadiness = {
  today: 'SUCCESS', evolution: 'SUCCESS', activitySnapshot: 'SUCCESS',
  frequency: 'SUCCESS', supportInbox: 'SUCCESS', allRequiredDataSettled: true,
};
const frequency = buildFrequencyWindow({
  todayLocalDate: '2026-09-22', offsetWindows: 0, completedDates: new Set(['2026-09-22']),
});
const valid = {
  uid: 'A', programInstanceId: 'program-B', timezone: 'America/Sao_Paulo',
  readiness, activityLoading: false, frequencyLoading: false, frequency,
};

describe('Home snapshot write boundary', () => {
  it('requires current authority across every Home bootstrap section', () => {
    expect(canWriteHomePresentationSnapshot(valid)).toBe(true);
    for (const section of ['today', 'evolution', 'activitySnapshot', 'frequency', 'supportInbox'] as const) {
      expect(canWriteHomePresentationSnapshot({ ...valid, readiness: { ...readiness, [section]: 'ERROR' } })).toBe(false);
      expect(canWriteHomePresentationSnapshot({ ...valid, readiness: { ...readiness, [section]: 'PENDING' } })).toBe(false);
    }
    expect(canWriteHomePresentationSnapshot({ ...valid, programInstanceId: null })).toBe(false);
    expect(canWriteHomePresentationSnapshot({ ...valid, uid: null })).toBe(false);
    expect(canWriteHomePresentationSnapshot({ ...valid, frequencyLoading: true })).toBe(false);
    expect(canWriteHomePresentationSnapshot({ ...valid, activityLoading: true })).toBe(false);
  });

  it('rejects a paginated historical window after a post-workout refresh', () => {
    const previousWindow = buildFrequencyWindow({ todayLocalDate: '2026-09-22', offsetWindows: 1, completedDates: new Set() });
    expect(canWriteHomePresentationSnapshot({ ...valid, frequency: previousWindow })).toBe(false);
  });
});

describe('Home frequency presentation source', () => {
  it('keeps cache during a remote error and swaps directly to current data', () => {
    const cached = { label: 'history' };
    const fallback = { label: 'empty-error-grid' };
    const current = { label: 'new-current-data' };
    expect(chooseHomeFrequencyPresentation({ current: fallback, currentReadSucceeded: false, cached }))
      .toEqual({ source: 'CACHE', value: cached });
    expect(chooseHomeFrequencyPresentation({ current, currentReadSucceeded: true, cached }))
      .toEqual({ source: 'AUTHORITATIVE', value: current });
    expect(chooseHomeFrequencyPresentation({ current: null, currentReadSucceeded: false, cached: null }))
      .toEqual({ source: 'AUTHORITATIVE', value: null });
  });
});

describe('Today action gate', () => {
  it('never enables cached Today after a midnight rollover, offline error or program change', () => {
    expect(canUseTodayActions({ snapshotExists: true, todayStatus: 'PENDING', programInstanceId: null })).toBe(false);
    expect(canUseTodayActions({ snapshotExists: true, todayStatus: 'ERROR', programInstanceId: 'program-A' })).toBe(false);
    expect(canUseTodayActions({ snapshotExists: true, todayStatus: 'SUCCESS', programInstanceId: null })).toBe(false);
    expect(canUseTodayActions({ snapshotExists: true, todayStatus: 'SUCCESS', programInstanceId: 'program-B', scheduleMatchesActiveProgram: false })).toBe(false);
    expect(canUseTodayActions({ snapshotExists: true, todayStatus: 'SUCCESS', programInstanceId: 'program-B' })).toBe(true);
    expect(canUseTodayActions({ snapshotExists: false, todayStatus: 'ERROR', programInstanceId: null })).toBe(true);
  });
});

describe('post-workout and error visuals', () => {
  it('keeps local presentation on first-load error but retains session visuals after authority has existed', () => {
    expect(shouldUseSnapshotPlaceholders({ snapshotAvailable: true, authoritativeNow: false, authoritativeReachedOnce: false })).toBe(true);
    expect(shouldUseSnapshotPlaceholders({ snapshotAvailable: true, authoritativeNow: true, authoritativeReachedOnce: false })).toBe(false);
    expect(shouldUseSnapshotPlaceholders({ snapshotAvailable: true, authoritativeNow: false, authoritativeReachedOnce: true })).toBe(false);
    expect(shouldUseSnapshotPlaceholders({ snapshotAvailable: false, authoritativeNow: false, authoritativeReachedOnce: false })).toBe(false);
  });

  it('keeps a valid offline snapshot visible without any current Today authority', () => {
    const visible = chooseHomeFrequencyPresentation({
      current: { completedCount: 0 }, currentReadSucceeded: false,
      cached: { completedCount: 1 },
    });
    expect(visible).toEqual({ source: 'CACHE', value: { completedCount: 1 } });
    expect(shouldUseSnapshotPlaceholders({ snapshotAvailable: true, authoritativeNow: false, authoritativeReachedOnce: false })).toBe(true);
    expect(canUseTodayActions({ snapshotExists: true, todayStatus: 'ERROR', programInstanceId: 'program-B' })).toBe(false);
    expect(canWriteHomePresentationSnapshot({ ...valid, readiness: { ...readiness, today: 'ERROR' } })).toBe(false);
  });
});
