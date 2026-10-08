# AJ Fit Nutrition — Porções e Unidades

## 1. Unidade canônica

A V1 usa **gramas** como unidade operacional.

Todo alimento possui nutrientes canônicos por 100 g.

---

## 2. Registro

O usuário registra quantidade em gramas.

Exemplo:

- arroz: 150 g;
- frango: 120 g;
- banana: 100 g.

---

## 3. Medidas caseiras

Fora da V1.

Não implementar:

- colher;
- xícara;
- fatia;
- unidade;
- concha;
- copo.

Essas medidas podem ser adicionadas futuramente por meio de conversões canônicas.

---

## 4. Cálculo

Para qualquer nutriente:

`nutrientAmount = nutrientPer100g × grams / 100`

Exemplo conceitual:

```ts
proteinG = proteinPer100g * grams / 100
```

---

## 5. Arredondamento

O backend deve manter precisão suficiente para cálculos.

A interface pode arredondar para exibição.

Nunca recalcular macros usando o valor já arredondado da UI.

---

## 6. Receita

Receitas usam ingredientes em gramas.

Macros da receita:

`soma dos nutrientes de cada ingrediente na quantidade informada`

---

## 7. Alimentos industrializados

Mesmo que o rótulo use porção própria, o registro canônico deve ser convertido para 100 g.

A porção original do rótulo pode ser armazenada como metadado, mas não é fonte canônica de cálculo.
