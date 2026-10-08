# AJ Fit Nutrition — Modelo do Catálogo de Alimentos

## 1. Objetivo

Definir a estrutura canônica do catálogo de alimentos da V1.

O catálogo-base contém apenas **alimentos simples**.

Receitas não fazem parte do catálogo-base.

---

## 2. Princípios

- foco inicial em alimentos consumidos no Brasil;
- catálogo amplo;
- suporte a alimentos in natura e industrializados;
- nutrientes canônicos por 100 g;
- sem medidas caseiras na V1;
- nomes e aliases em português;
- IDs canônicos estáveis;
- versionamento obrigatório;
- somente alimentos aprovados podem ser usados pela IA;
- alimentos cadastrados pelo usuário não entram na geração automática da dieta na V1.

---

## 3. Food

Estrutura conceitual:

```ts
interface NutritionFood {
  id: string;

  name: string;
  aliases: string[];

  category: FoodCategory;

  source: {
    type: FoodSourceType;
    sourceId?: string;
    sourceName: string;
    sourceVersion?: string;
  };

  nutritionPer100g: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number | null;
  };

  dietaryFlags: {
    vegetarian: boolean;
    vegan: boolean;
  };

  allergens: FoodAllergen[];

  generationStatus: "approved" | "blocked" | "pending_review";

  brand?: {
    name: string;
    productName?: string;
  } | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  catalogVersion: string;
}
```

---

## 4. Alimentos industrializados

A V1 permite alimentos de marcas específicas.

Eles devem possuir:

- marca;
- nome comercial;
- nutrientes por 100 g;
- fonte dos dados;
- data/versão de revisão;
- status de aprovação para uso pela IA.

Quando a fonte for rótulo, o dado deve ser identificado como proveniente de rótulo.

---

## 5. Alimentos cadastrados pelo usuário

O usuário poderá cadastrar alimentos próprios.

Estrutura conceitual:

```ts
interface UserNutritionFood {
  id: string;
  ownerUid: string;

  name: string;

  nutritionPer100g: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number | null;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Regras:

- macros são inseridos manualmente pelo usuário;
- o alimento pode ser usado no diário alimentar;
- não entra na geração automática por IA na V1;
- não entra no catálogo global;
- não herda status de aprovação global.

---

## 6. Receitas

Receitas são entidades separadas.

Elas são compostas por alimentos simples + quantidades.

```ts
interface NutritionRecipe {
  id: string;
  ownerUid: string;

  name: string;
  description?: string;

  ingredients: Array<{
    foodId: string;
    grams: number;
  }>;

  calculatedNutrition: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number | null;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Os macros da receita são sempre derivados dos ingredientes.

Não permitir que o usuário sobrescreva manualmente os macros calculados da receita.

---

## 7. Snapshot e histórico

Planos antigos não devem depender da versão atual de um alimento.

Cada dieta deve guardar snapshot suficiente para reconstruir:

- nome usado;
- quantidade;
- macros usados;
- versão do catálogo;
- versão/fonte do alimento.

Alterações futuras no catálogo não devem modificar retroativamente dietas existentes.
