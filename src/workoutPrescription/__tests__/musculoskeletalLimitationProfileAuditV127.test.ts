import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import {
  CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127,
  hasReliableLimitationProfileCoverageV127,
} from '../canonicalMusculoskeletalLimitationV127';
import { V127_TEMPLATE_PROFILES } from '../selectorV127';

/**
 * Fase 13 §1 — per-exercise audit of the 7 v1.27 Fase 2 closure resistance
 * exercises (`src/data/exercisesSeedData.ts`) against
 * `CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127` (the 76 ids in
 * `docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json`
 * — the same source `assertPlanSafe`/Firestore `limitationProfile` fields
 * are seeded from).
 *
 * No new clinical classification is invented anywhere in this file.
 *
 * RESULT (see the Fase 13 report for the full write-up):
 *
 *   2 have a strong, PRECEDENTED reuse candidate — same primaryMuscle,
 *   movement.pattern, movement.mechanic, movement.laterality, AND
 *   bodyPosition as an already-approved profile, differing ONLY in
 *   equipment. The existing 76-profile dataset already treats several
 *   equipment-only-different exercise pairs as sharing byte-identical
 *   `regions` content under `reviewBasis: 'product_policy'` (e.g.
 *   `iso-lateral-row-machine`/`low-cable-row-wide-neutral-grip`,
 *   `hack-squat-machine`/`leg-press-45`) — this is the established,
 *   already-supported mechanism, not a new one. PROPOSED, not applied:
 *   nothing in this repo copies the profile automatically; a human still
 *   has to review and publish it.
 *
 *     - dumbbell-rear-delt-fly  -> propose reusing cable-rear-delt-fly's profile
 *     - resistance-band-standing-leg-curl -> propose reusing supported-standing-leg-curl's profile
 *
 *   5 have NO existing profiled exercise with a matching movement pattern
 *   AND mechanic (the two other bench-press-family/push-up candidates
 *   differ by incline/decline/flat angle, which this dataset's own
 *   existing profiles already treat as clinically distinct — see the
 *   "no identical angle-crossing group" assertion below — so angle-based
 *   equivalence is NOT assumed). These stay BLOCKED until a real review:
 *
 *     - decline-barbell-bench-press
 *     - dumbbell-fly
 *     - resistance-band-pullover
 *     - decline-push-up
 *     - incline-push-up
 *
 * Regardless of category, ALL 7 currently fail closed identically — see
 * `musculoskeletalLimitationV127.ts`'s `hasProfileCoverage` check
 * (`musculoskeletalLimitationV127.test.ts`'s "real-data proof" test and
 * `engineV127Integration.test.ts`'s T009 test already prove the runtime
 * behavior end to end). This file only pins the AUDIT facts themselves.
 */
const NEW_EXERCISE_IDS = [
  'decline-barbell-bench-press',
  'dumbbell-fly',
  'dumbbell-rear-delt-fly',
  'resistance-band-pullover',
  'decline-push-up',
  'incline-push-up',
  'resistance-band-standing-leg-curl',
] as const;

const PROPOSED_REUSE: Record<string, string> = {
  'dumbbell-rear-delt-fly': 'cable-rear-delt-fly',
  'resistance-band-standing-leg-curl': 'supported-standing-leg-curl',
};

const exerciseById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

describe('Fase 13 §1 — none of the 7 new exercises have a confirmed limitation profile today', () => {
  it.each(NEW_EXERCISE_IDS)('%s is NOT in CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127', (id) => {
    expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(id)).toBe(false);
    expect(hasReliableLimitationProfileCoverageV127(id)).toBe(false);
  });

  it('exactly 76 exercises have a confirmed profile (unchanged by the audit itself)', () => {
    expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.size).toBe(76);
  });
});

describe('Fase 13 §1 — proposed reuse candidates are movement-identical, equipment-only different', () => {
  it.each(Object.entries(PROPOSED_REUSE))('%s matches %s on primaryMuscle/pattern/mechanic/laterality/bodyPosition', (newId, existingId) => {
    const newExercise = exerciseById.get(newId)!;
    const existingExercise = exerciseById.get(existingId)!;
    expect(existingExercise).toBeDefined();
    expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(existingId)).toBe(true);
    expect(newExercise.target.primaryMuscle).toBe(existingExercise.target.primaryMuscle);
    expect(newExercise.movement.pattern).toBe(existingExercise.movement.pattern);
    expect(newExercise.movement.mechanic).toBe(existingExercise.movement.mechanic);
    expect(newExercise.movement.laterality).toBe(existingExercise.movement.laterality);
    expect(newExercise.bodyPosition).toBe(existingExercise.bodyPosition);
    // The only legitimate difference this proposal relies on.
    expect(newExercise.equipment).not.toEqual(existingExercise.equipment);
  });

  it('the dataset already has precedent for equipment-only-different exercises sharing an identical profile (not a new mechanism)', () => {
    const rowPrecedent = ['iso-lateral-row-machine', 'low-cable-row-wide-neutral-grip'];
    const squatPrecedent = ['hack-squat-machine', 'leg-press-45'];
    for (const [a, b] of [rowPrecedent, squatPrecedent]) {
      expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(a)).toBe(true);
      expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(b)).toBe(true);
    }
  });
});

describe('Fase 13 §1 — the other 5 exercises have no SAFE existing profiled equivalent', () => {
  const artifact = JSON.parse(readFileSync(
    resolve(__dirname, '../../../docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json'), 'utf8',
  )) as { profiles: { exerciseId: string; limitationProfile: { regions: unknown } }[] };
  const regionsById = new Map(artifact.profiles.map((profile) => [profile.exerciseId, JSON.stringify(profile.limitationProfile.regions)]));

  it('dumbbell-fly and resistance-band-pullover have zero profiled exercises sharing primaryMuscle+pattern+mechanic — no candidate exists at all', () => {
    for (const id of ['dumbbell-fly', 'resistance-band-pullover'] as const) {
      const target = exerciseById.get(id)!;
      const sameMovementFamily = EXERCISES_SEED.filter((candidate) =>
        candidate.id !== id
        && candidate.target.primaryMuscle === target.target.primaryMuscle
        && candidate.movement.pattern === target.movement.pattern
        && candidate.movement.mechanic === target.movement.mechanic
        && CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(candidate.id));
      expect(sameMovementFamily).toEqual([]);
    }
  });

  /**
   * decline-barbell-bench-press/decline-push-up/incline-push-up DO share
   * primaryMuscle+pattern+mechanic with 5 already-profiled exercises
   * (incline-dumbbell-bench-press, iso-lateral-incline-chest-press-machine,
   * machine-flat-bench-press, push-up, wall-push-up) — but that coarse
   * match is NOT proof of safe equivalence: this test proves those 5
   * exercises do NOT share identical `regions` content with EACH OTHER
   * (unlike the row/squat precedent groups above), meaning the dataset's
   * own reviewers already treat incline/flat/decline/wall angle as
   * clinically distinct within this specific movement family. Borrowing
   * any one of their profiles for a NEW angle variant would be exactly the
   * invented-by-inference classification this fase forbids.
   */
  it('the flat/incline/wall bench-press family does not share an identical profile across its own angle variants (precedent for NOT assuming angle-equivalence)', () => {
    const anglePressIds = ['incline-dumbbell-bench-press', 'iso-lateral-incline-chest-press-machine', 'machine-flat-bench-press', 'push-up', 'wall-push-up'];
    for (const id of anglePressIds) expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(id)).toBe(true);
    const uniqueRegionsContent = new Set(anglePressIds.map((id) => regionsById.get(id)));
    expect(uniqueRegionsContent.size).toBe(anglePressIds.length);
  });
});

describe('Fase 13 §1 — exact v1.27 template impact of each blocked exercise', () => {
  const templateImpact = Object.fromEntries(NEW_EXERCISE_IDS.map((id) => [id, [] as string[]]));
  for (const profile of V127_TEMPLATE_PROFILES) {
    const template = getCanonicalTemplateV127ById(profile.id);
    const usedInTemplate = new Set<string>();
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        if ((NEW_EXERCISE_IDS as readonly string[]).includes(exercise.exercise_id)) usedInTemplate.add(exercise.exercise_id);
      }
    }
    for (const id of usedInTemplate) templateImpact[id].push(profile.id);
  }

  it('pins the exact affected-template counts (regression guard — re-check this report section if templates change)', () => {
    expect(templateImpact['decline-barbell-bench-press']).toHaveLength(12);
    expect(templateImpact['dumbbell-fly']).toHaveLength(12);
    expect(templateImpact['dumbbell-rear-delt-fly']).toHaveLength(14);
    expect(templateImpact['resistance-band-pullover']).toHaveLength(12);
    expect(templateImpact['decline-push-up']).toHaveLength(35);
    expect(templateImpact['incline-push-up']).toHaveLength(28);
    expect(templateImpact['resistance-band-standing-leg-curl']).toHaveLength(32);
  });

  it('T102 (beginner/home/7d) specifically depends on incline-push-up — a concrete example a limitation-declaring beginner Home user would hit', () => {
    expect(templateImpact['incline-push-up']).toContain('T102');
  });
});
