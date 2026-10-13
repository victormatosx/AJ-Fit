# AJ Fit Nutrition — Fluxos Autoritativos do Backend

## 1. Gerar plano

```text
Mobile
  -> requestNutritionPlanGeneration
  -> auth/accountActive
  -> rate limit
  -> acquire generation lock
  -> create generationJob
  -> load authoritative user data
  -> load nutritionProfile
  -> run Nutrition Engine
  -> eligibility gates
  -> select approved foods
  -> AI generation
  -> schema validation
  -> deterministic nutrition validation
  -> deterministic correction
  -> retry/fallback if necessary
  -> transaction: archive current + persist/activate new
  -> complete job
  -> release lock
```

---

## 2. Mobile acompanha geração

Mobile observa:

```text
users/{uid}/nutritionGenerationJobs/{generationId}
```

Estados:

- queued;
- running;
- validating;
- completed;
- failed.

Em `completed`, o job fornece `planId`.

---

## 3. Registrar consumo

```text
Mobile
  -> users/{uid}/nutritionDailyLogs/{localDate}
```

Escrita direta com Rules.

Não chamar IA.

Não alterar plano recomendado.

---

## 4. Trocar refeição recomendada

```text
Mobile
  -> regenerateNutritionMeal
  -> auth/rate limit
  -> load active plan
  -> select relevant food subset
  -> cheap AI model
  -> validate
  -> correct
  -> retry/fallback
  -> return candidate
  -> user confirms
  -> backend persists plan mutation/audit event
```

---

## 5. Restaurar plano antigo

```text
Mobile
  -> activateNutritionPlan(planId)
  -> backend validates ownership
  -> transaction:
       archive active
       activate selected
```

Diário não é tocado.

---

## 6. Atualizar perfil

Cliente salva `nutritionProfile/current`.

Mudanças não alteram plano atual automaticamente.

UI pode recomendar geração nova.

Se exclusões entrarem em conflito com plano atual, backend/UI detecta incompatibilidade e recomenda regeneração.

---

## 7. Catálogo

Mobile lê catálogo aprovado.

Escrita global somente via backend/admin tooling.

Alimentos próprios ficam em subcoleção privada.

---

## 8. Account deletion

Nutrição deve integrar-se ao workflow autoritativo de exclusão já existente.

Remover:

- profile;
- plans;
- logs;
- recipes;
- private foods;
- preferences;
- jobs;
- telemetry user-linked permitida pela política de retenção.

Catálogo global não é afetado.

---

## 9. Decisões arquiteturais finais

### Perfil
`users/{uid}/nutritionProfile/current`

### Planos
`users/{uid}/nutritionPlans/{planId}`

### Diário
`users/{uid}/nutritionDailyLogs/{localDate}`

### Catálogo
`nutritionFoods/{foodId}`

### Geração
job assíncrono e backend-authoritative

### Escrita
- perfil/diário/receitas/alimentos próprios: cliente + Rules;
- planos/jobs/IA/catálogo global: backend.

### Secrets
Google Secret Manager/Firebase Functions Secrets.

Esse desenho mantém consistência com os padrões atuais do AJ Fit e separa claramente dados de interação rápida de dados autoritativos.
