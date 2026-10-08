# AJ Fit Nutrition — Feature Flags

## 1. Objetivo

Permitir rollout gradual, desligamento rápido e controle independente por capacidade.

---

## 2. Flag principal

### nutritionEnabled

Controla acesso global à Nutrição.

Quando false:
- esconder tab;
- bloquear endpoints de geração quando aplicável;
- não apagar dados.

---

## 3. Flags recomendadas

### nutritionProfileEnabled

Perfil Nutricional disponível.

### nutritionPlanGenerationEnabled

Permite novas gerações.

### nutritionDiaryEnabled

Permite diário alimentar.

### nutritionMealAlternativeEnabled

Permite gerar nova opção de refeição.

### nutritionWeeklySummaryEnabled

Ativa resumo semanal.

### nutritionNotificationsEnabled

Ativa notificações de Nutrição.

### nutritionCustomFoodsEnabled

Ativa alimentos próprios.

### nutritionRecipesEnabled

Ativa receitas.

---

## 4. Flags de IA

### nutritionAiFallbackEnabled

Permite fallback para modelo mais forte.

### nutritionAiRealProviderEnabled

Permite provider real.

Útil para:
- ambientes;
- beta;
- rollback.

---

## 5. Flags de safety/hardening

Safety gates não devem ser desativáveis por flag de produto comum.

Nunca criar flag como:
- disablePregnancyGate;
- ignoreAllergens;
- bypassCalorieFloor.

---

## 6. Rollout percentual

Se a infraestrutura atual suportar targeting:

- percent rollout;
- whitelist interna;
- QA users;
- platform;
- app version.

---

## 7. Autoridade

O backend deve validar flags críticas.

Não confiar apenas no frontend escondendo botão.

Exemplo:
`nutritionPlanGenerationEnabled == false`
deve bloquear a Function.

---

## 8. Defaults

Defaults seguros:

- feature global OFF antes do lançamento;
- AI provider real OFF em ambientes não aprovados;
- fallback controlado;
- safety sempre ON.

---

## 9. Observabilidade

Toda operação deve registrar flags relevantes quando afetarem comportamento.

---

## 10. Remoção

Depois de rollout estável:
- remover flags temporárias;
- evitar acumular feature flags mortas.
