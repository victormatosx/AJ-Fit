import { describe, expect, it } from 'vitest';
import { generateWorkoutPrescriptionV127 } from '../engineV127';
import { generateWorkoutPrescription } from '../engine';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { composeTemplateV127 } from '../compositionV127';
import { completeAnswers } from './fixtures';
import { sanitizeAnswersForEngine } from '../input';
import { normalizeLoadedQuiz } from '../../lib/questionnaireSchema';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { buildPrescriptionInputSnapshot, isPrescriptionInputSnapshot, questionnaireAnswersFromPrescriptionInputs } from '../../workoutLifecycle/prescriptionInputs';
import { getStepSequence } from '../../onboarding/steps';
import { V127_TEMPLATE_PROFILES } from '../selectorV127';
import type { QuestionnaireAnswers } from '../types';

const answers = completeAnswers({ days: 5, sex: 'm', level: 'intermediate', goal: 'gain_muscle', place: 'gym' });
const historical = { ...answers, limits: ['knee', 'back', 'other'], limitationImpact: 'severe', specialConditions: ['musculoskeletal_limitation'] } as unknown as QuestionnaireAnswers;

describe('removed physical limitation system', () => {
  it('generates T004 and all five normal sessions, including Legs and the fifth session', () => {
    const result = generateWorkoutPrescriptionV127(historical, 'INTERMEDIATE');
    const clean = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
    expect(result).toEqual(clean);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.templateId).toBe('T004');
    expect(result.plan.sessions).toHaveLength(5);
    expect(result.plan.sessions).toEqual(composeTemplateV127(getCanonicalTemplateV127ById('T004')).sessions);
    expect(result.plan.sessions[2].name).toMatch(/legs/i);
    expect(result.plan.sessions[2].exercises.some(item => item.exerciseId === 'leg-press-45')).toBe(true);
    expect(result.plan.sessions[4].exercises.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/limitation|musculoskeletal|substitutionPolicy/);
  });

  it('ignores old answers in the V2 engine and does not require the retired question', () => {
    expect(generateWorkoutPrescription(historical)).toEqual(generateWorkoutPrescription(answers));
    expect(sanitizeAnswersForEngine(answers).legacyReasonCodes).toEqual([]);
  });

  it('materializes all 102 templates without any clinical dataset', () => {
    for (const profile of V127_TEMPLATE_PROFILES) {
      const template = getCanonicalTemplateV127ById(profile.id);
      const result = composeTemplateV127(template);
      expect(result.sessions).toHaveLength(template.sessions.length);
      expect(result.sessions.flatMap(s => s.exercises.map(e => e.exerciseId))).toEqual(template.sessions.flatMap(s => s.exercises.map(e => e.exercise_id)));
    }
  });

  it('drops retired fields at every boundary — local state, Firestore writes and engine-facing snapshots', () => {
    // The physical-limitations question no longer exists anywhere, so
    // `normalizeLoadedQuiz` now drops the retired fields instead of carrying
    // them for in-session navigation. A historical document stays loadable.
    const normalized = normalizeLoadedQuiz(historical);
    expect(Object.prototype.hasOwnProperty.call(normalized, 'limits')).toBe(false);
    expect(normalized.specialConditions).not.toContain('musculoskeletal_limitation');
    expect(Object.prototype.hasOwnProperty.call(normalized, 'limitationImpact')).toBe(false);

    const stored = toPersistedAnswers(historical);
    const snapshot = buildPrescriptionInputSnapshot({ answers: historical, currentTrainingLevel: 'INTERMEDIATE', source: 'QUESTIONNAIRE_BASELINE' });
    for (const value of [stored, snapshot]) expect(JSON.stringify(value)).not.toMatch(/limits|limitationImpact|musculoskeletal/);
    const old = { ...snapshot, inputs: { ...snapshot.inputs, limits: ['other'], specialConditions: ['musculoskeletal_limitation'] } };
    expect(isPrescriptionInputSnapshot(old)).toBe(true);
    expect(questionnaireAnswersFromPrescriptionInputs(old.inputs as never)).not.toHaveProperty('limitationImpact');
    // The REAL `EffectivePrescriptionInputs` shape (unlike the adversarial
    // `old.inputs` above, which injects a `limits`/`musculoskeletal_limitation`
    // combination `effectivePrescriptionInputsFromAnswers` can never actually
    // produce) never carries `musculoskeletal_limitation` through to
    // prescription-continuity state:
    expect(questionnaireAnswersFromPrescriptionInputs(snapshot.inputs).specialConditions).not.toContain('musculoskeletal_limitation');
    // The step is gone from every sequence, including for a historical
    // answer set that still declares a musculoskeletal limitation — the
    // question is no longer offered to anyone, under any entry point.
    for (const entry of ['anonymous', 'forcedQuestionnaire'] as const) {
      expect(getStepSequence(entry, historical)).not.toContain('limits');
      expect(getStepSequence(entry, answers)).not.toContain('limits');
    }
  });

  it('manual exercise substitution is unaffected by the restored (purely informational) limitations question', async () => {
    const { EXERCISES_SEED } = await import('../../data/exercisesSeedData');
    const { equipmentContextFor } = await import('../equipment');
    const { resolveManualSubstitutionCandidates } = await import('../manualSubstitutionResolver');
    const catalog = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
    const withoutLimitation = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat',
      catalog,
      equipmentContext: equipmentContextFor(answers, 'gym'),
      effectiveExerciseIdsInSession: new Set<string>(),
      maxResults: 10,
    });
    const withLimitation = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat',
      catalog,
      equipmentContext: equipmentContextFor(historical, 'gym'),
      effectiveExerciseIdsInSession: new Set<string>(),
      maxResults: 10,
    });
    expect(withLimitation).toEqual(withoutLimitation);
  });
});

it('has no production imports or executable owners of the retired subsystem', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const forbidden = /(?:limitationResolver|limitationDataset|localLimitationCatalog|canonicalMusculoskeletalLimitationV127|musculoskeletalLimitationV127|substitutionPolicyV3|ACTIVE_SUBSTITUTION_POLICY|MUSCULOSKELETAL_NO_SUBSTITUTE|NO_SAFE_CONFIGURATION)/;
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['__tests__', 'prescriptionEngine', 'docs'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/.test(path)) {
        const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
        expect(code, path).not.toMatch(forbidden);
      }
    }
  };
  visit('src');
  visit('functions/src');
});

it('does not copy retired prescription metadata into a new cycle', async () => {
  const { currentPrescriptionMetadata } = await import('../prescriptionMetadata');
  const result = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
  if (result.status !== 'SUCCESS') throw new Error(result.status);
  const historicalPlan = {
    ...result.plan,
    versions: { ...result.plan.versions, limitationResolver: '2.0.0' },
    trace: {
      ...result.plan.trace,
      limitationResolverVersion: 1,
      limitationDecisions: [{ regions: ['knee'] }],
      safety: { status: 'ADAPTED', reasons: ['MUSCULOSKELETAL_ADAPTATION_REQUIRED'], requiredModifierIds: ['safety:musculoskeletal_adaptation'], protectedConstraints: ['limitation:knee'] },
      appliedModifiers: ['safety:musculoskeletal_adaptation'],
    },
  } as unknown as typeof result.plan;
  const metadata = currentPrescriptionMetadata(historicalPlan);
  expect(metadata).toEqual(currentPrescriptionMetadata(result.plan));
  expect(JSON.stringify(metadata)).not.toMatch(/limitation|musculoskeletal/i);
  expect(historicalPlan.trace).toHaveProperty('limitationDecisions');
});
