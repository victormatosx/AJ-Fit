# Fila profissional DR-006

Status DR-006: `REVIEW_QUEUE_READY`; Gate A:
`BLOCKED_PENDING_PROFESSIONAL_REVIEW`. A triagem estrutural está pronta;
nenhuma classificação `compatible`, `adapt` ou `avoid` foi aprovada.

## Escopo real

- hipótese antiga do catálogo inteiro: 116 × 7 = 812 pares;
- escopo dos templates atuais: 71 × 7 = 497 pares;
- proposta `NOT_MATERIAL`: 197 pares, ainda sujeita à validação do reviewer;
- revisão detalhada `MATERIAL + UNCERTAIN`: **300 pares**;
- catálogo fora dos templates: 45 exercícios em lote separado.

Cada item M/U deve ser registrado na planilha/ferramenta de revisão como:

```text
exerciseId, exerciseName, region,
status, adaptation, substituteExerciseIds,
reviewStatus=PROFESSIONAL_REVIEW_REQUIRED, notes
```

`notes` é somente para reviewer/admin. Não dirige o algoritmo.

## BATCH 1 — maior impacto

20 exercícios, 1.326 referências (62,9% dos 2.108 slots), 86 pares para revisão
(54 M + 32 U):

`dumbbell-stiff-leg-deadlift`, `walking`, `hip-thrust`, `plank`,
`resistance-band-lat-pulldown`, `bar-lat-pulldown`,
`machine-flat-bench-press`, `seated-hip-abductor-machine`,
`iso-lateral-row-machine`, `goblet-squat`, `one-arm-dumbbell-row`,
`dumbbell-lateral-raise`, `dumbbell-shoulder-press`, `stationary-bike`,
`push-up`, `leg-press-45`, `ez-bar-biceps-curl`,
`iso-lateral-incline-chest-press-machine`, `machine-shoulder-press`,
`standing-calf-raise-machine`.

## BATCH 2 — impacto intermediário

20 exercícios, 570 referências, 91 pares (52 M + 39 U):

`triceps-rope-pushdown`, `barbell-back-squat`,
`bulgarian-split-squat-dumbbell`, `low-cable-row-wide-neutral-grip`,
`bench-step-up`, `dead-bug`, `resistance-band-row`,
`seated-leg-curl-machine`, `glute-bridge`, `march-in-place`, `hip-mobility`,
`incline-dumbbell-bench-press`, `cable-rear-delt-fly`, `pallof-press`,
`unilateral-iso-lateral-row-machine`, `farmers-walk`,
`dumbbell-overhead-triceps-extension`, `seated-dumbbell-curl`, `bird-dog`,
`chair-sit-to-stand`.

## BATCH 3 — restante em uso

31 exercícios, 212 referências, 123 pares (70 M + 53 U):

`mini-band-hip-abduction`, `conventional-deadlift`, `walking-lunges`,
`leg-extension-machine`, `lying-leg-curl-machine`, `hack-squat-machine`,
`supported-low-step-up`, `cable-triceps-pushdown`, `supported-calf-raise`,
`floor-crunch`, `hammer-curl`, `bodyweight-squat`,
`bulgarian-split-squat`, `low-step-up`, `supported-standing-leg-curl`,
`wall-push-up`, `controlled-marching`, `coordinated-breathing`,
`gentle-direction-changes`, `supported-semi-tandem-stance`,
`thoracic-mobility`, `v-bar-pulldown`, `weight-shift`, `chair-squat`,
`resistance-band-shoulder-press`, `seated-resistance-band-shoulder-press`,
`supported-hip-abduction`, `hip-hinge-drill`, `slider-leg-curl`,
`supported-balance`, `stationary-lunge`.

## BATCH 4 — fora dos templates

Os 45 exercícios `OUT_OF_CURRENT_TEMPLATE_SCOPE` listados na matriz devem ser
triados antes de serem aprovados como substitutos. Eles não bloqueiam a revisão
dos templates, mas um ID desse lote só pode entrar em `substituteExerciseIds`
depois de obter perfil aprovado para as sete regiões.

## Famílias sugeridas para revisão conjunta

Família ajuda a organizar o trabalho; nunca propaga classificação:

| Família estrutural | Catálogo | Em uso | Utilidade |
|---|---:|---:|---|
| squat/leg press/chair squat | 14 | 7 | comparar suporte, carga e equipamento |
| horizontal row | 10 | 5 | comparar apoio do tronco e pegadas |
| hip hinge/deadlift | 9 | 3 | comparar posição e implemento |
| biceps curl | 7 | 3 | comparar posição, pegada e apoio |
| vertical pull | 7 | 3 | comparar máquina, cabo e elástico |
| hamstring curl | 5 | 4 | comparar posição e apoio |
| horizontal press | 5 | 5 | comparar máquina, banco, chão e parede |
| lunge/split squat | 5 | 4 | comparar unilateralidade e suporte |
| hip abduction | 4 | 3 | comparar máquina, band e apoio |
| triceps extension | 4 | 3 | comparar posição do ombro e implemento |
| vertical shoulder press | 4 | 4 | comparar sentado/em pé/equipment |
| calf raise | 3 | 2 | comparar sentado, em pé e apoio |
| hip extension | 3 | 2 | comparar ponte, banco e cabo |
| lateral raise | 3 | 1 | comparar halter, cabo e máquina |
| step-up | 3 | 3 | comparar altura e apoio |

Core, gait, balance, mobility, breathing e functional/home exercises sem grupo
formal devem ser revisados como famílias próprias. Exercícios parecidos podem
ser apresentados lado a lado, mas cada perfil é aprovado individualmente.

## Checklist por exercício

1. validar os sete julgamentos de relevância, incluindo cada `NOT_MATERIAL`;
2. classificar M/U como `compatible`, `adapt`, `avoid` ou `unknown`;
3. para `adapt`, indicar uma variante existente e executável;
4. para `avoid`, ordenar candidatos reais entre todos os 116 exercícios;
5. avaliar cada candidato contra as sete regiões, equipment, environment,
   status e availability;
6. usar `MISSING_EXERCISE_CANDIDATE` quando nenhum ID existente servir;
7. aprovar o perfil integral sob `musculoskeletal-v1`.

## Decisões humanas restantes

- confirmar/rejeitar as 497 células de relevância, especialmente as 124 U;
- aprovar os 300 pares materiais/incertos;
- decidir candidatos e variantes por par;
- confirmar se cada `adapt` é realmente executável;
- identificar gaps reais somente depois de testar todos os candidatos;
- definir quem pode assumir `reviewedBy` e qual evidência interna é exigida.
