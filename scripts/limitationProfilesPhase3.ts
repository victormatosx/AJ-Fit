import { isDeepStrictEqual } from 'node:util';

export const LIMITATION_REGIONS = [
  'knee', 'hip', 'back', 'shoulder', 'elbow', 'wrist', 'ankle_foot',
] as const;
export const LIMITATION_STATUSES = [
  'compatible', 'adapt', 'avoid', 'not_applicable', 'unknown',
] as const;

export type LimitationRegion = typeof LIMITATION_REGIONS[number];
export type LimitationStatus = typeof LIMITATION_STATUSES[number];
export type Confidence = 'high' | 'medium' | 'low';
export type ReviewBasis = 'product_policy' | 'professional_review';

export interface LimitationRule {
  status: LimitationStatus;
  adaptation?: { kind: 'exercise_variant'; exerciseId: string };
  substituteExerciseIds?: string[];
  candidateStatus?: 'ready' | 'missing_exercise_candidate';
}

interface LimitationProfileCore {
  schemaVersion: 1;
  protocolVersion: 'musculoskeletal-v1';
  regions: Record<LimitationRegion, LimitationRule>;
}

export type LimitationProfile = LimitationProfileCore & (
  | { reviewStatus: 'draft'; reviewBasis?: never; reviewedAt?: never; reviewedBy?: never }
  | { reviewStatus: 'approved'; reviewBasis: 'product_policy'; reviewedAt?: never; reviewedBy?: never }
  | { reviewStatus: 'approved'; reviewBasis: 'professional_review'; reviewedAt: unknown; reviewedBy: string }
);

export interface V3RegionDecision {
  status: LimitationStatus;
  confidence: Confidence;
  adaptation?: { kind: string; exerciseId: string };
  candidateSubstituteExerciseIds?: string[];
}

export interface V3Dataset {
  datasetVersion: string;
  sourceProtocol: string;
  scope: { usedExerciseCount: number; regionCount: number; pairCount: number };
  summary?: Record<string, unknown>;
  exercises: Array<{
    exerciseId: string;
    regions: Record<string, V3RegionDecision>;
  }>;
}

export interface TechnicalProfileEntry {
  exerciseId: string;
  limitationProfile: LimitationProfile;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  statusCounts: Record<LimitationStatus, number>;
  pairCount: number;
  adaptCount: number;
  avoidCount: number;
  avoidWithoutSubstitute: Array<{ exerciseId: string; region: LimitationRegion }>;
  referencedCandidateIds: string[];
  externalCandidateIds: string[];
  actionReferencedCandidateIds: string[];
  externalActionCandidateIds: string[];
  cyclesByRegion: Array<{ region: LimitationRegion; exerciseIds: string[] }>;
  globalCycles: string[][];
}

function emptyStatusCounts(): Record<LimitationStatus, number> {
  return { compatible: 0, adapt: 0, avoid: 0, not_applicable: 0, unknown: 0 };
}

function canonicalCycle(nodes: string[]): string {
  const body = nodes.slice(0, -1);
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  return rotations.map((rotation) => rotation.join('>')).sort()[0];
}

export function findDirectedCycles(edges: Array<[string, string]>): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const [from, to] of edges) adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  const found = new Map<string, string[]>();

  function walk(start: string, node: string, path: string[], visited: Set<string>) {
    for (const next of adjacency.get(node) ?? []) {
      if (next === start) {
        const cycle = [...path, next];
        found.set(canonicalCycle(cycle), cycle);
      } else if (!visited.has(next) && path.length <= adjacency.size) {
        walk(start, next, [...path, next], new Set([...visited, next]));
      }
    }
  }

  for (const start of adjacency.keys()) walk(start, start, [start], new Set([start]));
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, cycle]) => cycle);
}

export function convertV3ToProfiles(v3: V3Dataset): TechnicalProfileEntry[] {
  return v3.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    limitationProfile: {
      schemaVersion: 1,
      protocolVersion: 'musculoskeletal-v1',
      reviewStatus: 'draft',
      regions: Object.fromEntries(LIMITATION_REGIONS.map((region) => {
        const source = exercise.regions[region];
        if (!source) throw new Error(`${exercise.exerciseId}: região ausente ${region}`);
        const rule: LimitationRule = { status: source.status };
        if (source.status === 'adapt') {
          rule.adaptation = {
            kind: 'exercise_variant',
            exerciseId: source.adaptation?.exerciseId ?? '',
          };
        }
        if (source.status === 'avoid') {
          rule.substituteExerciseIds = [...(source.candidateSubstituteExerciseIds ?? [])];
          rule.candidateStatus = rule.substituteExerciseIds.length
            ? 'ready'
            : 'missing_exercise_candidate';
        }
        return [region, rule];
      })) as Record<LimitationRegion, LimitationRule>,
    },
  }));
}

export function validateTechnicalProfiles(
  v3: V3Dataset,
  profiles: TechnicalProfileEntry[],
  catalogIds: Set<string>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const statusCounts = emptyStatusCounts();
  const avoidWithoutSubstitute: Array<{ exerciseId: string; region: LimitationRegion }> = [];
  const referenced = new Set<string>();
  const actionReferenced = new Set<string>();
  const baseIds = new Set(profiles.map((entry) => entry.exerciseId));
  let pairCount = 0;
  const edgesByRegion = new Map<LimitationRegion, Array<[string, string]>>(
    LIMITATION_REGIONS.map((region) => [region, []]),
  );

  if (profiles.length !== 71) errors.push(`profiles=${profiles.length}; esperado=71`);
  if (baseIds.size !== profiles.length) errors.push('exerciseId duplicado entre profiles');
  if (catalogIds.size !== 116) errors.push(`catálogo=${catalogIds.size}; esperado=116`);
  if (v3.datasetVersion !== '3.0.0-generalized-conservative') {
    errors.push(`datasetVersion V3 inesperado: ${v3.datasetVersion}`);
  }

  for (const exercise of v3.exercises) {
    for (const region of LIMITATION_REGIONS) {
      const source = exercise.regions[region];
      const sourceCandidates = source?.candidateSubstituteExerciseIds ?? [];
      if (new Set(sourceCandidates).size !== sourceCandidates.length) {
        errors.push(`${exercise.exerciseId}/${region}: candidatos duplicados na V3`);
      }
      for (const candidateId of sourceCandidates) {
        referenced.add(candidateId);
        if (!catalogIds.has(candidateId)) errors.push(`${exercise.exerciseId}/${region}: candidato V3 inexistente ${candidateId}`);
        if (candidateId === exercise.exerciseId) errors.push(`${exercise.exerciseId}/${region}: candidato V3 autorreferente`);
      }
      if (source?.adaptation?.exerciseId) referenced.add(source.adaptation.exerciseId);
    }
  }

  for (const entry of profiles) {
    if (!catalogIds.has(entry.exerciseId)) errors.push(`${entry.exerciseId}: ID-base inexistente`);
    const regionKeys = Object.keys(entry.limitationProfile.regions);
    if (regionKeys.length !== 7 || !LIMITATION_REGIONS.every((region) => regionKeys.includes(region))) {
      errors.push(`${entry.exerciseId}: regiões inválidas/incompletas`);
    }
    if (regionKeys.some((region) => !LIMITATION_REGIONS.includes(region as LimitationRegion))) {
      errors.push(`${entry.exerciseId}: região fora do enum`);
    }
    if (entry.limitationProfile.reviewStatus !== 'draft') {
      errors.push(`${entry.exerciseId}: reviewStatus deve permanecer draft nesta fase`);
    }

    for (const region of LIMITATION_REGIONS) {
      pairCount += 1;
      const rule = entry.limitationProfile.regions[region];
      if (!LIMITATION_STATUSES.includes(rule.status)) {
        errors.push(`${entry.exerciseId}/${region}: status fora do enum`);
        continue;
      }
      statusCounts[rule.status] += 1;
      if (rule.status === 'unknown') errors.push(`${entry.exerciseId}/${region}: unknown não permitido na V3`);

      if (rule.status === 'adapt') {
        const variantId = rule.adaptation?.exerciseId;
        if (rule.adaptation?.kind !== 'exercise_variant' || !variantId) {
          errors.push(`${entry.exerciseId}/${region}: adapt sem variante concreta`);
        } else {
          referenced.add(variantId);
          actionReferenced.add(variantId);
          if (!catalogIds.has(variantId)) errors.push(`${entry.exerciseId}/${region}: variante inexistente ${variantId}`);
          if (variantId === entry.exerciseId) errors.push(`${entry.exerciseId}/${region}: variante autorreferente`);
          edgesByRegion.get(region)?.push([entry.exerciseId, variantId]);
        }
      } else if (rule.adaptation) {
        errors.push(`${entry.exerciseId}/${region}: adaptation em status ${rule.status}`);
      }

      if (rule.status === 'avoid') {
        const substitutes = rule.substituteExerciseIds ?? [];
        if (new Set(substitutes).size !== substitutes.length) {
          errors.push(`${entry.exerciseId}/${region}: substituteExerciseIds duplicados`);
        }
        for (const candidateId of substitutes) {
          referenced.add(candidateId);
          actionReferenced.add(candidateId);
          if (!catalogIds.has(candidateId)) errors.push(`${entry.exerciseId}/${region}: substituto inexistente ${candidateId}`);
          if (candidateId === entry.exerciseId) errors.push(`${entry.exerciseId}/${region}: substituto autorreferente`);
          edgesByRegion.get(region)?.push([entry.exerciseId, candidateId]);
        }
        if (!substitutes.length) avoidWithoutSubstitute.push({ exerciseId: entry.exerciseId, region });
      } else if (rule.substituteExerciseIds || rule.candidateStatus) {
        errors.push(`${entry.exerciseId}/${region}: campos de avoid em status ${rule.status}`);
      }
    }
  }

  if (pairCount !== 497) errors.push(`pares=${pairCount}; esperado=497`);
  const sourceCounts = emptyStatusCounts();
  const sourceConfidenceCounts: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  for (const exercise of v3.exercises) {
    for (const region of LIMITATION_REGIONS) {
      const status = exercise.regions[region]?.status;
      if (status && LIMITATION_STATUSES.includes(status)) sourceCounts[status] += 1;
      const confidence = exercise.regions[region]?.confidence;
      if (confidence in sourceConfidenceCounts) sourceConfidenceCounts[confidence] += 1;
    }
  }
  if (!isDeepStrictEqual(sourceCounts, statusCounts)) errors.push('conversão alterou a distribuição de status da V3');
  if ((v3.summary as { adaptCount?: number } | undefined)?.adaptCount !== statusCounts.adapt) {
    warnings.push(`V3 summary.adaptCount=${(v3.summary as { adaptCount?: number }).adaptCount}; células adapt=${statusCounts.adapt}`);
  }
  if ((v3.summary as { avoidWithoutSubstituteCount?: number } | undefined)?.avoidWithoutSubstituteCount !== avoidWithoutSubstitute.length) {
    warnings.push(`V3 summary.avoidWithoutSubstituteCount=${(v3.summary as { avoidWithoutSubstituteCount?: number }).avoidWithoutSubstituteCount}; células avoid sem candidato=${avoidWithoutSubstitute.length}`);
  }
  if ((v3.summary as { lowConfidenceCount?: number } | undefined)?.lowConfidenceCount !== sourceConfidenceCounts.low) {
    warnings.push(`V3 summary.lowConfidenceCount=${(v3.summary as { lowConfidenceCount?: number }).lowConfidenceCount}; células low=${sourceConfidenceCounts.low}`);
  }

  const cyclesByRegion = LIMITATION_REGIONS.flatMap((region) =>
    findDirectedCycles(edgesByRegion.get(region) ?? []).map((exerciseIds) => ({ region, exerciseIds })),
  );
  const globalCycles = findDirectedCycles([...edgesByRegion.values()].flat());
  if (globalCycles.length) warnings.push(`${globalCycles.length} ciclo(s) óbvio(s) no grafo de variante/substituição`);

  const referencedCandidateIds = [...referenced].sort();
  const actionReferencedCandidateIds = [...actionReferenced].sort();
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    statusCounts,
    pairCount,
    adaptCount: statusCounts.adapt,
    avoidCount: statusCounts.avoid,
    avoidWithoutSubstitute,
    referencedCandidateIds,
    externalCandidateIds: referencedCandidateIds.filter((id) => !baseIds.has(id)),
    actionReferencedCandidateIds,
    externalActionCandidateIds: actionReferencedCandidateIds.filter((id) => !baseIds.has(id)),
    cyclesByRegion,
    globalCycles,
  };
}

export function profilesEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

const notApplicable = (): LimitationRule => ({ status: 'not_applicable' });
const compatible = (): LimitationRule => ({ status: 'compatible' });
const adapt = (exerciseId: string): LimitationRule => ({
  status: 'adapt',
  adaptation: { kind: 'exercise_variant', exerciseId },
});
const avoidWithoutSubstitute = (): LimitationRule => ({
  status: 'avoid',
  substituteExerciseIds: [],
  candidateStatus: 'missing_exercise_candidate',
});

function approvedProductProfile(regions: Record<LimitationRegion, LimitationRule>): LimitationProfile {
  return {
    schemaVersion: 1,
    protocolVersion: 'musculoskeletal-v1',
    reviewStatus: 'approved',
    reviewBasis: 'product_policy',
    regions,
  };
}

export const PHASE3_EXTERNAL_PRODUCT_PROFILES: TechnicalProfileEntry[] = [
  {
    exerciseId: 'cable-biceps-curl',
    limitationProfile: approvedProductProfile({
      knee: notApplicable(),
      hip: notApplicable(),
      back: adapt('seated-dumbbell-curl'),
      shoulder: avoidWithoutSubstitute(),
      elbow: adapt('hammer-curl'),
      wrist: adapt('hammer-curl'),
      ankle_foot: notApplicable(),
    }),
  },
  {
    exerciseId: 'cable-glute-kickback',
    limitationProfile: approvedProductProfile({
      knee: adapt('glute-bridge'),
      hip: adapt('glute-bridge'),
      back: avoidWithoutSubstitute(),
      shoulder: notApplicable(),
      elbow: notApplicable(),
      wrist: notApplicable(),
      ankle_foot: adapt('glute-bridge'),
    }),
  },
  {
    exerciseId: 'iso-lateral-pulldown-machine',
    limitationProfile: approvedProductProfile({
      knee: notApplicable(),
      hip: notApplicable(),
      back: compatible(),
      shoulder: adapt('resistance-band-lat-pulldown'),
      elbow: adapt('resistance-band-lat-pulldown'),
      wrist: adapt('resistance-band-lat-pulldown'),
      ankle_foot: notApplicable(),
    }),
  },
  {
    exerciseId: 'lying-leg-raise',
    limitationProfile: approvedProductProfile({
      knee: notApplicable(),
      hip: avoidWithoutSubstitute(),
      back: adapt('floor-crunch'),
      shoulder: notApplicable(),
      elbow: notApplicable(),
      wrist: notApplicable(),
      ankle_foot: notApplicable(),
    }),
  },
  {
    exerciseId: 'machine-lateral-raise',
    limitationProfile: approvedProductProfile({
      knee: notApplicable(),
      hip: notApplicable(),
      back: compatible(),
      shoulder: adapt('dumbbell-lateral-raise'),
      elbow: avoidWithoutSubstitute(),
      wrist: compatible(),
      ankle_foot: notApplicable(),
    }),
  },
];

export function buildPhase3V2Profiles(v1Profiles: TechnicalProfileEntry[]): TechnicalProfileEntry[] {
  const originalProfiles = v1Profiles.map((entry) => {
    const {
      reviewStatus: _reviewStatus,
      reviewBasis: _reviewBasis,
      reviewedAt: _reviewedAt,
      reviewedBy: _reviewedBy,
      ...profileCore
    } = entry.limitationProfile;
    return {
      exerciseId: entry.exerciseId,
      limitationProfile: {
        ...profileCore,
        reviewStatus: 'approved' as const,
        reviewBasis: 'product_policy' as const,
      },
    };
  });
  return [...originalProfiles, ...PHASE3_EXTERNAL_PRODUCT_PROFILES]
    .sort((left, right) => left.exerciseId.localeCompare(right.exerciseId));
}

export interface ClosedProfileValidation {
  valid: boolean;
  errors: string[];
  statusCounts: Record<LimitationStatus, number>;
  pairCount: number;
  avoidWithoutSubstitute: Array<{ exerciseId: string; region: LimitationRegion }>;
  actionCandidateIds: string[];
  remainingExternalActionCandidateIds: string[];
  cyclesByRegion: Array<{ region: LimitationRegion; exerciseIds: string[] }>;
  globalCycles: string[][];
}

export function validateClosedProfileSet(
  profiles: TechnicalProfileEntry[],
  catalogIds: Set<string>,
  expectedProfileCount = 76,
): ClosedProfileValidation {
  const errors: string[] = [];
  const statusCounts = emptyStatusCounts();
  const pairCount = profiles.length * LIMITATION_REGIONS.length;
  const profileIds = new Set(profiles.map((entry) => entry.exerciseId));
  const actionCandidateIds = new Set<string>();
  const avoidGaps: Array<{ exerciseId: string; region: LimitationRegion }> = [];
  const edgesByRegion = new Map<LimitationRegion, Array<[string, string]>>(
    LIMITATION_REGIONS.map((region) => [region, []]),
  );

  if (profiles.length !== expectedProfileCount) errors.push(`profiles=${profiles.length}; esperado=${expectedProfileCount}`);
  if (profileIds.size !== profiles.length) errors.push('exerciseId duplicado entre profiles');
  if (catalogIds.size !== 116) errors.push(`catálogo=${catalogIds.size}; esperado=116`);

  for (const entry of profiles) {
    const profile = entry.limitationProfile;
    if (!catalogIds.has(entry.exerciseId)) errors.push(`${entry.exerciseId}: ID-base inexistente`);
    const profileKeys = Object.keys(profile).sort();
    const expectedProfileKeys = ['protocolVersion', 'regions', 'reviewBasis', 'reviewStatus', 'schemaVersion'];
    if (!isDeepStrictEqual(profileKeys, expectedProfileKeys)) {
      errors.push(`${entry.exerciseId}: campos de profile fora do schema fechado`);
    }
    const regionKeys = Object.keys(profile.regions);
    if (regionKeys.length !== 7 || !LIMITATION_REGIONS.every((region) => regionKeys.includes(region))) {
      errors.push(`${entry.exerciseId}: regiões inválidas/incompletas`);
    }
    if (regionKeys.some((region) => !LIMITATION_REGIONS.includes(region as LimitationRegion))) {
      errors.push(`${entry.exerciseId}: região fora do enum`);
    }
    if (profile.schemaVersion !== 1 || profile.protocolVersion !== 'musculoskeletal-v1') {
      errors.push(`${entry.exerciseId}: schema/protocolo inválido`);
    }
    if (profile.reviewStatus !== 'approved' || profile.reviewBasis !== 'product_policy') {
      errors.push(`${entry.exerciseId}: governança não é approved + product_policy`);
    }
    if (profile.reviewedAt !== undefined || profile.reviewedBy !== undefined) {
      errors.push(`${entry.exerciseId}: identidade/timestamp profissional não permitido em product_policy`);
    }

    for (const region of LIMITATION_REGIONS) {
      const rule = profile.regions[region];
      if (!rule || !LIMITATION_STATUSES.includes(rule.status)) {
        errors.push(`${entry.exerciseId}/${region}: status inválido`);
        continue;
      }
      statusCounts[rule.status] += 1;
      if (rule.status === 'unknown') errors.push(`${entry.exerciseId}/${region}: unknown não permitido`);

      if (rule.status === 'adapt') {
        if (!isDeepStrictEqual(Object.keys(rule).sort(), ['adaptation', 'status'])) {
          errors.push(`${entry.exerciseId}/${region}: campos de adapt fora do schema fechado`);
        }
        const variantId = rule.adaptation?.exerciseId;
        if (rule.adaptation?.kind !== 'exercise_variant' || !variantId) {
          errors.push(`${entry.exerciseId}/${region}: adapt sem variante concreta`);
        } else {
          if (!isDeepStrictEqual(Object.keys(rule.adaptation).sort(), ['exerciseId', 'kind'])) {
            errors.push(`${entry.exerciseId}/${region}: campos de adaptation fora do schema fechado`);
          }
          actionCandidateIds.add(variantId);
          if (!catalogIds.has(variantId)) errors.push(`${entry.exerciseId}/${region}: variante inexistente ${variantId}`);
          if (variantId === entry.exerciseId) errors.push(`${entry.exerciseId}/${region}: variante autorreferente`);
          edgesByRegion.get(region)?.push([entry.exerciseId, variantId]);
        }
      } else if (rule.adaptation) {
        errors.push(`${entry.exerciseId}/${region}: adaptation em status ${rule.status}`);
      }

      if (rule.status === 'avoid') {
        if (!isDeepStrictEqual(Object.keys(rule).sort(), ['candidateStatus', 'status', 'substituteExerciseIds'])) {
          errors.push(`${entry.exerciseId}/${region}: campos de avoid fora do schema fechado`);
        }
        const substitutes = rule.substituteExerciseIds ?? [];
        if (new Set(substitutes).size !== substitutes.length) {
          errors.push(`${entry.exerciseId}/${region}: substitutos duplicados`);
        }
        if (!substitutes.length) {
          avoidGaps.push({ exerciseId: entry.exerciseId, region });
          if (rule.candidateStatus !== 'missing_exercise_candidate') {
            errors.push(`${entry.exerciseId}/${region}: avoid vazio sem missing_exercise_candidate`);
          }
        } else if (rule.candidateStatus !== 'ready') {
          errors.push(`${entry.exerciseId}/${region}: avoid com candidatos sem candidateStatus ready`);
        }
        for (const substituteId of substitutes) {
          actionCandidateIds.add(substituteId);
          if (!catalogIds.has(substituteId)) errors.push(`${entry.exerciseId}/${region}: substituto inexistente ${substituteId}`);
          if (substituteId === entry.exerciseId) errors.push(`${entry.exerciseId}/${region}: substituto autorreferente`);
          edgesByRegion.get(region)?.push([entry.exerciseId, substituteId]);
        }
      } else if (rule.substituteExerciseIds || rule.candidateStatus) {
        errors.push(`${entry.exerciseId}/${region}: campos de avoid em status ${rule.status}`);
      }
      if ((rule.status === 'compatible' || rule.status === 'not_applicable')
          && !isDeepStrictEqual(Object.keys(rule), ['status'])) {
        errors.push(`${entry.exerciseId}/${region}: campos extras em status ${rule.status}`);
      }
    }
  }

  const candidates = [...actionCandidateIds].sort();
  const cyclesByRegion = LIMITATION_REGIONS.flatMap((region) =>
    findDirectedCycles(edgesByRegion.get(region) ?? []).map((exerciseIds) => ({ region, exerciseIds })),
  );
  return {
    valid: errors.length === 0,
    errors,
    statusCounts,
    pairCount,
    avoidWithoutSubstitute: avoidGaps,
    actionCandidateIds: candidates,
    remainingExternalActionCandidateIds: candidates.filter((id) => !profileIds.has(id)),
    cyclesByRegion,
    globalCycles: findDirectedCycles([...edgesByRegion.values()].flat()),
  };
}
