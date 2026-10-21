> Registro histórico: as seções sobre limitações musculoesqueléticas estão descontinuadas. As demais regras independentes continuam sujeitas ao código atual. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit --- Sistema de Substituição de Exercícios

## 1. Objetivo

Substituição de exercício não deve ser uma tabela simples:

``` text
A → B
```

A alternativa correta depende do **motivo** da substituição.

Exemplo:

Um substituto adequado para `Back Squat` por falta de rack não é
necessariamente adequado para alguém que relatou uma limitação de
joelho.

O motor deve escolher candidatos por características.

------------------------------------------------------------------------

# 2. Modelo do exercício

Cada exercício deverá futuramente possuir metadados semelhantes a:

``` yaml
exercise:
  id: EX-0000
  name: ""

  patterns:
    - squat

  primary_muscles: []
  secondary_muscles: []

  equipment: []

  position: standing
  unilateral: false

  stability_demand: medium
  balance_demand: medium
  impact: none

  loading_options: []
  skill_level: intermediate

  limitation_compatibility:
    knee: compatible
    shoulder: adapt
    back: unknown

  tags: []
```

As tags finais deverão ser compatíveis com a biblioteca real de
exercícios do AJ Fit.

O nome conceitual acima foi consolidado como `limitationProfile`; seu schema e
resolver estão `IMPLEMENTED_V1`. Seus estados de domínio são
`compatible`, `adapt`, `avoid`, `unknown` e `not_applicable`. DR-005 fecha que ausente/não revisado
nunca é `compatible`. O metadado pertence ao exercício real,
não a uma matriz gigante paralela.

Os IDs coletados hoje são `knee`, `hip`, `back`, `shoulder`, `elbow`, `wrist`,
`ankle_foot` e `other`. Labels traduzidas não são chaves. As sete regiões
canônicas são resolvidas; `other` retorna `UNMAPPED_LIMITATION_REGION` sem
renomear ou ignorar respostas históricas.

------------------------------------------------------------------------

# 3. Padrões de movimento

Taxonomia inicial:

``` text
SQUAT
HINGE
HORIZONTAL_PUSH
VERTICAL_PUSH
HORIZONTAL_PULL
VERTICAL_PULL
LUNGE_SPLIT_SQUAT
STEP
HIP_EXTENSION
KNEE_FLEXION
KNEE_EXTENSION
CALF
CARRY
ANTI_EXTENSION_CORE
ANTI_ROTATION_CORE
LATERAL_CORE
LOCOMOTION
CARDIO_CONTINUOUS
CARDIO_INTERVAL
BALANCE
MOBILITY
```

Não é necessário forçar todo exercício a uma única categoria.

------------------------------------------------------------------------

# 4. Motivos de substituição

Enum conceitual:

``` text
EQUIPMENT
EXPERIENCE
FUNCTIONAL_CAPACITY
PAIN_OR_LIMITATION
IMPACT
BALANCE
PREGNANCY
POSTPARTUM
FRAILTY
PREFERENCE
UNAVAILABLE_EXERCISE
```

O motivo deve ser registrado no decision trace.

------------------------------------------------------------------------

# 5. Algoritmo conceitual

Para exercício `E`:

``` text
1. identificar finalidade de E
2. identificar motivo da troca
3. gerar candidatos
4. filtrar constraints de segurança
5. filtrar limitações
6. filtrar capacidade funcional
7. filtrar impacto
8. filtrar equipamento
9. preservar padrão/músculo/finalidade
10. adequar experiência
11. aplicar preferência
12. ranquear candidatos
13. escolher candidato
14. validar sessão
```

------------------------------------------------------------------------

# 6. Score conceitual

Um candidato pode receber pontuação por:

``` text
movement_pattern_match
primary_muscle_match
training_goal_match
equipment_match
skill_match
stability_match
preference_match
```

E ser excluído por constraints:

``` text
safety_block
limitation_block
impact_block
equipment_missing
population_block
```

Um exercício bloqueado não deve continuar no ranking com pontuação
menor. Deve sair do conjunto.

------------------------------------------------------------------------

# 7. Famílias iniciais de substituição

## 7.1 Squat

Possíveis membros:

``` text
Back Squat
Front Squat
Hack Squat
Smith Squat
Goblet Squat
Leg Press
Box Squat
Supported Squat
Sit-to-Stand
```

Não são equivalentes em todas as situações.

Exemplo:

``` text
reason = EQUIPMENT
Back Squat sem rack
→ Goblet Squat pode ser candidato
```

Mas:

``` text
reason = FUNCTIONAL_CAPACITY
→ Supported Squat / Sit-to-Stand podem receber ranking maior
```

------------------------------------------------------------------------

## 7.2 Hinge

``` text
Conventional Deadlift
Romanian Deadlift
Dumbbell RDL
Kettlebell Deadlift
Cable Pull Through
Hip Hinge with support
```

------------------------------------------------------------------------

## 7.3 Horizontal Push

``` text
Barbell Bench Press
Dumbbell Bench Press
Machine Chest Press
Incline Press
Push-up
Incline Push-up
Wall Push-up
Band Press
```

------------------------------------------------------------------------

## 7.4 Horizontal Pull

``` text
Barbell Row
Machine Row
Cable Row
Dumbbell Row
Supported Dumbbell Row
Band Row
```

------------------------------------------------------------------------

## 7.5 Vertical Push

``` text
Barbell Overhead Press
Dumbbell Shoulder Press
Machine Shoulder Press
Seated Dumbbell Press
```

A lista final deve respeitar regras específicas de ombro e populações
especiais.

------------------------------------------------------------------------

## 7.6 Vertical Pull

``` text
Pull-up
Assisted Pull-up
Lat Pulldown
Neutral-Grip Pulldown
Band Pulldown
```

------------------------------------------------------------------------

## 7.7 Unilateral Lower

``` text
Forward Lunge
Reverse Lunge
Split Squat
Bulgarian Split Squat
Step-up
Supported Split Squat
```

Demandas de equilíbrio diferem significativamente.

------------------------------------------------------------------------

## 7.8 Hip Extension / Glutes

``` text
Barbell Hip Thrust
Machine Hip Thrust
Dumbbell Hip Thrust
Glute Bridge
Cable Pull Through
Band Hip Extension
```

------------------------------------------------------------------------

## 7.9 Cardio

### Alto impacto potencial

``` text
running
jump rope
jumping drills
```

### Baixo impacto

``` text
walking
incline walking
stationary bike
elliptical
rowing
controlled step
marching
```

A classificação final deve considerar o exercício real e contexto.

------------------------------------------------------------------------

# 8. Substituição por equipamento

Exemplo:

``` text
Cable Row
reason: NO_CABLE
```

Candidatos:

``` text
Machine Row
Dumbbell Row
Band Row
```

Filtrar pelos equipamentos realmente disponíveis.

------------------------------------------------------------------------

# 9. Substituição por experiência

Exemplo:

``` text
complex free-weight movement
+
BEGINNER
```

O sistema pode preferir uma variante:

-   mais estável;
-   com menor demanda técnica;
-   mais fácil de carregar progressivamente;
-   compatível com o ambiente.

Isso não significa `BEGINNER = MACHINES_ONLY`.

------------------------------------------------------------------------

# 10. Substituição por equilíbrio

Quando:

``` text
BALANCE_SUPPORT_NEED = REQUIRED
```

priorizar variantes:

-   sentadas;
-   apoiadas;
-   máquinas;
-   bilateralmente estáveis;
-   com ponto de apoio.

Evitar transformar a sessão em teste de equilíbrio involuntário.

------------------------------------------------------------------------

# 11. Substituição por impacto

Quando:

``` text
NO_HIGH_IMPACT
```

o motor pode procurar modalidade equivalente de condicionamento.

Exemplo:

``` text
running intervals
→ bike intervals
→ elliptical intervals
→ incline walking intervals
```

A intensidade relativa pode ser preservada sem preservar impacto.

------------------------------------------------------------------------

# 12. Limitações articulares

Para joelho, quadril, ombro, coluna, punho e cotovelo, este documento
**não define diagnóstico nem prescrição clínica**.

O sistema deve operar com:

-   movimentos declarados como problemáticos;
-   restrições profissionais;
-   tolerância;
-   amplitude/posição permitida quando conhecida;
-   regras específicas posteriormente validadas.

Não criar uma tabela universal do tipo:

``` text
dor no joelho → exercício X
```

Isso seria simplificação excessiva.

------------------------------------------------------------------------

# 13. Gestação

Substituições podem ser motivadas por:

-   conforto;
-   posição;
-   estabilidade;
-   estágio gestacional;
-   orientação profissional;
-   necessidade de evitar determinada configuração.

O substituto deve permanecer dentro das regras da família T073--T078.

------------------------------------------------------------------------

# 14. Pós-parto

Substituições podem considerar:

-   estágio de recuperação;
-   conforto;
-   controle de pressão/esforço;
-   sintomas declarados;
-   tipo de parto como contexto;
-   restrições profissionais.

O motor não diagnostica diástase ou disfunção do assoalho pélvico.

------------------------------------------------------------------------

# 15. Fragilidade

Priorizar, quando necessário:

-   apoio;
-   estabilidade;
-   amplitude controlável;
-   transições simples;
-   exercícios funcionalmente relevantes.

Exemplo de progressão conceitual:

``` text
Sit-to-Stand com braços
↓
Sit-to-Stand sem braços
↓
Sit-to-Stand com controle
↓
Sit-to-Stand com carga
↓
Goblet Squat para banco
```

Progressão não deve remover apoio prematuramente em usuário com risco de
queda.

------------------------------------------------------------------------

# 16. Preferência

Se o usuário não gosta de um exercício:

``` text
DISLIKED_EXERCISE
```

o sistema pode substituir quando:

-   existe candidato equivalente;
-   não é componente estrutural insubstituível;
-   nenhuma regra superior exige aquela variante.

Preferência é aplicada por último.

------------------------------------------------------------------------

# 17. Fallback

Quando nenhum candidato satisfaz todas as constraints:

``` text
NO_SAFE_SUBSTITUTION
```

Não usar:

``` text
closestExercise[0]
```

sem validação.

O candidato deve ser um `exerciseId` real e satisfazer a interseção de todas as
constraints ativas. Nenhuma condição é avaliada isoladamente e nenhuma troca
pode reintroduzir algo proibido por outra condição.

------------------------------------------------------------------------

# 18. Validação após troca

Depois de substituir:

-   padrão principal foi preservado quando necessário?
-   objetivo muscular continua adequado?
-   equipamento existe?
-   nova opção respeita todas as constraints?
-   exercício não duplica desnecessariamente outro da sessão?
-   duração permanece válida?
-   volume final continua coerente?

------------------------------------------------------------------------

# 19. Substituições em cadeia

Evitar:

``` text
A → B
B → C
C → D
```

por aplicação sucessiva de modificadores.

Preferir recalcular o candidato final usando todas as constraints
ativas:

``` text
A
+
all constraints
→ D
```

Isso reduz comportamento imprevisível.

------------------------------------------------------------------------

# 20. Próxima etapa

Quando os documentos por família forem escritos, este arquivo deverá
ganhar:

-   IDs reais dos exercícios;
-   ranking de equivalência;
-   regras por padrão;
-   matriz de equipamentos;
-   tags de estabilidade/impacto;
-   restrições específicas validadas;
-   testes de substituição.

A expansão seguirá: original viável → substituição existente no catálogo →
novo exercício somente após gap demonstrado. Metadado ausente/não revisado não
equivale automaticamente a `compatible` ou `not_applicable`
(DR-004/DR-005/DR-019).

O inventário integral, schema proposto, política de interseção, reviews e gaps
estão em `exercise-limitations/`. São 116 exercícios, 71 usados nos templates,
497 pares usados triados e 300 pares M+U na fila profissional; 45 exercícios
ficam fora do escopo atual, mas podem ser candidatos após revisão.
