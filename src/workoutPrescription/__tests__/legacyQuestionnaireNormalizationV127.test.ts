import { describe, expect, it } from 'vitest';
import { completeAnswers } from './fixtures';
import { goalFamilyFor, normalizeGoal } from '../input';
import { normalizeLimitationRegionV127 } from '../canonicalMusculoskeletalLimitationV127';
import { normalizeMusclePriorityInputV127 } from '../canonicalMusclePriorityV127';
import { selectBaseTemplateV127ForCurrentTrainingLevel, selectBaseTemplateV127FromAnswers } from '../selectorV127';
import { questionnaireLevelForCurrentLevel } from '../../workoutLifecycle/prescriptionInputs';

/**
 * Fase 8 §5 — consolidated audit of every legacy/obsolete questionnaire
 * value a NEW v1.27 generation could realistically receive (an account
 * that answered the questionnaire years ago, before any of these fields
 * existed in their current form). Every normalizer here is the same real,
 * already-existing function from Fases 3/5/6/7 — nothing new is
 * implemented in this file, it only proves they hold together.
 */

describe('Fase 8 — goal aliases (legacy hyper/cut/def/recon)', () => {
  it.each([
    ['hyper', 'gain_muscle', 'hypertrophy_body_composition'],
    ['cut', 'lose_fat', 'hypertrophy_body_composition'],
    ['def', 'body_composition', 'hypertrophy_body_composition'],
    ['recon', 'return_to_training', 'hypertrophy_body_composition'],
  ] as const)('legacy goal "%s" normalizes to "%s" -> family "%s"', (legacy, normalized, family) => {
    expect(normalizeGoal(legacy)).toBe(normalized);
    expect(goalFamilyFor(legacy)).toBe(family);
  });

  it('the ambiguous legacy "perf" goal is never silently defaulted', () => {
    expect(goalFamilyFor('perf')).toBeNull();
    const result = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'perf' as never }));
    expect(result.status).toBe('MISSING_INPUT');
  });

  it('a genuinely unknown/corrupted goal value fails closed rather than inventing a family', () => {
    expect(goalFamilyFor('not_a_real_goal' as never)).toBeNull();
  });
});

describe('Fase 8 — currentTrainingLevel remains the sole authority for level (never the raw stored answer)', () => {
  it('stale "beginner"/"never_or_starting" answers never leak through once currentTrainingLevel says otherwise', () => {
    for (const staleLevel of ['beginner', 'never_or_starting'] as const) {
      const answers = completeAnswers({ level: staleLevel, place: 'gym', days: 4, goal: 'gain_muscle' });
      const result = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'INTERMEDIATE');
      expect(result.status).toBe('SELECTED');
      if (result.status === 'SELECTED') expect(result.templateId).not.toMatch(/^T(09[1-9]|10[0-2])$/);
    }
  });

  it('maps every lifecycle level to the exact questionnaire string the engines expect', () => {
    expect(questionnaireLevelForCurrentLevel('BEGINNER')).toBe('beginner');
    expect(questionnaireLevelForCurrentLevel('INTERMEDIATE')).toBe('intermediate');
    expect(questionnaireLevelForCurrentLevel('ADVANCED')).toBe('advanced');
  });
});

describe('Fase 8 — musculoskeletal limitation region: legacy "back" -> "spine" only, muscle "back" untouched', () => {
  it('"back" (the legacy LimitationRegionId value) normalizes to the v1.27 "spine" region', () => {
    expect(normalizeLimitationRegionV127('back')).toBe('spine');
  });

  it('the 7 canonical v1.27 region ids pass through unchanged', () => {
    for (const region of ['knee', 'hip', 'spine', 'shoulder', 'elbow', 'wrist', 'ankle_foot']) {
      expect(normalizeLimitationRegionV127(region)).toBe(region);
    }
  });

  it('"other" (not implemented) and any unrecognized value are dropped, never fabricated into a region', () => {
    expect(normalizeLimitationRegionV127('other')).toBeNull();
    expect(normalizeLimitationRegionV127('not_a_real_region')).toBeNull();
  });
});

describe('Fase 8 — muscle priority: legacy "arms" -> biceps + triceps, "core"/"none" handled', () => {
  it('"arms" expands to biceps + triceps, never forearms', () => {
    expect(normalizeMusclePriorityInputV127(['arms'])).toEqual(['biceps', 'triceps']);
  });

  it('"none" and unrecognized values are dropped, never fabricated into a target', () => {
    expect(normalizeMusclePriorityInputV127(['none'])).toEqual([]);
    expect(normalizeMusclePriorityInputV127(['not_a_real_target'])).toEqual([]);
  });

  it('the 10 canonical targets (including "core") pass through unchanged', () => {
    const targets = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];
    expect(normalizeMusclePriorityInputV127(targets)).toEqual(targets);
  });
});
