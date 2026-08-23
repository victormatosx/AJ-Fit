# AJ Fit --- Exemplos de Composição de Treinos

## 1. Objetivo

Este documento demonstra como treino-base, modificadores, prioridades e
substituições devem interagir.

Os exemplos são **testes conceituais**. Quando números exatos ainda não
foram especificados pelos documentos de regras, o exemplo descreve a
operação sem inventar um valor de produção.

------------------------------------------------------------------------

# Exemplo 1 --- Hipertrofia masculina, iniciante, 45 min

## Entrada

``` yaml
sex_profile: male
goal: hypertrophy_body_composition
environment: gym
days_per_week: 3
experience: beginner
session_duration: 45
limitations: []
```

## Base

``` text
T002
```

## Modificadores

``` text
MOD-EXP-001
MOD-TIME-002
```

## Composição

1.  preservar Push/Pull/Legs;
2.  simplificar variantes quando necessário;
3.  usar volume inicial compatível com iniciante;
4.  remover acessórios redundantes se a sessão exceder 45 min;
5.  não transformar PPL em circuito.

## Resultado esperado

``` text
RESOLVED
```

------------------------------------------------------------------------

# Exemplo 2 --- Hipertrofia feminina com preferência por glúteos

## Entrada

``` yaml
sex_profile: female
environment: gym
days_per_week: 4
goal: hypertrophy_body_composition
experience: intermediate
muscle_emphasis: [glutes]
session_duration: 60
```

## Base

``` text
T015
```

A família já possui ênfase padrão em glúteos/inferiores.

## Regra

Não adicionar volume automaticamente.

Ordem:

``` text
verificar ênfase já existente
→ escolher variantes mais alinhadas
→ redistribuir acessório se necessário
→ adicionar volume somente se houver orçamento
```

## Resultado

Treino continua completo, sem virar programa exclusivo de glúteos.

------------------------------------------------------------------------

# Exemplo 3 --- Hipertrofia masculina + joelho + preferência por quadríceps

## Entrada

``` yaml
base: T003
knee_limitation: true
aggravating_movements: [...]
muscle_emphasis: [quads]
```

## Prioridade

``` text
KNEE P2 > QUAD PREFERENCE P7
```

## Processo

``` text
exercício original
→ filtrar candidatos compatíveis com joelho
→ filtrar equipamento
→ dentro dos candidatos válidos, escolher opção com melhor ênfase em quadríceps
```

A preferência nunca reintroduz exercício bloqueado.

------------------------------------------------------------------------

# Exemplo 4 --- Força masculina, 30 min

## Entrada

``` yaml
base: T027
session_duration: 30
experience: intermediate
```

## Regra

Não reduzir descanso dos principais até descaracterizar força.

Ordem:

``` text
movimento principal
→ segundo prioritário
→ assistência
→ acessórios
```

Acessórios são removidos/reduzidos antes de transformar a sessão em
circuito.

------------------------------------------------------------------------

# Exemplo 5 --- Força em casa sem barra

## Entrada

``` yaml
base: T033
environment: home
equipment:
  - DUMBBELLS
  - BENCH
  - RESISTANCE_BANDS
no_barbell: true
```

## Processo

Movimentos que exigiriam barra consultam o grafo de substituição.

Critérios:

``` text
pattern
goal=strength
available equipment
skill
stability
progression potential
```

Não escolher automaticamente elástico se halter oferece alternativa mais
adequada.

------------------------------------------------------------------------

# Exemplo 6 --- Condicionamento + baixo impacto

## Entrada

``` yaml
base: T051
impact_tolerance: no_high_impact
cardio_preference: running
```

## Prioridade

``` text
NO_HIGH_IMPACT P2 > RUNNING PREFERENCE P7
```

## Resultado conceitual

A corrida deixa de ser candidata.

O motor busca modalidade de baixo impacto capaz de preservar o bloco
cardiovascular/intervalado.

------------------------------------------------------------------------

# Exemplo 7 --- Condicionamento em casa sem máquina de cardio

## Entrada

``` yaml
base: T058
equipment:
  - BODYWEIGHT
  - RESISTANCE_BANDS
no_cardio_machine: true
```

## Regra

"Casa" não significa ausência de cardio.

Candidatos podem incluir caminhada ou outra modalidade compatível com
impacto e contexto.

------------------------------------------------------------------------

# Exemplo 8 --- Iniciante + 30 min + equipamento reduzido

## Entrada

``` yaml
base: T019
experience: beginner
session_duration: 30
equipment:
  - DUMBBELLS
  - RESISTANCE_BANDS
```

## Erro a evitar

``` text
beginner -40%
time -40%
equipment removes 2 exercises
```

## Processo correto

``` text
1. adaptar exercícios ao equipamento
2. definir target de complexidade/volume para iniciante
3. classificar ESSENTIAL/HIGH/ACCESSORY/OPTIONAL
4. encaixar estrutura mínima em 30 min
5. validar cobertura
```

------------------------------------------------------------------------

# Exemplo 9 --- Gestação + experiência avançada

## Entrada

``` yaml
base: T074
pregnancy: true
experience: advanced
```

## Ordem

``` text
PREGNANCY_SAFETY_GATE
→ pregnancy constraints
→ experience
```

Experiência avançada pode preservar maior familiaridade e capacidade
dentro do envelope permitido.

Não remove constraints gestacionais.

------------------------------------------------------------------------

# Exemplo 10 --- Gestação + red flag

## Entrada

``` yaml
base: T073
pregnancy: true
runtime_symptom: vaginal_bleeding
```

## Resultado

``` text
SAFETY_GATE_BLOCKED
```

O motor não tenta:

``` text
trocar exercício
reduzir carga
trocar por caminhada
```

O fluxo normal é interrompido.

------------------------------------------------------------------------

# Exemplo 11 --- Pós-parto por tempo apenas

## Entrada

``` yaml
postpartum: true
time_since_delivery: X
recovery_data: insufficient
```

## Resultado

``` text
INSUFFICIENT_DATA
```

Tempo isolado não autoriza migração para treino convencional.

------------------------------------------------------------------------

# Exemplo 12 --- Pós-parto + preferência estética

## Entrada

``` yaml
base: T081
postpartum: true
muscle_emphasis: [glutes]
```

## Ordem

``` text
Safety
→ recovery stage
→ functional constraints
→ base session
→ preference
```

Preferência só redistribui o que for permitido.

------------------------------------------------------------------------

# Exemplo 13 --- Fragilidade + 4 dias

## Entrada

``` yaml
base: T087
frailty: true
days_per_week: 4
```

## Regra

O quarto dia de movimento leve não deve ser transformado em outra sessão
pesada só porque o usuário declarou disponibilidade.

A estrutura de recuperação/movimento faz parte da finalidade.

------------------------------------------------------------------------

# Exemplo 14 --- Fragilidade + apoio obrigatório

## Entrada

``` yaml
base: T089
balance_support_need: required
preferred_exercise: unsupported_split_squat
```

## Constraint

``` yaml
protected_constraints:
  - support_required
```

## Resultado

A preferência é rejeitada e o motor escolhe apenas candidatos com
apoio/estabilidade compatíveis.

------------------------------------------------------------------------

# Exemplo 15 --- Duas limitações simultâneas

## Entrada

``` yaml
base: T014
shoulder_limitation: true
wrist_limitation: true
```

## Processo

``` text
Candidates
∩ ShoulderAllowed
∩ WristAllowed
∩ EquipmentAvailable
= ValidCandidates
```

Não aplicar uma substituição do ombro e depois outra do punho em cadeia.

------------------------------------------------------------------------

# Exemplo 16 --- Nenhum substituto válido

## Entrada

``` yaml
base: Txxx
active_constraints:
  - limitation_A
  - limitation_B
equipment: very_limited
```

## Resultado

``` text
NO_SAFE_SUBSTITUTION
```

Não usar o candidato "menos ruim".

------------------------------------------------------------------------

# Exemplo 17 --- Recuperação ruim + alta frequência

## Entrada

``` yaml
base: T006
days_per_week: 7
perceived_recovery: poor
```

## Processo

O template já contém recuperação ativa.

O motor deve proteger esse papel e considerar redução de acessórios/dose
em sessões secundárias.

Não converter o dia leve em sessão pesada.

------------------------------------------------------------------------

# Exemplo 18 --- Emagrecimento

## Entrada

``` yaml
goal: weight_loss
sex_profile: male
environment: gym
days_per_week: 4
```

## Regra arquitetural

Emagrecimento não seleciona automaticamente um template de circuito.

O sistema seleciona a família de composição corporal adequada e aplica
cardio/dose conforme as regras.

Nutrição e déficit energético pertencem a outra camada do produto.

------------------------------------------------------------------------

# Exemplo 19 --- Definição

## Entrada

``` yaml
goal: definition
```

## Regra

Definição não exige biblioteca de musculação própria.

Preservar treinamento resistido e tratar composição corporal por camadas
apropriadas.

------------------------------------------------------------------------

# Exemplo 20 --- Usuária não quer ênfase em glúteos

## Entrada

``` yaml
base: T015
muscle_emphasis: [general]
explicit_preference:
  reduce_default_glute_emphasis: true
```

## Processo

A ênfase feminina é default, não obrigação.

O motor pode redistribuir acessórios/volume para uma estrutura mais
geral, preservando inferiores.

------------------------------------------------------------------------

# Exemplo 21 --- Usuário masculino quer glúteos

## Entrada

``` yaml
base: T003
muscle_emphasis: [glutes]
```

## Regra

Sexo não bloqueia preferência.

A família masculina pode receber ênfase em glúteos dentro de limites de
volume/duração.

------------------------------------------------------------------------

# Exemplo 22 --- 75+ minutos

## Entrada

``` yaml
base: T004
session_duration: 90
experience: intermediate
recovery: normal
```

## Regra

Não adicionar exercícios apenas para preencher 90 minutos.

Se o template-base já entrega a dose adequada:

``` text
KEEP BASE DOSE
```

------------------------------------------------------------------------

# Exemplo 23 --- Preferência por exercício sem equipamento

## Entrada

``` yaml
preferred_exercise: cable_row
available_equipment:
  - DUMBBELLS
```

## Resultado

``` text
P3 EQUIPMENT > P7 PREFERENCE
```

O exercício preferido não entra.

------------------------------------------------------------------------

# Exemplo 24 --- Sessão mínima não cabe

## Entrada

``` yaml
base: strength_template
session_duration: 15
```

Se a família não possuir versão válida dentro desse orçamento:

``` text
SESSION_TOO_SHORT_FOR_TEMPLATE
```

O motor não deve comprimir descanso e segurança para fingir que cabe.

------------------------------------------------------------------------

# Exemplo 25 --- Determinismo

## Entrada A

``` text
T003 + MOD-EXP-001 + MOD-TIME-001 + MOD-EQP-002
```

Executada duas vezes com a mesma versão de regras.

## Resultado esperado

``` text
same personalized workout
same modifier order
same constraints
same decision trace semantics
```

------------------------------------------------------------------------

# Exemplo 26 --- Idempotência

Aplicar:

``` text
MOD-TIME-001
```

duas vezes.

Resultado:

``` text
efeito aplicado uma única vez
```

------------------------------------------------------------------------

# Exemplo 27 --- Pós-cirúrgico sem módulo específico

## Entrada

``` yaml
post_surgical: true
surgery_context: insufficient
```

## Resultado

``` text
NEEDS_REVIEW
```

Não selecionar automaticamente treino de fragilidade, iniciante ou baixo
impacto.

------------------------------------------------------------------------

# Exemplo 28 --- Vertigem/labirintite

## Entrada

``` yaml
vertigo_or_labyrinthitis: true
rules_module_available: false
```

## Resultado

``` text
NEEDS_REVIEW
```

Não assumir que "sentado = seguro".

------------------------------------------------------------------------

# Exemplo 29 --- Lipedema

## Entrada

``` yaml
lipedema: true
rules_module_available: false
```

## Resultado

Não aplicar uma regra universal de impacto/volume.

``` text
NEEDS_REVIEW
```

até o módulo específico existir.

------------------------------------------------------------------------

# Exemplo 30 --- Composição complexa

## Entrada

``` yaml
base: T015
experience: beginner
session_duration: 30
equipment:
  - DUMBBELLS
  - RESISTANCE_BANDS
knee_limitation:
  present: true
  aggravating_movements: [...]
impact_tolerance: reduced
muscle_emphasis:
  - glutes
perceived_recovery: normal
```

## Ordem

``` text
1. safety
2. knee constraints
3. impact constraints
4. equipment
5. beginner
6. duration
7. glute preference
8. validation
```

## Resultado

O treino final deve:

-   caber no tempo;
-   usar equipamento real;
-   respeitar joelho/impacto;
-   ser adequado a iniciante;
-   manter a família de hipertrofia;
-   preservar alguma ênfase em glúteos apenas dentro do conjunto válido.

------------------------------------------------------------------------

# 31. Critério de sucesso dos exemplos

Cada cenário deve futuramente virar teste automatizado contendo:

``` text
Given
When
Then
```

Exemplo:

``` text
GIVEN T015 + support_required
WHEN preference requests unsupported unilateral exercise
THEN exercise is not selected
AND support_required remains protected
```

------------------------------------------------------------------------

# 32. O que estes exemplos não fecham

Ainda faltam especificações numéricas para:

-   volume mínimo/máximo;
-   RIR/RPE/%1RM;
-   duração real por exercício;
-   progressão;
-   regressão;
-   regras clínicas específicas;
-   ranking real de substituições.

Os exemplos devem ser atualizados quando essas regras forem aprovadas.
