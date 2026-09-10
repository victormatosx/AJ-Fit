import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import {
  buildAssessmentReminderNotification,
  buildCompareProgressNotification,
  buildPhotoReminderNotification,
} from '../contentPolicy';
import { runNotificationPreflight } from '../notificationPreflight';

const NOW = Timestamp.fromDate(new Date('2026-09-09T15:00:00Z'));

function fixture() {
  const harness = createFakeFirestore();
  const uid = 'uid-progress';
  const root = `users/${uid}`;
  harness.seed(root, { preferences: {} });
  harness.seed(`${root}/workoutProgramState/scheduleConfig`, { timezone: 'UTC' });
  return { harness, uid, root };
}

function seedPhoto(
  harness: ReturnType<typeof createFakeFirestore>,
  root: string,
  dateKey: string,
  pose: 'front' | 'side' | 'back' = 'front',
) {
  const id = `${dateKey}_${pose}`;
  const assetId = `10000000-0000-4000-8000-00000000${dateKey.slice(5, 7)}01`;
  const takenAt = Timestamp.fromDate(new Date(`${dateKey}T12:00:00Z`));
  harness.seed(`${root}/progressPhotos/${id}`, {
    assetId,
    dateKey,
    pose,
    storagePath: `${root}/progressPhotos/${assetId}.enc`,
    thumbnailStoragePath: `${root}/progressPhotos/${assetId}.thumb.enc`,
    takenAt,
    createdAt: Timestamp.fromMillis(takenAt.toMillis() + 1_000),
    originalMimeType: 'image/jpeg',
    encryptedSize: 1_024,
    thumbnailEncryptedSize: 512,
    encryption: {
      version: 1, algorithm: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', vaultKeyVersion: 1,
    },
    thumbnailEncryption: {
      version: 1, algorithm: 'AES-256-GCM', iv: 'BBBBBBBBBBBBBBBB', vaultKeyVersion: 1,
    },
  });
  return id;
}

function seedAssessment(
  harness: ReturnType<typeof createFakeFirestore>,
  root: string,
  id: string,
  measuredDate: string,
) {
  const measuredAt = Timestamp.fromDate(new Date(`${measuredDate}T12:00:00Z`));
  harness.seed(`${root}/assessments/${id}`, {
    source: 'imported',
    measuredAt,
    createdAt: Timestamp.fromMillis(measuredAt.toMillis() + 1_000),
    weight: 70,
    height: 175,
  });
}

describe('progress notification dispatch preflight', () => {
  it('cancels PHOTO_REMINDER if a new valid photo resolves its old cycle', async () => {
    const { harness, uid, root } = fixture();
    seedPhoto(harness, root, '2026-07-01');
    const request = buildPhotoReminderNotification({
      uid, progressIdentity: 'photoCycle:2026-07-01:2026-07-31', locale: 'pt-BR',
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: true });
    seedPhoto(harness, root, '2026-09-09');
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: false, reason: 'PROGRESS_FACT_CHANGED' });
  });

  it('cancels ASSESSMENT_REMINDER when a new complete assessment exists', async () => {
    const { harness, uid, root } = fixture();
    seedAssessment(harness, root, 'old', '2026-01-01');
    const request = buildAssessmentReminderNotification({
      uid, progressIdentity: 'assessmentCycle:2026-01-01:2026-04-01', locale: 'pt-BR',
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: true });
    seedAssessment(harness, root, 'new', '2026-09-09');
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: false, reason: 'PROGRESS_FACT_CHANGED' });
  });

  it('cancels COMPARE_PROGRESS if one source snapshot was deleted', async () => {
    const { harness, uid, root } = fixture();
    const oldId = seedPhoto(harness, root, '2026-07-01');
    seedPhoto(harness, root, '2026-09-01');
    const request = buildCompareProgressNotification({
      uid, progressIdentity: 'photoComparison:2026-07-01:2026-09-01', locale: 'pt-BR',
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: true });
    await harness.db.collection('users').doc(uid).collection('progressPhotos').doc(oldId).delete();
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: false, reason: 'PROGRESS_FACT_CHANGED' });
  });
});
