import { describe, expect, it } from 'vitest';

import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { generateWorkoutPrescriptionV127 } from '../engineV127';
import { V127_TEMPLATE_PROFILES } from '../selectorV127';
import type { CurrentTrainingLevel } from '../../workoutLifecycle/types';
import { answersForTemplate } from './fixtures';

/**
 * Fase 9 §4/§5/§6/§7 — full end-to-end materialization of all 102 v1.27
 * templates through the real pipeline (`generateWorkoutPrescriptionV127`),
 * not just profile-level selectability (already proven by
 * `selectorV127.test.ts`'s 102/102 reachability). "Selectable" and
 * "materializes a valid, SUCCESS FinalWorkoutPlan" are different claims —
 * this test proves the second one for every template the current data
 * actually supports composing (no active musculoskeletal limitation, no
 * muscle priority — those are covered by their own dedicated modifier
 * suites, `musculoskeletalLimitationV127.test.ts` /
 * `musclePriorityV127.test.ts`).
 */
describe('engineV127 — 102/102 template materialization (no modifiers active)', () => {
  const outcomes = V127_TEMPLATE_PROFILES.map((profile) => {
    const template = getCanonicalTemplateV127ById(profile.id);
    const answers = answersForTemplate(template);
    const currentTrainingLevel: CurrentTrainingLevel = profile.experience_level === 'beginner' ? 'BEGINNER' : 'INTERMEDIATE';
    const result = generateWorkoutPrescriptionV127(answers, currentTrainingLevel);
    return { profile, result };
  });

  it('covers exactly 102 templates: 72 regular + 18 special population + 12 beginner', () => {
    const regular = outcomes.filter(({ profile }) => !profile.special_population && !profile.experience_level);
    const special = outcomes.filter(({ profile }) => profile.special_population);
    const beginner = outcomes.filter(({ profile }) => profile.experience_level === 'beginner');
    expect(regular).toHaveLength(72);
    expect(special).toHaveLength(18);
    expect(beginner).toHaveLength(12);
    expect(outcomes).toHaveLength(102);
  });

  it('every template materializes SUCCESS and selects itself back (no cross-template drift)', () => {
    const failures = outcomes.filter(({ result }) => result.status !== 'SUCCESS');
    if (failures.length) {
      console.error('Fase 9 materialization failures:', failures.map(({ profile, result }) => ({
        id: profile.id,
        status: result.status,
        reasonCodes: 'reasonCodes' in result ? result.reasonCodes : undefined,
      })));
    }
    expect(failures).toHaveLength(0);
    for (const { profile, result } of outcomes) {
      if (result.status === 'SUCCESS') expect(result.plan.templateId).toBe(profile.id);
    }
  });

  it('every SUCCESS plan carries v1.27 identity end to end (versions, split, population, environment)', () => {
    for (const { profile, result } of outcomes) {
      if (result.status !== 'SUCCESS') continue;
      expect(result.plan.versions.templateLibrary).toBe('1.27.0');
      expect(result.plan.environment).toBe(profile.environment);
      if (profile.special_population) expect(result.plan.population).toBe(profile.special_population);
      else expect(result.plan.population).toBe('conventional');
    }
  });

  it('no legacy v2 transformation leaks through (session count matches template session count exactly)', () => {
    for (const { profile, result } of outcomes) {
      if (result.status !== 'SUCCESS') continue;
      const template = getCanonicalTemplateV127ById(profile.id);
      expect(result.plan.sessions).toHaveLength(template.sessions.length);
      result.plan.sessions.forEach((session, index) => {
        expect(session.exercises).toHaveLength(template.sessions[index].exercises.length);
      });
    }
  });

  it('planId is deterministic (repeat generation for the same answers reproduces the same planId)', () => {
    const sample = outcomes.find(({ result }) => result.status === 'SUCCESS');
    expect(sample).toBeDefined();
    if (!sample) return;
    const template = getCanonicalTemplateV127ById(sample.profile.id);
    const answers = answersForTemplate(template);
    const level: CurrentTrainingLevel = sample.profile.experience_level === 'beginner' ? 'BEGINNER' : 'INTERMEDIATE';
    const again = generateWorkoutPrescriptionV127(answers, level);
    expect(again.status).toBe('SUCCESS');
    if (again.status === 'SUCCESS' && sample.result.status === 'SUCCESS') {
      expect(again.plan.planId).toBe(sample.result.plan.planId);
    }
  });
});
