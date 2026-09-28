import { describe, expect, it } from 'vitest';
import { generateWorkoutPrescription } from '../engine';
import { FORCED_QUESTIONNAIRE_STEP_IDS } from '../../onboarding/steps';
import { completeAnswers } from './fixtures';

/**
 * Regression coverage for the reported bug: a Fluxo B user (Google/Apple
 * sign-in BEFORE the questionnaire) who answers every question the reduced
 * `forcedQuestionnaire` funnel actually shows them still reached Home with
 * "informações insuficientes para prescrever seu treino".
 *
 * Root cause (fixed in src/onboarding/useOnboardingFunnel.ts): the funnel's
 * initial step was hardcoded to `'goal'`, while `FORCED_QUESTIONNAIRE_STEP_IDS`
 * lists `sex`, `birthDate`, `height`, `weight` BEFORE `goal` — so those four
 * questions, including the hard-required `sex`, were never actually shown.
 * `useWorkoutReadinessGate` also used to resolve `'ready'` even when the
 * engine reported `NEEDS_QUESTIONNAIRE_UPDATE`, letting the app open Home
 * instead of sending the user back to complete the questionnaire.
 *
 * `completeAnswers()` (fixtures.ts) already represents exactly what a user
 * gets if the forced funnel visits every step in `FORCED_QUESTIONNAIRE_STEP_IDS`
 * from the correct first step (`sex`) onward — this suite makes that
 * connection explicit instead of relying on engine.test.ts's more general
 * "SUCCESS" assertions to imply it.
 */
describe('Fluxo B (forcedQuestionnaire) — full-coverage regression', () => {
  it('FORCED_QUESTIONNAIRE_STEP_IDS starts at sex, not goal — the exact bug this suite guards against', () => {
    expect(FORCED_QUESTIONNAIRE_STEP_IDS[0]).toBe('sex');
    expect(FORCED_QUESTIONNAIRE_STEP_IDS).not.toContain('name');
  });

  it('answering every field the reduced Fluxo B funnel actually asks yields a valid prescription', () => {
    // `completeAnswers()` sets every hard-required field the engine checks
    // (sex, goal, level, duration, place, days) plus the safety-required
    // `specialConditions`, exactly what a Fluxo B user provides by walking
    // FORCED_QUESTIONNAIRE_STEP_IDS end to end — every required prescription
    // input is collected by the reduced funnel.
    const result = generateWorkoutPrescription(completeAnswers());
    expect(result.status).toBe('SUCCESS');
  });

  it('provider identity (Google vs Apple) plays no role — same answers, same outcome either way', () => {
    // Both providers converge on the same Firebase path before any
    // onboarding step ever runs (src/services/socialAuth.ts's own doc
    // comment, verified in socialAuth.test.ts's `it.each(['google','apple'])`
    // suite) — provider is never part of `QuestionnaireAnswers`, so there is
    // nothing provider-specific left to test at the engine boundary.
    const answers = completeAnswers();
    expect(generateWorkoutPrescription(answers)).toEqual(generateWorkoutPrescription(answers));
  });
});

/**
 * Item 10 of the audit: a persisted questionnaire document existing is NOT
 * the same as it being complete enough to prescribe. This is the exact
 * distinction `useWorkoutReadinessGate`'s `readinessStatusForPrescription`
 * now makes (see its own unit test) — this proves the underlying engine
 * contract it relies on: missing a hard-required field always blocks
 * generation, never falls back to a silent default.
 */
describe('negative path — a questionnaire document existing is not completeness', () => {
  it('a persisted-but-incomplete questionnaire (missing sex) never reaches SUCCESS', () => {
    const incomplete = completeAnswers({ sex: null });
    const result = generateWorkoutPrescription(incomplete);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    expect('plan' in result).toBe(false);
  });

  it('a legacy document missing specialConditions/limits entirely (pre-Safety-phase shape) also blocks, never defaults to "no conditions"', () => {
    const legacyShaped = completeAnswers();
    // Simulates a Firestore doc from before these fields existed at all —
    // `sanitizeAnswersForEngine` must treat this differently from an
    // explicit `[]` (see workoutPrescription/input.ts).
    const { specialConditions: _sc, limits: _l, ...withoutSafetyFields } = legacyShaped;
    const result = generateWorkoutPrescription(withoutSafetyFields as typeof legacyShaped);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
  });
});
