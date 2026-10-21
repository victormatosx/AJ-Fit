import { beforeEach,describe,expect,it,vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), getAllKeys: vi.fn(), multiRemove: vi.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateWorkoutPrescription } from '../engine';
import { clearPrescriptionSnapshotsForUser,persistPrescriptionSnapshot,readPrescriptionSnapshot } from '../storage';
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
    expect(snapshot).toContain('"templateLibrary":"2.0.0"');
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

/**
 * Fase 8 §9 — cache is shape-tolerant, not version-pinned: `storage.ts`
 * never checks `versions.templateLibrary`'s VALUE, only that the field
 * exists (see `readPrescriptionSnapshot`'s own guard). A synthetic v1.27
 * snapshot (T09x template id, `distance`/`cycleRange`/guideline fields on
 * sessions/exercises that the v2.0 engine never produces) round-trips
 * identically to a real v2 one — no code change was needed for this,
 * confirmed here.
 */
describe('prescription snapshot storage — v1.27-shaped snapshots (Fase 8 backward/forward compatibility)', () => {
  beforeEach(() => vi.clearAllMocks());

  const SYNTHETIC_V127_PLAN = {
    planId: 'wp_synthetic127',
    templateId: 'T091',
    requestedDays: 2,
    prescribedStructuredDays: 2,
    population: 'conventional',
    environment: 'gym',
    goalFamily: 'hypertrophy_body_composition',
    split: 'full_body',
    sessions: [{
      name: 'Sessão 1',
      displayName: 'Treino Full Body',
      type: 'resistance',
      techniqueGuideline: 'Técnica controlada',
      effortGuideline: 'Esforço moderado',
      restGuideline: '60-90s',
      progressionGuideline: 'Progrida gradualmente',
      exercises: [
        {
          exerciseId: 'farmers-walk',
          sourceExerciseId: 'farmers-walk',
          sets: 3,
          distance: '20-40 m',
          notes: 'Mantenha a postura ereta',
        },
        {
          exerciseId: 'cardio-intervalado',
          sourceExerciseId: 'cardio-intervalado',
          cycleRange: { min: 5, max: 7 },
          duration: '1 min forte + 2 min leve',
          intensity: 'alta',
        },
      ],
    }],
    versions: {
      templateLibrary: '1.27.0',
      selectionEngine: '3.0.0',
      safetyRules: '1.0.0',
      modifierRules: '3.0.0',
      compositionEngine: '3.0.0',
      limitationResolver: '2.0.0',
    },
    trace: {
      selectionReasons: [],
      safety: { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] },
      appliedModifiers: [],
      unresolvedModifiers: [],
      conflicts: [],
      substitutions: [],
      compositionDecisions: [],
      validationCodes: [],
    },
  };

  it('round-trips a synthetic v1.27 snapshot (T09x id, distance, cycleRange, session guidelines) exactly like a v2 one', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
    await persistPrescriptionSnapshot('uid-1', 'questionnaire-1', SYNTHETIC_V127_PLAN as never);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
    const serialized = vi.mocked(AsyncStorage.setItem).mock.calls[0][1] as string;
    expect(serialized).toContain('"templateLibrary":"1.27.0"');
    expect(serialized).toContain('"distance":"20-40 m"');
    expect(serialized).toContain('"cycleRange"');

    vi.mocked(AsyncStorage.getItem).mockReset();
    vi.mocked(AsyncStorage.getItem)
      .mockResolvedValueOnce('wp_synthetic127')
      .mockResolvedValueOnce(serialized);
    const restored = await readPrescriptionSnapshot('uid-1', 'questionnaire-1');
    expect(restored?.templateId).toBe('T091');
    expect(restored?.versions.templateLibrary).toBe('1.27.0');
    expect(restored?.sessions[0].exercises[0]).toMatchObject({ exerciseId: 'farmers-walk', distance: '20-40 m' });
    expect(restored?.sessions[0].exercises[1]).toMatchObject({ exerciseId: 'cardio-intervalado', cycleRange: { min: 5, max: 7 } });
  });

  it('a version-incompatible/corrupted stored snapshot fails closed (returns null), never crashes, never falls back to a fabricated plan', async () => {
    vi.mocked(AsyncStorage.getItem)
      .mockResolvedValueOnce('wp_broken')
      .mockResolvedValueOnce('{not valid json');
    expect(await readPrescriptionSnapshot('uid-1', 'questionnaire-1')).toBeNull();
  });

  it('a stored snapshot missing the required shape fields (no versions object at all) fails closed', async () => {
    vi.mocked(AsyncStorage.getItem)
      .mockResolvedValueOnce('wp_missing_versions')
      .mockResolvedValueOnce('{"planId":"wp_missing_versions","templateId":"T091","sessions":[]}');
    expect(await readPrescriptionSnapshot('uid-1', 'questionnaire-1')).toBeNull();
  });
});
