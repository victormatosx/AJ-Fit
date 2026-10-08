# AJ Fit Nutrition — Comparação, Evolução e Feedback

## 1. Princípio

A V1 não trata o plano como obrigação.

O usuário registra livremente o que consumiu.

O sistema compara:

- recomendado;
- consumido.

O objetivo é oferecer contexto e evolução, não punir o usuário.

---

## 2. Registro por refeição

O usuário pode:

### Seguiu a recomendação

Selecionar que consumiu uma das opções recomendadas.

O app pode pré-preencher os alimentos e quantidades daquela opção no diário.

O usuário ainda pode editar o registro real antes de salvar.

### Consumiu outra coisa

Adicionar livremente:

- alimentos do catálogo;
- alimentos próprios;
- receitas próprias;
- quantidades reais.

---

## 3. Sem nota de aderência por refeição

A V1 não exibe:

- percentual de aderência por refeição;
- nota por refeição;
- julgamento binário de “certo/errado”.

A comparação da refeição pode existir internamente para compor métricas agregadas.

---

## 4. Sem percentual diário de aderência

A V1 não mostra score diário de aderência.

O resumo diário prioriza:

- calorias consumidas vs. meta;
- proteína consumida vs. meta;
- carboidratos consumidos vs. meta;
- gorduras consumidas vs. meta;
- fibras consumidas vs. meta.

---

## 5. Comparação semanal

A V1 terá visão semanal.

A comparação pode considerar conjuntamente:

- semelhança dos alimentos consumidos com o plano recomendado;
- proximidade de calorias;
- proximidade de macros.

Não reduzir toda a experiência a um único número sem contexto.

---

## 6. Métricas semanais

Exemplos de métricas permitidas:

- média calórica;
- média de proteína;
- média de carboidratos;
- média de gordura;
- média de fibras;
- refeições registradas;
- frequência de escolha de opções recomendadas;
- dias próximos das metas;
- tendência de peso utilizando o módulo de evolução já existente.

---

## 7. Linguagem

Evitar:

- “você falhou”;
- “refeição errada”;
- “quebrou a dieta”;
- punição visual.

Preferir linguagem simples e humana:

- “Você consumiu mais do que o planejado.”
- “Sua proteína ficou abaixo da meta nesta semana.”
- “Você seguiu com frequência as opções recomendadas no almoço.”

---

## 8. Feedback sobre recomendações

O usuário pode sinalizar que não gostou de uma recomendação.

Esse feedback pode:

- gerar nova opção;
- alimentar preferências futuras;
- reduzir repetição daquele alimento/refeição.

---

## 9. Favoritos

O usuário pode favoritar opções/refeições recomendadas.

Favoritos podem aumentar prioridade em gerações futuras, desde que continuem compatíveis com:

- metas;
- restrições;
- catálogo;
- engine.

---

## 10. Separação entre recomendação e consumo

Regra arquitetural obrigatória:

`Plano recomendado != Diário alimentar`

Toda métrica deve deixar claro qual lado representa:

- meta/recomendação;
- comportamento real.
