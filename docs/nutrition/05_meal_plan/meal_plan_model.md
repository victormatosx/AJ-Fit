# AJ Fit Nutrition — Modelo do Plano Alimentar

## 1. Princípio central

Implementação backend V1: planos são criados apenas pelo worker depois da validação determinística. Cada item inclui `foodId`, `grams` e snapshot canônico do nome, nutrientes por 100 g, `source`/`sourceId`/`sourceVersion` quando houver e `catalogVersion`. O plano também persiste `physicalSnapshot`, `engineSnapshot`, `dailyTotals`, `generationMetadata` e todas as versões. A versão do schema do plano é `1.1.0`.

Na V1, o plano alimentar gerado pela IA é uma **recomendação**.

Ele não representa o que o usuário efetivamente consumiu.

O consumo real pertence ao diário alimentar e deve ser persistido separadamente.

Nunca misturar:

- `recommendedPlan`;
- `actualIntake`.

---

## 2. Duração

O plano não possui duração fixa.

Ele permanece ativo até:

- o usuário gerar um novo plano;
- o usuário restaurar um plano anterior;
- o plano ser desativado por regra futura.

---

## 3. Estrutura diária

A mesma estrutura recomendada vale para todos os dias da semana na V1.

Não há:

- cardápio por dia;
- diferenciação entre dia de treino e descanso;
- rotação semanal automática.

---

## 4. Refeições

O plano respeita os slots escolhidos pelo usuário no Perfil Nutricional.

Cada refeição possui:

- nome/slot;
- 2 ou 3 opções geradas pela IA;
- uma opção principal/recomendada;
- metas aproximadas da refeição;
- alimentos e quantidades de cada opção.

A IA decide se a refeição terá 2 ou 3 opções, respeitando o contrato de geração.

---

## 5. Opção principal

Cada refeição deve possuir uma opção principal.

Ela funciona como recomendação padrão.

O usuário pode escolher outra opção da mesma refeição sem alterar o plano estrutural.

---

## 6. Estrutura conceitual

```ts
interface NutritionMealPlan {
  planId: string;
  generationId: string;

  status: "active" | "archived";

  engineSnapshot: NutritionEngineSnapshot;
  profileSnapshot: NutritionProfileSnapshot;

  meals: NutritionMealPlanMeal[];

  createdAt: Timestamp;
  activatedAt: Timestamp;
  archivedAt?: Timestamp | null;

  // Exatamente `canonical/meal_plan_schema.json` ("versions",
  // additionalProperties: false) — energyRulesVersion/macroRulesVersion/
  // mealDistributionVersion NÃO entram aqui, vivem em `engineSnapshot`
  // (ver `07_backend/firestore_schema.md` §3.3).
  versions: {
    planSchemaVersion: string;
    nutritionEngineVersion: string;
    questionnaireVersion: number;
    foodCatalogVersion: string;
    aiGenerationSchemaVersion: string;
    promptVersion?: string;
  };
}
```

`ownerUid` não aparece no documento — como em `questionnaires`/`assessments`, é implícito pelo path `users/{uid}/nutritionPlans/{planId}`, nunca duplicado no corpo do documento.

```ts
interface NutritionMealPlanMeal {
  slot: MealSlot;

  recommendedOptionId: string;

  options: NutritionMealOption[];
}
```

```ts
interface NutritionMealOption {
  id: string;

  foods: Array<{
    foodId: string;
    grams: number;

    snapshot: {
      name: string;
      kcal: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      fiberG?: number | null;
    };
  }>;

  totals: NutritionTotals;
}
```

---

## 7. Diário alimentar

O diário é uma entidade separada.

```ts
interface NutritionDailyLog {
  id: string;
  ownerUid: string;
  localDate: string;

  meals: NutritionLoggedMeal[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

O diário registra o que aconteceu de fato.

---

## 8. Registro livre

Em cada refeição, o usuário pode:

- marcar que seguiu uma opção recomendada;
- registrar manualmente os alimentos consumidos;
- registrar alimentos diferentes dos recomendados;
- registrar quantidades diferentes;
- adicionar quantos alimentos forem necessários;
- utilizar alimentos próprios cadastrados pelo usuário;
- utilizar receitas próprias.

O plano recomendado não é alterado por essas ações.

---

## 9. Regra de imutabilidade histórica

Modificar o plano ativo nunca altera registros passados do diário.

Modificar o diário nunca altera retroativamente o plano recomendado.

Essa separação é obrigatória em toda a arquitetura.
