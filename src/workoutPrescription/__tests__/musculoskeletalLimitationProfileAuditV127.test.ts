import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import {
  CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127,
  hasReliableLimitationProfileCoverageV127,
} from '../canonicalMusculoskeletalLimitationV127';
import { validateLimitationProfile } from '../limitationResolver';
import { V127_TEMPLATE_PROFILES } from '../selectorV127';

/**
 * Fase 13 §1 (original) + Fase 4 exercise-substitution closure (this file's
 * current state) — per-exercise audit of the 10 v1.27 exercises that had no
 * reviewed `limitationProfile` (7 from the original Fase 13 audit below, plus
 * `cable-crossover-fly`, `bent-over-dumbbell-row`, `preacher-curl`, found by
 * the later 714-combination audit).
 *
 * An APPROVED product/clinical decision matrix (all 7 regions, all 10
 * exercise ids) was implemented in
 * `docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json`
 * (`phase4Addition`), reusing ONLY already-catalogued, already-profiled
 * candidates that pass the resolver's own `purposePreserved` (same
 * `movement.pattern` + same `target.primaryMuscle`) and have their OWN
 * region rule `compatible`/`not_applicable` for the target region — never a
 * new or invented exercise, never a `proposed_catalog_addition`.
 *
 * RESULT: 7 of the 10 could be represented COMPLETELY (every `adapt` field
 * has a valid, existing candidate) and are now in
 * `CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127`:
 *
 *   - decline-push-up            (shoulder/elbow/wrist adapt -> wall-push-up)
 *   - incline-push-up            (shoulder/elbow/wrist adapt -> wall-push-up)
 *   - decline-barbell-bench-press(shoulder/elbow/wrist adapt -> wall-push-up)
 *   - resistance-band-standing-leg-curl (knee adapt -> supported-standing-leg-curl)
 *   - bent-over-dumbbell-row     (hip/shoulder/wrist adapt -> resistance-band-row; back avoid, no declared substitute)
 *   - preacher-curl              (elbow/wrist adapt -> hammer-curl)
 *   - resistance-band-pullover   (shoulder/wrist adapt -> resistance-band-lat-pulldown)
 *
 * Fase 4b (per-region coverage) — the remaining 3 (`cable-crossover-fly`,
 * `dumbbell-fly`, `dumbbell-rear-delt-fly`) could NOT be represented
 * completely (no existing candidate for at least one `adapt` region — see
 * the Fase 4 write-up below), which under the OLD "profile is all-or-nothing"
 * rule meant withholding the entire profile — including the regions that
 * WERE already decided (e.g. `cable-crossover-fly`'s own `knee:
 * not_applicable`), incorrectly blocking users whose only active region had
 * nothing to do with the pending one.
 *
 * The fix: `ExerciseLimitationRule` gained a `pending` status (see its own
 * doc in `types/exercise.ts`) — schema-valid, but NEVER terminal-safe and
 * NEVER a source of declared substitution candidates. `resolveExerciseLimitationsFromCandidates`
 * already evaluated `sourceTerminal`/candidate profiles per ACTIVE region
 * only (this part was never global) — the one real gap was that its
 * unconditional `similarExerciseIds`/family-group candidate search could
 * still run for a `pending` region and silently accept a same-family
 * candidate nobody actually reviewed for that region (e.g.
 * `cable-crossover-fly`'s own `chest_fly` group already contains
 * `pec-deck-machine-fly`). `hasPendingActiveRegion` in
 * `musculoskeletalLimitationV127.ts` closes that gap: any exercise with a
 * `pending` rule for an ACTIVE region is blocked as `PROFILE_COVERAGE_MISSING`
 * before the resolver's candidate search ever runs — `limitationResolver.ts`
 * itself (shared with v2) is otherwise unchanged.
 *
 * RESULT: all 3 now have a complete, schema-valid profile:
 *   - cable-crossover-fly: knee/hip/back/elbow/ankle_foot decided;
 *     shoulder/wrist `pending`.
 *   - dumbbell-fly: same shape as cable-crossover-fly.
 *   - dumbbell-rear-delt-fly: shoulder resolved (`adapt` -> cable-rear-delt-fly,
 *     already used elsewhere); wrist `pending`.
 *
 * No new clinical classification is invented anywhere in this file or in the
 * dataset it audits — every `adapt` target used already exists, is already
 * profiled, and already passes the resolver's real eligibility rules; every
 * `pending` region stays an explicit non-decision, never converted to
 * `compatible`/`not_applicable`/`adapt`/`avoid`.
 */
const RESOLVED_EXERCISE_IDS = [
  'decline-push-up',
  'incline-push-up',
  'decline-barbell-bench-press',
  'resistance-band-standing-leg-curl',
  'bent-over-dumbbell-row',
  'preacher-curl',
  'resistance-band-pullover',
] as const;

/** Fase 4b: these 3 now HAVE a profile object (in CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127), but at least one region is `pending`, never decided. */
const PARTIALLY_PENDING_EXERCISE_IDS = [
  'dumbbell-rear-delt-fly',
  'dumbbell-fly',
  'cable-crossover-fly',
] as const;

const PENDING_REGIONS: Record<string, string[]> = {
  'cable-crossover-fly': ['shoulder', 'wrist'],
  'dumbbell-fly': ['shoulder', 'wrist'],
  'dumbbell-rear-delt-fly': ['wrist'],
};

const ADAPT_TARGETS_USED: Record<string, Record<string, string>> = {
  'decline-push-up': { shoulder: 'wall-push-up', elbow: 'wall-push-up', wrist: 'wall-push-up' },
  'incline-push-up': { shoulder: 'wall-push-up', elbow: 'wall-push-up', wrist: 'wall-push-up' },
  'decline-barbell-bench-press': { shoulder: 'wall-push-up', elbow: 'wall-push-up', wrist: 'wall-push-up' },
  'resistance-band-standing-leg-curl': { knee: 'supported-standing-leg-curl' },
  'bent-over-dumbbell-row': { hip: 'resistance-band-row', shoulder: 'resistance-band-row', wrist: 'resistance-band-row' },
  'preacher-curl': { elbow: 'hammer-curl', wrist: 'hammer-curl' },
  'resistance-band-pullover': { shoulder: 'resistance-band-lat-pulldown', wrist: 'resistance-band-lat-pulldown' },
};

const exerciseById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
const artifact = JSON.parse(readFileSync(
  resolve(__dirname, '../../../docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json'), 'utf8',
)) as { profiles: { exerciseId: string; limitationProfile: { regions: Record<string, { status: string }> } }[] };
const profileByExerciseId = new Map(artifact.profiles.map((p) => [p.exerciseId, p.limitationProfile]));

describe('Fase 4 closure — 7 of the 10 previously-unprofiled exercises now have a complete, valid, non-invented limitationProfile', () => {
  it.each(RESOLVED_EXERCISE_IDS)('%s IS in CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127 and its profile is schema-valid', (id) => {
    expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(id)).toBe(true);
    expect(hasReliableLimitationProfileCoverageV127(id)).toBe(true);
    const profile = profileByExerciseId.get(id);
    expect(validateLimitationProfile(id, profile).valid).toBe(true);
  });

  it('exactly 86 exercises have a confirmed profile object (76 original + 7 Fase 4 + 3 Fase 4b) — object existing no longer implies every region is decided', () => {
    expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.size).toBe(86);
  });

  it.each(Object.entries(ADAPT_TARGETS_USED).flatMap(([id, regions]) => Object.entries(regions).map(([region, target]) => [id, region, target] as const)))(
    '%s: adapt target for region "%s" (%s) already exists, is already profiled, and is itself compatible/not_applicable for that region',
    (id, region, target) => {
      expect(exerciseById.has(target)).toBe(true);
      expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(target)).toBe(true);
      const targetProfile = profileByExerciseId.get(target);
      const targetRegionStatus = targetProfile?.regions[region]?.status;
      expect(['compatible', 'not_applicable']).toContain(targetRegionStatus);
      // purposePreserved: same movement.pattern AND same primaryMuscle as the source.
      const source = exerciseById.get(id)!;
      const candidate = exerciseById.get(target)!;
      expect(candidate.movement.pattern).toBe(source.movement.pattern);
      expect(candidate.target.primaryMuscle).toBe(source.target.primaryMuscle);
    },
  );

  it('bent-over-dumbbell-row\'s spine/back "avoid" rule declares no substitute (none was approved for that field) — the resolver still may reach one via similar/family pool, but nothing is asserted here', () => {
    const backRule = profileByExerciseId.get('bent-over-dumbbell-row')?.regions.back;
    expect(backRule?.status).toBe('avoid');
    expect((backRule as { substituteExerciseIds?: string[] })?.substituteExerciseIds).toEqual([]);
    expect((backRule as { candidateStatus?: string })?.candidateStatus).toBe('missing_exercise_candidate');
  });
});

describe('Fase 4b — cable-crossover-fly, dumbbell-fly, dumbbell-rear-delt-fly now HAVE a profile object, with only the still-undecided regions marked `pending`', () => {
  it.each(PARTIALLY_PENDING_EXERCISE_IDS)('%s IS in CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127 (has a schema-valid profile object)', (id) => {
    expect(CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(id)).toBe(true);
    expect(hasReliableLimitationProfileCoverageV127(id)).toBe(true);
    const profile = profileByExerciseId.get(id);
    expect(validateLimitationProfile(id, profile).valid).toBe(true);
  });

  it.each(PARTIALLY_PENDING_EXERCISE_IDS)('%s: every region NOT listed as pending has a real, decided status (never pending itself)', (id) => {
    const profile = profileByExerciseId.get(id)!;
    const pending = new Set(PENDING_REGIONS[id]);
    for (const [region, rule] of Object.entries(profile.regions)) {
      if (pending.has(region)) {
        expect(rule.status).toBe('pending');
      } else {
        expect(rule.status).not.toBe('pending');
        expect(['compatible', 'not_applicable', 'adapt', 'avoid']).toContain(rule.status);
      }
    }
  });

  it('dumbbell-fly and cable-crossover-fly (chest/horizontal_adduction): no same-family exercise is ACTUALLY shoulder/wrist-safe (compatible/not_applicable) — pending, not silently resolved', () => {
    for (const id of ['dumbbell-fly', 'cable-crossover-fly'] as const) {
      const target = exerciseById.get(id)!;
      const sameMovementFamily = EXERCISES_SEED.filter((candidate) =>
        candidate.id !== id
        && candidate.target.primaryMuscle === target.target.primaryMuscle
        && candidate.movement.pattern === target.movement.pattern
        && profileByExerciseId.has(candidate.id));
      for (const region of ['shoulder', 'wrist'] as const) {
        const safeCandidates = sameMovementFamily.filter((candidate) =>
          ['compatible', 'not_applicable'].includes(profileByExerciseId.get(candidate.id)!.regions[region]?.status));
        expect(safeCandidates).toEqual([]);
      }
    }
  });

  it('dumbbell-rear-delt-fly: shoulder now resolves via cable-rear-delt-fly (already used elsewhere); wrist stays pending because cable-rear-delt-fly\'s own wrist rule is `adapt`, not terminal-safe', () => {
    const profile = profileByExerciseId.get('dumbbell-rear-delt-fly')!;
    expect(profile.regions.shoulder).toEqual({ status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'cable-rear-delt-fly' } });
    expect(profile.regions.wrist.status).toBe('pending');
    const candidateProfile = profileByExerciseId.get('cable-rear-delt-fly')!;
    expect(candidateProfile.regions.shoulder.status).toBe('compatible');
    expect(candidateProfile.regions.wrist.status).toBe('adapt');
  });
});

describe('Fase 13 §1 (original) — exact v1.27 template impact of each blocked exercise (regression guard, still meaningful for the exercises that remain blocked)', () => {
  const ALL_TEN = [...RESOLVED_EXERCISE_IDS, ...PARTIALLY_PENDING_EXERCISE_IDS];
  const templateImpact = Object.fromEntries(ALL_TEN.map((id) => [id, [] as string[]]));
  for (const profile of V127_TEMPLATE_PROFILES) {
    const template = getCanonicalTemplateV127ById(profile.id);
    const usedInTemplate = new Set<string>();
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        if ((ALL_TEN as readonly string[]).includes(exercise.exercise_id)) usedInTemplate.add(exercise.exercise_id);
      }
    }
    for (const id of usedInTemplate) templateImpact[id].push(profile.id);
  }

  it('T102 (beginner/home/7d) specifically depends on incline-push-up — a concrete example of a template that is now unblocked by this closure (subject to the resolver\'s other gates: environment/duplicate/other exercises in the same session)', () => {
    expect(templateImpact['incline-push-up']).toContain('T102');
  });

  it('dumbbell-fly/cable-crossover-fly/dumbbell-rear-delt-fly still have real template impact (still-blocked exercises)', () => {
    expect(templateImpact['dumbbell-fly'].length).toBeGreaterThan(0);
    expect(templateImpact['cable-crossover-fly'].length).toBeGreaterThan(0);
    expect(templateImpact['dumbbell-rear-delt-fly'].length).toBeGreaterThan(0);
  });
});
