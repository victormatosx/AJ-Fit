# AJ Fit Nutrition — Macronutrientes e Fibras

## 1. Proteína

A proteína será calculada em `g/kg` do peso atual.

Faixas fechadas por `NutritionGoalCategory` (`canonical/nutrition_rules.json` `macros.protein.rangesByGoal`, fonte: ISSN Position Stand — Jäger et al. 2017):

| Categoria | Min (g/kg) | Alvo (g/kg) | Máx (g/kg) |
|---|---|---|---|
| weight_loss | 1.8 | 2.0 | 2.4 |
| muscle_gain | 1.6 | 1.8 | 2.2 |
| maintenance | 1.2 | 1.6 | 2.0 |
| body_recomposition | 1.8 | 2.0 | 2.4 |

`weight_loss`/`body_recomposition` usam a faixa mais alta sustentada pelo ISSN para preservar massa magra em déficit; `maintenance` usa a faixa mais baixa, apropriada para população ativa geral sem déficit/superávit.

A IA não escolhe a meta.

## 2. Gorduras

Estratégia fechada (`canonical/nutrition_rules.json` `macros.fat.ranges`):

1. mínimo: `0.8 g/kg` de peso atual (piso de saúde hormonal);
2. alvo: `25%` das calorias totais;
3. máximo: `35%` das calorias totais (IOM AMDR para gordura: 20-35%);
4. gordura = maior valor entre o piso em g/kg e o alvo percentual, nunca excedendo o máximo percentual;
5. completar energia restante principalmente com carboidratos.

Gordura nunca cai abaixo do piso em g/kg só para "liberar" calorias para carboidrato.

## 3. Carboidratos

Carboidratos serão calculados como o restante das calorias após proteína e gordura.

Conversões:

- proteína: 4 kcal/g;
- carboidrato: 4 kcal/g;
- gordura: 9 kcal/g.

### Comportamento em caso de restante inválido (decisão final)

Se `targetKcal - proteinKcal - fatKcal < 0` (proteína + gordura, por si só, excedem a meta calórica), o Engine **não** satura carboidrato em 0 e segue silenciosamente — ele lança um erro de domínio explícito (`MACRO_ALLOCATION_INFEASIBLE`). Zero gramas de carboidrato é um resultado válido quando o restante é exatamente zero ou pequeno positivo; apenas um restante **negativo** é tratado como entrada inviável, consistente com `conflictPriority` (carboidrato é o primeiro a cadê, mas não pode ceder abaixo de zero).

## 4. Fibras

A V1 tem meta diária de fibras fechada em `14 g / 1000 kcal` (`canonical/nutrition_rules.json` `macros.fiber.target`, fonte: Institute of Medicine, Dietary Reference Intakes 2002/2005 — equivalente aos valores absolutos de referência de 25 g/dia para mulheres e 38 g/dia para homens em ingestões energéticas típicas).

## 5. Prioridade em conflitos

1. safety gates;
2. calorias;
3. proteína;
4. mínimo de gordura;
5. carboidratos;
6. fibras.

## 6. Tolerâncias

O engine deve definir tolerâncias explícitas para:

- calorias;
- proteína;
- gordura;
- carboidratos;
- fibras.

Os valores devem ser versionados e testados.
