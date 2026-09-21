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
    expect(isProgramSnapshot({
      ...phase2,
      scheduleMode: 'flexible',
      availability: { days: 7, weekdays: [] },
      weeklySchedule: [],
    }, 'wpg_test')).toBe(true);
    expect(isProgramSnapshot({
      ...phase2,
      scheduleMode: 'fixed',
      availability: { days: 7, weekdays: [] },
      weeklySchedule: [],
    }, 'wpg_test')).toBe(false);
  });
});

/**
 * Fase 8 — a future v1.27 program snapshot must validate through the exact
 * same `isProgramSnapshot`, with ZERO code change: `templateId`'s regex
 * already covers T091-T102 (Fase 2), and `hasValidPrescriptionVersions`
 * only checks shape (semver-like strings), never a specific value — so a
 * `templateLibrary: '1.27.0'` document is already a "legitimate legacy-
 * shaped program" as far as this validator is concerned. This is a
 * confirmation, not a behavior change.
 */
describe('workout program snapshot backward/forward compatibility — v1.27', () => {
  function v127Snapshot(overrides: Record<string, unknown> = {}) {
    return {
      ...snapshot('1.27.0'),
      templateId: 'T091',
      versions: {
        templateLibrary: '1.27.0',
        selectionEngine: '3.0.0',
        safetyRules: '1.0.0',
        modifierRules: '3.0.0',
        compositionEngine: '3.0.0',
        limitationResolver: '2.0.0',
      },
      sessions: [{
        name: 'Sessão 1',
        displayName: 'Full Body',
        type: 'resistance',
        techniqueGuideline: 'Técnica controlada',
        exercises: [{
          exerciseId: 'farmers-walk',
          sourceExerciseId: 'farmers-walk',
          sets: 3,
          distance: '20-40 m',
        }, {
          exerciseId: 'cardio-intervalado',
          sourceExerciseId: 'cardio-intervalado',
          cycleRange: { min: 5, max: 7 },
          duration: '1 min forte + 2 min leve',
        }],
      }],
      ...overrides,
    };
  }

  it('accepts every T091-T102 beginner/regular-range id', () => {
    for (const id of ['T091', 'T096', 'T097', 'T102']) {
      expect(isProgramSnapshot(v127Snapshot({ templateId: id }), 'wpg_test')).toBe(true);
    }
  });

  it('accepts session/exercise fields the v2.0 engine never produces (distance, cycleRange, session guidelines)', () => {
    expect(isProgramSnapshot(v127Snapshot(), 'wpg_test')).toBe(true);
  });

  it('skips the strict Phase 2 fixed/flexible calendar shape check for a non-2.0.0 selectionEngine, exactly like it already does for other non-2.0.0 versions', () => {
    const withoutCalendar = v127Snapshot({ requestedDays: undefined, prescribedStructuredDays: undefined, availability: undefined, weeklySchedule: undefined });
    expect(isProgramSnapshot(withoutCalendar, 'wpg_test')).toBe(true);
  });

  it('still rejects a genuinely malformed versions shape even under the 1.27.0 templateLibrary value', () => {
    expect(isProgramSnapshot(v127Snapshot({ versions: { templateLibrary: '1.27.0' } }), 'wpg_test')).toBe(false);
  });
});
