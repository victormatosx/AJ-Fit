# Limitation Dataset Audit

Generated: 2026-08-27T14:30:04.962Z

Formal, mechanical audit of `15_LIMITATION_PROFILES_TECHNICAL_v2.json` run against the
real, unmodified `resolveExerciseLimitations()`/`validateLimitationProfile()` from
`src/workoutPrescription/limitationResolver.ts` — no resolver logic was reimplemented,
and nothing in the dataset, resolver, or prescription engine was changed by this audit.

## Resumo executivo

- **497** combinações `exerciseId × region` analisadas (71 exercícios realmente alcançáveis pelos 90 templates T001–T090 × 7 regiões).
- **176** combinações não produzem uma decisão válida (**35.4%**).
- Cobertura de profiles: **76/116** exercícios revisados; dos **40** não revisados, **0** aparecem em templates reais.
- Das falhas: **0** vêm de exercícios-fonte sem profile (revisão incompleta); **176** estão DENTRO dos exercícios já supostamente revisados (inconsistência interna, não apenas cobertura incompleta).
- Prioridade: **P0=32**, P1=46, P2=63, P3=35.
  (thresholds por percentil de alcance em templates: P0 ≥ p90 OU super node com ≥3 dependentes; P1 ≥ p60; P2 ≥ p25; P3 abaixo disso.
  Esta matriz só cobre exercícios já alcançáveis pelos templates atuais — "não alcançável" do enunciado não se aplica aqui por definição.)

**Nenhuma correção clínica foi feita nesta fase.** Este documento é insumo para revisão de conteúdo.

## Categorias de falha (root cause)

| Causa raiz | Combinações | Exercícios únicos | Regiões | Templates afetados |
|---|---:|---:|---|---:|
| F — `avoid` rule with no persisted substitute candidates (documented dataset gap) | 110 | 59 | ankle_foot, back, elbow, hip, knee, shoulder, wrist | 90 |
| B — adapt target is itself `adapt` (chain/cycle, non-recursive resolver cannot follow it) | 53 | 30 | back, elbow, hip, shoulder, wrist | 90 |
| A — adapt target is itself marked `avoid` for the same region | 8 | 6 | ankle_foot, back, knee, shoulder | 90 |
| E — adapt target rejected on purpose/availability/equipment grounds | 5 | 3 | ankle_foot, hip, knee, shoulder, wrist | 32 |

> Distinção importante: categorias F/G (`avoid` sem substituto utilizável) são decisões
> **independentes** — cada uma exige revisão própria. Categorias A/B/C/D (alvo de `adapt`
> quebrado) **concentram-se em poucos exercícios "super node"** — corrigir o alvo resolve
> várias falhas de uma vez (ver seção seguinte).

## Super nodes — exercícios/targets que mais propagam falhas

| Target | Região | Falhas causadas | Exercícios que dependem dele |
|---|---|---:|---|
| `resistance-band-row` (Remada com Elástico) | elbow | 5 | cable-rear-delt-fly, iso-lateral-row-machine, low-cable-row-wide-neutral-grip, one-arm-dumbbell-row, unilateral-iso-lateral-row-machine |
| `resistance-band-row` (Remada com Elástico) | wrist | 5 | cable-rear-delt-fly, iso-lateral-row-machine, low-cable-row-wide-neutral-grip, one-arm-dumbbell-row, unilateral-iso-lateral-row-machine |
| `seated-resistance-band-shoulder-press` (Desenvolvimento com Elástico Sentado) | shoulder | 3 | dumbbell-shoulder-press, machine-shoulder-press, resistance-band-shoulder-press |
| `seated-resistance-band-shoulder-press` (Desenvolvimento com Elástico Sentado) | elbow | 3 | dumbbell-shoulder-press, machine-shoulder-press, resistance-band-shoulder-press |
| `resistance-band-lat-pulldown` (Puxada com Elástico) | shoulder | 2 | bar-lat-pulldown, v-bar-pulldown |
| `resistance-band-lat-pulldown` (Puxada com Elástico) | elbow | 2 | bar-lat-pulldown, v-bar-pulldown |
| `resistance-band-lat-pulldown` (Puxada com Elástico) | wrist | 2 | bar-lat-pulldown, v-bar-pulldown |
| `chair-squat` (Agachamento até a Cadeira) | back | 2 | barbell-back-squat, goblet-squat |
| `dead-bug` (Dead Bug) | knee | 2 | bird-dog, plank |
| `dead-bug` (Dead Bug) | shoulder | 2 | bird-dog, plank |
| `triceps-rope-pushdown` (Tríceps Corda) | elbow | 2 | cable-triceps-pushdown, dumbbell-overhead-triceps-extension |
| `hip-hinge-drill` (Dobradiça de Quadril) | hip | 2 | conventional-deadlift, dumbbell-stiff-leg-deadlift |
| `hip-hinge-drill` (Dobradiça de Quadril) | back | 2 | conventional-deadlift, dumbbell-stiff-leg-deadlift |
| `seated-resistance-band-shoulder-press` (Desenvolvimento com Elástico Sentado) | wrist | 2 | machine-shoulder-press, resistance-band-shoulder-press |
| `machine-shoulder-press` (Desenvolvimento Máquina) | wrist | 2 | dumbbell-shoulder-press, seated-resistance-band-shoulder-press |
| `hammer-curl` (Rosca Martelo) | elbow | 2 | ez-bar-biceps-curl, seated-dumbbell-curl |
| `seated-hip-abductor-machine` (Cadeira Abdutora) | hip | 2 | mini-band-hip-abduction, supported-hip-abduction |
| `resistance-band-row` (Remada com Elástico) | shoulder | 1 | cable-rear-delt-fly |
| `hip-hinge-drill` (Dobradiça de Quadril) | wrist | 1 | conventional-deadlift |
| `machine-lateral-raise` (Elevação Lateral Máquina) | shoulder | 1 | dumbbell-lateral-raise |

## Impacto por região

| Região | Analisado | Válido | Inválido | % falha | Principais responsáveis |
|---|---:|---:|---:|---:|---|
| knee | 71 | 53 | 18 | 25.4% | dead-bug(3), conventional-deadlift(1), dumbbell-stiff-leg-deadlift(1), farmers-walk(1), controlled-marching(1) |
| hip | 71 | 48 | 23 | 32.4% | hip-hinge-drill(2), seated-hip-abductor-machine(2), bird-dog(1), dead-bug(1), farmers-walk(1) |
| back | 71 | 18 | 53 | 74.6% | chair-squat(3), hip-hinge-drill(2), bench-step-up(1), bodyweight-squat(1), bulgarian-split-squat(1) |
| shoulder | 71 | 47 | 24 | 33.8% | dead-bug(3), seated-resistance-band-shoulder-press(3), resistance-band-lat-pulldown(2), cable-triceps-pushdown(2), resistance-band-row(1) |
| elbow | 71 | 49 | 22 | 31.0% | resistance-band-row(5), seated-resistance-band-shoulder-press(3), resistance-band-lat-pulldown(2), triceps-rope-pushdown(2), hammer-curl(2) |
| wrist | 71 | 53 | 18 | 25.4% | resistance-band-row(5), resistance-band-lat-pulldown(2), machine-shoulder-press(2), seated-resistance-band-shoulder-press(2), hip-hinge-drill(1) |
| ankle_foot | 71 | 53 | 18 | 25.4% | seated-leg-curl-machine(2), conventional-deadlift(1), dumbbell-stiff-leg-deadlift(1), farmers-walk(1), controlled-marching(1) |

## Impacto por família de templates (blocos de 12)

| Família | Templates | Templates com algum risco | Total de blockers |
|---|---:|---:|---:|
| T001–T012 | 12 | 12 | 560 |
| T013–T024 | 12 | 12 | 642 |
| T025–T036 | 12 | 12 | 513 |
| T037–T048 | 12 | 12 | 555 |
| T049–T060 | 12 | 12 | 406 |
| T061–T072 | 12 | 12 | 490 |
| T073–T084 | 12 | 12 | 471 |
| T085–T090 | 6 | 6 | 155 |

## Top 10 templates com mais blockers

| Template | Regiões em risco | Total de blockers |
|---|---:|---:|
| T018 | 7/7 | 66 |
| T024 | 7/7 | 65 |
| T042 | 7/7 | 63 |
| T048 | 7/7 | 62 |
| T016 | 7/7 | 60 |
| T017 | 7/7 | 60 |
| T030 | 7/7 | 60 |
| T006 | 7/7 | 59 |
| T023 | 7/7 | 59 |
| T036 | 7/7 | 59 |

## Matriz de revisão clínica — Top 20 decisões prioritárias

Cada linha é uma decisão de conteúdo/clínica pendente. As opções listadas são
**categorias de decisão**, não uma escolha feita por esta auditoria.

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`) × knee

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 80 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`) × hip

- **Current rule**: `adapt` → `hip-hinge-drill`
- **Target status for hip**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:hip
- **Templates affected**: 80 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`) × back

- **Current rule**: `adapt` → `hip-hinge-drill`
- **Target status for back**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:back
- **Templates affected**: 80 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`) × shoulder

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 80 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`) × ankle_foot

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 80 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Prancha (`plank`) × knee

- **Current rule**: `adapt` → `dead-bug`
- **Target status for knee**: `avoid`
- **Problem**: LIMITATION_CANDIDATE_AVOID:knee
- **Templates affected**: 60 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Prancha (`plank`) × hip

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 60 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Prancha (`plank`) × shoulder

- **Current rule**: `adapt` → `dead-bug`
- **Target status for shoulder**: `avoid`
- **Problem**: LIMITATION_CANDIDATE_AVOID:shoulder
- **Templates affected**: 60 (T001, T002, T003, T004, T005, T006, T007, T008, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Agachamento Goblet (`goblet-squat`) × back

- **Current rule**: `adapt` → `chair-squat`
- **Target status for back**: `avoid`
- **Problem**: LIMITATION_CANDIDATE_AVOID:back
- **Templates affected**: 48 (T007, T008, T009, T010, T011, T012, T019, T020, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Agachamento Goblet (`goblet-squat`) × wrist

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 48 (T007, T008, T009, T010, T011, T012, T019, T020, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Elevação Pélvica (`hip-thrust`) × knee

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 48 (T007, T008, T009, T010, T011, T012, T013, T014, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Elevação Pélvica (`hip-thrust`) × hip

- **Current rule**: `adapt` → `glute-bridge`
- **Target status for hip**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:hip
- **Templates affected**: 48 (T007, T008, T009, T010, T011, T012, T013, T014, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Elevação Pélvica (`hip-thrust`) × back

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 48 (T007, T008, T009, T010, T011, T012, T013, T014, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Elevação Pélvica (`hip-thrust`) × ankle_foot

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 48 (T007, T008, T009, T010, T011, T012, T013, T014, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Desenvolvimento com Halteres (`dumbbell-shoulder-press`) × back

- **Current rule**: `avoid`
- **Substitute candidates listed**: (none)
- **Problem**: avoid rule has no persisted substitute candidates (candidateStatus=missing_exercise_candidate) — documented dataset gap, not a resolver defect
- **Templates affected**: 47 (T007, T008, T009, T010, T011, T012, T019, T020, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Desenvolvimento com Halteres (`dumbbell-shoulder-press`) × shoulder

- **Current rule**: `adapt` → `seated-resistance-band-shoulder-press`
- **Target status for shoulder**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:shoulder
- **Templates affected**: 47 (T007, T008, T009, T010, T011, T012, T019, T020, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Desenvolvimento com Halteres (`dumbbell-shoulder-press`) × elbow

- **Current rule**: `adapt` → `seated-resistance-band-shoulder-press`
- **Target status for elbow**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:elbow
- **Templates affected**: 47 (T007, T008, T009, T010, T011, T012, T019, T020, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Desenvolvimento com Halteres (`dumbbell-shoulder-press`) × wrist

- **Current rule**: `adapt` → `machine-shoulder-press`
- **Target status for wrist**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:wrist
- **Templates affected**: 47 (T007, T008, T009, T010, T011, T012, T019, T020, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Remada Articulada (`iso-lateral-row-machine`) × elbow

- **Current rule**: `adapt` → `resistance-band-row`
- **Target status for elbow**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:elbow
- **Templates affected**: 37 (T001, T002, T003, T004, T005, T006, T008, T009, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

### [P0] Remada Articulada (`iso-lateral-row-machine`) × wrist

- **Current rule**: `adapt` → `resistance-band-row`
- **Target status for wrist**: `adapt`
- **Problem**: LIMITATION_CANDIDATE_ADAPT:wrist
- **Templates affected**: 37 (T001, T002, T003, T004, T005, T006, T008, T009, …)
- **Clinical decision required** — choose one:
  - mark the exercise directly `compatible`/`not_applicable` for this region;
  - provide a different, clinically-reviewed adaptation target;
  - confirm `avoid` with a real safe substitute;
  - other clinically reviewed rule.

## Cobertura dos 116 exercícios

- 76 exercícios têm `limitationProfile`; 40 não têm.
- Dos 40 não revisados, 0 são efetivamente usados por algum template — esses geram `MISSING_PROFILE` sempre que um usuário com QUALQUER limitação os alcança.
- **176 das 176 falhas ocorrem dentro do conjunto já "revisado"** — ou seja, o problema não é só terminar a revisão dos 40 que faltam; há inconsistência dentro do que já foi considerado pronto.

## Proposta de Quality Gate futuro

**Não ative isso agora com falha obrigatória** — o dataset tem dívida técnica conhecida
(atualmente 176 combinações inválidas). Um CI que falhasse imediatamente
bloquearia todo o projeto por um problema pré-existente, não introduzido pelo PR em análise.

Proposta de **baseline decrescente** (estratégia adequada para este caso):

1. Persistir o número atual de combinações inválidas como baseline versionado
   (ex.: `docs/workout-modifiers/limitation-dataset-audit-baseline.json`, contendo
   `{ "knownInvalidCount": 176 }` e, idealmente, a lista completa das
   chaves `exerciseId:region` já conhecidas como inválidas).
2. Um teste/script de CI roda a mesma auditoria e compara contra o baseline:
   - **nova combinação inválida que NÃO estava no baseline** → falha (regressão real);
   - **contagem total menor ou igual, e nenhuma chave nova** → passa;
   - **contagem menor** (alguém corrigiu um profile) → passa E deveria abaixar o baseline
     no mesmo PR (evita a dívida voltar a subir silenciosamente).
3. Comparar por CHAVE (`exerciseId:region`), não só por contagem total — evita que uma
   correção e uma regressão não relacionadas se cancelem numericamente sem serem notadas.
4. Regras adicionais de guarda estrutural (sempre ativas, sem baseline, pois nunca devem
   ocorrer mesmo hoje):
   - todo `adaptation.exerciseId` referenciado deve existir no catálogo (categoria C/MISSING_ADAPT_TARGET —
     hoje zero casos, então isso pode já ser um gate rígido sem quebrar nada);
   - todo `substituteExerciseIds`/`adaptation.exerciseId` não pode autorreferenciar o próprio exercício
     (já garantido estruturalmente por `ruleValid` no resolver — apenas confirmar via teste dedicado);
   - todo exercício usado em algum template T001–T090 e alcançável quando o usuário declara
     `musculoskeletal_limitation` deve ter `limitationProfile` OU estar numa lista explícita de
     exceções conhecidas (torna a lista dos "40 não revisados" visível e rastreável em vez de silenciosa).
