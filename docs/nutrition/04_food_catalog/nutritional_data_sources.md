# AJ Fit Nutrition — Fontes de Dados Nutricionais

## 1. Estratégia da V1

A V1 utilizará múltiplas fontes.

Hierarquia recomendada:

1. TBCA;
2. TACO;
3. USDA FoodData Central;
4. rótulo/cadastro próprio para industrializados brasileiros.

Nenhuma fonte deve ser assumida como perfeita.

---

## 2. TBCA

A TBCA será a fonte principal para alimentos brasileiros.

Motivos:

- foco em alimentos consumidos no Brasil;
- boa cobertura nacional;
- base ampla;
- estrutura útil para composição nutricional.

Quando houver alimento equivalente adequado na TBCA, ela deve ser priorizada.

---

## 3. TACO

A TACO será fonte complementar.

Uso esperado:

- preencher lacunas;
- comparar dados;
- validar alimentos básicos;
- complementar cobertura nacional.

Não será a única fonte do catálogo.

---

## 4. USDA FoodData Central

Será fallback.

Uso esperado:

- alimentos ausentes nas bases brasileiras;
- referência complementar;
- suporte a itens específicos.

Não priorizar USDA quando houver equivalente brasileiro melhor representado nas fontes nacionais.

---

## 5. Industrializados e rótulos

Produtos de marca podem usar dados de rótulo.

Exigir:

- marca;
- nome do produto;
- nutrientes;
- data de captura/revisão;
- identificação da fonte.

O dado deve ser revisável e versionável.

---

## 6. Prioridade por alimento

Fluxo conceitual:

`TBCA -> TACO -> USDA -> rótulo/manual`

A prioridade real pode variar se uma fonte tiver informação claramente mais específica para aquele alimento.

---

## 7. Conflitos entre fontes

Quando fontes divergirem:

1. preferir a mais específica para o alimento;
2. preferir fonte brasileira para contexto brasileiro;
3. considerar método e recência;
4. registrar a fonte escolhida;
5. não fazer média automática entre fontes sem regra explícita.

---

## 8. Versionamento

Cada alimento deve carregar:

- fonte;
- ID externo quando existir;
- versão/data da fonte;
- versão do catálogo AJ Fit.

Mudanças relevantes exigem nova versão do registro.

---

## 9. Validação

Antes de produção, o catálogo deve passar por revisão amostral de qualidade.

Itens críticos:

- alimentos mais consumidos;
- principais fontes de proteína;
- carboidratos básicos;
- laticínios;
- óleos e gorduras;
- frutas;
- industrializados populares.

---

## 10. Escopo geográfico

A V1 é Brasil-first.

Não tentar resolver catálogo global nesta fase.
