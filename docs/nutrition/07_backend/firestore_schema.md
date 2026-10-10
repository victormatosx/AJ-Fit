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
    meals/{slot}
      items/{itemId}
  nutritionRecipes/{recipeId}
  nutritionFoods/{foodId}
  nutritionPreferences/current
  nutritionFavoriteMealOptions/{favoriteId}
  nutritionGenerationJobs/{generationId}
```

Catálogo global:

```text
nutritionFoods/{foodId}
nutritionCatalogMeta/current
```

`nutritionCatalogMeta/current` é escrito apenas pelo importador Admin SDK.
Contém `schemaVersion: 1`, `catalogVersion`, `importedAt`, `sourceVersions`,
`sourceCounts` e `importedRecordCount` (contagem do lote importado, não do
catálogo completo). Nenhum write de cliente é permitido.

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

  // Carrega o output do engine (RMR/TDEE/macros/mealTargets) e as versões
  // internas das regras determinísticas (ver §3.3) — NÃO o objeto `versions`
  // abaixo. `canonical/meal_plan_schema.json` não restringe o shape de
  // `engineSnapshot` (`"type": "object"`), por isso é o lugar correto para
  // essas versões internas, que não podem entrar em `versions` (ver §3.3).
  engineSnapshot: object;

  meals: object[];

  // Exatamente os campos de `canonical/meal_plan_schema.json` ("versions",
  // additionalProperties: false) — nenhum campo além destes é aceito aqui.
  versions: {
    planSchemaVersion: string;
    nutritionEngineVersion: string;
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

### 3.3 `versions` vs. versões internas do engine (decisão final)

`canonical/meal_plan_schema.json`'s `versions` é `additionalProperties: false` e só aceita os 6 campos listados acima (todos obrigatórios em planos V1.1). `energyRulesVersion`, `macroRulesVersion` e `mealDistributionVersion` — exigidos por `03_nutrition_engine/nutrition_engine_contract.md` §6 — NÃO pertencem a esse objeto; eles vivem dentro de `engineSnapshot`, num sub-objeto de versões internas do engine (`NutritionEngineRuleVersions` em `src/types/nutrition.ts`):

```ts
interface NutritionEngineRuleVersions {
  nutritionEngineVersion: string;
  energyRulesVersion: string;
  macroRulesVersion: string;
  mealDistributionVersion: string;
  questionnaireVersion: number;
  foodCatalogVersion: string;
}
```

Isso resolve a divergência entre o schema canônico estrito e o §6 do contrato do engine sem relaxar `additionalProperties: false` em `versions`.

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

Estrutura conceitual do documento do dia — note que `meals` NÃO é um array
aninhado aqui (ver nota abaixo):

```ts
interface NutritionDailyLogDocument {
  localDate: string;
  timezone: string;

  totals: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };

  /** Agregado mantido incrementalmente pelo cliente a cada escrita de item — ver nota abaixo. */
  loggedItemCount: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Os totais podem ser persistidos como materialização para leitura rápida, mas devem ser recalculáveis a partir dos itens.

**Nota (2026-10-08, achado da Fase 31):** as refeições e seus itens NÃO
ficam em arrays aninhados neste documento. Seis refeições x seis itens
cada, revalidados por completo a cada escrita, excediam o orçamento de
1000 expressões por escrita das Firestore Rules — o mesmo limite que já
havia motivado isolar `favoriteMealOptions` em subcoleção (seção 8).
Cada refeição é seu próprio documento, e cada item logado é por sua vez
um documento dentro da refeição:

```text
users/{uid}/nutritionDailyLogs/{localDate}/meals/{slot}
users/{uid}/nutritionDailyLogs/{localDate}/meals/{slot}/items/{itemId}
```

```ts
interface NutritionLoggedMealDocument {
  slot: NutritionMealSlot; // == o id do próprio documento
  totals: NutritionTotals;
  followedRecommendedOptionId?: string | null;
}
interface NutritionLoggedFoodItemDocument {
  id: string; // == o id do próprio documento
  foodId: string;
  grams: number;
  source: "catalog_food" | "custom_food" | "recipe";
  snapshot: { name: string; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number };
  loggedAt: Timestamp;
}
```

O limite de até seis itens por refeição deixou de ser validado pelas
Rules (cada item agora é validado isoladamente, sem visibilidade sobre
quantos outros itens já existem na mesma refeição) e passou a ser apenas
uma convenção do cliente — não era um invariante de segurança, só um
limite de produto, igual a `nutritionRecipes`/`nutritionFoods` (que
também nunca tiveram um limite de contagem aplicado em Rules).

O serviço (`src/services/nutritionDiary.ts`) recompõe a mesma projeção
`NutritionDailyLogDocument.meals` que o resto do app sempre consumiu —
telas e o resumo semanal não sabem que o armazenamento é dividido.

---

## 6. nutritionRecipes

```text
users/{uid}/nutritionRecipes/{recipeId}
```

Receitas próprias do usuário.

Cliente pode criar/editar/excluir as próprias receitas dentro de Rules estritas.

Nutrientes derivados devem ser recalculados no backend ou por lógica compartilhada confiável antes de uso autoritativo.

Base de Rules (2026-10-08): o cliente persiste `id`, `name`, `description?`,
`ingredients`, `createdAt` e `updatedAt`. `calculatedNutrition` fica ausente
nesse write e só pode ser acrescentado/recalculado pelo backend; as Rules não
conseguem provar uma soma de nutrientes a partir de ingredientes arbitrários.
Até existir esse cálculo, receitas próprias são rascunhos e não devem ser
tratadas como fonte autoritativa de macros.

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

Shape fechado escrito pelo cliente:

```ts
{
  favoriteFoodIds: string[];   // catálogo global ou nutritionFoods do usuário
  favoriteRecipeIds: string[]; // somente nutritionRecipes do usuário
  updatedAt: Timestamp;
}
```

As duas listas são independentes, persistem apenas IDs estáveis e têm um
limite técnico combinado de 20 itens para manter a validação integral abaixo do
orçamento de expressões das Firestore Rules. Nenhum snapshot nutricional é
duplicado neste documento; a UI sempre resolve o alimento/receita atual.

Separar do `nutritionProfile` evita reescrever um documento de questionário a cada feedback operacional.

Opções inteiras de refeição favoritas são um terceiro conceito e ficam
isoladas em:

```text
users/{uid}/nutritionFavoriteMealOptions/{favoriteId}
```

Cada documento contém um snapshot fechado de uma única opção (plano ou
alternativa), com no máximo oito alimentos. O isolamento evita a expansão
combinatória de validação de arrays aninhados nas Firestore Rules e permite
validar integralmente shape, enums, strings e números. O serviço limita a
lista exibida às dez opções mais recentes.

---

## 9. nutritionGenerationJobs

Implementação: além dos campos do contrato inicial, o backend mantém `ownerUid`, `leaseUntil`, `nextAttemptAt`, `aiAttemptCount` e `lastFailureCode` para reparo de jobs após perda de processo. `nutritionRateLimits/{uid}` contém locks/cursores de plano e alternativa, janela horária, request IDs e `activePlanId`; não é legível pelo cliente. Cada `nutritionAiOperations/{generationId}-{attempt}` contém `ownerUid`, operation, model/provider, versões, tentativa/retry, fallback, latência, usage real, status/failure e custo versionado somente quando calculável. O registry de account deletion apaga ambos. `nutritionPlans/{planId}` guarda apenas snapshots canônicos aprovados; `physicalSnapshot`, `dailyTotals` e `generationMetadata` completam a versão 1.1.0 do schema.

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
