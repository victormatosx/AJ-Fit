# AJ Fit --- Pós-parto

## 1. Escopo

Este documento especifica como o motor de modificadores deve operar
sobre **T079--T084**.

Família-ponte para reconstrução gradual de força, movimento e capacidade
antes do retorno aos templates gerais. É subordinada ao
`POSTPARTUM_SAFETY_GATE`; tempo desde o parto, isoladamente, não
equivale a recuperação completa.

Este arquivo complementa:

-   `01_ARCHITECTURE.md`
-   `02_VARIABLES_CATALOG.md`
-   `03_MODIFIERS_CATALOG.md`
-   `04_PRIORITY_AND_CONFLICTS.md`
-   `05_EXERCISE_SUBSTITUTIONS.md`

Ele não redefine as regras globais; especializa-as para esta família.

------------------------------------------------------------------------

## 2. Templates cobertos

### T079 --- gym · 2x/semana · Full Body A/B

Programa-ponte para reconstruir força, movimento e capacidade antes da
volta gradual aos templates convencionais.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Full Body A             resistance              Agachamento para
                                                  banco/Goblet Squat,
                                                  Remada sentada, Glute
                                                  Bridge/Hip Thrust
                                                  conforme conforto,
                                                  Chest Press, Hip
                                                  Hinge/RDL, Pallof
                                                  Press, Bird Dog

  Full Body B             resistance              Leg Press, Puxada
                                                  alta/elástico, RDL
                                                  leve/moderado,
                                                  Desenvolvimento
                                                  sentado, Step-up baixo,
                                                  Dead Bug adaptado
  -----------------------------------------------------------------------

### T080 --- gym · 3x/semana · Full / Cardio+Core / Full

Programa-ponte para reconstruir força, movimento e capacidade antes da
volta gradual aos templates convencionais.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Full Body A             resistance              Agachamento para
                                                  banco/Goblet Squat,
                                                  Remada sentada, Glute
                                                  Bridge/Hip Thrust
                                                  conforme conforto,
                                                  Chest Press, Hip
                                                  Hinge/RDL, Pallof
                                                  Press, Bird Dog

  Cardio + Core           mixed                   Caminhada/bike,
                                                  Respiração coordenada,
                                                  Bird Dog, Pallof Press,
                                                  Dead Bug adaptado

  Full Body B             resistance              Leg Press, Puxada
                                                  alta/elástico, RDL
                                                  leve/moderado,
                                                  Desenvolvimento
                                                  sentado, Step-up baixo,
                                                  Dead Bug adaptado
  -----------------------------------------------------------------------

### T081 --- gym · 4x/semana · Lower-Full / Upper / Cardio+Core / Full

Programa-ponte para reconstruir força, movimento e capacidade antes da
volta gradual aos templates convencionais.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Lower + Full            resistance              Agachamento para
                                                  banco/Goblet Squat, Hip
                                                  Thrust/Glute Bridge,
                                                  Remada sentada, Leg
                                                  Press/Step-up,
                                                  Flexora/Hinge, Pallof
                                                  Press

  Upper                   resistance              Puxada alta/elástico,
                                                  Chest Press, Remada
                                                  sentada,
                                                  Desenvolvimento
                                                  sentado, Elevação
                                                  lateral, Bíceps,
                                                  Tríceps

  Cardio + Core           mixed                   Caminhada/bike,
                                                  Respiração coordenada,
                                                  Bird Dog, Pallof Press,
                                                  Dead Bug adaptado

  Full Body B             resistance              Leg Press, Puxada
                                                  alta/elástico, RDL
                                                  leve/moderado,
                                                  Desenvolvimento
                                                  sentado, Step-up baixo,
                                                  Dead Bug adaptado
  -----------------------------------------------------------------------

### T082 --- home · 2x/semana · Full Body A/B

Programa-ponte para reconstruir força, movimento e capacidade antes da
volta gradual aos templates convencionais.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Full Body A             resistance              Sit-to-Stand/Goblet
                                                  Squat, Remada
                                                  elástico/unilateral
                                                  apoiada, Glute
                                                  Bridge/Hip Thrust
                                                  conforme conforto,
                                                  Press
                                                  halteres/elástico, Hip
                                                  Hinge/RDL, Pallof
                                                  Press, Bird Dog

  Full Body B             resistance              Sit-to-Stand/Goblet
                                                  Squat, Puxada
                                                  alta/elástico, RDL
                                                  leve/moderado,
                                                  Desenvolvimento
                                                  sentado, Step-up baixo,
                                                  Dead Bug adaptado
  -----------------------------------------------------------------------

### T083 --- home · 3x/semana · Full / Cardio+Core / Full

Programa-ponte para reconstruir força, movimento e capacidade antes da
volta gradual aos templates convencionais.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Full Body A             resistance              Sit-to-Stand/Goblet
                                                  Squat, Remada
                                                  elástico/unilateral
                                                  apoiada, Glute
                                                  Bridge/Hip Thrust
                                                  conforme conforto,
                                                  Press
                                                  halteres/elástico, Hip
                                                  Hinge/RDL, Pallof
                                                  Press, Bird Dog

  Cardio + Core           mixed                   Caminhada, Respiração
                                                  coordenada, Bird Dog,
                                                  Pallof Press, Dead Bug
                                                  adaptado

  Full Body B             resistance              Sit-to-Stand/Goblet
                                                  Squat, Puxada
                                                  alta/elástico, RDL
                                                  leve/moderado,
                                                  Desenvolvimento
                                                  sentado, Step-up baixo,
                                                  Dead Bug adaptado
  -----------------------------------------------------------------------

### T084 --- home · 4x/semana · Lower-Full / Upper / Cardio+Core / Full

Programa-ponte para reconstruir força, movimento e capacidade antes da
volta gradual aos templates convencionais.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Lower + Full            resistance              Sit-to-Stand/Goblet
                                                  Squat, Hip Thrust/Glute
                                                  Bridge, Remada
                                                  elástico/unilateral
                                                  apoiada, Leg
                                                  Press/Step-up,
                                                  Flexora/Hinge, Pallof
                                                  Press

  Upper                   resistance              Puxada alta/elástico,
                                                  Press
                                                  halteres/elástico,
                                                  Remada
                                                  elástico/unilateral
                                                  apoiada,
                                                  Desenvolvimento
                                                  sentado, Elevação
                                                  lateral, Bíceps,
                                                  Tríceps

  Cardio + Core           mixed                   Caminhada, Respiração
                                                  coordenada, Bird Dog,
                                                  Pallof Press, Dead Bug
                                                  adaptado

  Full Body B             resistance              Sit-to-Stand/Goblet
                                                  Squat, Puxada
                                                  alta/elástico, RDL
                                                  leve/moderado,
                                                  Desenvolvimento
                                                  sentado, Step-up baixo,
                                                  Dead Bug adaptado
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 3. Hierarquia aplicável

``` text
P0 Safety
→ P1 população especial
→ P2 limitações/capacidade/impacto
→ P3 equipamento
→ P4 experiência/recuperação
→ P5 duração
→ P6 programação
→ P7 preferência
```

Uma regra inferior só opera dentro das constraints deixadas pelas
superiores.

------------------------------------------------------------------------

## 4. Modificadores aplicáveis

### `SAF`

Safety Gates, red flags e restrições profissionais. Podem bloquear
geração, exercício ou progressão.

### `POP`

Estágio/estado da população especial. Define o envelope dentro do qual
os demais modificadores podem operar.

### `TIME`

Duração disponível. Preserva componentes prioritários e reduz
redundâncias/acessórios antes de destruir a estrutura.

### `EQP`

Equipamento. Substitui exercícios inviáveis preservando padrão,
finalidade e demais constraints.

### `KNEE`

Limitação declarada de joelho. Filtra movimentos/variações incompatíveis
sem diagnosticar a causa.

### `HIP`

Limitação declarada de quadril. Afeta candidatos, amplitude/posição
quando houver regra formal e tolerância.

### `SHOULDER`

Limitação declarada de ombro. Pode alterar presses, puxadas ou posições
conforme movimentos problemáticos relatados.

### `SPINE`

Limitação declarada de coluna. Exige regras específicas e não deve ser
reduzida a uma substituição universal.

### `WRIST`

Limitação declarada de punho. Pode mudar pegada, apoio ou exercício
quando documentado.

### `ELBOW`

Limitação declarada de cotovelo. Pode afetar presses, puxadas e
isoladores.

### `FUNC`

Capacidade funcional/equilíbrio. Ajusta estabilidade, apoio,
complexidade, unilateralidade e duração.

### `IMP`

Tolerância a impacto. Especialmente relevante para corrida, saltos e
intervalados.

### `REC`

Recuperação/fadiga. Pode reduzir dose ou retirar intensificadores; não
diagnostica doença/overtraining.

### `CARDIO`

Modalidade, duração e formato do cardio dentro da finalidade do
template.

### `PREF`

Preferências musculares, de exercícios e modalidades. Sempre P7 e nunca
reintroduzem algo bloqueado.

## Regras específicas do pós-parto

-   `POSTPARTUM_SAFETY_GATE` precede toda adaptação.
-   Tempo desde o parto é contexto, não autorização automática para
    progressão.
-   Sintomas declarados, cicatrização, conforto e restrições
    profissionais podem limitar exercícios e dose.
-   O objetivo é progressão de retorno; o motor deve permitir migração
    futura para templates gerais quando critérios forem atendidos.
-   Preferência/experiência não vencem estágio de recuperação.
-   Não diagnosticar diástase, disfunção do assoalho pélvico ou
    complicações.

------------------------------------------------------------------------

## 5. Estratégia de aplicação por categoria

### Experiência

Quando aplicável:

**Beginner** - adaptação temporária por lista: manter 50% dos exercícios na
Week 1, 70% na Week 2 e todos na Week 3+, usando `ceil`. A dose interna dos
itens retidos permanece igual; não há modifier de intensidade.

**Intermediate** - preserva o template-base; - ajustes vêm
principalmente de outras variáveis.

**Advanced** - preserva o template-base dentro do envelope da população;
nível sozinho não adiciona volume, intensidade ou técnicas.

### Duração

30 mantém 60% e 45 mantém 80% dos exercícios com `ceil`; 60/90 preservam
a lista. Usar ordem do template e signal de priority, sem estimar minutos.

### Equipamento

``` text
exercício inviável
→ identificar padrão/finalidade
→ filtrar constraints
→ filtrar equipamento
→ escolher candidato
→ validar sessão
```

Nunca selecionar substituto apenas pelo nome do músculo.

### Limitações

As limitações articulares/colunares devem operar a partir de: -
movimentos declarados como problemáticos; - tolerância; - restrições
profissionais; - regras específicas validadas.

Não existe regra global `dor em X → exercício Y`.

### Recuperação

Quando recuperação estiver abaixo do esperado e não houver red flag: 1.
remover intensificadores; 2. reduzir acessórios; 3. reduzir volume
secundário; 4. ajustar densidade; 5. preservar, quando possível, a
intenção central da sessão.

### Preferências

Preferências são aplicadas por último.

Podem: - escolher entre variantes equivalentes; - preservar/antecipar exercício
prioritário; - adicionar no máximo +1 set por priority/sessão quando a regra V1
permitir; - escolher modalidade de cardio compatível.

Não podem: - remover constraint; - reintroduzir exercício bloqueado; -
exigir equipamento inexistente; - descaracterizar a família.

------------------------------------------------------------------------

## 6. Preservação simples na redução

O motor usa a ordem canônica como sinal principal: protege o primeiro
exercício e candidatos de muscle priority, preenche pelas posições iniciais e
usa movement pattern apenas como guard mínimo de diversidade. Não classifica
slots manualmente. Safety, limitations e equipment já devem estar resolvidos.

------------------------------------------------------------------------

## 7. Substituições

Todas as substituições usam `05_EXERCISE_SUBSTITUTIONS.md`.

Regra:

``` text
OriginalExercise
+
ActiveConstraints
+
AvailableEquipment
+
Experience
+
FamilyGoal
+
Preference
→ BestValidCandidate
```

Se não houver candidato:

``` text
NO_SAFE_SUBSTITUTION
```

Não executar cadeia cega `A → B → C`.

------------------------------------------------------------------------

## 8. Combinações importantes

### Limitação + equipamento

O candidato deve satisfazer simultaneamente ambos.

### Iniciante + sessão curta

Não somar reduções percentuais cegamente. Calcular uma sessão mínima
coerente.

### Preferência + limitação

A preferência escolhe somente dentro do conjunto permitido pela
limitação.

### Preferência + tempo curto

Redistribuir antes de adicionar volume.

### Recuperação + alta frequência

Proteger sessões leves/recuperativas existentes. Não transformar
disponibilidade em intensidade diária.

------------------------------------------------------------------------

## 9. Validação pós-modificação

Antes de liberar o treino:

-   todos os exercícios são executáveis com o equipamento?
-   todas as constraints continuam respeitadas?
-   algum exercício bloqueado reapareceu?
-   a sessão mantém sua finalidade?
-   a redução aproximada de duration foi aplicada corretamente?
-   volume não foi duplicado por modificadores?
-   há redundância criada por substituições?
-   preferência alterou algo de prioridade superior?
-   frequência semanal continua coerente?
-   o treino final ainda pertence conceitualmente a esta família?

------------------------------------------------------------------------

## 10. Decision Trace mínimo

Registrar:

``` yaml
base_workout: Txxx
family: "{title}"
active_modifiers: []
protected_constraints: []
changes:
  - action: KEEP|REMOVE|REPLACE|ADD|REORDER|CHANGE_DOSE
    target: null
    replacement: null
    modifier_id: null
    reason: null
validation_state: RESOLVED
```

------------------------------------------------------------------------

## 11. Estados de saída

``` text
RESOLVED
RESOLVED_WITH_WARNINGS
NEEDS_REVIEW
NO_SAFE_SUBSTITUTION
SAFETY_GATE_BLOCKED
INSUFFICIENT_DATA
```

------------------------------------------------------------------------

## 12. Casos de teste obrigatórios desta família

1.  template de menor frequência sem modificadores;
2.  template de maior frequência sem modificadores;
3.  iniciante;
4.  sessão de 30 minutos;
5.  equipamento reduzido;
6.  uma limitação de membro inferior;
7.  uma limitação de membro superior;
8.  múltiplas limitações;
9.  preferência compatível;
10. preferência incompatível com constraint;
11. recuperação ruim;
12. 4+ modificadores simultâneos;
13. nenhum substituto válido;
14. repetição do mesmo modificador para testar idempotência;
15. mesma entrada/mesma versão para testar determinismo.

------------------------------------------------------------------------

## 13. Pontos ainda dependentes de especificação

Este documento **não inventa** regras clínicas ou números que ainda não
foram definidos. Antes da implementação final ainda precisam ser
fechados:

-   IDs reais dos exercícios;
-   tags e padrões de movimento do catálogo;
-   limites mínimos/máximos de volume por família;
-   eventual cronômetro de execução, fora do Prescription Engine V1;
-   regras numéricas de esforço/intensidade;
-   tabelas validadas para limitações;
-   ranking real de substituições;
-   critérios formais de progressão/regressão;
-   questionário que alimentará cada variável.

Esses pontos devem ser especificados antes de transformar a documentação
em lógica de produção.
