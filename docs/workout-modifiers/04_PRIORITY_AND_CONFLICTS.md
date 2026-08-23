# AJ Fit --- Prioridade e Resolução de Conflitos

## 1. Problema

Um usuário pode ativar simultaneamente:

``` text
iniciante
+
30 minutos
+
limitação de joelho
+
equipamento reduzido
+
preferência por quadríceps
+
baixa tolerância a impacto
```

Aplicar cada regra isoladamente pode produzir um treino incoerente.

Este documento define quem vence e como compor regras.

------------------------------------------------------------------------

# 2. Hierarquia

## P0 --- Segurança absoluta

Inclui:

-   Safety Gates;
-   red flags;
-   restrições profissionais;
-   bloqueios explícitos.

**Sempre vence.**

------------------------------------------------------------------------

## P1 --- População/estado especial

Inclui:

-   gestação;
-   pós-parto;
-   fragilidade;
-   outros módulos especiais formalmente documentados.

Essas regras moldam o espaço dentro do qual o restante pode operar.

------------------------------------------------------------------------

## P2 --- Limitação funcional, dor e tolerância

Inclui:

-   joelho;
-   quadril;
-   ombro;
-   coluna;
-   punho;
-   cotovelo;
-   tornozelo;
-   equilíbrio;
-   impacto quando ligado a segurança/capacidade.

------------------------------------------------------------------------

## P3 --- Viabilidade/equipamento

O usuário precisa conseguir executar o treino.

Um exercício que exige equipamento inexistente deve ser substituído
independentemente de ser preferido.

------------------------------------------------------------------------

## P4 --- Experiência e capacidade

Inclui:

-   iniciante;
-   intermediário;
-   avançado;
-   capacidade funcional;
-   necessidade de estabilidade;
-   recuperação quando não for safety.

------------------------------------------------------------------------

## P5 --- Disponibilidade

Inclui:

-   duração da sessão;
-   restrição logística;
-   distribuição temporal.

------------------------------------------------------------------------

## P6 --- Objetivo/ênfase programática

Usado quando há escolhas internas dentro da família.

O objetivo estrutural principal já deve ter participado da seleção do
treino-base.

------------------------------------------------------------------------

## P7 --- Preferência

Inclui:

-   músculo preferido;
-   exercício preferido;
-   exercício não desejado;
-   cardio preferido.

É a camada mais flexível e de menor autoridade.

------------------------------------------------------------------------

# 3. Regra fundamental

``` text
P0 > P1 > P2 > P3 > P4 > P5 > P6 > P7
```

Entretanto, prioridade não significa simplesmente "executar a regra
maior e ignorar todas as menores".

Significa:

> regras menores só podem operar dentro do espaço permitido pelas
> maiores.

------------------------------------------------------------------------

# 4. Protected Constraints

Quando uma regra superior gera uma restrição, registrar como constraint
protegida.

Exemplo:

``` yaml
protected_constraints:
  - no_high_impact
  - avoid_exercise:X
  - support_required
```

Modificadores posteriores não podem remover essas constraints.

------------------------------------------------------------------------

# 5. Exemplo: preferência vs joelho

Contexto:

``` text
MOD-KNEE-xxx
MOD-PREF-QUADS
```

A preferência por quadríceps pode buscar outra estratégia compatível.

Não pode reintroduzir um exercício removido pela regra de joelho.

Resultado:

``` text
KNEE CONSTRAINT
        ↓
lista de exercícios permitidos
        ↓
QUAD PREFERENCE escolhe dentro dessa lista
```

------------------------------------------------------------------------

# 6. Exemplo: equipamento vs preferência

Usuário prefere determinado exercício, mas não possui o equipamento.

``` text
P3 EQP > P7 PREF
```

O sistema procura uma alternativa equivalente.

A preferência pode influenciar qual alternativa será escolhida, mas não
criar equipamento inexistente.

------------------------------------------------------------------------

# 7. Exemplo: tempo vs objetivo

Sessão de 30 minutos em hipertrofia.

O modificador de tempo não deve transformar o treino em cardio porque
"cabe melhor".

Deve preservar a intenção:

``` text
movimentos prioritários
→ volume essencial
→ acessórios prioritários
→ acessórios opcionais
```

e cortar do fim dessa hierarquia lógica, não necessariamente da ordem
visual.

------------------------------------------------------------------------

# 8. Exemplo: iniciante + sessão curta

Dois modificadores podem querer reduzir volume.

Erro:

``` text
BEGINNER = -40%
TIME_30 = -40%

resultado = -80%
```

A composição não deve ser multiplicação cega.

Deve existir um limite por família e uma regra de volume final.

Conceito:

``` text
base volume
↓
target volume allowed by experience
↓
fit target inside session duration
↓
validate minimum effective structure
```

------------------------------------------------------------------------

# 9. Exemplo: múltiplas limitações

Usuário:

``` text
shoulder limitation
+
wrist limitation
```

Não selecionar independentemente:

``` text
substituto do ombro = exercício A
substituto do punho = exercício B
```

O substituto final precisa satisfazer **ambas** as constraints.

Formalmente:

``` text
Candidates
∩ ShoulderAllowed
∩ WristAllowed
∩ EquipmentAvailable
= ValidCandidates
```

Se `ValidCandidates = ∅`:

``` text
NO_SAFE_SUBSTITUTION
```

------------------------------------------------------------------------

# 10. Conflitos do mesmo nível

Quando dois modificadores possuem mesma prioridade:

### Regra 1 --- Interseção

Tentar satisfazer ambos.

### Regra 2 --- Especificidade

A regra mais específica vence a genérica.

Exemplo:

``` text
NO_HIGH_IMPACT
```

é mais específica para modalidade do que uma preferência genérica por
corrida.

### Regra 3 --- Constraint mais conservadora

Quando a disputa envolve segurança/capacidade, manter a restrição mais
conservadora.

### Regra 4 --- Não inventar

Se não houver resolução definida, retornar revisão em vez de decidir
arbitrariamente.

------------------------------------------------------------------------

# 11. Ordem técnica recomendada

Mesmo dentro das prioridades:

``` text
1. collect constraints
2. lock P0/P1 restrictions
3. resolve movement restrictions
4. resolve equipment
5. resolve complexity/experience
6. resolve time/volume
7. apply program emphasis
8. apply preferences
9. validate
```

------------------------------------------------------------------------

# 12. Conflitos entre volume e ênfase

Preferência por um músculo não significa simplesmente adicionar séries.

Estratégias possíveis, em ordem:

``` text
1. escolher variante já compatível com maior ênfase;
2. trocar acessório equivalente;
3. redistribuir volume de músculos menos prioritários;
4. adicionar volume somente se orçamento de recuperação/duração permitir.
```

Isso evita crescimento ilimitado do treino.

------------------------------------------------------------------------

# 13. Conflitos entre frequência e recuperação

Disponibilidade:

``` text
7 dias
```

não obriga:

``` text
7 dias intensos
```

Se a estrutura Txxx já possui recuperação ativa, um modificador de
preferência não pode converter esse dia em outra sessão pesada sem regra
explícita.

------------------------------------------------------------------------

# 14. Conflitos em populações especiais

Em:

-   gestação;
-   pós-parto;
-   fragilidade;

o template e seus Safety Gates estabelecem um envelope mais restrito.

Exemplo:

``` text
PREGNANCY
+
ADVANCED
```

`ADVANCED` não restaura automaticamente estratégias incompatíveis com as
regras da gestação.

A experiência modifica o treino **dentro do envelope da população
especial**.

------------------------------------------------------------------------

# 15. Precedência de substituição

Ao substituir exercício:

``` text
1. Safety
2. Professional restriction
3. Limitation compatibility
4. Functional capacity
5. Impact tolerance
6. Equipment
7. Preserve movement/goal
8. Experience
9. Preference
```

------------------------------------------------------------------------

# 16. Regra de mínimo estrutural

Todo grupo deverá definir um `MINIMUM_VIABLE_SESSION`.

Exemplo conceitual:

``` text
Txxx:
  priority_components:
    - primary_lower_pattern
    - primary_push
    - primary_pull
  optional_components:
    - accessory_1
    - accessory_2
```

O modificador de tempo deve remover opcionais antes de destruir a
estrutura mínima.

------------------------------------------------------------------------

# 17. Regra de máximo

Também deve existir proteção contra acumulação.

Exemplo:

``` text
glute preference
+
advanced
+
long session
```

não significa volume ilimitado.

Cada família deve definir limites de programação.

------------------------------------------------------------------------

# 18. Estados de resolução

O motor pode terminar com:

``` text
RESOLVED
RESOLVED_WITH_WARNINGS
NEEDS_REVIEW
NO_SAFE_SUBSTITUTION
SAFETY_GATE_BLOCKED
INSUFFICIENT_DATA
```

------------------------------------------------------------------------

# 19. Matriz rápida

  -----------------------------------------------------------------------
  Conflito                            Vencedor
  ----------------------------------- -----------------------------------
  Safety × qualquer outro             Safety

  Restrição profissional ×            Restrição
  preferência                         

  Limitação × preferência             Limitação

  Equipamento × exercício preferido   Equipamento

  População especial × avançado       População especial delimita

  Tempo × acessório                   Tempo pode remover acessório

  Tempo × componente essencial        preservar essencial; reduzir por
                                      outra estratégia

  Recuperação × volume extra          recuperação

  Baixo impacto × corrida preferida   baixo impacto

  Duas limitações                     interseção das duas
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 20. Testes obrigatórios futuros

Criar cenários para pelo menos:

-   2 modificadores;
-   3 modificadores;
-   5+ modificadores;
-   dois modificadores do mesmo nível;
-   zero substituições válidas;
-   preferência incompatível com safety;
-   tempo curto + iniciante;
-   limitação + equipamento reduzido;
-   população especial + preferência;
-   alta frequência + baixa recuperação.
