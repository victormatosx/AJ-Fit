> Registro histórico: as seções sobre limitações musculoesqueléticas estão descontinuadas. As demais regras independentes continuam sujeitas ao código atual. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit --- Catálogo Mestre de Variáveis

## 1. Objetivo

Este arquivo define o vocabulário canônico das informações que podem
influenciar o motor.

Uma variável pode ser:

-   `SELECTOR`: ajuda a escolher o treino-base.
-   `MODIFIER`: altera o treino-base.
-   `SAFETY`: participa de gates/restrições.
-   `CONTEXT`: informação útil, mas não deve modificar o treino
    isoladamente.

Uma mesma variável pode exercer mais de um papel.

------------------------------------------------------------------------

# 2. Perfil

## `SEX_PROFILE`

**Tipo:** enum\
**Valores conceituais:** `male`, `female`, outros estados conforme
modelagem do produto\
**Papel:** SELECTOR / CONTEXT

Nos templates gerais atuais, o perfil masculino/feminino diferencia a
ênfase padrão. Não deve ser interpretado como regra absoluta de
preferência muscular.

------------------------------------------------------------------------

## `AGE`

**Tipo:** integer\
**Papel:** CONTEXT / potencial MODIFIER

Idade isolada não deve selecionar automaticamente treino de fragilidade.

Deve ser interpretada junto de capacidade funcional, experiência,
equilíbrio, restrições e contexto especial.

------------------------------------------------------------------------

# 3. Objetivo

## `PRIMARY_GOAL`

**Tipo:** enum

Valores conceituais:

``` text
HYPERTROPHY
BODY_COMPOSITION
STRENGTH
CONDITIONING
```

**Papel:** SELECTOR

Emagrecimento e definição não exigem automaticamente biblioteca
resistida separada.

------------------------------------------------------------------------

## `SECONDARY_GOALS`

**Tipo:** array enum\
**Papel:** MODIFIER / CONTEXT

Exemplos:

-   maior capacidade aeróbica;
-   ganhar força;
-   aumentar massa;
-   melhorar mobilidade;
-   preferência estética.

Não deve contradizer o objetivo principal sem regra de composição.

------------------------------------------------------------------------

# 4. Disponibilidade

## `TRAINING_DAYS_PER_WEEK`

**Tipo:** integer\
**Faixa atual:** 2--7 para templates gerais; populações especiais
possuem faixas próprias.\
**Papel:** SELECTOR

Não significa que todos os dias serão intensos.

------------------------------------------------------------------------

## `SESSION_DURATION_MINUTES`

**Tipo:** enum/range

Opções atuais:

``` text
SHORT       ≈ 30 min
MEDIUM      ≈ 45 min
STANDARD    ≈ 60 min
LONG        ≈ 90 min
```

**Papel:** MODIFIER

Pode alterar:

-   acessórios;
-   séries;
-   organização;
-   duração de cardio.

30/45 não autorizam compressão cega de descanso, circuitos ou supersets
automáticos. A estratégia aprovada preserva safety/core/prioridade e reduz
redundâncias e componentes de menor prioridade.

Não deve remover silenciosamente os componentes prioritários do treino.

------------------------------------------------------------------------

# 5. Ambiente e equipamento

## `TRAINING_ENVIRONMENT`

Valores:

``` text
GYM
HOME
```

**Papel:** SELECTOR

"Casa" significa não depender de academia; não significa necessariamente
permanecer dentro de casa.

------------------------------------------------------------------------

## `AVAILABLE_EQUIPMENT`

**Tipo:** set

Categorias sugeridas:

``` text
BODYWEIGHT
CHAIR
BENCH
DUMBBELLS
ADJUSTABLE_DUMBBELLS
BARBELL
PLATES
RACK
CABLE
RESISTANCE_BANDS
PULLUP_BAR
KETTLEBELL
LEG_PRESS
SMITH_MACHINE
CARDIO_TREADMILL
CARDIO_BIKE
CARDIO_ELLIPTICAL
CARDIO_ROWER
OTHER_MACHINE
```

**Papel:** MODIFIER

Deve operar preferencialmente por capacidades/tags, não por centenas de
booleans independentes.

------------------------------------------------------------------------

# 6. Experiência

## `EXPERIENCE_LEVEL`

Valores:

``` text
BEGINNER
INTERMEDIATE
ADVANCED
```

**Papel:** MODIFIER

Regra aprovada: `BEGINNER` inicia adaptação temporária nas semanas 1 e 2;
`INTERMEDIATE` e `ADVANCED` preservam a dose-base e não recebem volume ou
intensidade extra apenas pelo nível. Experiência de onboarding não é progressão
permanente. Familiaridade de movimento pode continuar informando uma troca
específica, respeitando todas as constraints.

------------------------------------------------------------------------

## `TRAINING_HISTORY_MONTHS`

**Tipo:** integer\
**Papel:** CONTEXT / MODIFIER auxiliar

Não deve substituir sozinho `EXPERIENCE_LEVEL`.

------------------------------------------------------------------------

## `MOVEMENT_FAMILIARITY`

**Tipo:** mapa por padrão/exercício\
**Papel:** MODIFIER

Exemplo:

``` text
BARBELL_SQUAT = unfamiliar
DUMBBELL_PRESS = familiar
```

Útil para não assumir que "intermediário" domina todo exercício.

------------------------------------------------------------------------

# 7. Capacidade funcional

## `FUNCTIONAL_CAPACITY`

Valores:

``` text
HIGH
MODERATE
LOW
VERY_LOW
```

**Papel:** MODIFIER / SELECTOR auxiliar / SAFETY

Especialmente importante para fragilidade.

------------------------------------------------------------------------

## `BALANCE_SUPPORT_NEED`

Valores:

``` text
NONE
OPTIONAL
RECOMMENDED
REQUIRED
```

**Papel:** MODIFIER / SAFETY

Pode alterar:

-   exercícios unilaterais;
-   step-up;
-   carries;
-   exercícios em pé;
-   necessidade de apoio.

------------------------------------------------------------------------

## `FALL_RISK`

Valores conceituais:

``` text
LOW
ELEVATED
HIGH
```

**Papel:** SAFETY / MODIFIER

Não deve ser inferido apenas por idade.

------------------------------------------------------------------------

## `IMPACT_TOLERANCE`

Valores:

``` text
NORMAL
REDUCED
NO_HIGH_IMPACT
```

**Papel:** MODIFIER

Especialmente relevante em condicionamento.

------------------------------------------------------------------------

# 8. Limitações e sintomas musculoesqueléticos

As variáveis abaixo representam **informação declarada ou previamente
conhecida**, não diagnóstico do AJ Fit.

## `KNEE_LIMITATION`

## `HIP_LIMITATION`

## `SHOULDER_LIMITATION`

## `SPINE_LIMITATION`

Subcategorias futuras podem distinguir cervical/torácica/lombar quando
necessário.

## `WRIST_LIMITATION`

## `ELBOW_LIMITATION`

## `ANKLE_LIMITATION`

**Tipo conceitual para todas:**

``` yaml
limitation:
  present: true
  side: left | right | bilateral | unknown
  severity: mild | moderate | severe | unknown
  movements_that_aggravate: []
  professional_restrictions: []
```

**Papel:** MODIFIER / SAFETY dependendo do caso.

A presença da variável não autoriza o sistema a diagnosticar a causa.

------------------------------------------------------------------------

## `PAIN_DURING_EXERCISE`

**Tipo:** contextual/dinâmico\
**Papel:** SAFETY / MODIFIER

Deve distinguir desconforto esperado de esforço de dor relatada como
problema. Regras exatas serão documentadas separadamente.

------------------------------------------------------------------------

# 9. Condições especiais

## `PREGNANCY_STATUS`

Valores conceituais:

``` text
NOT_PREGNANT
PREGNANT
```

**Papel:** SELECTOR / SAFETY

------------------------------------------------------------------------

## `GESTATIONAL_STAGE`

Informação preferencial:

``` text
GESTATIONAL_WEEK
```

Faixas podem ser derivadas quando necessário.

**Papel:** MODIFIER / SAFETY

Afeta:

-   posições;
-   estabilidade;
-   conforto;
-   amplitude;
-   seleção de exercícios;
-   dose.

------------------------------------------------------------------------

## `PREGNANCY_PROFESSIONAL_RESTRICTIONS`

**Tipo:** array\
**Papel:** SAFETY

Tem precedência sobre preferência e programação normal.

------------------------------------------------------------------------

## `POSTPARTUM_STATUS`

**Papel:** SELECTOR / SAFETY

------------------------------------------------------------------------

## `TIME_SINCE_DELIVERY`

**Tipo:** duração\
**Papel:** MODIFIER / CONTEXT

Tempo sozinho não define recuperação.

------------------------------------------------------------------------

## `DELIVERY_TYPE`

Valores:

``` text
VAGINAL
CESAREAN
OTHER_OR_UNKNOWN
```

**Papel:** MODIFIER / CONTEXT

Não deve criar automaticamente uma biblioteca duplicada.

------------------------------------------------------------------------

## `POSTPARTUM_RECOVERY_STAGE`

Valores conceituais:

``` text
EARLY_RECOVERY
REBUILDING
RETURN_TO_TRAINING
```

**Papel:** MODIFIER / SAFETY

Deve considerar mais do que tempo.

------------------------------------------------------------------------

## `POSTPARTUM_SYMPTOMS`

Pode incluir informação declarada sobre:

-   dor;
-   cicatrização;
-   perda urinária/fecal;
-   peso/pressão vaginal;
-   sangramento anormal;
-   sintomas durante esforço.

**Papel:** SAFETY.

------------------------------------------------------------------------

## `FRAILTY_STATUS`

**Papel:** SELECTOR / SAFETY

Não equivale a idade avançada.

------------------------------------------------------------------------

# 10. Lipedema, tontura/vertigem e pós-cirúrgico

Esses cenários agora possuem **contrato de entrada**, mas ainda não possuem
regras clínicas executáveis no motor T001--T090.

## `LIPEDEMA_STATUS`, `LIPEDEMA_SYMPTOM_IMPACT`, `LIPEDEMA_PROFESSIONAL_GUIDANCE`

Valores coletados: presença declarada; impacto `NONE`,
`MILD_OR_OCCASIONAL`, `INTERFERES_WITH_EXERCISES` ou `UNKNOWN`; orientação
profissional `YES`, `NO` ou `UNSURE`.

**Papel:** MODIFIER P2 + entrada de SAFETY. O rótulo isolado não implica baixo
impacto, redução de volume ou incapacidade.

## `DIZZINESS_STATUS`, `DIZZINESS_FREQUENCY`, `DIZZINESS_AFFECTS_BALANCE`

Frequência: `HISTORY_ONLY`, `OCCASIONAL`, `FREQUENT` ou
`CURRENT_OR_RECENT`. Equilíbrio: `YES`, `NO` ou `UNKNOWN`.

**Papel:** SAFETY P0 quando atual/recente ou com equilíbrio afetado;
MODIFIER P2 nos demais estados documentados. Não equivale a um diagnóstico de
labirintite.

## `POST_SURGICAL_STATUS`, `POST_SURGICAL_REGION`, `POST_SURGICAL_CLEARANCE`

Recuperação: `COMPLETED`, `IN_PROGRESS`, `UNSURE`. Região: joelho, quadril,
coluna/costas, ombro, cotovelo, punho/mão, tornozelo/pé, abdômen, tórax ou
outra. Liberação: `CLEARED_NO_RESTRICTIONS`, `CLEARED_WITH_RESTRICTIONS`,
`NOT_YET`, `UNSURE`.

**Papel:** RESTRICTIVE SAFETY GATE P0 + MODIFIER. A região não autoriza inferir
procedimento, tecido, prazo ou exercício permitido.

## `PROFESSIONAL_EXERCISE_RESTRICTION`

Valores: `YES`, `NO`, `UNSURE`. Estrutura a antiga opção genérica de restrição
médica sem inventar seu conteúdo.

**Papel:** SAFETY P0. Orientação de lipedema ou liberação cirúrgica com
restrições permanecem em seus próprios objetos; não são convertidas
silenciosamente nesta variável.

------------------------------------------------------------------------

# 11. Preferências

## `MUSCLE_EMPHASIS_PREFERENCE`

Exemplos:

``` text
GLUTES
QUADS
HAMSTRINGS
CHEST
BACK
SHOULDERS
ARMS
GENERAL
```

**Papel:** MODIFIER P7

Pode preservar/ordenar candidatos e adicionar no máximo +1 set por
priority/sessão nas condições da V1.

Direção V1: até duas priorities protegem e antecipam o primeiro exercício
relevante de cada músculo. Fora de Beginner Week 1/2 e duration 30, cada uma
pode adicionar exatamente +1 set por sessão no primeiro candidato com sets
numéricos. Em 45, isso só ocorre se a sessão não foi reduzida. Não há budget
semanal, donors/receivers ou `slotRole`.

Não pode vencer segurança.

------------------------------------------------------------------------

## `PREFERRED_EXERCISES`

**Tipo:** array de IDs\
**Papel:** MODIFIER P7

Preferência não garante inclusão.

------------------------------------------------------------------------

## `DISLIKED_EXERCISES`

**Tipo:** array\
**Papel:** MODIFIER P7

Pode gerar substituição quando houver alternativa equivalente e nenhuma
razão estrutural para manter o exercício.

------------------------------------------------------------------------

## `CARDIO_PREFERENCE`

Exemplos:

``` text
WALKING
RUNNING
BIKE
ELLIPTICAL
ROWER
NO_PREFERENCE
```

**Papel:** MODIFIER P7

Impacto/equipamento/safety têm prioridade.

------------------------------------------------------------------------

# 12. Recuperação

## `PERCEIVED_RECOVERY`

Valores:

``` text
GOOD
NORMAL
POOR
```

## `UNUSUAL_FATIGUE`

**Tipo:** boolean/escala

## `SLEEP_QUALITY`

Valores conceituais:

``` text
GOOD
FAIR
POOR
```

**Papel:** MODIFIER / CONTEXT

Essas variáveis podem futuramente alterar dose diária, mas não devem
criar um sistema pseudomédico de diagnóstico de fadiga.

------------------------------------------------------------------------

# 13. Variáveis derivadas

Algumas informações devem ser calculadas, não perguntadas diretamente.

Exemplos:

``` text
BASE_WORKOUT_ID
EFFECTIVE_WEEKLY_VOLUME
ESTIMATED_SESSION_DURATION
REQUIRED_EQUIPMENT
ACTIVE_MODIFIERS
SAFETY_STATE
```

------------------------------------------------------------------------

# 14. Variáveis que não devem decidir sozinhas

Evitar regras como:

``` text
AGE >= 65 → FRAILTY
FEMALE → GLUTE_FOCUS obrigatório
WEIGHT_LOSS → HIIT
BEGINNER → MACHINE_ONLY
POSTPARTUM_WEEKS >= X → FULLY_RECOVERED
```

Essas simplificações destroem a personalização e podem gerar decisões
inadequadas.

------------------------------------------------------------------------

# 15. Variáveis ainda a fechar

Antes da implementação final, os documentos por família deverão decidir:

-   faixas finais de duração;
-   escala de experiência;
-   escala de capacidade funcional;
-   representação de dor/limitação;
-   granularidade de equipamento;
-   regras de recuperação;
-   como registrar restrições profissionais;
-   se preferências musculares aceitam múltiplas prioridades;
-   quais dados serão perguntados e quais serão derivados.

O índice canônico atualizado é `../workout-lifecycle/07_OPEN_DECISIONS.md`.
Dias da semana preferidos e data/reavaliação pós-parto são entradas futuras,
não campos atuais (`../workout-lifecycle/03_SCHEDULE_ENGINE.md` e
`../workout-lifecycle/06_REASSESSMENT.md`).
