> Registro histórico: as seções sobre limitações musculoesqueléticas estão descontinuadas. As demais regras independentes continuam sujeitas ao código atual. Ver [remoção definitiva](../../removal-physical-limitations/REPORT.md).

# AJ Fit --- Equipment Rules

## 1. Objetivo

Garantir que todo treino final seja executável no ambiente e com os
recursos reais do usuário.

Regra:

``` text
equipamento altera execução
não altera automaticamente objetivo
```

------------------------------------------------------------------------

## 2. Ambiente

Templates atuais distinguem:

``` text
GYM
HOME
```

Porém o modificador deve trabalhar com equipamento real.

Uma academia pode não possuir determinada máquina.

Uma casa pode possuir:

-   rack;
-   barra;
-   banco;
-   halteres;
-   bicicleta;
-   barra fixa.

Portanto:

``` text
environment != equipment inventory
```

------------------------------------------------------------------------

## 3. Inventário canônico inicial

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

O catálogo final deve refletir os equipamentos realmente suportados pelo
banco de exercícios.

------------------------------------------------------------------------

## 4. Requisitos por exercício

Cada exercício deverá declarar:

``` yaml
equipment:
  required: []
  alternatives: []
```

Exemplo conceitual:

``` yaml
barbell_bench_press:
  required:
    - BARBELL
    - PLATES
    - BENCH
    - RACK
```

------------------------------------------------------------------------

## 5. Capacidade em vez de marca

Não modelar:

``` text
Technogym Chest Press
Life Fitness Chest Press
```

quando o algoritmo só precisa saber:

``` text
MACHINE_CHEST_PRESS
```

Detalhes comerciais não devem dirigir lógica de treino.

------------------------------------------------------------------------

## 6. Falta de equipamento

Pipeline:

``` text
exercise requires unavailable equipment
→ identify purpose/pattern
→ query substitution graph
→ apply active constraints
→ filter available equipment
→ rank candidates
→ replace
```

------------------------------------------------------------------------

## 7. Halteres

Quando halteres estiverem disponíveis, podem substituir diversas
variantes com barra/máquina, mas:

-   estabilidade muda;
-   carga máxima muda;
-   progressão muda;
-   experiência pode importar.

Não considerar equivalência perfeita.

------------------------------------------------------------------------

## 8. Elásticos

Elásticos são úteis, mas não devem ser tratados como substitutos
universais para qualquer estímulo.

O ranking deve considerar:

-   padrão;
-   perfil de resistência;
-   possibilidade de progressão;
-   estabilidade;
-   objetivo.

------------------------------------------------------------------------

## 9. Peso corporal

`BODYWEIGHT_ONLY` exige atenção especial à progressão.

Não transformar todos os movimentos em séries infinitas de repetições.

Usar:

-   alavanca;
-   amplitude;
-   unilateralidade quando segura;
-   tempo;
-   apoio;
-   variantes.

As regras de progressão específicas ainda precisam ser definidas.

------------------------------------------------------------------------

## 10. Sem máquinas de cardio

Cardio pode usar:

``` text
walking
outdoor walking
stairs/step quando apropriado
marching
bodyweight low-impact conditioning
```

conforme impacto, ambiente e segurança.

"Casa" não significa "não pode caminhar fora".

------------------------------------------------------------------------

## 11. Equipamento compartilhado / ocupado

A biblioteca atual não possui variável de disponibilidade momentânea de
máquina.

Se futuramente existir:

``` text
TEMPORARILY_UNAVAILABLE
```

ela deve usar o mesmo grafo de substituição, mas sem alterar
permanentemente o perfil do usuário.

------------------------------------------------------------------------

## 12. Preferência vs equipamento

``` text
P3 EQP > P7 PREF
```

Usuário pode preferir um exercício, mas sem equipamento ele não é
candidato.

------------------------------------------------------------------------

## 13. Força em casa

T031--T036 e T043--T048 reconhecem que força máxima depende do
equipamento.

Se o usuário possuir barra/rack/anilhas, o sistema pode selecionar
variantes carregáveis.

Se não possuir, deve usar variantes disponíveis e registrar que a
progressão será por outros mecanismos.

------------------------------------------------------------------------

## 14. Populações especiais

Equipamento nunca vence:

``` text
P0/P1/P2 constraints
```

Exemplo:

uma máquina disponível não é automaticamente adequada para gestação,
fragilidade ou uma limitação.

------------------------------------------------------------------------

## 15. Equipamento e sessão curta

Evitar sessões com muitas trocas de estação quando o tempo é curto.

O ranking pode favorecer candidatos que:

-   usam o mesmo equipamento;
-   reduzem setup;
-   preservam finalidade.

Mas isso é critério secundário à segurança e qualidade do estímulo.

------------------------------------------------------------------------

## 16. Equipamento e supersets

Supersets devem considerar logística.

Errado:

``` text
superset que exige monopolizar 3 máquinas
```

quando a alternativa simples atende melhor.

------------------------------------------------------------------------

## 17. Fallback

Se nenhum exercício válido puder representar um componente essencial:

``` text
NO_VALID_EQUIPMENT_SUBSTITUTION
```

Não remover silenciosamente o componente sem revalidar a sessão.

------------------------------------------------------------------------

## 18. Validation

-   todo equipamento requerido está disponível?
-   substituto respeita constraints?
-   padrão/finalidade foi preservado?
-   complexidade é adequada?
-   sessão não ganhou setup excessivo?
-   preferência não forçou recurso inexistente?

------------------------------------------------------------------------

## 19. Trace

``` yaml
equipment_change:
  exercise: EX-000
  missing: [CABLE]
  candidate_pool: []
  selected: EX-111
  reason: MOD-EQP-002
```

------------------------------------------------------------------------

## 20. Próximos dados necessários

Antes da implementação:

-   inventário final de equipamentos;
-   tags de cada exercício;
-   requirements reais;
-   grafo de substituições;
-   ranking por família;
-   regras de progressão para equipamento limitado.

Ordem aprovada para cobertura: manter o exercício original quando viável →
usar substituição real do catálogo atual → criar novo `exerciseId` somente após
gap demonstrado. “Parecido” sem candidato validado não autoriza criação ou
troca silenciosa.

A auditoria encontrou dois gaps reproduzíveis mesmo com todo inventário HOME
representável: `cable-rear-delt-fly` (8 templates) e `stationary-bike` (12).
O primeiro é provável gap de catálogo; o segundo pode ser gap do resolver/input,
pois alternativas de cardio mudam o movement pattern. Consulte
`../exercise-limitations/05_CATALOG_GAPS.md`.

Equipment resolution ocorre antes de priority. O candidato escolhido deve
passar também pelas limitações; `unknown` nunca equivale a compatível (DR-005).
Somente depois o exercício pode participar do signal simples de priority e das
reduções por ordem. Equipment não autoriza priority sobre exercício que será
substituído nem exige metadata estrutural nova.
