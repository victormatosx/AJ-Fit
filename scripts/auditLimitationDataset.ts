/**
 * Formal audit of the exercise limitation dataset (docs/workout-modifiers/
 * exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json), run
 * against the REAL, unmodified `limitationResolver.ts` — never a
 * reimplementation of its accept/reject rules. Produces:
 *
 *   docs/workout-modifiers/LIMITATION_DATASET_AUDIT.md   (human report)
 *   docs/workout-modifiers/limitation-dataset-audit.json (structured data)
 *
 * This script performs NO clinical judgment: it classifies existing rule
 * outcomes, groups by mechanical root cause, and ranks by product impact.
 * It never edits the dataset, the resolver, or the prescription engine.
 *
 * Usage: npx tsx scripts/auditLimitationDataset.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLocalExerciseCatalogForLimitations } from '../src/workoutPrescription/localLimitationCatalog';
import {
  resolveExerciseLimitations,
  validateLimitationProfile,
  type LimitationCatalogExercise,
} from '../src/workoutPrescription/limitationResolver';
import { LIMITATION_REGION_IDS, type LimitationRegionId } from '../src/types/exercise';
import templatesJson from '../docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ─────────────────────────── Templates index ───────────────────────────

interface TemplateFile {
  workouts: Array<{
    id: string;
    profile?: { environment?: string; primary_goal?: string; days_per_week?: number };
    sessions: Array<{ exercises: Array<{ exercise_id: string }> }>;
  }>;
}

const templates = (templatesJson as unknown as TemplateFile).workouts;

export function buildExerciseTemplateIndex(
  templateList: TemplateFile['workouts'],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const tpl of templateList) {
    const idsInTemplate = new Set<string>();
    for (const session of tpl.sessions) {
      for (const ex of session.exercises) idsInTemplate.add(ex.exercise_id);
    }
    for (const id of idsInTemplate) {
      if (!index.has(id)) index.set(id, new Set());
      index.get(id)!.add(tpl.id);
    }
  }
  return index;
}

const exerciseTemplates = buildExerciseTemplateIndex(templates);
const usedExerciseIds = [...exerciseTemplates.keys()].sort();

// ─────────────────────────── Catalog ───────────────────────────

const catalogArr = loadLocalExerciseCatalogForLimitations();
const catalog = new Map<string, LimitationCatalogExercise>(catalogArr.map((e) => [e.id, e]));
const alwaysExecutable = () => true; // equipment/environment is a separate axis; this audit is limitation-only.

function displayName(exercise: LimitationCatalogExercise | undefined, fallbackId: string): string {
  return exercise?.name?.ptBR ?? fallbackId;
}

// ─────────────────────────── Classification ───────────────────────────

export type CaseClassification =
  | 'DIRECT_COMPATIBLE'
  | 'DIRECT_NOT_APPLICABLE'
  | 'VALID_ADAPTATION'
  | 'VALID_AVOID'
  | 'INVALID_ADAPT_TARGET_AVOID'
  | 'INVALID_ADAPT_TARGET_ADAPT'
  | 'INVALID_ADAPT_TARGET_OTHER'
  | 'MISSING_ADAPT_TARGET'
  | 'AVOID_NO_CANDIDATES'
  | 'AVOID_CANDIDATES_ALL_FAIL'
  | 'MISSING_PROFILE'
  | 'INVALID_PROFILE'
  | 'MISSING_EXERCISE';

export const VALID_CLASSIFICATIONS: ReadonlySet<CaseClassification> = new Set([
  'DIRECT_COMPATIBLE', 'DIRECT_NOT_APPLICABLE', 'VALID_ADAPTATION', 'VALID_AVOID',
]);

/** Root-cause bucket — coarser than `CaseClassification`, used for the "how many independent decisions" question (section 3/12 of the audit). */
export type RootCause =
  | 'A_ADAPT_TARGET_MARKED_AVOID'
  | 'B_ADAPT_TARGET_IS_ITSELF_ADAPT'
  | 'C_ADAPT_TARGET_MISSING_EXERCISE'
  | 'D_ADAPT_TARGET_MISSING_PROFILE'
  | 'E_ADAPT_TARGET_PURPOSE_OR_AVAILABILITY'
  | 'F_AVOID_NO_CANDIDATES_LISTED'
  | 'G_AVOID_ALL_CANDIDATES_FAIL'
  | 'H_SOURCE_MISSING_PROFILE'
  | 'I_SOURCE_INVALID_PROFILE'
  | 'J_OTHER';

const CLASSIFICATION_TO_ROOT_CAUSE: Partial<Record<CaseClassification, RootCause>> = {
  INVALID_ADAPT_TARGET_AVOID: 'A_ADAPT_TARGET_MARKED_AVOID',
  INVALID_ADAPT_TARGET_ADAPT: 'B_ADAPT_TARGET_IS_ITSELF_ADAPT',
  MISSING_ADAPT_TARGET: 'C_ADAPT_TARGET_MISSING_EXERCISE',
  AVOID_NO_CANDIDATES: 'F_AVOID_NO_CANDIDATES_LISTED',
  AVOID_CANDIDATES_ALL_FAIL: 'G_AVOID_ALL_CANDIDATES_FAIL',
  MISSING_PROFILE: 'H_SOURCE_MISSING_PROFILE',
  INVALID_PROFILE: 'I_SOURCE_INVALID_PROFILE',
  MISSING_EXERCISE: 'J_OTHER',
};

export interface CaseResult {
  exerciseId: string;
  exerciseName: string;
  region: LimitationRegionId;
  ruleStatus: string | null;
  classification: CaseClassification;
  rootCause: RootCause | null;
  valid: boolean;
  adaptTargetId: string | null;
  adaptTargetName: string | null;
  adaptTargetStatusForRegion: string | null;
  avoidSubstituteIds: string[] | null;
  reasonCodes: string[];
  failureDetail: string;
  templatesAffected: string[];
  templateCount: number;
}

export function classifyPair(
  exerciseId: string,
  region: LimitationRegionId,
  cat: Map<string, LimitationCatalogExercise>,
  templateIndex: Map<string, Set<string>>,
): CaseResult {
  const exercise = cat.get(exerciseId);
  const templatesAffected = [...(templateIndex.get(exerciseId) ?? [])].sort();
  const base = {
    exerciseId,
    exerciseName: displayName(exercise, exerciseId),
    region,
    templatesAffected,
    templateCount: templatesAffected.length,
  };

  if (!exercise) {
    return {
      ...base, ruleStatus: null, classification: 'MISSING_EXERCISE', rootCause: 'J_OTHER', valid: false,
      adaptTargetId: null, adaptTargetName: null, adaptTargetStatusForRegion: null, avoidSubstituteIds: null,
      reasonCodes: ['MISSING_EXERCISE'], failureDetail: `'${exerciseId}' is referenced by a template but does not exist in the exercise catalog`,
    };
  }

  const validation = validateLimitationProfile(exercise.id, exercise.limitationProfile);
  if (!validation.valid) {
    const classification: CaseClassification = validation.reasonCode === 'LIMITATION_PROFILE_MISSING' ? 'MISSING_PROFILE' : 'INVALID_PROFILE';
    return {
      ...base, ruleStatus: null, classification, rootCause: CLASSIFICATION_TO_ROOT_CAUSE[classification] ?? 'J_OTHER', valid: false,
      adaptTargetId: null, adaptTargetName: null, adaptTargetStatusForRegion: null, avoidSubstituteIds: null,
      reasonCodes: [validation.reasonCode], failureDetail: validation.reasonCode,
    };
  }

  const rule = validation.profile.regions[region];
  const result = resolveExerciseLimitations({ exerciseId, regions: [region], catalog: cat, isExecutable: alwaysExecutable });

  if (rule.status === 'compatible' || rule.status === 'not_applicable') {
    const classification: CaseClassification = rule.status === 'compatible' ? 'DIRECT_COMPATIBLE' : 'DIRECT_NOT_APPLICABLE';
    return {
      ...base, ruleStatus: rule.status, classification, rootCause: null, valid: true,
      adaptTargetId: null, adaptTargetName: null, adaptTargetStatusForRegion: null, avoidSubstituteIds: null,
      reasonCodes: [], failureDetail: '',
    };
  }

  if (rule.status === 'adapt') {
    const targetId = rule.adaptation.exerciseId;
    const target = cat.get(targetId);
    let targetStatusForRegion: string | null = null;
    if (target) {
      const targetValidation = validateLimitationProfile(target.id, target.limitationProfile);
      if (targetValidation.valid) targetStatusForRegion = targetValidation.profile.regions[region].status;
    }
    if (result.status === 'RESOLVED') {
      return {
        ...base, ruleStatus: 'adapt', classification: 'VALID_ADAPTATION', rootCause: null, valid: true,
        adaptTargetId: targetId, adaptTargetName: displayName(target, targetId), adaptTargetStatusForRegion: targetStatusForRegion,
        avoidSubstituteIds: null, reasonCodes: [], failureDetail: '',
      };
    }
    if (!target) {
      return {
        ...base, ruleStatus: 'adapt', classification: 'MISSING_ADAPT_TARGET', rootCause: 'C_ADAPT_TARGET_MISSING_EXERCISE', valid: false,
        adaptTargetId: targetId, adaptTargetName: targetId, adaptTargetStatusForRegion: null, avoidSubstituteIds: null,
        reasonCodes: result.reasonCodes, failureDetail: `adaptation target '${targetId}' does not exist in the catalog`,
      };
    }
    const evaluated = result.status === 'FAILED' ? result.candidatesEvaluated[0] : undefined;
    const codes = evaluated?.reasonCodes ?? (result.status === 'FAILED' ? result.reasonCodes : []);
    let classification: CaseClassification = 'INVALID_ADAPT_TARGET_OTHER';
    if (targetStatusForRegion === 'avoid') classification = 'INVALID_ADAPT_TARGET_AVOID';
    else if (targetStatusForRegion === 'adapt') classification = 'INVALID_ADAPT_TARGET_ADAPT';
    else if (codes.includes('LIMITATION_PROFILE_MISSING')) classification = 'MISSING_ADAPT_TARGET' as CaseClassification;
    const rootCause: RootCause = classification === 'INVALID_ADAPT_TARGET_OTHER' && codes.some((c) => c === 'LIMITATION_PROFILE_MISSING')
      ? 'D_ADAPT_TARGET_MISSING_PROFILE'
      : classification === 'INVALID_ADAPT_TARGET_OTHER'
        ? 'E_ADAPT_TARGET_PURPOSE_OR_AVAILABILITY'
        : (CLASSIFICATION_TO_ROOT_CAUSE[classification] ?? 'J_OTHER');
    return {
      ...base, ruleStatus: 'adapt', classification, rootCause, valid: false,
      adaptTargetId: targetId, adaptTargetName: displayName(target, targetId), adaptTargetStatusForRegion: targetStatusForRegion,
      avoidSubstituteIds: null, reasonCodes: codes, failureDetail: codes.join(','),
    };
  }

  // avoid — the only remaining member of the union (compatible/not_applicable
  // and adapt were both handled and returned above); asserted explicitly so
  // TS narrows `rule` here regardless of how far its control-flow analysis
  // tracks across the two preceding if-blocks.
  if (rule.status !== 'avoid') {
    throw new Error(`unreachable: unexpected rule status '${(rule as { status: string }).status}'`);
  }
  const substituteIds = rule.substituteExerciseIds;
  if (result.status === 'RESOLVED') {
    return {
      ...base, ruleStatus: 'avoid', classification: 'VALID_AVOID', rootCause: null, valid: true,
      adaptTargetId: null, adaptTargetName: null, adaptTargetStatusForRegion: null, avoidSubstituteIds: substituteIds,
      reasonCodes: [], failureDetail: '',
    };
  }
  const classification: CaseClassification = substituteIds.length === 0 ? 'AVOID_NO_CANDIDATES' : 'AVOID_CANDIDATES_ALL_FAIL';
  const detail = classification === 'AVOID_NO_CANDIDATES'
    ? 'avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect'
    : `all ${substituteIds.length} listed candidate(s) failed validation: ${
      result.status === 'FAILED' ? result.candidatesEvaluated.map((c) => `${c.exerciseId}[${c.reasonCodes.join('|')}]`).join('; ') : ''
    }`;
  return {
    ...base, ruleStatus: 'avoid', classification, rootCause: CLASSIFICATION_TO_ROOT_CAUSE[classification] ?? 'J_OTHER', valid: false,
    adaptTargetId: null, adaptTargetName: null, adaptTargetStatusForRegion: null, avoidSubstituteIds: substituteIds,
    reasonCodes: result.status === 'FAILED' ? result.reasonCodes : [], failureDetail: detail,
  };
}

// ─────────────────────────── Main analysis ───────────────────────────

function main() {
  const allCases: CaseResult[] = [];
  for (const exerciseId of usedExerciseIds) {
    for (const region of LIMITATION_REGION_IDS) {
      allCases.push(classifyPair(exerciseId, region, catalog, exerciseTemplates));
    }
  }

  const invalidCases = allCases.filter((c) => !c.valid);
  const totalAnalyzed = allCases.length;
  const totalInvalid = invalidCases.length;
  const failureRate = totalInvalid / totalAnalyzed;

  // ── Coverage of the 116 exercises ──
  const allExercises = [...catalog.values()];
  const reviewed = allExercises.filter((e) => e.limitationProfile != null);
  const unreviewed = allExercises.filter((e) => e.limitationProfile == null);
  const unreviewedUsedInTemplates = unreviewed.filter((e) => exerciseTemplates.has(e.id));
  const failuresFromUnreviewedSource = invalidCases.filter((c) => c.classification === 'MISSING_PROFILE');
  const failuresFromReviewedSource = invalidCases.filter((c) => c.classification !== 'MISSING_PROFILE');

  // ── Root cause grouping ──
  const rootCauseGroups = new Map<RootCause, CaseResult[]>();
  for (const c of invalidCases) {
    const key = c.rootCause ?? 'J_OTHER';
    if (!rootCauseGroups.has(key)) rootCauseGroups.set(key, []);
    rootCauseGroups.get(key)!.push(c);
  }

  // ── Super nodes: which adaptTargetId is responsible for the most direct failures ──
  // Non-recursive resolver (docs §Não recursividade): a broken target only
  // ever breaks the exercises that adapt to it DIRECTLY — there is no
  // multi-hop cascade to model beyond this single level.
  const targetFailureCount = new Map<string, { name: string; region: LimitationRegionId; count: number; sources: string[] }[]>();
  for (const c of invalidCases) {
    if (!c.adaptTargetId) continue;
    const key = c.adaptTargetId;
    if (!targetFailureCount.has(key)) targetFailureCount.set(key, []);
    const list = targetFailureCount.get(key)!;
    let entry = list.find((e) => e.region === c.region);
    if (!entry) {
      entry = { name: c.adaptTargetName ?? key, region: c.region, count: 0, sources: [] };
      list.push(entry);
    }
    entry.count += 1;
    entry.sources.push(c.exerciseId);
  }
  const superNodes = [...targetFailureCount.entries()]
    .flatMap(([targetId, regions]) => regions.map((r) => ({ targetId, targetName: r.name, region: r.region, failuresCaused: r.count, sources: r.sources })))
    .sort((a, b) => b.failuresCaused - a.failuresCaused);

  // ── Per-region summary ──
  const perRegion = LIMITATION_REGION_IDS.map((region) => {
    const casesForRegion = allCases.filter((c) => c.region === region);
    const invalidForRegion = casesForRegion.filter((c) => !c.valid);
    const responsibleCounts = new Map<string, number>();
    for (const c of invalidForRegion) {
      const key = c.adaptTargetId ?? c.exerciseId;
      responsibleCounts.set(key, (responsibleCounts.get(key) ?? 0) + 1);
    }
    const topResponsible = [...responsibleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      region,
      totalAnalyzed: casesForRegion.length,
      valid: casesForRegion.length - invalidForRegion.length,
      invalid: invalidForRegion.length,
      failureRate: invalidForRegion.length / casesForRegion.length,
      topResponsible: topResponsible.map(([id, count]) => ({ id, count })),
    };
  });

  // ── Per-template impact ──
  const perTemplate = templates.map((tpl) => {
    const idsInTemplate = new Set<string>();
    for (const session of tpl.sessions) for (const ex of session.exercises) idsInTemplate.add(ex.exercise_id);
    const regionsStatus = LIMITATION_REGION_IDS.map((region) => {
      const failingExercises = [...idsInTemplate]
        .map((id) => allCases.find((c) => c.exerciseId === id && c.region === region)!)
        .filter((c) => !c.valid);
      return {
        region,
        pass: failingExercises.length === 0,
        blockerCount: failingExercises.length,
        blockingExerciseIds: failingExercises.map((c) => c.exerciseId),
      };
    });
    return {
      templateId: tpl.id,
      environment: tpl.profile?.environment ?? null,
      exerciseCount: idsInTemplate.size,
      regions: regionsStatus,
      totalBlockers: regionsStatus.reduce((sum, r) => sum + r.blockerCount, 0),
      regionsAtRisk: regionsStatus.filter((r) => !r.pass).length,
    };
  });

  // Family grouping in chunks of 12 (T001-012, ..., T085-090)
  const sortedTemplateIds = perTemplate.map((t) => t.templateId).sort();
  const families: { label: string; templateIds: string[] }[] = [];
  for (let i = 0; i < sortedTemplateIds.length; i += 12) {
    const chunk = sortedTemplateIds.slice(i, i + 12);
    families.push({ label: `${chunk[0]}–${chunk[chunk.length - 1]}`, templateIds: chunk });
  }
  const perFamily = families.map((fam) => {
    const templatesInFamily = perTemplate.filter((t) => fam.templateIds.includes(t.templateId));
    const totalBlockers = templatesInFamily.reduce((s, t) => s + t.totalBlockers, 0);
    const templatesWithAnyRisk = templatesInFamily.filter((t) => t.regionsAtRisk > 0).length;
    return {
      label: fam.label,
      templateCount: templatesInFamily.length,
      templatesWithAnyRisk,
      totalBlockers,
    };
  });

  // ── Priority scoring (P0–P3), data-driven thresholds ──
  const templateCounts = invalidCases.map((c) => c.templateCount).sort((a, b) => a - b);
  const percentile = (p: number) => templateCounts[Math.min(templateCounts.length - 1, Math.floor(p * templateCounts.length))];
  const p90 = percentile(0.9);
  const p60 = percentile(0.6);
  const p25 = percentile(0.25);

  function priorityFor(c: CaseResult): 'P0' | 'P1' | 'P2' | 'P3' {
    const isSuperNodeTarget = c.adaptTargetId ? (targetFailureCount.get(c.adaptTargetId)?.find((e) => e.region === c.region)?.count ?? 0) >= 3 : false;
    if (c.templateCount >= p90 || isSuperNodeTarget) return 'P0';
    if (c.templateCount >= p60) return 'P1';
    if (c.templateCount >= p25) return 'P2';
    return 'P3';
  }
  const prioritized = invalidCases
    .map((c) => ({ ...c, priority: priorityFor(c) }))
    .sort((a, b) => {
      const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
      if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
      return b.templateCount - a.templateCount;
    });

  const priorityCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const c of prioritized) priorityCounts[c.priority]++;

  // ── Write structured JSON ──
  const jsonOutput = {
    generatedAt: new Date().toISOString(),
    methodology: 'Real resolveExerciseLimitations()/validateLimitationProfile() from src/workoutPrescription/limitationResolver.ts, run for every exercise actually referenced by T001-T090 x each of the 7 limitation regions, one region at a time (equipment/environment ignored — separate axis).',
    summary: {
      totalAnalyzed,
      totalValid: totalAnalyzed - totalInvalid,
      totalInvalid,
      failureRate,
      exercisesReviewed: reviewed.length,
      exercisesUnreviewed: unreviewed.length,
      unreviewedUsedInTemplates: unreviewedUsedInTemplates.length,
      failuresFromUnreviewedSource: failuresFromUnreviewedSource.length,
      failuresFromReviewedSource: failuresFromReviewedSource.length,
      templatesTotal: templates.length,
      exercisesUsedInTemplates: usedExerciseIds.length,
    },
    priorityCounts,
    rootCauseGroups: [...rootCauseGroups.entries()].map(([cause, cases]) => ({
      rootCause: cause,
      count: cases.length,
      uniqueExercises: new Set(cases.map((c) => c.exerciseId)).size,
      regionsAffected: [...new Set(cases.map((c) => c.region))].sort(),
      templatesAffected: [...new Set(cases.flatMap((c) => c.templatesAffected))].length,
    })),
    superNodes: superNodes.slice(0, 30),
    perRegion,
    perTemplate,
    perFamily,
    cases: allCases,
    prioritizedInvalidCases: prioritized,
    unreviewedExercises: unreviewed.map((e) => ({ id: e.id, name: displayName(e, e.id), usedInTemplates: exerciseTemplates.has(e.id), templateCount: exerciseTemplates.get(e.id)?.size ?? 0 })),
  };

  const jsonPath = resolve(REPO_ROOT, 'docs/workout-modifiers/limitation-dataset-audit.json');
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2) + '\n', 'utf8');

  // ── Write human Markdown report ──
  const md = renderMarkdownReport({
    totalAnalyzed, totalInvalid, failureRate, reviewed, unreviewed, unreviewedUsedInTemplates,
    failuresFromUnreviewedSource, failuresFromReviewedSource, rootCauseGroups, superNodes, perRegion,
    perFamily, perTemplate, prioritized, priorityCounts, templatesTotal: templates.length,
    exercisesUsedInTemplates: usedExerciseIds.length,
  });
  const mdPath = resolve(REPO_ROOT, 'docs/workout-modifiers/LIMITATION_DATASET_AUDIT.md');
  writeFileSync(mdPath, md, 'utf8');

  console.log(`Analyzed ${totalAnalyzed} combinations — ${totalInvalid} invalid (${(failureRate * 100).toFixed(1)}%)`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function renderMarkdownReport(d: {
  totalAnalyzed: number;
  totalInvalid: number;
  failureRate: number;
  reviewed: LimitationCatalogExercise[];
  unreviewed: LimitationCatalogExercise[];
  unreviewedUsedInTemplates: LimitationCatalogExercise[];
  failuresFromUnreviewedSource: CaseResult[];
  failuresFromReviewedSource: CaseResult[];
  rootCauseGroups: Map<RootCause, CaseResult[]>;
  superNodes: { targetId: string; targetName: string; region: LimitationRegionId; failuresCaused: number; sources: string[] }[];
  perRegion: ReturnType<typeof buildPerRegionForType>;
  perFamily: { label: string; templateCount: number; templatesWithAnyRisk: number; totalBlockers: number }[];
  perTemplate: { templateId: string; totalBlockers: number; regionsAtRisk: number }[];
  prioritized: (CaseResult & { priority: 'P0' | 'P1' | 'P2' | 'P3' })[];
  priorityCounts: { P0: number; P1: number; P2: number; P3: number };
  templatesTotal: number;
  exercisesUsedInTemplates: number;
}): string {
  const rootCauseLabels: Record<RootCause, string> = {
    A_ADAPT_TARGET_MARKED_AVOID: 'A — adapt target is itself marked `avoid` for the same region',
    B_ADAPT_TARGET_IS_ITSELF_ADAPT: 'B — adapt target is itself `adapt` (chain/cycle, non-recursive resolver cannot follow it)',
    C_ADAPT_TARGET_MISSING_EXERCISE: 'C — adapt target exercise does not exist in the catalog',
    D_ADAPT_TARGET_MISSING_PROFILE: 'D — adapt target exists but has no limitation profile',
    E_ADAPT_TARGET_PURPOSE_OR_AVAILABILITY: 'E — adapt target rejected on purpose/availability/equipment grounds',
    F_AVOID_NO_CANDIDATES_LISTED: 'F — `avoid` rule with no persisted substitute candidates (documented dataset gap)',
    G_AVOID_ALL_CANDIDATES_FAIL: 'G — `avoid` rule whose listed candidates all fail validation',
    H_SOURCE_MISSING_PROFILE: 'H — source exercise itself has no limitation profile (one of the 40 unreviewed)',
    I_SOURCE_INVALID_PROFILE: 'I — source exercise profile fails structural validation',
    J_OTHER: 'J — other',
  };

  const topTemplates = [...d.perTemplate].sort((a, b) => b.totalBlockers - a.totalBlockers).slice(0, 10);

  const lines: string[] = [];
  lines.push('# Limitation Dataset Audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Formal, mechanical audit of `15_LIMITATION_PROFILES_TECHNICAL_v2.json` run against the');
  lines.push('real, unmodified `resolveExerciseLimitations()`/`validateLimitationProfile()` from');
  lines.push('`src/workoutPrescription/limitationResolver.ts` — no resolver logic was reimplemented,');
  lines.push('and nothing in the dataset, resolver, or prescription engine was changed by this audit.');
  lines.push('');
  lines.push('## Resumo executivo');
  lines.push('');
  lines.push(`- **${d.totalAnalyzed}** combinações \`exerciseId × region\` analisadas (${d.exercisesUsedInTemplates} exercícios realmente alcançáveis pelos ${d.templatesTotal} templates T001–T090 × 7 regiões).`);
  lines.push(`- **${d.totalInvalid}** combinações não produzem uma decisão válida (**${pct(d.failureRate)}**).`);
  lines.push(`- Cobertura de profiles: **${d.reviewed.length}/${d.reviewed.length + d.unreviewed.length}** exercícios revisados; dos **${d.unreviewed.length}** não revisados, **${d.unreviewedUsedInTemplates.length}** aparecem em templates reais.`);
  lines.push(`- Das falhas: **${d.failuresFromUnreviewedSource.length}** vêm de exercícios-fonte sem profile (revisão incompleta); **${d.failuresFromReviewedSource.length}** estão DENTRO dos exercícios já supostamente revisados (inconsistência interna, não apenas cobertura incompleta).`);
  if (d.totalInvalid > 0) {
    lines.push(`- Prioridade: **P0=${d.priorityCounts.P0}**, P1=${d.priorityCounts.P1}, P2=${d.priorityCounts.P2}, P3=${d.priorityCounts.P3}.`);
    lines.push('  (thresholds por percentil de alcance em templates: P0 ≥ p90 OU super node com ≥3 dependentes; P1 ≥ p60; P2 ≥ p25; P3 abaixo disso.');
    lines.push('  Esta matriz só cobre exercícios já alcançáveis pelos templates atuais — "não alcançável" do enunciado não se aplica aqui por definição.)');
  } else {
    lines.push('- **Quality gate alcançável: 497/497 válidas; dívida conhecida = 0.**');
  }
  lines.push('');
  lines.push('**Esta auditoria não toma decisões clínicas.** Ela verifica mecanicamente o dataset materializado.');
  lines.push('');

  lines.push('## Categorias de falha (root cause)');
  lines.push('');
  lines.push('| Causa raiz | Combinações | Exercícios únicos | Regiões | Templates afetados |');
  lines.push('|---|---:|---:|---|---:|');
  if (d.rootCauseGroups.size === 0) lines.push('| Nenhuma falha alcançável | 0 | 0 | — | 0 |');
  for (const [cause, cases] of [...d.rootCauseGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const regions = [...new Set(cases.map((c) => c.region))].sort().join(', ');
    const templatesAffected = new Set(cases.flatMap((c) => c.templatesAffected)).size;
    lines.push(`| ${rootCauseLabels[cause]} | ${cases.length} | ${new Set(cases.map((c) => c.exerciseId)).size} | ${regions} | ${templatesAffected} |`);
  }
  lines.push('');
  lines.push('> Distinção importante: categorias F/G (`avoid` sem substituto utilizável) são decisões');
  lines.push('> **independentes** — cada uma exige revisão própria. Categorias A/B/C/D (alvo de `adapt`');
  lines.push('> quebrado) **concentram-se em poucos exercícios "super node"** — corrigir o alvo resolve');
  lines.push('> várias falhas de uma vez (ver seção seguinte).');
  lines.push('');

  lines.push('## Super nodes — exercícios/targets que mais propagam falhas');
  lines.push('');
  lines.push('| Target | Região | Falhas causadas | Exercícios que dependem dele |');
  lines.push('|---|---|---:|---|');
  for (const node of d.superNodes.slice(0, 20)) {
    lines.push(`| \`${node.targetId}\` (${node.targetName}) | ${node.region} | ${node.failuresCaused} | ${node.sources.join(', ')} |`);
  }
  lines.push('');

  lines.push('## Impacto por região');
  lines.push('');
  lines.push('| Região | Analisado | Válido | Inválido | % falha | Principais responsáveis |');
  lines.push('|---|---:|---:|---:|---:|---|');
  for (const r of d.perRegion) {
    const top = r.topResponsible.map((t) => `${t.id}(${t.count})`).join(', ');
    lines.push(`| ${r.region} | ${r.totalAnalyzed} | ${r.valid} | ${r.invalid} | ${pct(r.failureRate)} | ${top} |`);
  }
  lines.push('');

  lines.push('## Impacto por família de templates (blocos de 12)');
  lines.push('');
  lines.push('| Família | Templates | Templates com algum risco | Total de blockers |');
  lines.push('|---|---:|---:|---:|');
  for (const fam of d.perFamily) {
    lines.push(`| ${fam.label} | ${fam.templateCount} | ${fam.templatesWithAnyRisk} | ${fam.totalBlockers} |`);
  }
  lines.push('');

  lines.push('## Top 10 templates com mais blockers');
  lines.push('');
  lines.push('| Template | Regiões em risco | Total de blockers |');
  lines.push('|---|---:|---:|');
  for (const t of topTemplates) {
    lines.push(`| ${t.templateId} | ${t.regionsAtRisk}/7 | ${t.totalBlockers} |`);
  }
  lines.push('');

  lines.push('## Matriz de revisão clínica — Top 20 decisões prioritárias');
  lines.push('');
  lines.push('Cada linha é uma decisão de conteúdo/clínica pendente. As opções listadas são');
  lines.push('**categorias de decisão**, não uma escolha feita por esta auditoria.');
  lines.push('');
  if (d.prioritized.length === 0) {
    lines.push('Nenhuma decisão pendente no escopo alcançável T001–T090 × 7 regiões.');
    lines.push('');
  }
  for (const c of d.prioritized.slice(0, 20)) {
    lines.push(`### [${c.priority}] ${c.exerciseName} (\`${c.exerciseId}\`) × ${c.region}`);
    lines.push('');
    lines.push(`- **Current rule**: \`${c.ruleStatus}\`${c.adaptTargetId ? ` → \`${c.adaptTargetId}\`` : ''}`);
    if (c.adaptTargetId) lines.push(`- **Target status for ${c.region}**: \`${c.adaptTargetStatusForRegion ?? 'n/a'}\``);
    if (c.avoidSubstituteIds) lines.push(`- **Substitute candidates listed**: ${c.avoidSubstituteIds.length ? c.avoidSubstituteIds.join(', ') : '(none)'}`);
    lines.push(`- **Problem**: ${c.failureDetail || c.classification}`);
    lines.push(`- **Templates affected**: ${c.templateCount} (${c.templatesAffected.slice(0, 8).join(', ')}${c.templatesAffected.length > 8 ? ', …' : ''})`);
    lines.push('- **Clinical decision required** — choose one:');
    lines.push('  - mark the exercise directly `compatible`/`not_applicable` for this region;');
    lines.push('  - provide a different, clinically-reviewed adaptation target;');
    lines.push('  - confirm `avoid` with a real safe substitute;');
    lines.push('  - other clinically reviewed rule.');
    lines.push('');
  }

  lines.push('## Cobertura dos 116 exercícios');
  lines.push('');
  lines.push(`- ${d.reviewed.length} exercícios têm \`limitationProfile\`; ${d.unreviewed.length} não têm.`);
  lines.push(`- Dos ${d.unreviewed.length} não revisados, ${d.unreviewedUsedInTemplates.length} são efetivamente usados por algum template — esses geram \`MISSING_PROFILE\` sempre que um usuário com QUALQUER limitação os alcança.`);
  lines.push(`- **${d.failuresFromReviewedSource.length} das ${d.totalInvalid} falhas ocorrem dentro do conjunto já "revisado"** — ou seja, o problema não é só terminar a revisão dos 40 que faltam; há inconsistência dentro do que já foi considerado pronto.`);
  lines.push('');

  lines.push('## Proposta de Quality Gate futuro');
  lines.push('');
  if (d.totalInvalid === 0) {
    lines.push('O baseline alcançável é **zero**. O gate deve falhar para qualquer nova chave inválida,');
    lines.push('target ausente/não terminal, autorreferência ou profile ausente em exercício alcançável.');
  } else {
    lines.push('O dataset ainda tem dívida técnica conhecida; use baseline decrescente por chave,');
    lines.push('nunca apenas por contagem, até atingir zero.');
  }
  lines.push('');
  lines.push('Proposta de **baseline decrescente** (estratégia adequada para este caso):');
  lines.push('');
  lines.push('1. Persistir o número atual de combinações inválidas como baseline versionado');
  lines.push('   (ex.: `docs/workout-modifiers/limitation-dataset-audit-baseline.json`, contendo');
  lines.push(`   \`{ "knownInvalidCount": ${d.totalInvalid} }\` e, idealmente, a lista completa das`);
  lines.push('   chaves `exerciseId:region` já conhecidas como inválidas).');
  lines.push('2. Um teste/script de CI roda a mesma auditoria e compara contra o baseline:');
  lines.push('   - **nova combinação inválida que NÃO estava no baseline** → falha (regressão real);');
  lines.push('   - **contagem total menor ou igual, e nenhuma chave nova** → passa;');
  lines.push('   - **contagem menor** (alguém corrigiu um profile) → passa E deveria abaixar o baseline');
  lines.push('     no mesmo PR (evita a dívida voltar a subir silenciosamente).');
  lines.push('3. Comparar por CHAVE (`exerciseId:region`), não só por contagem total — evita que uma');
  lines.push('   correção e uma regressão não relacionadas se cancelem numericamente sem serem notadas.');
  lines.push('4. Regras adicionais de guarda estrutural (sempre ativas, sem baseline, pois nunca devem');
  lines.push('   ocorrer mesmo hoje):');
  lines.push('   - todo `adaptation.exerciseId` referenciado deve existir no catálogo (categoria C/MISSING_ADAPT_TARGET —');
  lines.push('     hoje zero casos, então isso pode já ser um gate rígido sem quebrar nada);');
  lines.push('   - todo `substituteExerciseIds`/`adaptation.exerciseId` não pode autorreferenciar o próprio exercício');
  lines.push('     (já garantido estruturalmente por `ruleValid` no resolver — apenas confirmar via teste dedicado);');
  lines.push('   - todo exercício usado em algum template T001–T090 e alcançável quando o usuário declara');
  lines.push('     `musculoskeletal_limitation` deve ter `limitationProfile` OU estar numa lista explícita de');
  lines.push('     exceções conhecidas (torna a lista dos "40 não revisados" visível e rastreável em vez de silenciosa).');
  lines.push('');

  return lines.join('\n');
}

// Type helper purely for the renderer's parameter typing above.
function buildPerRegionForType() {
  return [] as { region: LimitationRegionId; totalAnalyzed: number; valid: number; invalid: number; failureRate: number; topResponsible: { id: string; count: number }[] }[];
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) main();
