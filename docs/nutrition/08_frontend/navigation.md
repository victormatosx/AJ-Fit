# AJ Fit Nutrition — Navegação

## 1. Entrada principal

A Nutrição será uma **aba principal** na navegação do AJ Fit.

Nome de produto:

`Nutrição`

A aba deve existir no mesmo nível das áreas principais do app.

---

## 2. Estrutura de navegação

Estrutura conceitual:

```text
NutritionTab
  NutritionHome
  NutritionOnboarding
  NutritionGenerating
  NutritionPlan
  MealDetails
  LogMeal
  FoodSearch
  CreateCustomFood
  CreateRecipe
  WeeklyNutrition
  NutritionHistory
  NutritionProfile
```

---

## 3. Home da Nutrição

A `NutritionHome` é a entrada padrão da aba.

Ela mistura:

- resumo do dia;
- consumo atual;
- recomendação da dieta;
- próxima refeição;
- refeições do dia;
- visão semanal resumida.

A Home não deve ser apenas uma lista de refeições nem apenas um dashboard.

---

## 4. Plano e Diário

Dentro da área principal da Nutrição, usar navegação interna entre:

- `Plano`
- `Diário`

O usuário deve entender claramente:

- Plano = recomendação;
- Diário = o que foi consumido.

Não misturar os dois semanticamente.

---

## 5. Primeira entrada

Se o usuário ainda não possui Perfil Nutricional completo:

`NutritionTab -> NutritionOnboarding`

Se possui perfil, mas ainda não possui plano:

`NutritionTab -> NutritionHome empty state -> Criar minha dieta`

---

## 6. Geração

Ao solicitar geração:

`NutritionHome / NutritionProfile -> NutritionGenerating`

A tela acompanha o `generationJob`.

Quando concluir:

`NutritionGenerating -> NutritionPlan`

Quando falhar:

mostrar erro tratável e permitir tentar novamente.

---

## 7. Histórico

`NutritionHistory` permite:

- visualizar planos arquivados;
- abrir detalhes;
- restaurar plano anterior.

Restaurar não altera diário alimentar.

---

## 8. Navegação de registro

Fluxo típico:

```text
NutritionHome
  -> refeição do dia
  -> MealDetails
  -> Registrar refeição
  -> LogMeal
  -> FoodSearch
```

Também deve existir ação rápida `+` na refeição.

---

## 9. Deep links internos

Arquitetura deve permitir abrir diretamente:

- refeição específica;
- plano ativo;
- dia específico do diário;
- visão semanal;
- geração em andamento.

Isso facilita notificações e futuras integrações.
