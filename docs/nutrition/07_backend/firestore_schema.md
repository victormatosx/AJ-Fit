# AJ Fit Nutrition — Firestore Schema

## 1. Princípio

A Nutrição deve seguir o padrão já existente no AJ Fit:

- dados privados e pertencentes ao usuário ficam sob `users/{uid}/...`;
- dados autoritativos e derivados pelo backend não são graváveis diretamente pelo cliente;
- catálogos globais ficam fora de `users`;
- histórico é preservado em documentos separados, não sobrescrito;
- documentos devem ser pequenos e orientados aos padrões reais de leitura.

---

## 2. Estrutura proposta

```text
users/{uid}
  nutritionProfile/current
  nutritionPlans/{planId}
  nutritionDailyLogs/{localDate}
  nutritionRecipes/{recipeId}
  nutritionFoods/{foodId}
  nutritionPreferences/current
  nutritionGenerationJobs/{generationId}
```

Catálogo global:

```text
nutritionFoods/{foodId}
nutritionCatalogMeta/current
```

Observabilidade/backend-only:

```text
nutritionAiOperations/{operationId}
nutritionRateLimits/{limitId}
```

---

## 3. nutritionProfile

```text
users/{uid}/nutritionProfile/current
```

Contém somente respostas específicas de Nutrição.

Não duplicar:

- sexo;
- nascimento/idade;
- altura;
- peso;
- objetivo geral.

Esses dados continuam em suas fontes autoritativas já existentes.

Campos conceituais:

```ts
interface NutritionProfileDocument {
  questionnaireVersion: number;

  progressionPace: "gradual" | "moderate" | "accelerated";
  targetWeightKg?: number | null;

  nonTrainingActivityLevel:
    | "sedentary"
    | "low_active"
    | "active"
    | "very_active";

  mealSlots: MealSlot[];

  dietaryPattern:
    | "omnivore"
    | "vegetarian"
    | "vegan"
    | "pescatarian";

  preferredFoodIds: string[];
  usualFoodIds: string[];
  excludedFoodIds: string[];

  supplements: string[];
  breastfeeding?: boolean | null;

  varietyPreference:
    | "repeatable"
    | "variety"
    | "indifferent";

  updatedAt: Timestamp;
}
```

---

## 4. nutritionPlans

```text
users/{uid}/nutritionPlans/{planId}
```

Planos são snapshots autoritativos gerados pelo backend.

O mobile pode ler, mas não criar, alterar ou apagar diretamente.

Campos principais:

```ts
interface NutritionPlanDocument {
  planId: string;
  generationId: string;

  status: "active" | "archived";

  profileSnapshot: object;
  engineSnapshot: object;

  meals: object[];

  versions: {
    planSchemaVersion: string;
    nutritionEngineVersion: string;
    energyRulesVersion: string;
    macroRulesVersion: string;
    mealDistributionVersion: string;
    questionnaireVersion: number;
    foodCatalogVersion: string;
    aiGenerationSchemaVersion: string;
    promptVersion: string;
  };

  createdAt: Timestamp;
  activatedAt: Timestamp;
  archivedAt?: Timestamp | null;
}
```

Só pode existir um plano `active` por usuário.

Essa invariância deve ser garantida pelo backend com transação, não por confiança no cliente.

---

## 5. nutritionDailyLogs

```text
users/{uid}/nutritionDailyLogs/{YYYY-MM-DD}
```

Um documento por data local.

Motivos:

- acesso direto O(1) por dia;
- tela diária não exige query;
- escrita isolada por dia;
- histórico simples;
- evita documento único crescendo indefinidamente.

Estrutura conceitual:

```ts
interface NutritionDailyLogDocument {
  localDate: string;
  timezone: string;

  meals: LoggedMeal[];

  totals: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Os totais podem ser persistidos como materialização para leitura rápida, mas devem ser recalculáveis a partir dos itens.

---

## 6. nutritionRecipes

```text
users/{uid}/nutritionRecipes/{recipeId}
```

Receitas próprias do usuário.

Cliente pode criar/editar/excluir as próprias receitas dentro de Rules estritas.

Nutrientes derivados devem ser recalculados no backend ou por lógica compartilhada confiável antes de uso autoritativo.

---

## 7. nutritionFoods do usuário

```text
users/{uid}/nutritionFoods/{foodId}
```

Alimentos personalizados.

Uso permitido no diário.

Não entram automaticamente na geração por IA da V1.

---

## 8. nutritionPreferences

```text
users/{uid}/nutritionPreferences/current
```

Memória estruturada persistente, por exemplo:

- favoritos;
- alimentos rejeitados;
- padrões preferidos.

Separar do `nutritionProfile` evita reescrever um documento de questionário a cada feedback operacional.

---

## 9. nutritionGenerationJobs

```text
users/{uid}/nutritionGenerationJobs/{generationId}
```

Documento de status do job.

```ts
type NutritionGenerationStatus =
  | "queued"
  | "running"
  | "validating"
  | "completed"
  | "failed";
```

Campos:

- operationType;
- status;
- requestedAt;
- startedAt;
- completedAt;
- planId quando concluído;
- errorCode sanitizado;
- retryCount.

Cliente pode ler o próprio job.

Cliente não altera status diretamente.

---

## 10. catálogo global

```text
nutritionFoods/{foodId}
```

Global e compartilhado.

Leitura permitida ao app autenticado/ativo conforme política do produto.

Escrita somente backend/admin tooling.

Não duplicar catálogo por usuário.

---

## 11. observabilidade

```text
nutritionAiOperations/{operationId}
```

Backend-only.

Não expor logs operacionais ao mobile.

Guardar somente dados necessários de custo, latência, versão, erro e validação.

---

## 12. escalabilidade

Evitar:

- arrays ilimitados em `users/{uid}`;
- plano e diário no mesmo documento;
- histórico inteiro em um único documento;
- catálogo dentro do usuário;
- logs de IA dentro do plano.

A granularidade proposta distribui writes, reduz contenção e mantém queries simples.
