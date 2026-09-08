import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getStepSequence } from '../steps';

const HOOK_SOURCE = readFileSync(new URL('../useOnboardingFunnel.ts', import.meta.url), 'utf8');

/**
 * Root-cause regression: this hook used to hardcode `mode === 'forcedQuestionnaire'
 * ? 'goal' : 'presentation'` as the initial step. `FORCED_QUESTIONNAIRE_STEP_IDS`
 * (steps.ts) lists `sex`, `birthDate`, `height`, `weight` BEFORE `goal`, so every
 * Fluxo B user (social sign-in before the questionnaire) silently never saw those
 * four questions — including `sex`, a hard-required prescription-engine field
 * (see workoutPrescription/input.ts `prescriptionInputErrors`). That produced
 * `NEEDS_QUESTIONNAIRE_UPDATE` at first-app-entry for a user who, from their own
 * perspective, had answered every question they were shown.
 *
 * This suite (source-inspection, matching this repo's convention for hooks with
 * no React Testing Library harness — see usePremiumCapabilities.test.ts) proves
 * the initial step can never again drift from the registered sequence, because
 * it is derived FROM that sequence rather than duplicated as a literal.
 */
describe('useOnboardingFunnel initial step', () => {
  it('derives the initial step from getStepSequence(mode), never a hardcoded literal', () => {
    expect(HOOK_SOURCE).toContain('getStepSequence(mode)[0]');
    expect(HOOK_SOURCE).not.toMatch(/mode === 'forcedQuestionnaire'\s*\?\s*'goal'/);
  });

  it("getStepSequence('forcedQuestionnaire')[0] is 'sex' — the actual first step a Fluxo B user sees", () => {
    expect(getStepSequence('forcedQuestionnaire')[0]).toBe('sex');
  });

  it("getStepSequence('anonymous')[0] is 'presentation' — unchanged for Fluxo A", () => {
    expect(getStepSequence('anonymous')[0]).toBe('presentation');
  });

  it('the forced sequence never omits any prescription-engine hard-required field', () => {
    const seq = getStepSequence('forcedQuestionnaire');
    for (const requiredStep of ['sex', 'goal', 'level', 'duration', 'place']) {
      expect(seq).toContain(requiredStep);
    }
  });
});
