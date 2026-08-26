import {
  LIMITATION_REGION_IDS,
  type ExerciseLimitationProfile,
  type ExerciseLimitationRule,
  type ExerciseSeedInput,
  type LimitationRegionId,
  type LimitationReviewBasis,
} from '../types/exercise';
import type { QuestionnaireAnswers } from './types';

export const LIMITATION_RESOLVER_VERSION = 1 as const;

export type LimitationReasonCode =
  | 'LIMITATION_PROFILE_MISSING'
  | 'LIMITATION_PROFILE_NOT_APPROVED'
  | 'LIMITATION_PROFILE_VERSION_UNSUPPORTED'
  | 'LIMITATION_PROFILE_INVALID'
  | 'UNMAPPED_LIMITATION_REGION'
  | 'LIMITATION_ADAPTATION_INVALID'
  | 'NO_SAFE_SUBSTITUTION';

export type LimitationResolution = 'compatible' | 'adapted' | 'substituted';

export type LimitationCatalogExercise = Omit<ExerciseSeedInput, 'limitationProfile'> & {
  limitationProfile?: unknown;
};

export type LimitationCatalog = ReadonlyMap<string, LimitationCatalogExercise>;

export interface LimitationCandidateEvaluation {
  exerciseId: string;
  accepted: boolean;
  reasonCodes: string[];
}

export interface LimitationDecisionTrace {
  sessionIndex: number;
  originalExerciseId: string;
  finalExerciseId: string;
  regionsEvaluated: LimitationRegionId[];
  resolution: LimitationResolution;
  reasonRegions: LimitationRegionId[];
  candidatesEvaluated?: LimitationCandidateEvaluation[];
  protocolVersion: 'musculoskeletal-v1';
  reviewBasis: LimitationReviewBasis;
}

interface ResolverTrace extends Omit<LimitationDecisionTrace, 'sessionIndex'> {}

export type LimitationResolutionResult =
  | { status: 'RESOLVED'; exercise: LimitationCatalogExercise; trace: ResolverTrace }
  | { status: 'FAILED'; reasonCodes: string[]; candidatesEvaluated: LimitationCandidateEvaluation[] };

export type QuestionnaireLimitationMapping =
  | { status: 'MAPPED'; regions: LimitationRegionId[] }
  | { status: 'UNMAPPED'; reasonCodes: ['UNMAPPED_LIMITATION_REGION'] };

const REGION_SET = new Set<string>(LIMITATION_REGION_IDS);
const PROFILE_KEYS = ['protocolVersion', 'regions', 'reviewBasis', 'reviewStatus', 'schemaVersion'];

function sameKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ruleValid(rule: unknown, exerciseId: string): rule is ExerciseLimitationRule {
  if (!isRecord(rule) || typeof rule.status !== 'string') return false;
  if (rule.status === 'compatible' || rule.status === 'not_applicable') {
    return sameKeys(rule, ['status']);
  }
  if (rule.status === 'adapt') {
    return sameKeys(rule, ['status', 'adaptation'])
      && isRecord(rule.adaptation)
      && sameKeys(rule.adaptation, ['kind', 'exerciseId'])
      && rule.adaptation.kind === 'exercise_variant'
      && typeof rule.adaptation.exerciseId === 'string'
      && rule.adaptation.exerciseId.length > 0
      && rule.adaptation.exerciseId !== exerciseId;
  }
  if (rule.status === 'avoid') {
    if (!sameKeys(rule, ['status', 'substituteExerciseIds', 'candidateStatus'])) return false;
    if (!Array.isArray(rule.substituteExerciseIds)
        || rule.substituteExerciseIds.some((id) => typeof id !== 'string' || !id || id === exerciseId)
        || new Set(rule.substituteExerciseIds).size !== rule.substituteExerciseIds.length) return false;
    return rule.substituteExerciseIds.length === 0
      ? rule.candidateStatus === 'missing_exercise_candidate'
      : rule.candidateStatus === 'ready';
  }
  return false;
}

type ProfileValidation =
  | { valid: true; profile: ExerciseLimitationProfile }
  | { valid: false; reasonCode: LimitationReasonCode };

export function validateLimitationProfile(
  exerciseId: string,
  value: unknown,
): ProfileValidation {
  if (value == null) return { valid: false, reasonCode: 'LIMITATION_PROFILE_MISSING' };
  if (!isRecord(value)) return { valid: false, reasonCode: 'LIMITATION_PROFILE_INVALID' };
  if (value.schemaVersion !== 1 || value.protocolVersion !== 'musculoskeletal-v1') {
    return { valid: false, reasonCode: 'LIMITATION_PROFILE_VERSION_UNSUPPORTED' };
  }
  if (value.reviewStatus !== 'approved') {
    return { valid: false, reasonCode: 'LIMITATION_PROFILE_NOT_APPROVED' };
  }
  const productPolicy = value.reviewBasis === 'product_policy';
  const professionalReview = value.reviewBasis === 'professional_review'
    && typeof value.reviewedBy === 'string'
    && value.reviewedBy.length > 0
    && value.reviewedAt != null;
  const expectedKeys = productPolicy
    ? PROFILE_KEYS
    : [...PROFILE_KEYS, 'reviewedAt', 'reviewedBy'];
  if ((!productPolicy && !professionalReview) || !sameKeys(value, expectedKeys)) {
    return { valid: false, reasonCode: 'LIMITATION_PROFILE_INVALID' };
  }
  if (!isRecord(value.regions) || !sameKeys(value.regions, [...LIMITATION_REGION_IDS])) {
    return { valid: false, reasonCode: 'LIMITATION_PROFILE_INVALID' };
  }
  for (const region of LIMITATION_REGION_IDS) {
    if (!ruleValid(value.regions[region], exerciseId)) {
      return { valid: false, reasonCode: 'LIMITATION_PROFILE_INVALID' };
    }
  }
  return { valid: true, profile: value as unknown as ExerciseLimitationProfile };
}

export function mapQuestionnaireLimitations(
  answers: Pick<QuestionnaireAnswers, 'specialConditions' | 'limits'>,
): QuestionnaireLimitationMapping {
  if (!answers.specialConditions.includes('musculoskeletal_limitation')) {
    return { status: 'MAPPED', regions: [] };
  }
  const declared = answers.limits.filter((region) => region !== 'none');
  if (declared.some((region) => !REGION_SET.has(region))) {
    return { status: 'UNMAPPED', reasonCodes: ['UNMAPPED_LIMITATION_REGION'] };
  }
  const unique = new Set(declared);
  return {
    status: 'MAPPED',
    regions: LIMITATION_REGION_IDS.filter((region) => unique.has(region)),
  };
}

function exerciseOperationallyValid(exercise: LimitationCatalogExercise | undefined): exercise is LimitationCatalogExercise {
  return Boolean(
    exercise
    && exercise.status === 'active'
    && exercise.availability.workoutGeneration
    && exercise.availability.substitution,
  );
}

function purposePreserved(
  source: LimitationCatalogExercise,
  candidate: LimitationCatalogExercise,
): boolean {
  return candidate.movement.pattern === source.movement.pattern
    && candidate.target.primaryMuscle === source.target.primaryMuscle;
}

export function evaluateDirectLimitationCandidate(input: {
  source: LimitationCatalogExercise;
  candidateId: string;
  regions: LimitationRegionId[];
  catalog: LimitationCatalog;
  isExecutable: (exercise: LimitationCatalogExercise) => boolean;
  visitedExerciseIds: ReadonlySet<string>;
}): LimitationCandidateEvaluation {
  const reasonCodes: string[] = [];
  const candidate = input.catalog.get(input.candidateId);
  if (input.visitedExerciseIds.has(input.candidateId)) reasonCodes.push('LIMITATION_CANDIDATE_VISITED');
  if (!exerciseOperationallyValid(candidate)) reasonCodes.push('LIMITATION_CANDIDATE_UNAVAILABLE');
  if (!candidate) return { exerciseId: input.candidateId, accepted: false, reasonCodes };
  if (!purposePreserved(input.source, candidate)) reasonCodes.push('LIMITATION_CANDIDATE_PURPOSE_MISMATCH');
  const validation = validateLimitationProfile(candidate.id, candidate.limitationProfile);
  if (!validation.valid) reasonCodes.push(validation.reasonCode);
  else {
    for (const region of input.regions) {
      const status = validation.profile.regions[region].status;
      if (status !== 'compatible' && status !== 'not_applicable') {
        reasonCodes.push(`LIMITATION_CANDIDATE_${status.toUpperCase()}:${region}`);
      }
    }
  }
  if (!input.isExecutable(candidate)) reasonCodes.push('LIMITATION_CANDIDATE_EQUIPMENT_UNAVAILABLE');
  return { exerciseId: input.candidateId, accepted: reasonCodes.length === 0, reasonCodes };
}

export function resolveExerciseLimitations(input: {
  exerciseId: string;
  regions: LimitationRegionId[];
  catalog: LimitationCatalog;
  isExecutable: (exercise: LimitationCatalogExercise) => boolean;
  visitedExerciseIds?: ReadonlySet<string>;
}): LimitationResolutionResult {
  const source = input.catalog.get(input.exerciseId);
  if (!source) {
    return { status: 'FAILED', reasonCodes: ['LIMITATION_PROFILE_MISSING'], candidatesEvaluated: [] };
  }
  const sourceValidation = validateLimitationProfile(source.id, source.limitationProfile);
  if (!sourceValidation.valid) {
    return { status: 'FAILED', reasonCodes: [sourceValidation.reasonCode], candidatesEvaluated: [] };
  }
  const visited = new Set([...(input.visitedExerciseIds ?? []), source.id]);
  const rules = input.regions.map((region) => ({ region, rule: sourceValidation.profile.regions[region] }));
  const avoidRules = rules.filter(({ rule }) => rule.status === 'avoid');
  if (avoidRules.length) {
    const candidateIds = [...new Set(avoidRules.flatMap(({ rule }) =>
      rule.status === 'avoid' ? rule.substituteExerciseIds : [],
    ))];
    const candidatesEvaluated: LimitationCandidateEvaluation[] = [];
    for (const candidateId of candidateIds) {
      const evaluation = evaluateDirectLimitationCandidate({
        source,
        candidateId,
        regions: input.regions,
        catalog: input.catalog,
        isExecutable: input.isExecutable,
        visitedExerciseIds: visited,
      });
      candidatesEvaluated.push(evaluation);
      if (evaluation.accepted) {
        const candidate = input.catalog.get(candidateId) as LimitationCatalogExercise;
        return {
          status: 'RESOLVED',
          exercise: candidate,
          trace: {
            originalExerciseId: source.id,
            finalExerciseId: candidate.id,
            regionsEvaluated: input.regions,
            resolution: 'substituted',
            reasonRegions: avoidRules.map(({ region }) => region),
            candidatesEvaluated,
            protocolVersion: sourceValidation.profile.protocolVersion,
            reviewBasis: sourceValidation.profile.reviewBasis,
          },
        };
      }
    }
    return { status: 'FAILED', reasonCodes: ['NO_SAFE_SUBSTITUTION'], candidatesEvaluated };
  }

  const adaptRules = rules.filter(({ rule }) => rule.status === 'adapt');
  if (adaptRules.length) {
    const variantIds = [...new Set(adaptRules.flatMap(({ rule }) =>
      rule.status === 'adapt' ? [rule.adaptation.exerciseId] : [],
    ))];
    if (variantIds.length !== 1) {
      return { status: 'FAILED', reasonCodes: ['LIMITATION_ADAPTATION_INVALID'], candidatesEvaluated: [] };
    }
    const evaluation = evaluateDirectLimitationCandidate({
      source,
      candidateId: variantIds[0],
      regions: input.regions,
      catalog: input.catalog,
      isExecutable: input.isExecutable,
      visitedExerciseIds: visited,
    });
    if (!evaluation.accepted) {
      return {
        status: 'FAILED',
        reasonCodes: ['LIMITATION_ADAPTATION_INVALID'],
        candidatesEvaluated: [evaluation],
      };
    }
    const candidate = input.catalog.get(variantIds[0]) as LimitationCatalogExercise;
    return {
      status: 'RESOLVED',
      exercise: candidate,
      trace: {
        originalExerciseId: source.id,
        finalExerciseId: candidate.id,
        regionsEvaluated: input.regions,
        resolution: 'adapted',
        reasonRegions: adaptRules.map(({ region }) => region),
        candidatesEvaluated: [evaluation],
        protocolVersion: sourceValidation.profile.protocolVersion,
        reviewBasis: sourceValidation.profile.reviewBasis,
      },
    };
  }

  return {
    status: 'RESOLVED',
    exercise: source,
    trace: {
      originalExerciseId: source.id,
      finalExerciseId: source.id,
      regionsEvaluated: input.regions,
      resolution: 'compatible',
      reasonRegions: [],
      protocolVersion: sourceValidation.profile.protocolVersion,
      reviewBasis: sourceValidation.profile.reviewBasis,
    },
  };
}
