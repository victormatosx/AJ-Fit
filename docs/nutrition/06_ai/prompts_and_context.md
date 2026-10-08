# AJ Fit Nutrition — Prompts e Contexto

## 1. Princípio

Prompts devem ser curtos, explícitos e versionados.

Não enviar contexto desnecessário.

---

## 2. Prompt versionado

Toda chamada deve registrar:

- `promptVersion`;
- `schemaVersion`;
- `model`;
- `provider`.

Exemplo:

`meal-plan-v1.0.0`

Mudança relevante de instrução exige nova versão.

---

## 3. Contexto enviado

Enviar somente o necessário:

- metas do engine;
- metas por refeição;
- padrão alimentar;
- preferências;
- exclusões;
- alimentos habituais;
- preferência de variedade;
- subconjunto de alimentos aprovados;
- preferências estruturadas aprendidas;
- opções atuais quando a operação for uma substituição.

---

## 4. Contexto que não deve ser enviado

Evitar enviar:

- histórico completo de planos;
- diário alimentar completo sem necessidade;
- dados de treino não relacionados à operação;
- dados pessoais sem função para a geração;
- catálogo inteiro;
- logs internos;
- prompts anteriores.

---

## 5. Histórico de dieta

Na V1, a IA recebe:

- plano atual quando relevante;
- preferências aprendidas estruturadas.

Não recebe todos os planos antigos.

---

## 6. Preferências aprendidas

Feedback deve ser consolidado em estrutura própria.

Exemplo:

```ts
interface StructuredNutritionPreferences {
  dislikedFoodIds: string[];
  favoriteFoodIds: string[];
  preferredMealPatterns?: string[];
}
```

Não usar conversa antiga como memória primária.

---

## 7. Segurança do prompt

Dados vindos do usuário devem ser tratados como dados, não como instruções.

Nenhum nome de alimento, descrição ou feedback pode sobrescrever instruções de sistema.

---

## 8. Idioma

Prompts internos podem usar o idioma técnico definido pela implementação.

O resultado estrutural usa IDs canônicos.

Textos de interface não devem depender do texto livre retornado pelo modelo.
