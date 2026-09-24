import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Same established mock pattern as `prepareWorkoutProgramLocally.test.ts` —
// `workoutPrograms.ts` imports `db` from `../lib/firebase`, which throws at
// module load without EXPO_PUBLIC_FIREBASE_* env vars. Every test here
// exercises the pre-auth LOCAL path only, which never touches `db` for
// either generation version.
vi.mock('../../lib/firebase', () => ({
  get db() {
    return undefined;
  },
}));

import { prepareWorkoutProgramLocally } from '../workoutPrograms';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { PRESCRIPTION_VERSIONS_V127, PRESCRIPTION_VERSIONS } from '../../workoutPrescription/types';
import { resolveGenerationVersion } from '../../workoutPrescription/generationVersion';

const VALID_ANSWERS = completeAnswers({ level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle' });

/**
 * Fase 11 (cutover complete) — `resolveGenerationVersion()`'s default is
 * now `'v1.27'` (no P0/P1 remained after Fase 11 fixed the backend-
 * authoritative resealing gap — see the Fase 11 report). Proves
 * `prepareWorkoutProgramLocally` (the pre-auth "onboarding novo" compute
 * path, `AnalyzingScreen.tsx`'s real call site) is v1.27 by default now,
 * AND that an explicit `'v2'` override (the rollback path) still works —
 * both through the real production functions, no mocking needed for the
 * default case anymore.
 */
describe('Fase 11 — prepareWorkoutProgramLocally is v1.27 by default (cutover complete)', () => {
  it('resolveGenerationVersion() defaults to v1.27 in production', () => {
    expect(resolveGenerationVersion()).toBe('v1.27');
  });

  it('a real local generation is v1.27-versioned by default, with no pre-loaded v2 template', async () => {
    const result = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.templateLibraryVersion).toBe('1.27.0');
    expect(result.prescriptionVersions).toEqual(PRESCRIPTION_VERSIONS_V127);
    expect(result.plan.versions.templateLibrary).toBe('1.27.0');
    expect(/^T\d{3}$/.test(result.templateId)).toBe(true);
    expect(/^wp_[0-9a-f]{8}$/.test(result.plan.planId)).toBe(true);
  });

  it('beginner (never-trained, gym, 3 days) routes to a T091-T102 beginner template', async () => {
    const answers = completeAnswers({ level: 'beginner', days: 3, place: 'gym', sex: 'f', goal: 'gain_muscle' });
    const result = await prepareWorkoutProgramLocally(answers);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(/^T09[1-9]|T10[0-2]$/.test(result.templateId)).toBe(true);
  });

  it('pregnancy routes to a special-population v1.27 template', async () => {
    const answers = completeAnswers({
      sex: 'f', place: 'gym', days: 3,
      specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
    });
    const result = await prepareWorkoutProgramLocally(answers);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.population).toBe('pregnancy');
  });
});

/**
 * Rollback proof — a single-point override back to v2 still fully works
 * through the real production code, not just at the low-level
 * `generateWorkoutPrescriptionRouted` layer (already covered by
 * `generatePrescriptionRouting.test.ts`). This mocks `generationVersion.ts`
 * for exactly this file to simulate "the one line changed back to v2" —
 * `prepareWorkoutProgramLocally`'s own code never changes for this.
 */
describe('Fase 11 — rollback: forcing v2 still works end to end through the real production path', () => {
  it('prepareWorkoutProgramLocally produces a v2-versioned plan once the central resolver says v2', async () => {
    vi.resetModules();
    vi.doMock('../../workoutPrescription/generationVersion', () => ({
      resolveGenerationVersion: (override?: 'v2' | 'v1.27') => override ?? 'v2',
      isLegacyGenerationVersion: (version: 'v2' | 'v1.27') => version === 'v2',
    }));
    const { prepareWorkoutProgramLocally: prepareLocally } = await import('../workoutPrograms');
    const { completeAnswers: build } = await import('../../workoutPrescription/__tests__/fixtures');
    const answers = build({ level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle' });
    const result = await prepareLocally(answers);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.templateLibraryVersion).toBe('2.0.0');
    expect(result.prescriptionVersions).toEqual(PRESCRIPTION_VERSIONS);
    expect(result.plan.versions.templateLibrary).toBe('2.0.0');
    vi.resetModules();
    vi.doUnmock('../../workoutPrescription/generationVersion');
  });
});

/**
 * §4/§5 — "usuário com plano v2 existente continua v2 até nova geração".
 * `resolveWorkoutPrescription` (`useWorkoutPrescription.ts`) already
 * guarantees this by construction: an existing active program is returned
 * VERBATIM the moment `loadActiveWorkoutProgram` finds one — generation
 * (and therefore any `resolveActiveGenerationVersion` decision) is only
 * ever reached when NO active program exists. This is a structural,
 * source-scanning proof (same convention as `noProductionV127Wiring.test.ts`)
 * that this early-return still precedes every generation call, so cutting
 * over the generation default can never itself trigger a silent
 * regeneration of an already-active v2 plan.
 */
describe('Fase 10/11 §4 — an existing active program is never regenerated on load', () => {
  it('resolveWorkoutPrescription returns program load results before any generation call is reached', () => {
    const source = readFileSync(resolve(__dirname, '../../workoutPrescription/useWorkoutPrescription.ts'), 'utf8');
    const loadIndex = source.indexOf('program = await loadActiveWorkoutProgram(uid)');
    const earlyReturnIndex = source.indexOf("if (program) return { status: 'SUCCESS', plan: program }");
    const generationIndex = source.indexOf('generateAndPersistWorkoutProgramDeduped({');
    expect(loadIndex).toBeGreaterThan(-1);
    expect(earlyReturnIndex).toBeGreaterThan(loadIndex);
    expect(generationIndex).toBeGreaterThan(earlyReturnIndex);
  });
});
