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
  };

  workout: {
    weeklyTrainingFrequency: number;
  };

  nutritionProfile: {
    progressionPace?: ProgressionPace;
    targetWeightKg?: number | null;
    nonTrainingActivityLevel: NonTrainingActivityLevel;
    mealSlots: MealSlot[];
    dietaryPattern: DietaryPattern;
    excludedFoodIds: string[];
    preferredFoodIds: string[];
    usualFoodIds: string[];
    pregnant: boolean;
    breastfeeding: boolean;
    varietyPreference: VarietyPreference;
    nutritionGoalCategory?: NutritionGoalCategory;
  };
}
```

Nota (decisão final, substitui versão anterior deste documento): `pregnant`/`breastfeeding` **não são** campos herdados (`inherited`) — são estado atual, lido de `nutritionProfile/current.pregnant`/`.breastfeeding` (ver `07_backend/firestore_schema.md` §3.1). Removidos de `inherited.pregnancyStatus`; passam a fazer parte de `nutritionProfile` acima, como qualquer outro campo do Perfil Nutricional.

Nota (ajuste de implementação): `workout.weeklyTrainingFrequency` foi adicionado como campo de topo do input — nenhum documento anterior o havia incluído explicitamente no contrato, apesar de `energy_calculation.md` §3 e `10_integrations/workout_integration.md` exigirem esse dado para o cálculo de TDEE. Reaproveita exatamente `WorkoutNutritionContext` (`src/types/nutrition.ts`), sem duplicar o contrato.

### 3.1 Elegibilidade e erro de domínio (decisão final)

O Engine não produz metas normais quando `nutritionProfile.pregnant === true` ou `nutritionProfile.breastfeeding === true` — gates bloqueadores sem bypass (`09_safety/nutrition_safety_rules.md` §2). Também não produz metas quando o objetivo é ambíguo e `nutritionGoalCategory` está ausente. Em ambos os casos, a função principal do Engine lança um erro de domínio explícito e tipado (`NutritionEngineError`, `src/nutrition/engine/errors.ts`) — nunca um default silencioso nem um resultado parcial/zerado disfarçado de válido.

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

Esses seis campos formam `NutritionEngineRuleVersions` e vivem dentro de `engineSnapshot` do plano persistido — **não** dentro do objeto `versions` de nível superior, que segue `canonical/meal_plan_schema.json` (`additionalProperties: false`, 5 campos de base + `promptVersion`, obrigatório nos planos gerados pela implementação V1). Ver `07_backend/firestore_schema.md` §3.3 para a decisão completa.
