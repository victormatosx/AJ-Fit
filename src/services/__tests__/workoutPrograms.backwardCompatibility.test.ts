import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));

import { isProgramSnapshot } from '../workoutPrograms';

function snapshot(templateLibrary: unknown) {
  return {
    programId: 'wpg_test',
    prescriptionId: 'wp_test',
    status: 'active',
    source: 'automatic_reconciliation',
    templateId: 'T004',
    templateVersion: 1,
    templateSourceVersion: typeof templateLibrary === 'string' ? templateLibrary : '2.0.0',
    templateContentHash: 'a'.repeat(64),
    questionnaireId: 'q1',
    questionnaireVersion: 1,
    sessions: [{
      name: 'Push',
      type: 'resistance',
      exercises: [{ exerciseId: 'push-up', sourceExerciseId: 'push-up', sets: 2 }],
    }],
    versions: {
      templateLibrary,
      selectionEngine: '1.0.0',
      safetyRules: '1.0.0',
      modifierRules: '2.0.0',
      compositionEngine: '2.0.0',
      limitationResolver: '1.0.0',
    },
  };
}

describe('workout program snapshot backward compatibility', () => {
  it.each(['1.3.0', '2.0.0'])('accepts a structurally valid %s persisted program', (version) => {
    expect(isProgramSnapshot(snapshot(version), 'wpg_test')).toBe(true);
  });

  it.each([undefined, '', 2, {}, 'not-semver'])('rejects invalid templateLibrary value %j', (value) => {
    expect(isProgramSnapshot(snapshot(value), 'wpg_test')).toBe(false);
  });

  it('rejects a missing or malformed versions shape', () => {
    const missing = snapshot('2.0.0');
    delete (missing as { versions?: unknown }).versions;
    expect(isProgramSnapshot(missing, 'wpg_test')).toBe(false);
    expect(isProgramSnapshot({ ...snapshot('2.0.0'), versions: { templateLibrary: '1.3.0' } }, 'wpg_test')).toBe(false);
  });

  it('QG2-12 loads Phase 2 while retaining v1.3 and Phase 1 fallbacks', () => {
    const phase2 = {
      ...snapshot('2.0.0'),
      requestedDays: 7,
      prescribedStructuredDays: 4,
      prescribedTrainingFrequency: 4,
      availability: { days: 7, weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] },
      weeklySchedule: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((weekday, index) =>
        index < 4 ? { weekday, state: 'TRAINING', sessionIndex: 0 } : { weekday, state: 'REST' }),
      versions: { ...snapshot('2.0.0').versions, selectionEngine: '2.0.0', compositionEngine: '2.1.0' },
    };
    expect(isProgramSnapshot(snapshot('1.3.0'), 'wpg_test')).toBe(true);
    expect(isProgramSnapshot(snapshot('2.0.0'), 'wpg_test')).toBe(true);
    expect(isProgramSnapshot(phase2, 'wpg_test')).toBe(true);
    expect(isProgramSnapshot({ ...phase2, prescribedTrainingFrequency: 7 }, 'wpg_test')).toBe(false);
  });
});
