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

Contém somente respostas específicas de Nutrição, mais o **estado atual** de gravidez/lactação (ver `3.1`).

Não duplicar como nova fonte mutável:

- sexo;
- nascimento/idade;
- altura;
- peso;
- objetivo geral.

Esses dados continuam em suas fontes autoritativas já existentes (ver hierarquia completa em `3.2`).

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

  // Estado atual, não snapshot. Editável pela usuária e revalidado a
  // cada geração pelo backend. `pregnant` é pré-preenchido a partir de
  // `Quiz.pregnancyScreening` (snapshot imutável do onboarding) apenas na
  // criação inicial deste documento; depois disso, Quiz.pregnancyScreening
  // nunca é lido de novo. `breastfeeding` não tem fonte prévia no AJ Fit e
  // vive inteiramente aqui.
  pregnant: boolean;
  breastfeeding: boolean;

  varietyPreference:
    | "repeatable"
    | "variety"
    | "indifferent";

  updatedAt: Timestamp;
}
```

### 3.1 Gravidez e lactação são estado atual, não dado herdado

Ao contrário de sexo/altura/idade/peso/objetivo (seção `3.2`), gravidez e lactação **não** são lidos de uma fonte autoritativa externa a cada geração:

- `pregnant`: pré-preenchido 1x a partir de `Quiz.pregnancyScreening` na criação do documento; depois disso, só é lido/escrito via `nutritionProfile/current`;
- `breastfeeding`: não existe fonte prévia confiável no restante do AJ Fit; é coletado e mantido inteiramente aqui.

O backend deve validar `nutritionProfile/current.pregnant` e `nutritionProfile/current.breastfeeding` antes de toda nova geração. Ambos continuam sendo safety gates bloqueadores (ver `09_safety/eligibility_and_gates.md`) e nenhum dos dois pode ter bypass.

### 3.2 Hierarquia das fontes físicas

Para evitar ambiguidade, esta é a fonte autoritativa exata de cada dado físico consumido por Nutrição:

| Dado | Fonte primária | Fallback |
|---|---|---|
| Nascimento/idade | `UserProfile.profile.birthDate` (`src/services/userProfile.ts`) | `Quiz.birthDate` (questionário imutável) |
| Altura | `UserProfile.profile.height` (`src/services/userProfile.ts`) | `Quiz.height` (questionário imutável) |
| Peso | Assessment mais recente em `users/{uid}/assessments/{id}`, ordenado por `measuredAt` desc (`src/services/assessments.ts`) | — (obrigatório; bloqueia geração se ausente) |
| Sexo | `Quiz.sex` | — (não há fonte mutável melhor hoje) |
| Objetivo | `Quiz.goal` | — (não há fonte mutável melhor hoje) |
| Gravidez | `nutritionProfile/current.pregnant` | Pré-preenchimento inicial único a partir de `Quiz.pregnancyScreening` |
| Lactação | `nutritionProfile/current.breastfeeding` | — (sem fonte prévia) |

Nenhum desses dados deve ser copiado para dentro de `nutritionProfile` como uma nova fonte mutável de verdade — Nutrição sempre lê diretamente da fonte da tabela acima no momento da geração e materializa o valor usado apenas dentro do snapshot imutável do plano gerado.

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
