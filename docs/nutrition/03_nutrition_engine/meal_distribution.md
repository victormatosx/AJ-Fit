# AJ Fit Nutrition — Distribuição entre Refeições

## 1. Estrutura

O usuário escolhe entre 2 e 6 refeições.

Slots:

- breakfast;
- morning_snack;
- lunch;
- afternoon_snack;
- dinner;
- supper.

A IA deve produzir exatamente os slots escolhidos.

## 2. Papel do engine

O engine define faixas por refeição.

A IA escolhe os alimentos dentro dessas faixas.

## 3. Regra de distribuição (decisão final)

Cada slot de refeição pertence a uma categoria (`canonical/nutrition_rules.json` `mealDistribution.distributionWeights`):

- **main**: breakfast, lunch, dinner;
- **snack**: morning_snack, afternoon_snack, supper.

Cada categoria tem um peso para energia e um peso (mais suave) para proteína:

| Categoria | Peso energia | Peso proteína |
|---|---|---|
| main | 1.5 | 1.2 |
| snack | 1.0 | 1.0 |

Algoritmo: normalizar os pesos pela soma apenas dos slots que o usuário selecionou (2 a 6), e multiplicar pelo total diário. Energia/gordura/carboidrato seguem o peso de energia; proteína segue seu próprio peso (mais próximo de 1:1 entre categorias, por isso "relativamente equilibrada" — `proteinRelativelyEven`). Essa é uma escolha de produto/engenharia documentada, não derivada de um único estudo — evita uma matriz de combinações sem crescer a complexidade.

## 4. Proteína

A proteína é distribuída de forma relativamente equilibrada entre as refeições (peso 1.2 para principais vs. 1.0 para lanches — bem mais suave que o peso de energia).

Não é dividida matematicamente igual, mas também não varia tanto quanto a energia.

## 5. Energia

A distribuição calórica varia por categoria de refeição (peso 1.5 para principais vs. 1.0 para lanches).

Como a V1 não coleta horários nem horário de treino, não haverá timing nutricional avançado.

Resultado da regra: refeições principais maiores, lanches menores, total diário correto (dentro das tolerâncias de `canonical/nutrition_rules.json` `tolerances`).

## 6. Gordura, carboidratos e fibras

Gordura e carboidratos seguem o mesmo peso de energia da refeição (não precisam ser iguais entre refeições).

Fibra é meta diária, sem obrigação rígida por refeição.
