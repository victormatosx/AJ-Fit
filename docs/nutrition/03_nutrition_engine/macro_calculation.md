# AJ Fit Nutrition — Macronutrientes e Fibras

## 1. Proteína

A proteína será calculada em `g/kg` do peso atual.

A V1 utilizará faixas por objetivo:

- mínimo;
- alvo;
- máximo.

A tabela numérica final deve ser canônica e versionada.

A IA não escolhe a meta.

## 2. Gorduras

Estratégia:

1. definir mínimo em `g/kg`;
2. respeitar esse mínimo;
3. permitir ajuste dentro da faixa;
4. completar energia restante principalmente com carboidratos.

## 3. Carboidratos

Carboidratos serão calculados como o restante das calorias após proteína e gordura.

Conversões:

- proteína: 4 kcal/g;
- carboidrato: 4 kcal/g;
- gordura: 9 kcal/g.

## 4. Fibras

A V1 terá meta diária de fibras baseada em energia consumida, em `g / 1000 kcal`.

O valor exato deve ficar na configuração canônica.

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
