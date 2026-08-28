import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural regression guard for the removal of the `limitationImpact`
 * questionnaire step (mild / requires_adaptation / professional_restriction /
 * unknown). Selecting a musculoskeletal region now activates adaptation on
 * its own — see `evaluateSafety` in `../safety.ts`. This guard fails if that
 * symbol, or the musculoskeletal `professional_restriction` branch it used
 * to gate, is reintroduced into runtime production code. It intentionally
 * allows the narrow, explicitly-named legacy-read-compat sites (which strip
 * the field so it can never reach the current model) and test fixtures that
 * exist only to prove old documents don't crash.
 */

const PRODUCTION_FILES_MUST_NOT_REFERENCE_LIMITATION_IMPACT = [
  'src/state/AppState.tsx',
  'src/onboarding/questionDefs.ts',
  'src/onboarding/steps.ts',
  'src/screens/OnboardingFunnelScreen.tsx',
  'src/workoutPrescription/types.ts',
  'src/workoutPrescription/safety.ts',
  'src/workoutPrescription/modifiers.ts',
  'src/workoutPrescription/input.ts',
  'src/workoutPrescription/limitationResolver.ts',
  'src/workoutPrescription/engine.ts',
];

// These read historical Firestore/draft documents at a data boundary. Each
// must only ever destructure-and-discard the legacy field — never branch on
// its value or persist it forward. Asserted individually below.
const LEGACY_READ_COMPAT_FILES = [
  'src/lib/questionnaireAnswers.ts',
  'src/lib/questionnaireSchema.ts',
  'src/onboarding/draftStorage.ts',
];

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('limitationImpact / musculoskeletal professional_restriction regression guard', () => {
  it.each(PRODUCTION_FILES_MUST_NOT_REFERENCE_LIMITATION_IMPACT)(
    '%s never references the removed limitationImpact field',
    (path) => {
      expect(read(path)).not.toMatch(/limitationImpact/);
    },
  );

  it('safety.ts never branches on the removed musculoskeletal professional_restriction outcome', () => {
    const body = read('src/workoutPrescription/safety.ts');
    expect(body).not.toMatch(/professional_restriction/);
    expect(body).not.toMatch(/MUSCULOSKELETAL_PROFESSIONAL_RESTRICTION/);
    expect(body).not.toMatch(/MUSCULOSKELETAL_MILD/);
  });

  it('SafetyReasonCode no longer declares the removed musculoskeletal reason codes', () => {
    const body = read('src/workoutPrescription/types.ts');
    expect(body).not.toMatch(/MUSCULOSKELETAL_PROFESSIONAL_RESTRICTION/);
    expect(body).not.toMatch(/MUSCULOSKELETAL_MILD/);
  });

  it.each(LEGACY_READ_COMPAT_FILES)(
    '%s only declares the field as `unknown` or destructures-and-discards it into `_legacy*`, never reads or branches on its value',
    (path) => {
      const body = read(path);
      // Present as a read-boundary artifact (type/destructure), but never
      // property-accessed (`.limitationImpact` / `['limitationImpact']`),
      // compared against a value, or re-assembled into an object that gets
      // written back out.
      expect(body).toMatch(/limitationImpact/);
      expect(body).not.toMatch(/\.limitationImpact\b/);
      expect(body).not.toMatch(/limitationImpact['"\]]/);
      expect(body).not.toMatch(/limitationImpact\s*===/);
      const declarationOrDiscard = /limitationImpact\s*(\?:\s*unknown|:\s*_legacy\w*)/g;
      const occurrences = body.match(/limitationImpact/g) ?? [];
      const allowed = body.match(declarationOrDiscard) ?? [];
      expect(allowed.length).toBe(occurrences.length);
    },
  );

  it('no production i18n resource still defines the removed limitationImpact question copy', () => {
    for (const locale of ['en', 'es', 'pt-BR']) {
      const body = read(`src/i18n/resources/${locale}/quiz.json`);
      expect(body).not.toMatch(/"limitationImpact"/);
      expect(body).not.toMatch(/"professional_restriction"/);
      expect(body).not.toMatch(/"requires_adaptation"/);
    }
  });
});
