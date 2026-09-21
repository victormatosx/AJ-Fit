import {
  AVOID_RUNTIME_IDS_BY_REGION_V127,
  isRuntimeExerciseExecutableV127,
  SUBSTITUTION_CANDIDATES_BY_RUNTIME_ID_V127,
  type MusculoskeletalLimitationRegionV127,
  type SubstitutionCandidateV127,
  type SubstitutionCandidatesV127,
} from './canonicalMusculoskeletalLimitationV127';
import type { FinalWorkoutExercise, FinalWorkoutSession, TemplateEnvironment } from './types';

/**
 * Fase 5 — the one canonical v1.27 modifier: `musculoskeletal_limitation`.
 * Pure, deterministic, no I/O. Operates on the *already Fase-4-identity-
 * mapped* `FinalWorkoutSession[]` (so it only ever needs a runtime
 * `exerciseId` to look up candidates — see
 * `canonicalMusculoskeletalLimitationV127.ts`'s doc on why the
 * substitution-map lookup is keyed by runtime id, not by name).
 *
 * Rule (Fase 5 §1): a region never re-selects a template or reshapes
 * anything but the vetoed slot itself. Every exercise NOT vetoed by an
 * active region is copied through unchanged — same object reference even,
 * so "session unaffected" is provably true.
 */

export type SubstitutionTier = 'A' | 'B' | 'C';

export type RejectedCandidateReasonV127 =
  | 'CANDIDATE_NOT_EXECUTABLE'
  | 'CANDIDATE_ENVIRONMENT_INCOMPATIBLE'
  | 'CANDIDATE_VIOLATES_ACTIVE_LIMITATION'
  | 'CANDIDATE_IS_SELF'
  | 'CANDIDATE_DUPLICATE_IN_SESSION'
  | 'CANDIDATE_UNSAFE_DOSE';

export interface RejectedCandidateV127 {
  exerciseId: string;
  tier: SubstitutionTier;
  reasonCode: RejectedCandidateReasonV127;
}

export type MusculoskeletalLimitationDecisionV127 =
  | {
      sessionIndex: number;
      exerciseId: string;
      vetoedByRegions: MusculoskeletalLimitationRegionV127[];
      outcome: 'SUBSTITUTED';
      tier: SubstitutionTier;
      substituteExerciseId: string;
      rejectedCandidates: RejectedCandidateV127[];
    }
  | {
      sessionIndex: number;
      exerciseId: string;
      vetoedByRegions: MusculoskeletalLimitationRegionV127[];
      outcome: 'BLOCKED';
      reasonCode: 'NO_SUBSTITUTION_MAP_ENTRY' | 'NO_VALID_CANDIDATE';
      rejectedCandidates: RejectedCandidateV127[];
    };

export type MusculoskeletalLimitationResultV127 =
  | { status: 'APPLIED'; sessions: FinalWorkoutSession[]; decisions: MusculoskeletalLimitationDecisionV127[] }
  | { status: 'BLOCKED'; reasonCodes: string[]; decisions: MusculoskeletalLimitationDecisionV127[] };

const TIERS: readonly SubstitutionTier[] = ['A', 'B', 'C'];

type DoseFieldsV127 = Pick<FinalWorkoutExercise, 'sets' | 'reps' | 'duration' | 'distance' | 'cycles' | 'cycleRange' | 'intensity' | 'notes'>;

/**
 * The one place a future authoritative substitute-specific reps/intensity
 * would be read from. Always `null` today: audited, and the
 * `exercise_substitution_map` candidate objects
 * (`canonicalMusculoskeletalLimitationV127.ts`'s `SubstitutionCandidateV127`
 * / the raw JSON's `RawSubstitutionCandidate`) carry only
 * `name`/`exercise_id`/`catalog_status`/`environments` — no dose field of
 * any kind — and `EXERCISES_SEED`'s `Exercise` has no prescriptive
 * reps/intensity either (dose is session-specific, not exercise-intrinsic).
 * Deliberately NOT a threshold, a muscle/mechanic-keyed range table, or a
 * hypertrophy/strength lookup — none of that exists in the canonical
 * source, and inventing one would be exactly the fabricated prescription
 * Fase 5 §6 forbids.
 */
function substituteAuthoritativeDose(_candidateRuntimeId: string): Pick<FinalWorkoutExercise, 'reps' | 'intensity'> | null {
  return null;
}

/**
 * Fase 5 §6 dose policy:
 *  - Tier A (closest equivalent): the original dose transfers verbatim —
 *    never an absolute load (this schema has none to copy in the first
 *    place), just the same sets/reps/duration/distance/cycles/intensity.
 *  - Tier B/C: `sets` (a volume signal, not an exercise-specific one) may
 *    always transfer from the original. `reps`/`intensity` are NEVER
 *    inherited from the original — only from an authoritative
 *    substitute-specific source (`substituteAuthoritativeDose`, always
 *    `null` today). If the original prescription needed reps or intensity
 *    (i.e. either field was set) and no authoritative substitute value
 *    exists, the candidate is rejected (`CANDIDATE_UNSAFE_DOSE`) —
 *    consistently, for every B/C candidate today, since no substitute
 *    anywhere in the canonical source carries its own dose metadata yet.
 *    `duration`/`distance`/`cycles`/`cycleRange` are unaffected — not a
 *    "reps" concern — and transfer from the original as before.
 */
function computeSubstituteDoseV127(
  tier: SubstitutionTier,
  original: FinalWorkoutExercise,
  candidateRuntimeId: string,
): { ok: true; dose: DoseFieldsV127 } | { ok: false } {
  if (tier === 'A') {
    return {
      ok: true,
      dose: {
        sets: original.sets,
        reps: original.reps,
        duration: original.duration,
        distance: original.distance,
        cycles: original.cycles,
        cycleRange: original.cycleRange,
        intensity: original.intensity,
        notes: original.notes,
      },
    };
  }
  const needsAuthoritativeDose = original.reps != null || original.intensity != null;
  const authoritative = needsAuthoritativeDose ? substituteAuthoritativeDose(candidateRuntimeId) : null;
  if (needsAuthoritativeDose && !authoritative) return { ok: false };
  const hasNonRepsDose = original.sets != null || original.duration != null || original.distance != null || original.cycleRange != null;
  if (!hasNonRepsDose) return { ok: false };
  return {
    ok: true,
    dose: {
      sets: original.sets,
      reps: authoritative?.reps,
      duration: original.duration,
      distance: original.distance,
      cycles: original.cycles,
      cycleRange: original.cycleRange,
      intensity: authoritative?.intensity,
      notes: original.notes,
    },
  };
}

function validateCandidateV127(input: {
  candidate: SubstitutionCandidateV127;
  environment: TemplateEnvironment;
  effectiveAvoid: ReadonlySet<string>;
  originalRuntimeId: string;
  usedInSession: ReadonlySet<string>;
  isExecutable: (runtimeId: string) => boolean;
}): RejectedCandidateReasonV127 | null {
  // Identity resolution and "existing_library only" are already enforced
  // when candidates are loaded (canonicalMusculoskeletalLimitationV127.ts)
  // — every SubstitutionCandidateV127 here already satisfies Fase 5 §5's
  // "resolves to a valid runtime identity" and "not a proposed addition"
  // checks structurally, by construction.
  // Self-check first: the original exercise's own runtime id is always,
  // trivially, a member of `effectiveAvoid` (it is the vetoed exercise) —
  // checking that before self-identity would misreport a self-referential
  // candidate as merely "violates a limitation" instead of the more
  // specific, more actionable truth.
  if (input.candidate.runtimeId === input.originalRuntimeId) return 'CANDIDATE_IS_SELF';
  if (!input.isExecutable(input.candidate.runtimeId)) return 'CANDIDATE_NOT_EXECUTABLE';
  if (!input.candidate.environments.includes(input.environment)) return 'CANDIDATE_ENVIRONMENT_INCOMPATIBLE';
  if (input.effectiveAvoid.has(input.candidate.runtimeId)) return 'CANDIDATE_VIOLATES_ACTIVE_LIMITATION';
  if (input.usedInSession.has(input.candidate.runtimeId)) return 'CANDIDATE_DUPLICATE_IN_SESSION';
  return null;
}

/**
 * Fase 5 §3: effectiveAvoid is the UNION of every active region's avoid
 * list — a candidate must be safe against ALL active limitations, not just
 * whichever region vetoed the exercise being replaced.
 */
function effectiveAvoidRuntimeIds(
  activeRegions: readonly MusculoskeletalLimitationRegionV127[],
  avoidByRegion: Readonly<Record<MusculoskeletalLimitationRegionV127, ReadonlySet<string>>>,
): ReadonlySet<string> {
  const union = new Set<string>();
  for (const region of activeRegions) {
    for (const runtimeId of avoidByRegion[region]) union.add(runtimeId);
  }
  return union;
}

export interface MusculoskeletalLimitationDataV127 {
  avoidByRegion: Readonly<Record<MusculoskeletalLimitationRegionV127, ReadonlySet<string>>>;
  candidatesByRuntimeId: ReadonlyMap<string, SubstitutionCandidatesV127>;
  isExecutable: (runtimeId: string) => boolean;
}

const DEFAULT_DATA: MusculoskeletalLimitationDataV127 = {
  avoidByRegion: AVOID_RUNTIME_IDS_BY_REGION_V127,
  candidatesByRuntimeId: SUBSTITUTION_CANDIDATES_BY_RUNTIME_ID_V127,
  isExecutable: isRuntimeExerciseExecutableV127,
};

/**
 * `data` defaults to the real canonical v1.27 source/catalog — injectable
 * only for unit tests that need precise, synthetic A/B/C scenarios (same
 * pattern as `selectBaseTemplateV127(input, catalog = V127_TEMPLATE_PROFILES)`
 * and `catalogInvariantErrors(source = catalog)` elsewhere in this
 * directory). Production/default behavior is never affected by this param.
 */
export function applyMusculoskeletalLimitationV127(
  sessions: readonly FinalWorkoutSession[],
  environment: TemplateEnvironment,
  activeRegions: readonly MusculoskeletalLimitationRegionV127[],
  data: MusculoskeletalLimitationDataV127 = DEFAULT_DATA,
): MusculoskeletalLimitationResultV127 {
  if (!activeRegions.length) {
    // Nothing active — every exercise is returned by identity, matching
    // Fase 4's "no context => byte-identical" invariant exactly.
    return { status: 'APPLIED', sessions: sessions as FinalWorkoutSession[], decisions: [] };
  }

  const effectiveAvoid = effectiveAvoidRuntimeIds(activeRegions, data.avoidByRegion);
  const decisions: MusculoskeletalLimitationDecisionV127[] = [];
  const reasonCodes: string[] = [];

  const resultSessions: FinalWorkoutSession[] = sessions.map((session, sessionIndex) => {
    const usedInSession = new Set<string>();
    let sessionChanged = false;
    const finalExercises: FinalWorkoutExercise[] = session.exercises.map((exercise) => {
      const originalRuntimeId = exercise.exerciseId;
      const vetoedByRegions = activeRegions.filter((region) => data.avoidByRegion[region].has(originalRuntimeId));
      if (!vetoedByRegions.length) {
        usedInSession.add(originalRuntimeId);
        return exercise;
      }

      const candidateGroup = data.candidatesByRuntimeId.get(originalRuntimeId);
      const rejectedCandidates: RejectedCandidateV127[] = [];
      let accepted: { tier: SubstitutionTier; candidate: SubstitutionCandidateV127; dose: DoseFieldsV127 } | undefined;

      if (candidateGroup) {
        for (const tier of TIERS) {
          if (accepted) break;
          const tierCandidates = tier === 'A' ? candidateGroup.A : tier === 'B' ? candidateGroup.B : candidateGroup.C;
          for (const candidate of tierCandidates) {
            const rejectionReason = validateCandidateV127({
              candidate, environment, effectiveAvoid, originalRuntimeId, usedInSession, isExecutable: data.isExecutable,
            });
            if (rejectionReason) {
              rejectedCandidates.push({ exerciseId: candidate.runtimeId, tier, reasonCode: rejectionReason });
              continue;
            }
            const doseResult = computeSubstituteDoseV127(tier, exercise, candidate.runtimeId);
            if (!doseResult.ok) {
              rejectedCandidates.push({ exerciseId: candidate.runtimeId, tier, reasonCode: 'CANDIDATE_UNSAFE_DOSE' });
              continue;
            }
            accepted = { tier, candidate, dose: doseResult.dose };
            break;
          }
        }
      }

      if (!accepted) {
        decisions.push({
          sessionIndex,
          exerciseId: originalRuntimeId,
          vetoedByRegions,
          outcome: 'BLOCKED',
          reasonCode: candidateGroup ? 'NO_VALID_CANDIDATE' : 'NO_SUBSTITUTION_MAP_ENTRY',
          rejectedCandidates,
        });
        reasonCodes.push(`MUSCULOSKELETAL_NO_SUBSTITUTE:${sessionIndex}:${originalRuntimeId}`);
        usedInSession.add(originalRuntimeId);
        return exercise;
      }

      sessionChanged = true;
      usedInSession.add(accepted.candidate.runtimeId);
      decisions.push({
        sessionIndex,
        exerciseId: originalRuntimeId,
        vetoedByRegions,
        outcome: 'SUBSTITUTED',
        tier: accepted.tier,
        substituteExerciseId: accepted.candidate.runtimeId,
        rejectedCandidates,
      });
      return {
        exerciseId: accepted.candidate.runtimeId,
        sourceExerciseId: exercise.sourceExerciseId,
        ...accepted.dose,
      };
    });

    // No vetoed exercise in this session at all: return the SAME session
    // object (not a copy) — the strongest possible "unaffected session
    // stays byte-identical" guarantee.
    if (!sessionChanged && finalExercises.every((exercise, index) => exercise === session.exercises[index])) {
      return session;
    }
    return { ...session, exercises: finalExercises };
  });

  if (reasonCodes.length) {
    return { status: 'BLOCKED', reasonCodes: [...new Set(reasonCodes)].sort(), decisions };
  }
  return { status: 'APPLIED', sessions: resultSessions, decisions };
}
