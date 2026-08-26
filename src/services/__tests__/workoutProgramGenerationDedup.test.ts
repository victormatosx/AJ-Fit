import { describe, expect, it, vi } from 'vitest';

// Same pattern as `workoutPrograms.legacyQuestionnaire.test.ts` — `db` stays
// undefined and is never touched: every case here uses a legacy/invalid
// questionnaire shape that short-circuits at the sanitize/validation gate,
// BEFORE any Firestore call, so the dedup mechanism itself (not Firestore
// transaction behavior, already proven separately in
// `workoutProgramReconciliation.integration.test.ts`) is what's under test.
vi.mock('../../lib/firebase', () => ({
  get db() {
    return undefined;
  },
}));

import { generateAndPersistWorkoutProgramDeduped } from '../workoutPrograms';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';

function legacyInput(overrides: { uid?: string; questionnaireId?: string } = {}) {
  const raw = { ...completeAnswers() } as Record<string, unknown>;
  delete raw.specialConditions;
  delete raw.limits;
  return {
    uid: overrides.uid ?? 'uid-1',
    questionnaireId: overrides.questionnaireId ?? 'q-1',
    questionnaireVersion: 1,
    answers: raw as never,
    source: 'automatic_reconciliation' as const,
  };
}

describe('generateAndPersistWorkoutProgramDeduped (Phase 1, Part C — global reconciliation guard)', () => {
  it('(8) two concurrent calls for the exact same (uid, questionnaireId) share the SAME in-flight promise', () => {
    const input = legacyInput();
    const p1 = generateAndPersistWorkoutProgramDeduped(input);
    const p2 = generateAndPersistWorkoutProgramDeduped(input);
    expect(p1).toBe(p2);
    return Promise.all([p1, p2]).then(([r1, r2]) => {
      expect(r1).toEqual(r2);
      expect(r1.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    });
  });

  it('different uid/questionnaireId never dedupe against each other', () => {
    const a = generateAndPersistWorkoutProgramDeduped(legacyInput({ uid: 'uid-a' }));
    const b = generateAndPersistWorkoutProgramDeduped(legacyInput({ uid: 'uid-b' }));
    expect(a).not.toBe(b);
    const c = generateAndPersistWorkoutProgramDeduped(legacyInput({ questionnaireId: 'q-x' }));
    const d = generateAndPersistWorkoutProgramDeduped(legacyInput({ questionnaireId: 'q-y' }));
    expect(c).not.toBe(d);
  });

  it('a failure is never cached — the registry entry clears on settle, and the next call for the same key is a genuinely fresh attempt', async () => {
    const input = legacyInput({ uid: 'uid-retry' });
    const first = generateAndPersistWorkoutProgramDeduped(input);
    await first;
    const second = generateAndPersistWorkoutProgramDeduped(input);
    expect(second).not.toBe(first);
    await expect(second).resolves.toEqual(await first);
  });

  it('retrying after settle does not create a duplicated/stuck registry entry — a third call also gets a fresh promise', async () => {
    const input = legacyInput({ uid: 'uid-retry-2' });
    await generateAndPersistWorkoutProgramDeduped(input);
    const second = generateAndPersistWorkoutProgramDeduped(input);
    await second;
    const third = generateAndPersistWorkoutProgramDeduped(input);
    expect(third).not.toBe(second);
  });
});
