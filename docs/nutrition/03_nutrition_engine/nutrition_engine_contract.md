# AJ Fit Nutrition — Contrato do Nutrition Engine

## 1. Autoridade do engine

O Nutrition Engine é autoridade para:

- elegibilidade;
- RMR;
- TDEE;
- meta calórica;
- déficit/superávit;
- proteína;
- gordura;
- carboidratos;
- fibras;
- tolerâncias;
- distribuição por refeição;
- validação numérica;
- safety gates.

A IA não é autoridade para esses itens.

## 2. Pipeline

`Perfil -> Nutrition Engine -> Food Catalog -> IA -> Validador determinístico -> Persistência`

## 3. Input conceitual

```ts
interface NutritionEngineInput {
  inherited: {
    sex: ExistingSexType;
    ageYears: number;
    heightCm: number;
    currentWeightKg: number;
    goal: ExistingGoalType;
    pregnancyStatus?: ExistingPregnancyType;
  };

  nutritionProfile: {
    progressionPace?: ProgressionPace;
    targetWeightKg?: number | null;
    nonTrainingActivityLevel: NonTrainingActivityLevel;
    meals: MealSlot[];
    dietaryPattern: DietaryPattern;
    excludedFoodIds: string[];
    preferredFoodIds: string[];
    usualFoodIds: string[];
    breastfeeding?: boolean | null;
    varietyPreference: VarietyPreference;
  };
}
```

## 4. Output conceitual

```ts
interface NutritionEngineOutput {
  eligible: boolean;
  blockers: NutritionEligibilityBlocker[];

  energy: {
    rmrKcal: number;
    tdeeKcal: number;
    targetKcal: number;
    safetyClampApplied: boolean;
  };

  macros: {
    proteinG: number;
    fatG: number;
    carbsG: number;
    fiberG: number;
  };

  mealTargets: MealNutritionTarget[];
  calculationTrace: NutritionCalculationTrace;
}
```

## 5. Validação pós-IA

Após a IA:

1. resolver alimentos para IDs canônicos;
2. recalcular nutrientes pelo catálogo;
3. comparar com as metas;
4. corrigir quantidades deterministicamente quando possível;
5. se não for possível, rejeitar a tentativa e gerar novamente.

Ordem definida:

**corrigir primeiro -> regenerar depois**.

## 6. Determinismo e versionamento

Com os mesmos inputs e versões, as metas calculadas devem ser iguais.

Persistir no mínimo:

- `nutritionEngineVersion`;
- `energyRulesVersion`;
- `macroRulesVersion`;
- `mealDistributionVersion`;
- `questionnaireVersion`;
- `foodCatalogVersion`.
