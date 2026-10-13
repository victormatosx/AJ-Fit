# AJ Fit Nutrition — Componentes

## 1. DailyNutritionSummary

Resumo de:

- kcal;
- proteína;
- carboidratos;
- gordura;
- fibra.

Comparação entre consumido e meta.

---

## 2. MacroProgress

Componente reutilizável para macro individual.

Estados:

- abaixo;
- próximo da meta;
- acima.

A linguagem visual não deve punir.

---

## 3. NextMealCard

Mostra:

- nome da refeição;
- opção recomendada;
- principais alimentos;
- ação para abrir;
- ação rápida para registrar.

---

## 4. MealCard

Usado na lista diária.

Conteúdo:

- slot;
- status de registro;
- resumo recomendado;
- resumo consumido;
- botão `+`/registrar.

---

## 5. PlanDiarySegmentedControl

Alternância:

`Plano | Diário`

Deve deixar a separação conceitual evidente.

---

## 6. MealOptionCard

Exibe uma opção recomendada.

Estados:

- principal;
- alternativa;
- selecionada;
- trocada.

---

## 7. FoodRow

Usado em:

- busca;
- diário;
- receita;
- detalhe de refeição.

Campos:

- nome;
- marca quando existir;
- quantidade;
- macros resumidos.

---

## 8. QuantityEditor

Editor em gramas.

A V1 não usa medidas caseiras.

---

## 9. GenerationProgress

Componente visual da tela de geração.

Reutilizar linguagem visual do fluxo de montagem de treino quando fizer sentido.

---

## 10. WeeklySummaryCard

Resumo compacto na Home.

Ao tocar:

`WeeklyNutrition`

---

## 11. EmptyNutritionState

Quando ainda não há plano:

- mensagem curta;
- benefício;
- CTA `Criar minha dieta`.

---

## 12. NutritionErrorState

Componente comum para:

- falha de geração;
- erro de catálogo;
- erro de carregamento;
- indisponibilidade temporária.

Sempre apresentar próxima ação possível.
