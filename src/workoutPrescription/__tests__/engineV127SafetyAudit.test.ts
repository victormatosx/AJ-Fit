import { describe,expect,it } from 'vitest';

import { generateWorkoutPrescriptionV127 } from '../engineV127';
import type { QuestionnaireAnswers } from '../types';

/**
 * Fase 9 §12 (fixed) — `evaluateSafety` (safety.ts) is reused verbatim by
 * `engineV127.ts`, but its `status`/`reasons` for the v1.27 trace now pass
 * through `safetyV127.ts`'s `effectiveSafetyV127` first. v1.27 only has TWO
 * real composition-affecting mechanisms: special-population template
 * routing (pregnancy/postpartum/frailty) and the musculoskeletal limitation
 * modifier. `dizziness_or_vertigo` (controlled case), `post_surgical`
 * (in-progress-adapted case), and `lipedema` (mild/interferes cases) have
 * no v1.27 modifier — those users now correctly see `CLEAR` (never a
 * fabricated `ADAPTED`), and their composed plan is genuinely identical to
 * a fully-clear user's, matching what the status now claims.
 *
 * `REQUIRES_CLEARANCE`/`BLOCKED` are untouched — "requires medical
 * clearance, user doesn't have it yet" still blocks generation exactly as
 * before (see the `dizziness_or_vertigo`/`lipedema` REQUIRES_CLEARANCE
 * cases below).
 */
function base(overrides: Partial<QuestionnaireAnswers> = {}): QuestionnaireAnswers {
  return {
    sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, duration: '60', place: 'gym',
    specialConditions: ['none'],
    equipment: [], muscleFocus: [], style: [], trainingDays: [], scheduleMode: 'fixed',
    ...overrides,
  } as QuestionnaireAnswers;
}

function generate(answers: QuestionnaireAnswers) {
  return generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
}

function sessionsOf(answers: QuestionnaireAnswers) {
  const result = generate(answers);
  if (result.status !== 'SUCCESS') throw new Error(`unexpected ${result.status}`);
  return { status: result.plan.trace.safety.status, sessions: result.plan.sessions, templateId: result.plan.templateId };
}

describe('Fase 9 §12 — v1.27 safety ADAPTED truthfulness (fixed)', () => {
  const clear = sessionsOf(base());

  it('CLEAR baseline is CLEAR', () => {
    expect(clear.status).toBe('CLEAR');
  });

  it.each([
    ['dizziness_controlled', base({
      specialConditions: ['dizziness_or_vertigo'],
      dizzinessScreening: { symptomFrequency: 'occasional', affectsBalance: 'no' },
    } as Partial<QuestionnaireAnswers>)],
    ['post_surgical in-progress cleared', base({
      specialConditions: ['post_surgical'],
      postSurgicalScreening: { recoveryStatus: 'in_progress', bodyRegion: 'knee', returnClearance: 'cleared_no_restrictions' },
    } as Partial<QuestionnaireAnswers>)],
    ['lipedema mild', base({
      specialConditions: ['lipedema'],
      lipedemaScreening: { professionalGuidance: 'no', symptomImpact: 'mild_or_occasional' },
    } as Partial<QuestionnaireAnswers>)],
    ['lipedema interferes', base({
      specialConditions: ['lipedema'],
      lipedemaScreening: { professionalGuidance: 'no', symptomImpact: 'interferes_with_exercises' },
    } as Partial<QuestionnaireAnswers>)],
  ])('%s: no v1.27 modifier exists, so status is now CLEAR (never a false ADAPTED) and the plan matches the CLEAR baseline exactly', (_label, answers) => {
    const result = sessionsOf(answers);
    expect(result.status).toBe('CLEAR');
    expect(result.templateId).toBe(clear.templateId);
    expect(result.sessions).toEqual(clear.sessions);
  });

  it.each([
    ['dizziness relevant (no clearance yet)', base({
      specialConditions: ['dizziness_or_vertigo'],
      dizzinessScreening: { symptomFrequency: 'frequent', affectsBalance: 'yes' },
    } as Partial<QuestionnaireAnswers>)],
    ['lipedema requiring professional guidance (no clearance yet)', base({
      specialConditions: ['lipedema'],
      lipedemaScreening: { professionalGuidance: 'yes', symptomImpact: 'interferes_with_exercises' },
    } as Partial<QuestionnaireAnswers>)],
    ['post-surgical restriction (no clearance yet)', base({
      specialConditions: ['post_surgical'],
      postSurgicalScreening: { recoveryStatus: 'in_progress', bodyRegion: 'knee', returnClearance: 'not_yet' },
    } as Partial<QuestionnaireAnswers>)],
  ])('%s: still blocks generation via REQUIRES_CLEARANCE, unchanged by the Fase 9 §12 fix', (_label, answers) => {
    const result = generate(answers);
    expect(result.status).toBe('REQUIRES_CLEARANCE');
  });

  it('pregnancy/postpartum/frailty ADAPTED is TRUE — special-population template routing genuinely differs from conventional', () => {
    const pregnancy = sessionsOf(base({
      sex: 'f', specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
    } as Partial<QuestionnaireAnswers>));
    expect(pregnancy.status).toBe('ADAPTED');
    expect(pregnancy.templateId).not.toBe(clear.templateId);
  });

  it('a real reason (pregnancy) combined with a dropped reason still reports ADAPTED, scoped to the real reason only', () => {
    // Pregnancy population screening already implies the dizziness branch is
    // unreachable in the same answers set (mutually exclusive specialConditions
    // in practice), so this proves the filtering logic directly instead.
    const result = generate(base({
      sex: 'f', specialConditions: ['pregnancy', 'dizziness_or_vertigo'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
      dizzinessScreening: { symptomFrequency: 'occasional', affectsBalance: 'no' },
    } as Partial<QuestionnaireAnswers>));
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.trace.safety.status).toBe('ADAPTED');
    expect(result.plan.trace.safety.reasons).toEqual(['PREGNANCY_POPULATION']);
  });
});
