#!/usr/bin/env -S node --import tsx

/**
 * Offline documentation generator for the proposed Phase 1 review dataset.
 * It does not initialize Firebase, write to Firestore, or participate in runtime.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXERCISES_SEED } from '../../../src/data/exercisesSeedData.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../..');
const MATRIX_PATH = join(HERE, '06_MUSCULOSKELETAL_RELEVANCE_MATRIX.md');
const WORKOUTS_PATH = join(REPO_ROOT, 'docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json');
const OUTPUT_JSON = join(HERE, '08_PHASE1_PROPOSED_DATASET.json');
const OUTPUT_MD = join(HERE, '09_PHASE1_PROPOSED_REVIEW_SUMMARY.md');

const REGIONS = ['knee', 'hip', 'back', 'shoulder', 'elbow', 'wrist', 'ankle_foot'];
const REGION_LABEL = {
  knee: 'joelho', hip: 'quadril', back: 'coluna/costas', shoulder: 'ombro',
  elbow: 'cotovelo', wrist: 'punho', ankle_foot: 'tornozelo/pé',
};

const catalogById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
const workouts = JSON.parse(readFileSync(WORKOUTS_PATH, 'utf8'));
const usedIds = new Set(workouts.workouts.flatMap((workout) =>
  workout.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exercise_id)),
));

function parseTriageMatrix() {
  const rows = new Map();
  for (const line of readFileSync(MATRIX_PATH, 'utf8').split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 14) continue;
    const id = cells[0].replaceAll('`', '');
    if (!catalogById.has(id)) continue;
    rows.set(id, {
      exerciseName: cells[1],
      triage: Object.fromEntries(REGIONS.map((region, index) => [region, cells[5 + index]])),
    });
  }
  return rows;
}

const triageRows = parseTriageMatrix();

const ADAPTATIONS = new Map(Object.entries({
  'dumbbell-stiff-leg-deadlift:wrist': ['hip-hinge-drill', 'Variante sem implemento manual mantém o padrão de dobradiça.'],
  'plank:shoulder': ['dead-bug', 'Variante em decúbito mantém o trabalho anti-extensão sem apoio nos ombros.'],
  'plank:elbow': ['dead-bug', 'Variante em decúbito mantém o trabalho anti-extensão sem apoio nos cotovelos.'],
  'plank:wrist': ['dead-bug', 'Variante em decúbito mantém o trabalho anti-extensão sem apoio nos punhos.'],
  'dumbbell-lateral-raise:wrist': ['machine-lateral-raise', 'Variante catalogada em máquina elimina a sustentação de halteres.'],
  'dumbbell-shoulder-press:wrist': ['machine-shoulder-press', 'Variante catalogada em máquina substitui os halteres por trajetória guiada.'],
  'push-up:shoulder': ['wall-push-up', 'Variante catalogada na parede preserva o empurrar horizontal com apoio elevado.'],
  'push-up:elbow': ['wall-push-up', 'Variante catalogada na parede preserva o empurrar horizontal com apoio elevado.'],
  'push-up:wrist': ['wall-push-up', 'Variante catalogada na parede preserva o empurrar horizontal com apoio elevado.'],
  'barbell-back-squat:wrist': ['chair-squat', 'Variante catalogada remove a barra e usa a cadeira como referência concreta.'],
  'bulgarian-split-squat-dumbbell:wrist': ['bulgarian-split-squat', 'Variante catalogada preserva o movimento sem halteres.'],
  'bench-step-up:knee': ['supported-low-step-up', 'Variante catalogada combina degrau baixo e apoio.'],
  'bench-step-up:hip': ['supported-low-step-up', 'Variante catalogada combina degrau baixo e apoio.'],
  'bench-step-up:ankle_foot': ['supported-low-step-up', 'Variante catalogada combina degrau baixo e apoio.'],
  'bird-dog:shoulder': ['dead-bug', 'Variante em decúbito mantém o trabalho anti-extensão sem apoio nos ombros.'],
  'bird-dog:elbow': ['dead-bug', 'Variante em decúbito mantém o trabalho anti-extensão sem apoio nos cotovelos.'],
  'bird-dog:wrist': ['dead-bug', 'Variante em decúbito mantém o trabalho anti-extensão sem apoio nos punhos.'],
  'conventional-deadlift:wrist': ['hip-hinge-drill', 'Variante sem implemento manual mantém o padrão de dobradiça.'],
  'incline-dumbbell-bench-press:wrist': ['machine-flat-bench-press', 'Variante catalogada em máquina elimina a sustentação de halteres.'],
  'dumbbell-overhead-triceps-extension:shoulder': ['cable-triceps-pushdown', 'Variante catalogada de extensão do cotovelo evita a posição acima da cabeça.'],
  'low-step-up:knee': ['supported-low-step-up', 'Variante catalogada acrescenta apoio mantendo o degrau baixo.'],
  'low-step-up:hip': ['supported-low-step-up', 'Variante catalogada acrescenta apoio mantendo o degrau baixo.'],
  'low-step-up:ankle_foot': ['supported-low-step-up', 'Variante catalogada acrescenta apoio mantendo o degrau baixo.'],
  'ez-bar-biceps-curl:wrist': ['hammer-curl', 'Variante catalogada troca a barra W por pegada neutra com halteres.'],
  'triceps-rope-pushdown:wrist': ['cable-triceps-pushdown', 'Variante catalogada troca a corda por outra execução de pushdown.'],
  'cable-triceps-pushdown:wrist': ['triceps-rope-pushdown', 'Variante catalogada troca o implemento por corda.'],
}));

const COMPATIBLE = new Map(Object.entries({
  'walking:knee': 'Atividade de baixo impacto e sem carga externa; adequação depende do quadro individual.',
  'walking:hip': 'Atividade de baixo impacto e sem carga externa; adequação depende do quadro individual.',
  'walking:ankle_foot': 'Atividade de baixo impacto e sem carga externa; adequação depende do quadro individual.',
  'stationary-bike:knee': 'Atividade cíclica sentada e de baixo impacto; adequação depende do quadro individual.',
  'stationary-bike:hip': 'Atividade cíclica sentada e de baixo impacto; adequação depende do quadro individual.',
  'stationary-bike:ankle_foot': 'Atividade cíclica sentada e de baixo impacto; adequação depende do quadro individual.',
  'march-in-place:knee': 'Marcha sem deslocamento nem carga externa; adequação depende do quadro individual.',
  'march-in-place:hip': 'Marcha sem deslocamento nem carga externa; adequação depende do quadro individual.',
  'march-in-place:ankle_foot': 'Marcha sem deslocamento nem carga externa; adequação depende do quadro individual.',
  'controlled-marching:knee': 'Marcha controlada sem carga externa; adequação depende do quadro individual.',
  'controlled-marching:hip': 'Marcha controlada sem carga externa; adequação depende do quadro individual.',
  'controlled-marching:ankle_foot': 'Marcha controlada sem carga externa; adequação depende do quadro individual.',
  'supported-semi-tandem-stance:knee': 'Tarefa estática com apoio e sem carga externa; adequação depende do quadro individual.',
  'supported-semi-tandem-stance:hip': 'Tarefa estática com apoio e sem carga externa; adequação depende do quadro individual.',
  'supported-semi-tandem-stance:ankle_foot': 'Tarefa estática com apoio e sem carga externa; adequação depende do quadro individual.',
  'weight-shift:knee': 'Tarefa controlada sem carga externa; adequação depende do quadro individual.',
  'weight-shift:hip': 'Tarefa controlada sem carga externa; adequação depende do quadro individual.',
  'weight-shift:ankle_foot': 'Tarefa controlada sem carga externa; adequação depende do quadro individual.',
  'supported-balance:knee': 'Tarefa estática com apoio e sem carga externa; adequação depende do quadro individual.',
  'supported-balance:hip': 'Tarefa estática com apoio e sem carga externa; adequação depende do quadro individual.',
  'supported-balance:ankle_foot': 'Tarefa estática com apoio e sem carga externa; adequação depende do quadro individual.',
  'dead-bug:wrist': 'Execução em decúbito não exige apoio de peso nos punhos.',
}));

const PREFERRED_BY_PATTERN = {
  squat: ['chair-sit-to-stand', 'chair-squat', 'bodyweight-squat', 'leg-press-45', 'hack-squat-machine'],
  lunge: ['supported-low-step-up', 'low-step-up', 'stationary-lunge', 'bench-step-up', 'walking-lunges'],
  knee_extension: [],
  knee_flexion: ['seated-leg-curl-machine', 'lying-leg-curl-machine', 'supported-standing-leg-curl', 'slider-leg-curl'],
  hinge: ['hip-hinge-drill', 'dumbbell-stiff-leg-deadlift', 'stiff-leg-deadlift-machine', 'sumo-deadlift-dumbbell'],
  hip_extension: ['glute-bridge', 'cable-glute-kickback', 'hip-thrust'],
  hip_abduction: ['seated-hip-abductor-machine', 'supported-hip-abduction', 'mini-band-hip-abduction', 'lateral-band-walk'],
  gait: ['controlled-marching', 'march-in-place', 'walking', 'stationary-bike'],
  cycling: ['walking', 'march-in-place', 'controlled-marching'],
  balance: ['supported-balance', 'supported-semi-tandem-stance', 'weight-shift'],
  calf_raise: ['seated-calf-raise-machine', 'supported-calf-raise', 'standing-calf-raise-machine'],
  horizontal_push: ['wall-push-up', 'machine-flat-bench-press', 'iso-lateral-incline-chest-press-machine', 'push-up', 'incline-dumbbell-bench-press'],
  vertical_push: ['seated-resistance-band-shoulder-press', 'machine-shoulder-press', 'resistance-band-shoulder-press', 'dumbbell-shoulder-press'],
  horizontal_pull: ['resistance-band-row', 'iso-lateral-row-machine', 'unilateral-iso-lateral-row-machine', 'low-cable-row-wide-neutral-grip'],
  vertical_pull: ['resistance-band-lat-pulldown', 'iso-lateral-pulldown-machine', 'bar-lat-pulldown', 'v-bar-pulldown'],
  shoulder_abduction: ['machine-lateral-raise', 'cable-lateral-raise', 'dumbbell-lateral-raise'],
  elbow_flexion: ['hammer-curl', 'cable-biceps-curl', 'seated-dumbbell-curl', 'ez-bar-biceps-curl'],
  elbow_extension: ['triceps-rope-pushdown', 'cable-triceps-pushdown', 'dumbbell-overhead-triceps-extension', 'cable-skull-crusher'],
  core_anti_extension: ['dead-bug', 'bird-dog', 'plank'],
  core_flexion: ['lying-leg-raise', 'floor-crunch'],
  core_anti_rotation: [],
  loaded_carry: [],
  mobility: [],
  breathing: [],
};

function candidatesFor(exercise) {
  const preferred = PREFERRED_BY_PATTERN[exercise.movement.pattern] ?? [];
  const structural = exercise.substitution.similarExerciseIds ?? [];
  return [...new Set([...preferred, ...structural])]
    .filter((id) => id !== exercise.id && catalogById.has(id));
}

function proposedRule(exercise, region, triage) {
  const key = `${exercise.id}:${region}`;
  if (ADAPTATIONS.has(key)) {
    const [exerciseId, rationale] = ADAPTATIONS.get(key);
    return {
      status: 'adapt', confidence: 'medium', rationale,
      adaptation: { kind: 'exercise_variant', exerciseId },
      humanReview: { required: true, priority: 'high', reason: 'Confirmar que a variante é executável e adequada à limitação declarada.' },
    };
  }
  if (COMPATIBLE.has(key)) {
    return {
      status: 'compatible', confidence: key === 'dead-bug:wrist' ? 'medium' : 'low',
      rationale: COMPATIBLE.get(key),
      humanReview: { required: true, priority: 'high', reason: 'Compatibilidade genérica depende do diagnóstico, gravidade e sintomas não presentes no catálogo.' },
    };
  }
  if (triage === 'N') {
    return {
      status: 'not_applicable', confidence: 'high',
      rationale: `${REGION_LABEL[region]} não é material segundo o padrão ${exercise.movement.pattern} e os metadados disponíveis.`,
      humanReview: { required: true, priority: 'normal', reason: 'Confirmar a não materialidade antes de qualquer aprovação.' },
    };
  }
  if (triage === 'U') {
    return {
      status: 'unknown', confidence: 'low',
      rationale: `Metadados de catálogo não bastam para decidir o efeito em ${REGION_LABEL[region]}.`,
      humanReview: { required: true, priority: 'high', reason: 'Exige avaliação humana da execução e do tipo de limitação.' },
    };
  }
  if (exercise.movement.pattern === 'mobility') {
    return {
      status: 'unknown', confidence: 'low',
      rationale: `O catálogo não especifica os movimentos da rotina de mobilidade para decidir o efeito em ${REGION_LABEL[region]}.`,
      humanReview: { required: true, priority: 'high', reason: 'Exige definição da execução e avaliação humana antes da classificação.' },
    };
  }
  const substituteExerciseIds = candidatesFor(exercise);
  return {
    status: 'avoid', confidence: 'medium',
    rationale: `O padrão ${exercise.movement.pattern} demanda diretamente ${REGION_LABEL[region]}; proposta conservadora de substituição.`,
    substituteExerciseIds,
    candidateStatus: substituteExerciseIds.length ? 'ready' : 'missing_exercise_candidate',
    humanReview: {
      required: true,
      priority: substituteExerciseIds.length ? 'normal' : 'high',
      reason: substituteExerciseIds.length
        ? 'Validar a decisão e cada candidato contra todas as limitações e o contexto.'
        : 'Não há candidato catalogado suficientemente próximo; revisar gap prioritariamente.',
    },
  };
}

const exercises = [...usedIds].sort().map((exerciseId) => {
  const exercise = catalogById.get(exerciseId);
  const matrix = triageRows.get(exerciseId);
  if (!exercise || !matrix) throw new Error(`Exercise missing from catalog or triage matrix: ${exerciseId}`);
  return {
    exerciseId,
    exerciseName: exercise.name.ptBR,
    catalogContext: {
      movementPattern: exercise.movement.pattern,
      primaryMuscle: exercise.target.primaryMuscle,
      equipment: exercise.equipment,
      bodyPosition: exercise.bodyPosition ?? null,
    },
    regions: Object.fromEntries(REGIONS.map((region) => [
      region,
      { structuralTriage: matrix.triage[region], ...proposedRule(exercise, region, matrix.triage[region]) },
    ])),
  };
});

const flat = exercises.flatMap((exercise) => REGIONS.map((region) => ({
  exerciseId: exercise.exerciseId,
  exerciseName: exercise.exerciseName,
  region,
  ...exercise.regions[region],
})));

const countBy = (key, values) => Object.fromEntries(values.map((value) => [
  value,
  flat.filter((item) => item[key] === value).length,
]));
const statusCounts = countBy('status', ['compatible', 'avoid', 'adapt', 'not_applicable', 'unknown']);
const confidenceCounts = countBy('confidence', ['high', 'medium', 'low']);
const unknown = flat.filter((item) => item.status === 'unknown');
const adaptations = flat.filter((item) => item.status === 'adapt');
const avoidWithoutSubstitute = flat.filter((item) => item.status === 'avoid' && item.substituteExerciseIds.length === 0);
const lowConfidence = flat.filter((item) => item.confidence === 'low');
const outOfScopeCandidates = [...new Set(flat.flatMap((item) => item.substituteExerciseIds ?? [])
  .concat(flat.flatMap((item) => item.adaptation ? [item.adaptation.exerciseId] : []))
  .filter((id) => !usedIds.has(id)))].sort();

const validation = {
  exactly71Exercises: exercises.length === 71,
  exactly497Pairs: flat.length === 497,
  allExerciseIdsExist: exercises.every((exercise) => catalogById.has(exercise.exerciseId)),
  allSubstituteExerciseIdsExist: flat.every((item) =>
    (item.substituteExerciseIds ?? []).every((id) => catalogById.has(id))),
  noAdaptWithoutConcreteVariant: flat.every((item) => item.status !== 'adapt' || (
    item.adaptation?.kind === 'exercise_variant' &&
    catalogById.has(item.adaptation.exerciseId) &&
    item.adaptation.exerciseId !== item.exerciseId
  )),
  noAvoidWithInventedExercise: flat.every((item) => item.status !== 'avoid' ||
    (item.substituteExerciseIds ?? []).every((id) => catalogById.has(id))),
  sevenRegionsPerExercise: exercises.every((exercise) =>
    Object.keys(exercise.regions).length === 7 && REGIONS.every((region) => exercise.regions[region])),
  allPairsPendingHumanReview: flat.every((item) => item.humanReview?.required === true),
  noProfessionalApprovalClaim: true,
};

const failedValidations = Object.entries(validation).filter(([, passed]) => !passed).map(([name]) => name);
if (failedValidations.length) throw new Error(`Phase 1 validation failed: ${failedValidations.join(', ')}`);

const dataset = {
  datasetVersion: 'phase1-proposal-v1',
  generatedAt: '2026-08-25',
  sourceProtocol: 'musculoskeletal-v1',
  scope: { templates: 'T001-T090', catalogExerciseCount: EXERCISES_SEED.length, usedExerciseCount: exercises.length, regionCount: REGIONS.length, pairCount: flat.length },
  reviewState: {
    status: 'PROPOSED_PENDING_HUMAN_REVIEW',
    clinicalApproval: false,
    firestoreReady: false,
    disclaimer: 'Heurística documental para revisão. Não constitui avaliação, prescrição ou aprovação clínica.',
  },
  semantics: {
    compatible: 'Pode permanecer como proposta; exige confirmação humana.',
    avoid: 'Substituir como proposta; candidatos ordenados não são automaticamente seguros.',
    adapt: 'Usar somente a variante catalogada indicada; exige confirmação humana.',
    not_applicable: 'Região proposta como não material; não afirma segurança clínica.',
    unknown: 'Informação insuficiente; falhar fechado em eventual runtime futuro.',
  },
  sources: [
    'docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json',
    'src/data/exercisesSeedData.ts',
    'docs/workout-modifiers/exercise-limitations/01_LIMITATION_SCHEMA.md',
    'docs/workout-modifiers/exercise-limitations/03_SUBSTITUTION_STRATEGY.md',
    'docs/workout-modifiers/exercise-limitations/06_MUSCULOSKELETAL_RELEVANCE_MATRIX.md',
  ],
  summary: { statusCounts, confidenceCounts, unknownCount: unknown.length, adaptCount: adaptations.length, avoidWithoutSubstituteCount: avoidWithoutSubstitute.length, lowConfidenceCount: lowConfidence.length },
  validation,
  exercises,
};

function groupedRegions(items) {
  const grouped = new Map();
  for (const item of items) {
    const list = grouped.get(item.exerciseId) ?? [];
    list.push(`\`${item.region}\``);
    grouped.set(item.exerciseId, list);
  }
  if (!grouped.size) return '_Nenhum._';
  return [...grouped.entries()].map(([id, regions]) => `- \`${id}\`: ${regions.join(', ')}`).join('\n');
}

const summaryMd = `# Fase 1 — resumo do dataset proposto\n\n` +
`Estado: \`PROPOSED_PENDING_HUMAN_REVIEW\`. Este material **não é aprovação clínica**, não está pronto para Firestore e não autoriza runtime. A classificação usa os contratos existentes, a triagem estrutural e metadados do catálogo. Como a entrada informa apenas uma região, sem diagnóstico, gravidade ou sintomas, as decisões de baixa confiança e os candidatos devem ser revisados por profissional habilitado.\n\n` +
`Referências externas de enquadramento: o [CDC recomenda orientação individualizada](https://www.cdc.gov/physical-activity-basics/guidelines/chronic-health-conditions-and-disabilities.html) para condições crônicas/deficiências e descreve caminhada e ciclismo como atividades de baixo estresse articular, sem torná-las universais para toda limitação; a [OMS registra mais de 150 condições musculoesqueléticas](https://www.who.int/news-room/fact-sheets/detail/musculoskeletal-conditions), razão pela qual região isolada não equivale a diagnóstico.\n\n` +
`## Cobertura validada\n\n` +
`- Exercícios: **${exercises.length}**\n- Regiões: **${REGIONS.length}**\n- Pares exercício × região: **${flat.length}**\n- Catálogo usado para validar IDs: **${EXERCISES_SEED.length} exercícios**\n\n` +
`## Distribuição por status\n\n| Status | Quantidade |\n|---|---:|\n${Object.entries(statusCounts).map(([key, value]) => `| \`${key}\` | ${value} |`).join('\n')}\n| **Total** | **${flat.length}** |\n\n` +
`## Distribuição por confidence\n\n| Confidence | Quantidade |\n|---|---:|\n${Object.entries(confidenceCounts).map(([key, value]) => `| \`${key}\` | ${value} |`).join('\n')}\n| **Total** | **${flat.length}** |\n\n` +
`## Todos os unknown (${unknown.length})\n\n${groupedRegions(unknown)}\n\n` +
`## Todos os adapt (${adaptations.length})\n\n| Exercício | Região | Variante concreta | Justificativa |\n|---|---|---|---|\n${adaptations.map((item) => `| \`${item.exerciseId}\` | \`${item.region}\` | \`${item.adaptation.exerciseId}\` | ${item.rationale} |`).join('\n') || '| — | — | — | Nenhum |'}\n\n` +
`## Avoid sem substituto (${avoidWithoutSubstitute.length})\n\n${groupedRegions(avoidWithoutSubstitute)}\n\n` +
`## Decisões low confidence (${lowConfidence.length})\n\n${groupedRegions(lowConfidence)}\n\n` +
`## Revisão prioritária\n\n` +
`Prioridade máxima: todos os \`unknown\`, todos os \`adapt\`, todos os \`avoid\` sem candidato e todas as decisões \`compatible\` de baixa confiança. Também exigem perfil integral antes de uso os candidatos/variantes fora dos 71 atuais:\n\n` +
`${outOfScopeCandidates.length ? outOfScopeCandidates.map((id) => `- \`${id}\``).join('\n') : '_Nenhum._'}\n\n` +
`Nenhum substituto desta proposta é automaticamente seguro para outra região. A ordem apenas preserva propósito/padrão e privilegia variantes simples do catálogo; o resolver futuro deverá revalidar todas as limitações, equipamento, ambiente, status e availability.\n\n` +
`## Validações do artefato\n\n` +
`- [x] exatamente 71 exercícios\n- [x] exatamente 497 pares\n- [x] todos os exerciseIds existem entre os 116\n- [x] todos os substituteExerciseIds existem entre os 116\n- [x] nenhum \`adapt\` sem \`adaptation.kind=exercise_variant\` e variante existente\n- [x] nenhum \`avoid\` referencia exercício inventado\n- [x] dataset marcado como proposta pendente, sem aprovação profissional\n- [x] nenhuma escrita no Firestore; nenhum runtime ou Rule alterado\n`;

writeFileSync(OUTPUT_JSON, `${JSON.stringify(dataset, null, 2)}\n`);
writeFileSync(OUTPUT_MD, summaryMd);

console.log(JSON.stringify({
  outputFiles: [OUTPUT_JSON, OUTPUT_MD],
  exercises: exercises.length,
  pairs: flat.length,
  statusCounts,
  confidenceCounts,
  unknown: unknown.length,
  adaptations: adaptations.length,
  avoidWithoutSubstitute: avoidWithoutSubstitute.length,
  lowConfidence: lowConfidence.length,
  outOfScopeCandidates,
  validation,
}, null, 2));
