import { describe, expect, it } from 'vitest';
import { generateWorkoutPrescription } from '../engine';
import { sanitizeAnswersForEngine } from '../input';
import { completeAnswers } from './fixtures';

/**
 * Regression coverage for the real E2E failure: a questionnaire persisted
 * before the Safety/Limitation Resolver phases has no `specialConditions`
 * key at all (not `[]` — genuinely absent), because the question never
 * existed when it was written. Feeding that shape straight into the engine
 * used to throw `Cannot read properties of undefined (reading 'includes')`
 * from `selectTemplate`/`evaluateSafety`, silently swallowed by the callers'
 * generic catches, leaving the account permanently without a program.
 */
describe('legacy questionnaire shapes never crash the engine', () => {
  it('a pre-Safety-phase document (no specialConditions, no limits key) is rejected, never crashes, never silently defaults to "no conditions"', () => {
    const legacy = completeAnswers();
    // Simulate the exact real-world shape: keys never written, not `[]`.
    const raw = { ...legacy } as Record<string, unknown>;
    delete raw.specialConditions;
    delete raw.limits;

    expect(() => generateWorkoutPrescription(raw as never)).not.toThrow();
    const result = generateWorkoutPrescription(raw as never);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    if (result.status !== 'NEEDS_QUESTIONNAIRE_UPDATE') return;
    expect(result.reasonCodes).toContain('QUESTIONNAIRE_SPECIAL_CONDITIONS_UNKNOWN');
    expect(result.reasonCodes).toContain('QUESTIONNAIRE_LIMITS_UNKNOWN');
  });

  it('missing specialConditions alone (limits present) is still rejected — a partial legacy gap must not be papered over', () => {
    const raw = { ...completeAnswers({ limits: ['none'] }) } as Record<string, unknown>;
    delete raw.specialConditions;
    const result = generateWorkoutPrescription(raw as never);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    if (result.status !== 'NEEDS_QUESTIONNAIRE_UPDATE') return;
    expect(result.reasonCodes).toContain('QUESTIONNAIRE_SPECIAL_CONDITIONS_UNKNOWN');
    expect(result.reasonCodes).not.toContain('QUESTIONNAIRE_LIMITS_UNKNOWN');
  });

  it('an explicit, previously-collected empty array is trusted — NOT flagged as a legacy gap', () => {
    const answers = completeAnswers({ specialConditions: ['none'], limits: ['none'] });
    const result = generateWorkoutPrescription(answers);
    expect(result.status).toBe('SUCCESS');
  });

  it('null/non-array garbage in equipment/muscleFocus/style is coerced safely (no clinical meaning, no crash) while specialConditions/limits are not', () => {
    const raw = { ...completeAnswers() } as Record<string, unknown>;
    raw.equipment = null;
    raw.muscleFocus = undefined;
    raw.style = 'not-an-array';
    const sanitized = sanitizeAnswersForEngine(raw as never);
    expect(sanitized.answers.equipment).toEqual([]);
    expect(sanitized.answers.muscleFocus).toEqual([]);
    expect(sanitized.answers.style).toEqual([]);
    expect(sanitized.legacyReasonCodes).toEqual([]);
  });

  it('a genuinely invalid (non-legacy) questionnaire — missing required dimensions — still resolves NEEDS_QUESTIONNAIRE_UPDATE, not a generic workout', () => {
    const answers = completeAnswers({ sex: null, goal: null, place: null });
    const result = generateWorkoutPrescription(answers);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
  });

  it('a musculoskeletal limitation without a resolvable adaptation stays fail-closed (never bypassed by the sanitize boundary)', () => {
    const answers = completeAnswers({
      specialConditions: ['musculoskeletal_limitation'],
      limits: ['knee'],
      limitationImpact: null,
    });
    const result = generateWorkoutPrescription(answers);
    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    if (result.status !== 'NEEDS_QUESTIONNAIRE_UPDATE') return;
    expect(result.reasonCodes).toContain('QUESTIONNAIRE_LIMITATION_IMPACT_REQUIRED');
  });
});
