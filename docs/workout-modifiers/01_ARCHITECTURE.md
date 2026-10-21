> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit --- Arquitetura do Motor de Modificadores

## 1. Responsabilidade

O motor de modificadores recebe:

``` text
UserProfile
+
BaseWorkout
+
ModifierRules
+
SafetyRules
+
ExerciseSubstitutionGraph
```

e produz:

``` text
PersonalizedWorkout
+
AppliedModifiers
+
DecisionTrace
+
Warnings/Blocks
```

O motor não escolhe arbitrariamente um novo treino. Ele transforma de
maneira determinística e rastreável um template previamente selecionado.

------------------------------------------------------------------------

## 2. Pipeline

``` text
1. Normalizar dados
        ↓
2. Selecionar treino-base
        ↓
3. Executar Safety Gates
        ↓
4. Detectar modificadores
        ↓
5. Ordenar por prioridade
        ↓
6. Resolver conflitos
        ↓
7. Aplicar modificadores estruturais
        ↓
8. Substituir exercícios
        ↓
9. Ajustar dose de treinamento
        ↓
10. Aplicar preferências
        ↓
11. Validar resultado
        ↓
12. Gerar treino + decision trace
```

------------------------------------------------------------------------

## 3. Camadas

### Camada A --- Base Workout

Contém a intenção original:

-   frequência;
-   divisão;
-   sessões;
-   exercícios;
-   séries;
-   repetições;
-   duração;
-   modalidade;
-   finalidade de cada sessão.

### Camada B --- Safety

Possui autoridade máxima.

Pode:

-   bloquear geração;
-   bloquear exercício;
-   bloquear impacto;
-   limitar determinadas estratégias;
-   exigir avaliação externa;
-   impedir progressão.

### Camada C --- Structural Modifiers

Alteram a estrutura do treino.

Exemplos:

-   reduzir sessão de 60 para 30 minutos;
-   adaptar iniciante;
-   adaptar capacidade funcional baixa;
-   modificar sessão em gestação/pós-parto.

### Camada D --- Feasibility Modifiers

Tornam o treino executável.

Exemplos:

-   equipamento indisponível;
-   exercício inviável;
-   ambiente;
-   necessidade de apoio;
-   baixo impacto.

### Camada E --- Programming Modifiers

Alteram dose ou distribuição:

-   séries;
-   repetições;
-   descanso;
-   intensidade relativa;
-   volume;
-   densidade;
-   frequência efetiva.

### Camada F --- Preference Modifiers

Personalização de menor prioridade:

-   maior ênfase muscular;
-   exercício preferido;
-   exercício que o usuário não gosta;
-   modalidade aeróbica preferida.

------------------------------------------------------------------------

## 4. Modelo conceitual de dados

### `UserTrainingContext`

``` yaml
user_training_context:
  profile:
    sex: null
    age: null

  goal:
    primary: null
    secondary: []

  availability:
    days_per_week: null
    session_duration_minutes: null

  environment:
    location: null
    equipment: []

  experience:
    level: null
    training_history_months: null

  functional:
    capacity: null
    impact_tolerance: null
    balance_support_need: null

  limitations: []

  special_population:
    pregnancy: null
    postpartum: null
    frailty: null

  preferences:
    muscle_emphasis: []
    preferred_exercises: []
    disliked_exercises: []
    cardio_preferences: []

  recovery:
    perceived_recovery: null
    sleep_quality: null
    unusual_fatigue: null
```

O schema final de produção pode ser diferente. Este documento define
conceitos, não contrato de banco de dados.

------------------------------------------------------------------------

## 5. Modelo conceitual de modificador

``` yaml
modifier:
  id: MOD-XXX-000
  name: ""
  priority: P0-P7

  trigger:
    variables: []
    condition: ""

  scope:
    families: []
    workout_ids: []
    session_types: []
    movement_patterns: []

  effects:
    may_change:
      - exercise
      - sets
      - reps
      - rest
      - intensity
      - tempo
      - order
      - session_volume
      - impact
      - support
    protected_fields: []

  conflicts_with: []
  compatible_with: []

  validation: []
```

------------------------------------------------------------------------

## 6. Operações permitidas

O motor pode realizar operações explícitas.

``` text
KEEP
REMOVE
REPLACE
ADD
REORDER
REDUCE_SETS
INCREASE_SETS
CHANGE_REP_RANGE
CHANGE_REST
CHANGE_INTENSITY
CHANGE_TEMPO
CHANGE_DURATION
CHANGE_IMPACT
ADD_SUPPORT
SPLIT_SESSION
```

Evitar regras vagas como:

> "deixar o treino mais leve"

Preferir regras semanticamente observáveis:

> reduzir volume total; aumentar margem de repetições em reserva; trocar
> padrão de alto impacto; adicionar apoio; remover técnica avançada.

------------------------------------------------------------------------

## 7. Campos protegidos

Um modificador comum não pode alterar livremente:

-   `workout_id`;
-   família clínica/especial;
-   objetivo estrutural principal;
-   frequência selecionada sem regra explícita;
-   Safety Gate;
-   restrições previamente impostas por prioridade superior.

Exemplo:

``` text
MOD-PREF-GLUTES
```

não pode transformar um programa de força em um programa exclusivamente
de glúteos.

------------------------------------------------------------------------

## 8. Idempotência

Aplicar o mesmo modificador duas vezes não deve duplicar seu efeito.

Errado:

``` text
MOD-TIME-30
→ remove 2 exercícios

MOD-TIME-30 novamente
→ remove mais 2
```

Correto:

``` text
MOD-TIME-30 já aplicado
→ nenhum novo efeito
```

------------------------------------------------------------------------

## 9. Determinismo

Com:

-   mesmo treino-base;
-   mesmas variáveis;
-   mesma versão de regras;

o resultado deve ser o mesmo, exceto quando uma regra explicitamente
suportar variação controlada.

Isso facilita:

-   testes;
-   auditoria;
-   debugging;
-   reprodução de bugs;
-   comparação entre versões.

------------------------------------------------------------------------

## 10. Decision Trace

Toda transformação relevante deve ser explicável.

Exemplo:

``` json
{
  "baseWorkout": "T003",
  "appliedModifiers": [
    "MOD-EXP-001",
    "MOD-KNEE-001",
    "MOD-TIME-001"
  ],
  "changes": [
    {
      "action": "REPLACE",
      "from": "exercise-x",
      "to": "exercise-y",
      "reason": "MOD-KNEE-001"
    },
    {
      "action": "REMOVE",
      "exercise": "accessory-z",
      "reason": "MOD-TIME-001"
    }
  ]
}
```

O usuário final não precisa ver esse objeto técnico, mas o sistema
administrativo/logs deveriam conseguir reconstruir a decisão.

------------------------------------------------------------------------

## 11. Validação pós-modificação

Depois de aplicar modificadores, validar:

### Estrutura

-   existe ao menos uma sessão válida?
-   frequência está correta?
-   sessão ficou vazia?
-   a redução aproximada de duration foi aplicada corretamente?

### Movimento

-   há redundâncias excessivas?
-   algum padrão necessário desapareceu sem justificativa?
-   há exercícios proibidos ainda presentes?

### Dose

-   séries não ficaram negativas/zero indevidamente?
-   intensidade e repetições são coerentes?
-   volume não foi duplicado por dois modificadores?

### Segurança

-   preferência reintroduziu restrição?
-   exercício incompatível reapareceu?
-   impacto proibido continua presente?

### Equipamento

-   todos os exercícios podem ser executados com recursos disponíveis?

------------------------------------------------------------------------

## 12. Fail-safe

Quando não houver solução segura:

``` text
DO NOT IMPROVISE
```

O motor deve retornar um estado explícito, por exemplo:

``` text
NEEDS_REVIEW
NO_SAFE_SUBSTITUTION
SAFETY_GATE_BLOCKED
INSUFFICIENT_DATA
```

Isso é melhor do que escolher silenciosamente um exercício "parecido".

------------------------------------------------------------------------

## 13. Versionamento

As regras devem possuir versão.

Exemplo:

``` text
modifier_engine_version: 1.0.0
exercise_substitution_version: 1.0.0
```

Mudanças que alterem comportamento devem ser rastreáveis.

------------------------------------------------------------------------

## 14. Responsabilidades futuras

Esta arquitetura deverá ser complementada por:

-   regras específicas T001--T090;
-   catálogo completo de exercícios;
-   tags biomecânicas/funcionais;
-   cronômetro/estimativa de execução, se futuramente útil fora da V1;
-   progressão;
-   regressão;
-   critérios de saída de populações especiais;
-   testes de composição.

Agenda, progressão, ciclos, reavaliação e histórico em nuvem não pertencem a
este pipeline. Seus contratos e versões são independentes e estão em
`../workout-lifecycle/`.

------------------------------------------------------------------------

## 15. Entradas de saúde da Fase 2

O roteador do questionário pode ativar vários ramos simultaneamente. Cada ramo
produz dados declarados, nunca diagnóstico:

``` text
lipedema             → MODIFIER + SAFETY input
dizziness_or_vertigo → SAFETY + MODIFIER input
post_surgical        → RESTRICTIVE SAFETY GATE + MODIFIER input
medical_restriction  → structured P0 input
```

Coleta, persistência e consulta administrativa estão disponíveis. O pipeline
`QuestionnaireAnswers → Txxx → modifiers → workout` está no runtime atual, mas
uma condição `ADAPTED` sem transformação validada permanece fail-closed; ela
não autoriza alterar exercício, volume ou intensidade por improviso.

## 16. Estado arquitetural consolidado

- `IMPLEMENTED`: seleção T001–T090, safety agregado, resolução pelo catálogo
  atual, composição/validação, trace e snapshot local.
- `IMPLEMENTED`: adaptação inicial, advanced na dose-base, regra 30/45 e
  prioridade muscular simples.
- `APPROVED_NOT_IMPLEMENTED`: Schedule Engine e Firestore de templates/programas.
- `IMPLEMENTED_V1`: limitation profile por exercício e Limitation Resolver
  puro integrado ao Prescription Engine.
- `FUTURE_DESIGN`: expansão de protocolos clínicos e demais evoluções fora da
  política conservadora V1.
- `DECISION_REQUIRED`: itens DR em
  `../workout-lifecycle/07_OPEN_DECISIONS.md`.

O fechamento quantitativo auditado e seus limites estão em
`../workout-lifecycle/08_PRESCRIPTION_CLOSURE_ANALYSIS.md`; limitation metadata
e o inventário dos 116, a matriz dos 71 usados e a fila de 300 pares estão em
`exercise-limitations/`.

## 17. Ordem executável futura

`Questionnaire → Safety → immutable Txxx → limitations/equipment → priority
signal → duration → beginner → priority ordering/extra set → validation →
snapshot`. A ordem do template e metadata muscular/de movimento existentes são
os únicos sinais estruturais necessários. Não há timing, effort target ou
`slotRole` na V1. As etapas partem da base/versionamentos para garantir
idempotência. Detalhes em `06_NORMALIZED_DOSE_AND_SESSION_MODEL.md`.
