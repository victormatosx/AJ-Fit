# AJ Fit --- Condicionamento --- Masculino

## 1. Escopo

Este documento especifica como o motor de modificadores deve operar
sobre **T049--T060**.

Família masculina de condicionamento. Combina resistência muscular,
trabalho aeróbico contínuo e intervalado. O objetivo não é HIIT diário
nem musculação com descanso artificialmente curto; impacto, modalidade e
densidade devem ser adaptáveis.

Este arquivo complementa:

-   `01_ARCHITECTURE.md`
-   `02_VARIABLES_CATALOG.md`
-   `03_MODIFIERS_CATALOG.md`
-   `04_PRIORITY_AND_CONFLICTS.md`
-   `05_EXERCISE_SUBSTITUTIONS.md`

Ele não redefine as regras globais; especializa-as para esta família.

------------------------------------------------------------------------

## 2. Templates cobertos

### T049 --- gym · 2x/semana · Conditioning A/B

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra
                                                  romeno, Step-up,
                                                  Bike/remo/marcha
                                                  rápida, Prancha

  Conditioning B +        mixed                   Leg Press/Afundo,
  intervalos                                      Puxada alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio,
                                                  Dead Bug, Aquecimento,
                                                  Intervalos, Volta à
                                                  calma
  -----------------------------------------------------------------------

### T050 --- gym · 3x/semana · Circuit / Aeróbico / Interval + resistência

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Interval + resistência  mixed                   Aquecimento, Intervalos, Volta
                                                  à calma, Leg Press/Afundo,
                                                  Puxada alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug
  ------------------------------------------------------------------------------

### T051 --- gym · 4x/semana · Circuit / Aeróbico / Circuit / Interval

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma
  ------------------------------------------------------------------------------

### T052 --- gym · 5x/semana · 2 circuitos + 2 aeróbicos + intervalado

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma

  Aeróbico + Core         mixed                   Aeróbico contínuo, Prancha,
                                                  Pallof Press, Mobilidade
  ------------------------------------------------------------------------------

### T053 --- gym · 6x/semana · 3 conditioning + 2 aeróbicos + intervalado

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Aeróbico leve           cardio                  Aeróbico leve/moderado,
                                                  Mobilidade

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma

  Conditioning C          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha
  ------------------------------------------------------------------------------

### T054 --- gym · 7x/semana · 6 sessões + recuperação ativa

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Aeróbico leve           cardio                  Aeróbico leve/moderado,
                                                  Mobilidade

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma

  Conditioning C          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Recuperação ativa       recovery                Caminhada leve, Mobilidade
  ------------------------------------------------------------------------------

### T055 --- home · 2x/semana · Conditioning A/B

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  -----------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- -----------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra
                                                  romeno, Step-up,
                                                  Bike/remo/marcha
                                                  rápida, Prancha

  Conditioning B +        mixed                   Leg Press/Afundo,
  intervalos                                      Puxada alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio,
                                                  Dead Bug, Aquecimento,
                                                  Intervalos, Volta à
                                                  calma
  -----------------------------------------------------------------------

### T056 --- home · 3x/semana · Circuit / Aeróbico / Interval + resistência

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Interval + resistência  mixed                   Aquecimento, Intervalos, Volta
                                                  à calma, Leg Press/Afundo,
                                                  Puxada alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug
  ------------------------------------------------------------------------------

### T057 --- home · 4x/semana · Circuit / Aeróbico / Circuit / Interval

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma
  ------------------------------------------------------------------------------

### T058 --- home · 5x/semana · 2 circuitos + 2 aeróbicos + intervalado

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma

  Aeróbico + Core         mixed                   Aeróbico contínuo, Prancha,
                                                  Pallof Press, Mobilidade
  ------------------------------------------------------------------------------

### T059 --- home · 6x/semana · 3 conditioning + 2 aeróbicos + intervalado

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Aeróbico leve           cardio                  Aeróbico leve/moderado,
                                                  Mobilidade

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma

  Conditioning C          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha
  ------------------------------------------------------------------------------

### T060 --- home · 7x/semana · 6 sessões + recuperação ativa

Condicionamento combina resistência muscular, capacidade aeróbica e
intervalos; não é musculação com descanso curto nem HIIT diário.

  ------------------------------------------------------------------------------
  Sessão                  Tipo                    Exercícios-base
  ----------------------- ----------------------- ------------------------------
  Conditioning A          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Aeróbico contínuo       cardio                  Caminhada/bike/elíptico/remo

  Conditioning B          circuit                 Leg Press/Afundo, Puxada
                                                  alta/elástico,
                                                  Desenvolvimento, Remada
                                                  unilateral, Cardio, Dead Bug

  Aeróbico leve           cardio                  Aeróbico leve/moderado,
                                                  Mobilidade

  Intervalado             interval                Aquecimento, Intervalos, Volta
                                                  à calma

  Conditioning C          circuit                 Goblet Squat, Remada
                                                  baixa/elástico, Chest
                                                  Press/Flexão, Terra romeno,
                                                  Step-up, Bike/remo/marcha
                                                  rápida, Prancha

  Recuperação ativa       recovery                Caminhada leve, Mobilidade
  ------------------------------------------------------------------------------

------------------------------------------------------------------------

## 3. Hierarquia aplicável

``` text
P0 Safety (quando acionado)
→ P2 limitações/capacidade/impacto
→ P3 equipamento
→ P4 experiência/recuperação
→ P5 duração
→ P6 objetivo/ênfase
→ P7 preferência
```

Uma regra inferior só opera dentro das constraints deixadas pelas
superiores.

------------------------------------------------------------------------

## 4. Modificadores aplicáveis

### `EXP`

Experiência. Ajusta complexidade, volume inicial, estabilidade, esforço
e uso de técnicas avançadas.

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

### `PREF`

Preferências musculares, de exercícios e modalidades. Sempre P7 e nunca
reintroduzem algo bloqueado.

### `CARDIO`

Modalidade, duração e formato do cardio dentro da finalidade do
template.

## Regras específicas de condicionamento

-   Preservar a combinação de capacidade aeróbica e resistência muscular
    prevista no template.
-   `NO_HIGH_IMPACT`: trocar modalidade, não necessariamente reduzir o
    estímulo cardiovascular.
-   `BEGINNER`: reduzir densidade, duração ou número de voltas antes de
    tornar os movimentos tecnicamente complexos.
-   Sessão curta: reduzir voltas/duração e preservar aquecimento/volta à
    calma quando relevantes.
-   Cardio preferido só pode ser escolhido se impacto, equipamento e
    limitações permitirem.
-   HIIT não deve ser usado como fallback universal para emagrecimento.

------------------------------------------------------------------------

## 5. Estratégia de aplicação por categoria

### Experiência

Quando aplicável:

**Beginner** - reduzir complexidade desnecessária; - reduzir volume
inicial quando o template exceder a capacidade atual; - favorecer
execução estável e repetível; - manter margem de esforço conservadora; -
não usar técnicas avançadas como requisito.

**Intermediate** - tende a preservar o template-base; - ajustes vêm
principalmente de outras variáveis.

**Advanced** - pode tolerar maior especificidade/dose quando a família e
recuperação permitirem; - não significa adicionar volume
automaticamente.

### Duração

Ordem de adaptação:

``` text
preservar constraints
→ preservar componentes prioritários
→ remover redundância
→ reduzir acessórios de menor prioridade
→ reorganizar pares/supersets compatíveis
→ reduzir séries quando necessário
→ validar duração e estrutura mínima
```

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

Podem: - escolher entre variantes equivalentes; - substituir acessório
equivalente; - redistribuir parte do volume; - escolher modalidade de
cardio compatível.

Não podem: - remover constraint; - reintroduzir exercício bloqueado; -
exigir equipamento inexistente; - descaracterizar a família.

------------------------------------------------------------------------

## 6. Componentes prioritários e removíveis

O motor deve classificar cada exercício da sessão em tempo de
composição:

``` text
ESSENTIAL
HIGH_PRIORITY
ACCESSORY
OPTIONAL
```

Critérios: - papel do exercício na finalidade da sessão; - cobertura de
padrão/músculo; - redundância com outros exercícios; - objetivo da
família; - preferência válida; - constraints ativas.

Essa classificação deve ser contextual. O último exercício da lista não
é automaticamente o primeiro a ser removido.

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
-   duração estimada cabe no limite?
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
-   cálculo oficial de duração;
-   regras numéricas de esforço/intensidade;
-   tabelas validadas para limitações;
-   ranking real de substituições;
-   critérios formais de progressão/regressão;
-   questionário que alimentará cada variável.

Esses pontos devem ser especificados antes de transformar a documentação
em lógica de produção.
