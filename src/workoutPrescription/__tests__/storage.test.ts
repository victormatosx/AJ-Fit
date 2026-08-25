import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), getAllKeys: vi.fn(), multiRemove: vi.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateWorkoutPrescription } from '../engine';
import { clearPrescriptionSnapshotsForUser, persistPrescriptionSnapshot, readPrescriptionSnapshot } from '../storage';
import { completeAnswers } from './fixtures';

describe('prescription snapshot storage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes an immutable versioned snapshot and active pointer without questionnaire answers', async () => {
    const result = generateWorkoutPrescription(completeAnswers());
    if (result.status !== 'SUCCESS') throw new Error(result.status);
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
    await persistPrescriptionSnapshot('uid-1', 'questionnaire-1', result.plan);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
    const snapshot = vi.mocked(AsyncStorage.setItem).mock.calls[0][1];
    expect(snapshot).not.toContain('birthDate');
    expect(snapshot).not.toContain('pregnancyScreening');
    expect(snapshot).toContain('"templateLibrary":"1.3.0"');
  });

  it('does not overwrite an existing immutable snapshot', async () => {
    const result = generateWorkoutPrescription(completeAnswers());
    if (result.status !== 'SUCCESS') throw new Error(result.status);
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('{}');
    await persistPrescriptionSnapshot('uid-1', 'questionnaire-1', result.plan);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed stored data while allowing older versioned snapshots', async () => {
    vi.mocked(AsyncStorage.getItem)
      .mockResolvedValueOnce('wp_test')
      .mockResolvedValueOnce('{"planId":"wp_test","templateId":"T001","sessions":[],"versions":{"templateLibrary":0}}');
    expect(await readPrescriptionSnapshot('uid-1', 'questionnaire-1')).toBeNull();
  });

  it('deletion cleanup removes only snapshots scoped to the deleted uid', async () => {
    vi.mocked(AsyncStorage.getAllKeys).mockResolvedValue([
      'ajfit-workout-prescription-v1:uid-1:questionnaire:questionnaire-1',
      'ajfit-workout-prescription-v1:uid-1:wp_a',
      'ajfit-workout-prescription-v1:uid-2:wp_b',
      'unrelated',
    ]);
    await clearPrescriptionSnapshotsForUser('uid-1');
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
      'ajfit-workout-prescription-v1:uid-1:questionnaire:questionnaire-1',
      'ajfit-workout-prescription-v1:uid-1:wp_a',
    ]);
  });
});
