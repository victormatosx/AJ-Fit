# AJ Fit Nutrition — Contrato de Geração por IA

## 1. Objetivo

Definir o contrato entre o AI Orchestrator e o modelo.

---

## 2. Geração completa

Input conceitual:

```ts
interface GenerateMealPlanInput {
  generationId: string;

  targets: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };

  mealTargets: MealNutritionTarget[];

  profile: {
    dietaryPattern: DietaryPattern;
    preferredFoodIds: string[];
    usualFoodIds: string[];
    excludedFoodIds: string[];
    varietyPreference: VarietyPreference;
  };

  allowedFoods: AIFoodCandidate[];

  currentPreferencesMemory: StructuredNutritionPreferences;
}
```

---

## 3. Output

```ts
interface GeneratedMealPlan {
  meals: Array<{
    slot: MealSlot;
    recommendedOptionIndex: number;

    options: Array<{
      foods: Array<{
        foodId: string;
        grams: number;
      }>;
    }>;
  }>;
}
```

---

## 4. Regras de schema

O schema deve impedir:

- IDs livres não previstos;
- campos desconhecidos;
- ausência de refeições obrigatórias;
- quantidade inválida;
- opções fora do intervalo permitido;
- estruturas parciais.

O backend ainda deve validar semântica e nutrição após validar schema.

---

## 5. Número de opções

Cada refeição deve conter:

- mínimo 2 opções;
- máximo 3 opções;
- exatamente uma opção principal.

---

## 6. Nova opção de refeição

A geração parcial recebe somente:

- meta daquela refeição;
- contexto mínimo necessário;
- preferências;
- exclusões;
- opções já existentes;
- subconjunto permitido do catálogo.

Não enviar todo o plano ou todo o histórico quando não for necessário.

---

## 7. Idempotência

Toda solicitação deve possuir `generationId`.

Retries da mesma operação devem ser identificáveis para evitar persistência duplicada.

---

## 8. Persistência

Nenhuma saída do modelo é persistida como plano válido antes de:

1. schema validation;
2. food validation;
3. nutrition validation;
4. safety validation.
