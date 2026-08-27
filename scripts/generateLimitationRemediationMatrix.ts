/**
 * Transforms the approved formal audit
 * (docs/workout-modifiers/limitation-dataset-audit.json) into a remediation
 * artifact for CONTENT/CLINICAL review — one row per invalid combination,
 * grouped into a priority queue.
 *
 * This script makes NO clinical judgment: `clinicalDecision` is always
 * `null` on generation. It only reshapes and groups already-computed,
 * mechanical facts (the same real-resolver classification from
 * `scripts/auditLimitationDataset.ts`) for human review. It never edits the
 * dataset, the resolver, the composition engine, or the templates.
 *
 * Produces:
 *   docs/workout-modifiers/limitation-remediation-matrix.json
 *   docs/workout-modifiers/LIMITATION_REMEDIATION_QUEUE.md
 *
 * Usage: npx tsx scripts/generateLimitationRemediationMatrix.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import auditJson from '../docs/workout-modifiers/limitation-dataset-audit.json';
import type { CaseResult, RootCause } from './auditLimitationDataset';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

type AuditCase = CaseResult & { priority: 'P0' | 'P1' | 'P2' | 'P3' };

const prioritizedInvalidCases = auditJson.prioritizedInvalidCases as unknown as AuditCase[];

// ─────────────────────────── Failure class (Parte 2) ───────────────────────────

export type FailureClass =
  | 'CLASS_1_DATASET_CONTRADICTORY' // adapt -> avoid (declared adaptation the resolver cannot accept)
  | 'CLASS_2_ADAPTATION_NOT_TERMINAL' // adapt -> adapt (chain/cycle; resolver V1 is non-recursive by design)
  | 'CLASS_3_AVOID_NO_EXECUTABLE_STRATEGY' // avoid with no working substitute
  | 'CLASS_4_TARGET_TECHNICALLY_INCOMPATIBLE' // target rejected on purpose/availability/equipment grounds
  | 'CLASS_5_STRUCTURAL_OTHER'; // missing target exercise/profile, source profile issues — 0 cases today, kept for forward-compat

const ROOT_CAUSE_TO_FAILURE_CLASS: Record<RootCause, FailureClass> = {
  A_ADAPT_TARGET_MARKED_AVOID: 'CLASS_1_DATASET_CONTRADICTORY',
  B_ADAPT_TARGET_IS_ITSELF_ADAPT: 'CLASS_2_ADAPTATION_NOT_TERMINAL',
  C_ADAPT_TARGET_MISSING_EXERCISE: 'CLASS_5_STRUCTURAL_OTHER',
  D_ADAPT_TARGET_MISSING_PROFILE: 'CLASS_5_STRUCTURAL_OTHER',
  E_ADAPT_TARGET_PURPOSE_OR_AVAILABILITY: 'CLASS_4_TARGET_TECHNICALLY_INCOMPATIBLE',
  F_AVOID_NO_CANDIDATES_LISTED: 'CLASS_3_AVOID_NO_EXECUTABLE_STRATEGY',
  G_AVOID_ALL_CANDIDATES_FAIL: 'CLASS_3_AVOID_NO_EXECUTABLE_STRATEGY',
  H_SOURCE_MISSING_PROFILE: 'CLASS_5_STRUCTURAL_OTHER',
  I_SOURCE_INVALID_PROFILE: 'CLASS_5_STRUCTURAL_OTHER',
  J_OTHER: 'CLASS_5_STRUCTURAL_OTHER',
};

// ─────────────────────────── Review lifecycle (Parte 7) ───────────────────────────

export type ReviewStatus = 'PENDING' | 'NEEDS_CLINICAL_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESOLVED';

export interface RemediationRow {
  exerciseId: string;
  exerciseName: string;
  region: string;
  failureClass: FailureClass;
  currentStatus: string | null;
  currentTarget: string | null;
  targetStatus: string | null;
  templatesAffected: string[];
  templateCount: number;
  propagationImpact: number;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  clinicalDecision: null;
  reviewStatus: ReviewStatus;
  reviewNotes: string;
}

function buildRows(cases: AuditCase[]): RemediationRow[] {
  // propagationImpact: how many OTHER rows share the exact same underlying
  // decision. Adapt-target failures cluster around a shared (target, region)
  // pair — fixing that ONE target's profile fixes every row in the group.
  // Avoid failures with no candidate list are, by contract
  // (03_SUBSTITUTION_STRATEGY.md), standalone decisions — no shared target
  // to fix on their behalf.
  const targetGroupSize = new Map<string, number>();
  for (const c of cases) {
    if (!c.adaptTargetId) continue;
    const key = `${c.adaptTargetId}:${c.region}`;
    targetGroupSize.set(key, (targetGroupSize.get(key) ?? 0) + 1);
  }

  return cases.map((c) => {
    const rootCause = (c.rootCause ?? 'J_OTHER') as RootCause;
    const propagationImpact = c.adaptTargetId
      ? (targetGroupSize.get(`${c.adaptTargetId}:${c.region}`) ?? 1)
      : 1;
    return {
      exerciseId: c.exerciseId,
      exerciseName: c.exerciseName,
      region: c.region,
      failureClass: ROOT_CAUSE_TO_FAILURE_CLASS[rootCause],
      currentStatus: c.ruleStatus,
      currentTarget: c.adaptTargetId,
      targetStatus: c.adaptTargetStatusForRegion,
      templatesAffected: c.templatesAffected,
      templateCount: c.templateCount,
      propagationImpact,
      priority: c.priority,
      clinicalDecision: null,
      // Every current case needs a content/clinical decision — none of the
      // 176 combinations analyzed are pure data typos (0 missing-target-
      // exercise, 0 self-reference cases; see CLASS_5_STRUCTURAL_OTHER
      // being empty today). See Parte 6 of the audit report.
      reviewStatus: 'NEEDS_CLINICAL_REVIEW' as ReviewStatus,
      reviewNotes: '',
    };
  });
}

// ─────────────────────────── Remediation queue (Parte 5/6) ───────────────────────────

interface QueueUnit {
  key: string; // groups multiple rows resolvable by the SAME decision
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  rows: RemediationRow[];
  totalTemplateReach: number; // union of templatesAffected across the group
  decisionSubject: { exerciseId: string; exerciseName: string; region: string } | null; // the shared target, when the decision is about a target
}

function buildQueue(rows: RemediationRow[]): QueueUnit[] {
  // Group by (currentTarget, region) when a shared target exists (fixing it
  // is ONE decision that resolves every row in the group); otherwise each
  // row is its own unit (avoid-with-no-candidate decisions never share a
  // target — see 03_SUBSTITUTION_STRATEGY.md's `missing_exercise_candidate`
  // contract).
  const groups = new Map<string, RemediationRow[]>();
  for (const row of rows) {
    const key = row.currentTarget ? `target:${row.currentTarget}:${row.region}` : `standalone:${row.exerciseId}:${row.region}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const totalTemplateReach = new Set(groupRows.flatMap((r) => r.templatesAffected)).size;
      const best = groupRows.reduce((a, b) => (order[a.priority] <= order[b.priority] ? a : b));
      const decisionSubject = groupRows[0].currentTarget
        ? { exerciseId: groupRows[0].currentTarget, exerciseName: groupRows[0].currentTarget, region: groupRows[0].region }
        : null;
      return { key, priority: best.priority, rows: groupRows, totalTemplateReach, decisionSubject };
    })
    .sort((a, b) => {
      if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
      return b.totalTemplateReach - a.totalTemplateReach;
    });
}

// ─────────────────────────── Render ───────────────────────────

function renderTop20Markdown(queue: QueueUnit[]): string {
  const lines: string[] = [];
  lines.push('# Limitation Remediation Queue');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Fila de decisões de conteúdo/clínicas pendentes, agrupada por decisão');
  lines.push('compartilhada (corrigir um target de `adapt` resolve todas as linhas do');
  lines.push('grupo de uma vez). Nenhuma decisão foi tomada — `clinicalDecision` é sempre');
  lines.push('`null` neste artefato. As opções listadas são categorias de resolução, não');
  lines.push('uma escolha feita por este script.');
  lines.push('');
  lines.push(`Total de unidades de decisão: **${queue.length}** (vs. 176 linhas individuais —`);
  lines.push('agrupar por target compartilhado reduz o esforço humano de revisão).');
  lines.push('');
  lines.push('## Top 20 unidades de decisão por impacto');
  lines.push('');

  for (const unit of queue.slice(0, 20)) {
    const first = unit.rows[0];
    const isSharedTarget = unit.rows.length > 1 && first.currentTarget;
    lines.push('---');
    lines.push('');
    if (isSharedTarget) {
      lines.push(`### [${unit.priority}] DECISÃO COMPARTILHADA — target \`${first.currentTarget}\``);
      lines.push('');
      lines.push(`**RESOLVE ${unit.rows.length} OCORRÊNCIAS DE UMA VEZ**`);
      lines.push('');
      lines.push('EXERCÍCIOS AFETADOS');
      lines.push(unit.rows.map((r) => `${r.exerciseName} (\`${r.exerciseId}\`)`).join(', '));
      lines.push('');
      lines.push('REGIÃO');
      lines.push(first.region);
      lines.push('');
      lines.push('REGRA ATUAL (comum ao grupo)');
      lines.push(`\`${first.currentStatus}\` → \`${first.currentTarget}\``);
      lines.push('');
      lines.push('PROBLEMA');
      lines.push(`\`${first.currentTarget}\` está marcado \`${first.targetStatus}\` para ${first.region}, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos ${unit.rows.length} exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.`);
    } else {
      lines.push(`### [${unit.priority}] ${first.exerciseName} (\`${first.exerciseId}\`)`);
      lines.push('');
      lines.push('REGIÃO');
      lines.push(first.region);
      lines.push('');
      lines.push('REGRA ATUAL');
      lines.push(first.currentTarget ? `\`${first.currentStatus}\` → \`${first.currentTarget}\`` : `\`${first.currentStatus}\``);
      lines.push('');
      lines.push('PROBLEMA');
      lines.push(first.currentTarget
        ? `target \`${first.currentTarget}\` está \`${first.targetStatus}\` para ${first.region}`
        : 'regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)');
    }
    lines.push('');
    lines.push('IMPACTO');
    lines.push(`${unit.totalTemplateReach} templates`);
    lines.push('');
    lines.push('DECISÃO NECESSÁRIA');
    lines.push(isSharedTarget
      ? `Definir o comportamento clínico de \`${first.currentTarget}\` para ${first.region} (ou redirecionar os ${unit.rows.length} exercícios para outro target aprovado).`
      : `Definir o comportamento clínico de ${first.exerciseName} para ${first.region}.`);
    lines.push('');
    lines.push('POSSÍVEIS TIPOS DE RESOLUÇÃO');
    lines.push('- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;');
    lines.push('- fornecer outro target de adaptação já aprovado e diretamente terminal;');
    lines.push('- confirmar `avoid` com uma lista real de substitutos seguros;');
    lines.push('- outra decisão clinicamente revisada.');
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const rows = buildRows(prioritizedInvalidCases);
  const queue = buildQueue(rows);

  const jsonOutput = {
    generatedAt: new Date().toISOString(),
    methodology: 'Transform of docs/workout-modifiers/limitation-dataset-audit.json — no re-resolution, no clinical judgment. clinicalDecision is always null.',
    totalRows: rows.length,
    totalDecisionUnits: queue.length,
    reviewStatusModel: {
      PENDING: 'Row identified by the audit, not yet triaged.',
      NEEDS_CLINICAL_REVIEW: 'Triaged — requires a content/clinical decision before any dataset edit.',
      APPROVED: 'A specific resolution was clinically approved but not yet applied to the dataset.',
      REJECTED: 'A proposed resolution was reviewed and rejected; needs a different proposal.',
      RESOLVED: 'Applied to the dataset AND re-validated by the real resolver (see quality gate) as producing a valid combination.',
    },
    rows,
    queue: queue.map((u) => ({
      key: u.key,
      priority: u.priority,
      rowCount: u.rows.length,
      totalTemplateReach: u.totalTemplateReach,
      decisionSubject: u.decisionSubject,
      exerciseIds: u.rows.map((r) => r.exerciseId),
      region: u.rows[0].region,
    })),
  };

  const jsonPath = resolve(REPO_ROOT, 'docs/workout-modifiers/limitation-remediation-matrix.json');
  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2) + '\n', 'utf8');

  const mdPath = resolve(REPO_ROOT, 'docs/workout-modifiers/LIMITATION_REMEDIATION_QUEUE.md');
  writeFileSync(mdPath, renderTop20Markdown(queue), 'utf8');

  console.log(`${rows.length} remediation rows grouped into ${queue.length} decision units`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) main();
