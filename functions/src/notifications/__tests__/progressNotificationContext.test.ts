import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import {
  ASSESSMENT_REMINDER_INTERVAL_DAYS,
  deriveAssessmentReminderCandidate,
  deriveCompareProgressCandidate,
  derivePhotoReminderCandidate,
  deriveProgressCandidates,
  PHOTO_REMINDER_INTERVAL_DAYS,
  loadProgressFacts,
  readProgressNotificationContext,
  type AssessmentFact,
  type ProgressFacts,
  type ProgressPhotoFact,
} from '../progressNotificationContext';

const photo = (
  _id: string,
  dateKey: string,
  pose: 'front' | 'side' | 'back' = 'front',
): ProgressPhotoFact => ({
  id: `${dateKey}_${pose}`,
  dateKey,
  pose,
  takenAt: new Date(`${dateKey}T12:00:00.000Z`),
  createdAt: new Date(`${dateKey}T12:01:00.000Z`),
});

const assessment = (id: string, date: string): AssessmentFact => ({
  id,
  measuredAt: new Date(`${date}T12:00:00.000Z`),
  createdAt: new Date(`${date}T12:01:00.000Z`),
});

describe('canonical progress notification facts', () => {
  it('uses a conservative monthly photo cycle and never account age', () => {
    expect(PHOTO_REMINDER_INTERVAL_DAYS).toBe(30);
    expect(derivePhotoReminderCandidate({ photos: [], timezone: 'UTC', localDate: '2026-09-30' }))
      .toBeNull();
    expect(derivePhotoReminderCandidate({
      photos: [photo('a', '2026-09-01')], timezone: 'UTC', localDate: '2026-09-30',
    })).toBeNull();
    expect(derivePhotoReminderCandidate({
      photos: [photo('a', '2026-09-01')], timezone: 'UTC', localDate: '2026-10-01',
    })).toEqual({
      notificationType: 'PHOTO_REMINDER',
      progressIdentity: 'photoCycle:2026-09-01:2026-10-01',
    });
  });

  it('a new valid photo resolves the previous reminder cycle', () => {
    expect(derivePhotoReminderCandidate({
      photos: [photo('old', '2026-08-01'), photo('new', '2026-09-25')],
      timezone: 'UTC',
      localDate: '2026-10-01',
    })).toBeNull();
  });

  it('uses 90 civil days from the latest real assessment and ignores accounts without one', () => {
    expect(ASSESSMENT_REMINDER_INTERVAL_DAYS).toBe(90);
    expect(deriveAssessmentReminderCandidate({
      assessments: [], timezone: 'UTC', localDate: '2026-09-09',
    })).toBeNull();
    expect(deriveAssessmentReminderCandidate({
      assessments: [assessment('a1', '2026-06-11')], timezone: 'UTC', localDate: '2026-09-08',
    })).toBeNull();
    expect(deriveAssessmentReminderCandidate({
      assessments: [assessment('a1', '2026-06-11')], timezone: 'UTC', localDate: '2026-09-09',
    })).toMatchObject({ notificationType: 'ASSESSMENT_REMINDER' });
  });

  it('a new assessment resolves an older due cycle', () => {
    expect(deriveAssessmentReminderCandidate({
      assessments: [assessment('old', '2026-01-01'), assessment('new', '2026-09-01')],
      timezone: 'UTC',
      localDate: '2026-09-09',
    })).toBeNull();
  });

  it('requires two posed snapshots on different dates with a common pose', () => {
    expect(deriveCompareProgressCandidate([photo('only', '2026-08-01')])).toBeNull();
    expect(deriveCompareProgressCandidate([
      photo('front', '2026-08-01', 'front'),
      photo('side', '2026-09-01', 'side'),
    ])).toBeNull();
    expect(deriveCompareProgressCandidate([
      photo('before', '2026-08-01', 'front'),
      photo('after', '2026-09-01', 'front'),
    ])).toEqual({
      notificationType: 'COMPARE_PROGRESS',
      progressIdentity: 'photoComparison:2026-08-01:2026-09-01',
    });
  });

  it('does not invent a backend comparison identity for legacy photos', () => {
    const legacy: ProgressPhotoFact = {
      id: 'legacy-id',
      takenAt: new Date('2026-08-01T12:00:00Z'),
      createdAt: new Date('2026-08-01T12:01:00Z'),
    };
    expect(deriveCompareProgressCandidate([legacy, { ...legacy, id: 'legacy-2' }])).toBeNull();
  });

  it('creates a new comparison identity only when a new comparable snapshot exists', () => {
    const first = deriveCompareProgressCandidate([
      photo('a', '2026-07-01'), photo('b', '2026-08-01'),
    ]);
    const replay = deriveCompareProgressCandidate([
      photo('a', '2026-07-01'), photo('b', '2026-08-01'),
    ]);
    const next = deriveCompareProgressCandidate([
      photo('a', '2026-07-01'), photo('b', '2026-08-01'), photo('c', '2026-09-01'),
    ]);
    expect(replay).toEqual(first);
    expect(next?.progressIdentity).not.toBe(first?.progressIdentity);
  });

  it('orders progress value as compare, assessment, then photo', () => {
    const facts: ProgressFacts & { localDate: string } = {
      status: 'READY',
      timezone: 'UTC',
      localDate: '2026-09-09',
      photos: [photo('a', '2026-01-01'), photo('b', '2026-02-01')],
      assessments: [assessment('old', '2026-01-01')],
    };
    expect(deriveProgressCandidates(facts).map((item) => item.notificationType)).toEqual([
      'COMPARE_PROGRESS', 'ASSESSMENT_REMINDER', 'PHOTO_REMINDER',
    ]);
  });

  it('uses IANA local dates across DST and fails closed outside the product window', async () => {
    const loadFacts = vi.fn(async () => ({
      status: 'READY' as const,
      timezone: 'America/New_York',
      photos: [photo('a', '2026-01-01')],
      assessments: [],
    }));
    await expect(readProgressNotificationContext(
      {} as never,
      'uid-1',
      Timestamp.fromDate(new Date('2026-11-02T13:30:00Z')),
      { loadFacts },
    )).resolves.toMatchObject({ allowed: true, localDate: '2026-11-02' });
    await expect(readProgressNotificationContext(
      {} as never,
      'uid-1',
      Timestamp.fromDate(new Date('2026-11-02T12:59:00Z')),
      { loadFacts },
    )).resolves.toMatchObject({ allowed: false, reason: 'OUTSIDE_LOCAL_WINDOW' });
  });

  it('fails closed instead of silently using UTC for an invalid timezone', async () => {
    await expect(readProgressNotificationContext(
      {} as never,
      'uid-1',
      Timestamp.fromDate(new Date('2026-09-09T08:30:00Z')),
      {
        loadFacts: vi.fn(async () => ({
          status: 'READY' as const,
          timezone: 'UTC-3',
          photos: [photo('a', '2026-01-01')],
          assessments: [],
        })),
      },
    )).resolves.toEqual({ allowed: false, reason: 'TIMEZONE_UNAVAILABLE' });
  });

  it('lets retry preflight re-read facts outside the daily window', async () => {
    const loadFacts = vi.fn(async () => ({
      status: 'READY' as const,
      timezone: 'UTC',
      photos: [photo('a', '2026-01-01')],
      assessments: [],
    }));
    await expect(readProgressNotificationContext(
      {} as never,
      'uid-1',
      Timestamp.fromDate(new Date('2026-09-09T15:00:00Z')),
      { loadFacts },
      { requireDailyWindow: false },
    )).resolves.toMatchObject({ allowed: true, localDate: '2026-09-09' });
  });

  it('fails closed for an incomplete legacy assessment document', async () => {
    const harness = createFakeFirestore();
    const root = 'users/uid-history';
    harness.seed(root, { preferences: {} });
    harness.seed(`${root}/workoutProgramState/scheduleConfig`, { timezone: 'UTC' });
    harness.seed(`${root}/assessments/partial`, {
      source: 'guided',
      measuredAt: Timestamp.fromDate(new Date('2026-01-01T12:00:00Z')),
      createdAt: Timestamp.fromDate(new Date('2026-01-01T12:01:00Z')),
      weight: 70,
      height: 175,
      // Missing the guided protocol/calculator fields is not a valid assessment.
    });
    await expect(loadProgressFacts(
      harness.db as never,
      'uid-history',
      Timestamp.fromDate(new Date('2026-09-09T12:00:00Z')),
    )).resolves.toEqual({ status: 'HISTORY_UNAVAILABLE', timezone: 'UTC' });
  });
});
