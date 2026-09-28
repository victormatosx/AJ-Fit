# Motor de prescrição T001–T090 (runtime atual)

## 1. Escopo e fontes

Esta implementação transforma o último `QuestionnaireAnswers` persistido em
uma decisão determinística de prescrição. A fonte canônica futura é
`docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_27_goal_routing_fixed.json`
(schema `1.27.0`, T001–T102). A biblioteca ativa no runtime durante a migração
continua sendo `docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json`.
As demais fontes históricas e de implementação deste motor são:

- `docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json`;
- `docs/workout-modifiers/`;
- `docs/31_questionario_entrada_t001_t090.md`;
- `src/data/exercisesSeedData.ts` e o contrato `Exercise`.

O JSON v1.3.0 permanece como histórico. Este documento descreve o comportamento
do motor ativo; a especificação futura está no JSON v1.27.

Este documento distingue `IMPLEMENTED`, `APPROVED_NOT_IMPLEMENTED`,
`FUTURE_DESIGN` e `DECISION_REQUIRED` conforme
`workout-lifecycle/00_README.md`. Prescrição, agenda e progressão são motores
separados; este arquivo descreve somente a prescrição atual e suas lacunas.

## 2. Fronteira de integração

Antes desta entrega, `AuthContext` carregava o último questionário, mas o plano
parava ali. `PlanReadyScreen` mostrava somente respostas e `WorkoutScreen`
executava uma lista demonstrativa fixa, sem vínculo com o questionário.

Agora a fronteira é:

```text
users/{uid}/questionnaires/{latest}.answers
  → input validation / legacy normalization
  → Safety Engine
  → Selection Engine
  → Modifier Engine
  → Conflict Resolution
  → Composition Engine
  → Final Validation
  → immutable local snapshot
  → PlanReady / start gate / Workout runtime
```

Safety antecede selection no orquestrador. Selection continua sendo uma função
pura independente para permitir a auditoria matricial do catálogo.

## 3. Contratos e resultados

Estados de safety:

- `CLEAR`: nenhuma constraint especial;
- `ADAPTED`: pode prosseguir somente se todos os modifiers obrigatórios forem
  executáveis;
- `REQUIRES_CLEARANCE`: não gera plano;
- `BLOCKED`: não gera plano.

Resultados do pipeline:

- `SUCCESS`;
- `NEEDS_QUESTIONNAIRE_UPDATE`;
- `REQUIRES_CLEARANCE`;
- `BLOCKED`;
- `INVALID_CONFIGURATION`;
- `MISSING_TEMPLATE`;
- `MISSING_EXERCISE`.

Estados esperados de domínio não usam exceções genéricas.

## 4. Selection Engine

A seleção pesquisa o metadata do catálogo em runtime. Ranges abaixo são uma
representação auditável da matriz encontrada, não a implementação do lookup.
Em cada linha, dias `2,3,4,5,6,7` mapeiam sequencialmente para os seis IDs.

| População | Sexo | Objetivo canônico | Ambiente | Dias → IDs |
|---|---|---|---|---|
| convencional | male | hypertrophy_body_composition | gym | 2→T001, 3→T002, 4→T003, 5→T004, 6→T005, 7→T006 |
| convencional | male | hypertrophy_body_composition | home | 2→T007, 3→T008, 4→T009, 5→T010, 6→T011, 7→T012 |
| convencional | female | hypertrophy_body_composition | gym | 2→T013, 3→T014, 4→T015, 5→T016, 6→T017, 7→T018 |
| convencional | female | hypertrophy_body_composition | home | 2→T019, 3→T020, 4→T021, 5→T022, 6→T023, 7→T024 |
| convencional | male | strength | gym | 2→T025, 3→T026, 4→T027, 5→T028, 6→T029, 7→T030 |
| convencional | male | strength | home | 2→T031, 3→T032, 4→T033, 5→T034, 6→T035, 7→T036 |
| convencional | female | strength | gym | 2→T037, 3→T038, 4→T039, 5→T040, 6→T041, 7→T042 |
| convencional | female | strength | home | 2→T043, 3→T044, 4→T045, 5→T046, 6→T047, 7→T048 |
| convencional | male | conditioning | gym | 2→T049, 3→T050, 4→T051, 5→T052, 6→T053, 7→T054 |
| convencional | male | conditioning | home | 2→T055, 3→T056, 4→T057, 5→T058, 6→T059, 7→T060 |
| convencional | female | conditioning | gym | 2→T061, 3→T062, 4→T063, 5→T064, 6→T065, 7→T066 |
| convencional | female | conditioning | home | 2→T067, 3→T068, 4→T069, 5→T070, 6→T071, 7→T072 |
| pregnancy | female | `special_population=pregnancy` | gym | 2→T073, 3→T074, 4→T075 |
| pregnancy | female | `special_population=pregnancy` | home | 2→T076, 3→T077, 4→T078 |
| postpartum | female | `special_population=postpartum` | gym | 2→T079, 3→T080, 4→T081 |
| postpartum | female | `special_population=postpartum` | home | 2→T082, 3→T083, 4→T084 |
| frailty | any | `special_population=frailty` | gym | 2→T085, 3→T086, 4→T087 |
| frailty | any | `special_population=frailty` | home | 2→T088, 3→T089, 4→T090 |

Objetivos atuais `gain_muscle`, `lose_fat` e `health` normalizam para
`hypertrophy_body_composition`. Os valores persistidos antigos
`body_composition` e `return_to_training` continuam com o mesmo mapeamento.
`strength` e `conditioning` preservam suas famílias. Experience, duração, equipamentos e
prioridade muscular não participam do lookup. O ambiente é definido diretamente por `place`
como `gym` ou `home`.

Populações especiais preservam `requestedDays`, mas usam
`prescribedStructuredDays = min(requestedDays, 4)`. Funcional é ativado por
situação funcional real, nunca por idade. Pós-parto permanece conservador na
família especial porque o questionário atual não contém um critério suficiente
para provar a transição à família convencional.

## 5. Safety Engine

| Cenário | Resposta relevante | Decisão |
|---|---|---|
| gestação sem red flag/restrição | sinais `none`, sem restrição/complicação | `ADAPTED`, base T073–T078 |
| gestação com red flag documentada | qualquer warning sign real | `BLOCKED` |
| gestação com restrição/complicação | restriction `yes` ou complication `yes/unsure` | `REQUIRES_CLEARANCE` |
| pós-parto liberado e sem sinais | clearance `yes`, signs `none` | `ADAPTED`, base T079–T084 |
| pós-parto com sinais ou sem liberação | sinal real, `not_yet` ou `with_restrictions` | `REQUIRES_CLEARANCE` |
| baixa capacidade funcional | situação funcional real | `ADAPTED`, base T085–T090 |
| cirurgia concluída e sem restrição | completed + cleared_no_restrictions | `CLEAR` em relação à cirurgia |
| cirurgia em andamento liberada sem restrição | in_progress + cleared_no_restrictions | `ADAPTED` |
| cirurgia incerta/restrita/não liberada | demais combinações conservadoras | `REQUIRES_CLEARANCE` |
| tontura histórica sem equilíbrio | history_only + no | `CLEAR` |
| tontura ocasional sem equilíbrio | occasional + no | `ADAPTED` |
| tontura relevante | frequent/current_or_recent ou balance yes/unknown | `REQUIRES_CLEARANCE` |
| lipedema sem impacto | none + guidance no | `CLEAR` |
| lipedema com impacto | mild/interferes + guidance no | `ADAPTED` |
| orientação de lipedema não representável | guidance yes/unsure | `REQUIRES_CLEARANCE` |
| limitação musculoesquelética | qualquer região declarada em `limits[]` | `ADAPTED` |
| restrição médica | yes/unsure | `REQUIRES_CLEARANCE` |

O agregador é monotônico: `BLOCKED > REQUIRES_CLEARANCE > ADAPTED > CLEAR`.
Uma regra posterior nunca enfraquece uma anterior.

## 6. Modifiers e limites operacionais

| Modifier | Prioridade | Estado implementado |
|---|---:|---|
| população pregnancy/postpartum/frailty | P1 | aplicado pela base especial |
| inventário home | P3 | aplicado com catálogo e grafo real de similares |
| experience intermediate | P4 | `IMPLEMENTED`: preserva dose base |
| experience advanced | P4 | `IMPLEMENTED`: preserva dose base |
| experience beginner/never | P4 | `IMPLEMENTED`: manter 50%/70%/100% dos exercícios; dose dos retidos permanece base |
| duration 60 | P5 | preserva sessão base |
| duration 90 | P5 | não preenche tempo artificialmente |
| lose_fat/body_composition | P6 | preserva musculação base; sem circuito/nutrição inventados |
| muscle priority | P7 | `IMPLEMENTED`: preservar/ordenar e até +1 set por priority/sessão |
| return_to_training | P2 | `IMPLEMENTED`: preserva template e não ativa beginner por si só |
| duration 30/45 | P5 | `IMPLEMENTED`: manter `ceil(n×0,60)`/`ceil(n×0,80)` exercícios |
| limitação musculoesquelética (qualquer região declarada) | P0 | `IMPLEMENTED`: Limitation Resolver V1, fail-closed |
| demais safety clínicos adaptados sem transformação estruturada | P0 | `RULE_DEFINITION_REQUIRED` |

Um modifier obrigatório sem regra completa faz o resultado final ser
`INVALID_CONFIGURATION`. Isso é intencional e implementa `DO NOT IMPROVISE`.

## 7. Equipment e exercise resolution

O inventário do questionário é normalizado para os IDs reais de `Exercise`.
Para uma incompatibilidade de equipment:

1. lê o `Exercise` fonte;
2. percorre `similarExerciseIds` na ordem canônica;
3. exige exercício ativo e habilitado para geração/substituição;
4. exige mesmo movement pattern e músculo primário;
5. exige que todo equipamento do candidato esteja disponível;
6. seleciona o primeiro candidato válido e registra a troca.

Não há query por exercício. Sem limitação musculoesquelética, a composição
continua usando o catálogo local versionado. Com limitação, o serviço carrega
os 116 documentos de `exercises` em uma única query e entrega o snapshot ao
resolver puro; candidatos de equipment também precisam ser diretamente válidos
para todas as regiões declaradas. As 2.108 referências dos 90 templates
resolvem para 71 IDs únicos existentes, com zero ausências. Quando o grafo não
possui candidato seguro para o inventário real, o motor retorna
`NO_SAFE_EQUIPMENT_SUBSTITUTE`.

## 8. Conflitos

Resoluções são dados estruturados no trace:

- return-to-training vence progressão advanced;
- safety musculoesquelético restringe muscle priority;
- 30 minutos usa priority apenas para preservar/ordenar, sem adicionar volume;
- beginner vence a tentação de preencher 90 minutos;
- lipedema + limitação exige interseção de constraints;
- safety P0 permanece antes de equipment/home e preferências.

Não existe cadeia de mutações destrutivas nem reintrodução de item bloqueado.
As decisões aprovadas não autorizam circuitos automáticos, compressão cega de
descanso ou corte dos últimos N itens para caber em 30/45 minutos.

## 9. Composição e validação final

O template é clonado para um snapshot mínimo de sessões e referências. Dose
canônica (`sets`, `reps`, `duration`) é preservada. Resolução de limitações,
substituições de equipamento e reordenação estável por prioridade são aplicadas
antes da validação.

A validação verifica:

- ID T001–T090;
- quantidade de sessões e cap especial;
- existência de todo exerciseId;
- colisão indevida causada por substituição;
- presença de dose canônica;
- modifiers obrigatórios ainda não resolvidos.

Faixas numéricas de volume/intensidade e estimativa de duração não são
"validadas" por números inventados: a necessidade correspondente permanece um
erro explícito até o produto definir essas tabelas.

## 10. Versionamento, determinismo e trace

Versões atuais:

```json
{
  "templateLibrary": "1.3.0",
  "selectionEngine": "1.0.0",
  "safetyRules": "1.0.0",
  "modifierRules": "2.0.0",
  "compositionEngine": "2.0.0",
  "limitationResolver": "1.0.0"
}
```

O `planId` é um hash estável das dimensões da prescrição, modifiers,
substituições, decisões de limitações, decisões de composição, estágio beginner
e versões. Week 3+ normaliza para estágio 3. Não existe aleatoriedade. O trace
contém reason codes, seleção, safety, modifiers aplicados/não resolvidos,
conflitos, substituições, `limitationResolverVersion: 1`, decisões de limitações
e resultado da validação. O snapshot registra a decisão, não copia o profile.
Respostas completas, PII e texto médico livre não são logados.

`generateWorkoutPrescription(answers, { adaptationWeek })` recebe o estágio de
lifecycle sem adicioná-lo ao questionário. Para novo beginner, ausência do
contexto significa Week 1. Usuários não beginner ignoram esse contexto.

Exemplo anonimizado:

```json
{
  "templateId": "T008",
  "versions": { "templateLibrary": "1.3.0", "selectionEngine": "1.0.0" },
  "trace": {
    "selectionReasons": ["population:conventional", "sex:male", "environment:home", "structured_days:3"],
    "safety": { "status": "CLEAR", "reasons": [], "protectedConstraints": [] },
    "appliedModifiers": ["equipment:available_inventory", "experience:intermediate", "duration:60"],
    "substitutions": [
      { "fromExerciseId": "iso-lateral-row-machine", "toExerciseId": "bent-over-dumbbell-row", "reasonCode": "EQUIPMENT_UNAVAILABLE" }
    ]
  }
}
```

## 11. Persistência

As Firestore Rules atuais declaram campos de treino como backend-only e não há
collection cliente existente para planos. Alterá-las exigiria uma decisão e
validação humana separadas. Por isso, esta fase usa o padrão local já presente
no workout runtime:

```text
ajfit-workout-prescription-v1:{uid}:{planId} → snapshot final imutável
ajfit-workout-prescription-v1:{uid}:questionnaire:{questionnaireId} → planId ativo para aquela avaliação
```

O snapshot guarda `templateId`, versões, dias solicitados/prescritos, população,
ambiente, família, split, sessões finais, exerciseIds e trace. Não guarda o
questionário ou PII. Uma nova prescrição cria outro `planId`; snapshots
existentes não são sobrescritos. O runtime relê o snapshot associado ao mesmo
questionário antes de gerar; assim um plano antigo não muda se o JSON ou a regra
futura mudar. Uma nova avaliação possui outro `questionnaireId` e gera sua
própria prescrição. A exclusão de conta remove todos os snapshots daquele uid
antes do logout local.

## 12. Legacy e UX

Legacy `hyper`, `cut`, `def` e `recon` normalizam para objetivos inequívocos.
`beg`, `int`, `adv` e `elite` normalizam para experience sem mudar Txxx.
`perf` é ambíguo entre força/condicionamento e retorna
`NEEDS_QUESTIONNAIRE_UPDATE`.

`PlanReadyScreen` e o modal de início usam i18n pt-BR/en/es. Clearance e blocked
nunca abrem `WorkoutScreen`. Falta de dados pede atualização; regra ausente
explica que nenhum treino genérico foi gerado. Um `SUCCESS` abre o runtime com
os exercícios da primeira sessão do snapshot real. Como o catálogo não contém
intervalos numéricos de descanso, o countdown demonstrativo é desativado em vez
de prescrever 60/90 segundos inventados.

## 13. Fronteira de ciclo de vida e decisões abertas

O motor de prescrição não implementa progressão, ciclos automáticos nem
reavaliação pós-parto. Agenda (Schedule Engine) está `IMPLEMENTED_V1` como
motor separado — ver `workout-lifecycle/03_SCHEDULE_ENGINE.md`; ele consome o
programa ativo já persistido, sem alterar Selection/Safety/Modifiers/
Composition. Essas responsabilidades estão documentadas em `workout-lifecycle/`.

Os estados atuais estão em `workout-lifecycle/07_OPEN_DECISIONS.md`. A
simplificação V1 substituiu DR-001/002/003/016/021; DR-015 está resolvido pela
regra aproximada de contagem. DR-023/024/026 foram cancelados e DR-025 deixou de
bloquear Prescription V1. DR-005/019/022 permanecem resolvidos; DR-004 está
`RESOLVED_IMPLEMENTED_V1` e DR-006 foi resolvido para o comportamento
conservador de produto V1, sem alegação de aprovação profissional.

A persistência V1 de templates e programas está implementada conforme
`workout-lifecycle/05_PERSISTENCE_AND_VERSIONING.md`. Questionários com regiões
canônicas agora passam pelo Limitation Resolver e só geram plano quando todos
os slots terminam válidos. Profile ausente/inválido e `other` continuam
fail-closed. A mudança local correspondente das Rules está testada, mas não foi
publicada porque o ruleset completo contém alterações pendentes de outros
fluxos; status `RULESET_DEPLOY_PENDING`.

## 14. Equipamento e limitações: V1 implementada

O Limitation Resolver consome os profiles estruturados no catálogo real,
intersecta todas as regiões e aplica somente variantes/substitutos por
`exerciseId`. Candidatos são revalidados diretamente contra profile,
disponibilidade, purpose e equipment. Substituições não encadeiam: se B falha,
o resolver tenta o próximo candidato original de A, com proteção de visitados.
Ausência de profile, profile draft, versão desconhecida ou região ausente falham
fechado; sem limitação musculoesquelética, a ausência não afeta o usuário. O
contrato, as matrizes históricas e o relatório de implementação estão em
`exercise-limitations/`.

## 15. Contrato simplificado V1

O modelo atual está em
`workout-modifiers/06_NORMALIZED_DOSE_AND_SESSION_MODEL.md`. Beginner e duration
reduzem a quantidade de exercícios pela ordem do template. Priority funciona
como sinal de preservação/ordenação e pode adicionar no máximo +1 set por
priority/sessão fora de beginner/30. Não há RIR, timing engine, `slotRole`,
budget +20% ou dose normalizada obrigatória. `return_to_training` não ativa
beginner e 90 minutos não obriga expansão.

A ordem de expansão do catálogo é: exercício original → substituição existente
validada → criação de exercício somente depois de um gap demonstrado.

## 16. v1.27 (Fase 2/3) — desligado do runtime produtivo

Artefatos preparatórios para a futura migração T001–T102/schema `1.27.0`,
todos opt-in e não referenciados pelo caminho produtivo (`catalog.ts` continua
carregando `AJ_Fit_T001_T090_workouts_reformed_v2_0.json`/`2.0.0`):

- `docs/workouts/AJ_Fit_v1_27_exercise_identity_matrix.json` — reconciliação
  determinística dos 78 `exercise_id` referenciados diretamente pelos
  templates v1.27 contra o catálogo runtime (`EXERCISES_SEED`), com status
  `EXACT_MATCH` / `SEMANTIC_ALIAS_CONFIRMED` / `AMBIGUOUS` / `TRULY_MISSING`
  por item. Consumida somente por `canonicalExerciseIdentity.ts`
  (`resolveCanonicalExerciseId`), nunca por lookup textual em runtime.
- `canonicalCatalog.ts` — adaptador local que faz o parse de um template
  v1.27 bruto para o `CanonicalTemplate` do motor atual (normaliza
  `sets`/ciclos, resolve identidade de exercício, falha fechado em qualquer
  `exercise_id` ainda bloqueado na matriz).
- `selectorV127.ts` — selector puro de template-base (Fase 3): recebe
  sexo/ambiente/família de objetivo/população/beginner/dias e devolve o
  `templateId` T001–T102 correspondente, sem tocar em sets, reps, descanso,
  exercícios, cardio, duration, equipamento ou limitações — essas
  permanecem modifiers que rodam depois da seleção. Não decide safety/
  população especial; consome o resultado já calculado por
  `selection.ts`/`safety.ts`.
- `sessionTypes.ts` — classificação central de tipos de sessão
  (`isRecoverySessionType`, `isCardioDominantSessionType`), usada tanto pelo
  motor v2.0 ativo quanto pelo parser v1.27, para que `active_recovery` seja
  tratado como recuperação em todo o pipeline (frequência, cardio finisher,
  agenda semanal) sem duplicar essa lista em cada consumidor.

Ativação em produção, remoção dos modifiers legados incompatíveis e migração
de planos existentes são passos futuros fora deste escopo.
