import { describe, expect, it, vi } from 'vitest';

// `workoutPrograms.ts` imports `db` from `../lib/firebase`, which throws at
// module load without EXPO_PUBLIC_FIREBASE_* env vars. Mocked out exactly
// like `workoutProgression.integration.test.ts` does — these tests never
// need a real `db`: the legacy-gap short-circuit must return BEFORE any
// Firestore call is made.
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import { generateAndPersistWorkoutProgram } from '../workoutPrograms';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';

describe('generateAndPersistWorkoutProgram — legacy questionnaire boundary', () => {
  it('rejects a pre-Safety-phase questionnaire (missing specialConditions/limits) before touching Firestore', async () => {
    const raw = { ...completeAnswers() } as Record<string, unknown>;
    delete raw.specialConditions;
    delete raw.limits;

    // `db` stays `undefined` — if the function reached any Firestore call,
    // it would throw synchronously (e.g. `doc(undefined, ...)`), not
    // resolve to a typed result. A clean resolved NEEDS_QUESTIONNAIRE_UPDATE
    // proves the gate fired first.
    const result = await generateAndPersistWorkoutProgram({
      uid: 'legacy-uid',
      questionnaireId: 'q1',
      questionnaireVersion: 1,
      answers: raw as never,
      source: 'onboarding',
    });

    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    if (result.status !== 'NEEDS_QUESTIONNAIRE_UPDATE') return;
    expect(result.reasonCodes).toContain('QUESTIONNAIRE_SPECIAL_CONDITIONS_UNKNOWN');
    expect(result.reasonCodes).toContain('QUESTIONNAIRE_LIMITS_UNKNOWN');
  });
});
