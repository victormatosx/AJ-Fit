# AJ Fit Nutrition — Eventos de Analytics

## 1. Princípio

Analytics deve medir comportamento de produto sem transportar dados nutricionais sensíveis detalhados.

Não enviar como payload de analytics:
- peso exato;
- alergias;
- lista de alimentos consumidos;
- lista de alimentos excluídos;
- conteúdo integral da dieta;
- conteúdo de prompts;
- respostas brutas da IA;
- dados clínicos;
- descrições livres do usuário.

## 2. Convenção

Eventos devem seguir a convenção já existente no AJ Fit.
Os nomes abaixo são conceituais e devem ser adaptados ao padrão real do projeto.

## 3. Entrada na Nutrição

### nutrition_tab_opened

Disparado quando o usuário abre a aba Nutrição.

Propriedades possíveis:
- `hasNutritionProfile`
- `hasActivePlan`
- `hasLogToday`

## 4. Perfil Nutricional

### nutrition_profile_started
### nutrition_profile_completed
### nutrition_profile_updated

Propriedades permitidas:
- `questionnaireVersion`
- `mealCount`
- `dietaryPattern`
- `varietyPreference`
- `hasExclusions`
- `hasPreferredFoods`
- `hasUsualFoods`

Não enviar IDs ou nomes dos alimentos.

## 5. Geração de dieta

### nutrition_plan_generation_requested
### nutrition_plan_generation_completed
### nutrition_plan_generation_failed

Propriedades:
- `generationType`
- `engineVersion`
- `promptVersion`
- `modelFamily`
- `retryCount`
- `fallbackUsed`
- `durationBucket`
- `failureCode`

## 6. Plano

### nutrition_plan_opened
### nutrition_meal_option_selected
### nutrition_plan_restored
### nutrition_plan_history_opened

Não enviar o conteúdo da refeição.

## 7. Diário alimentar

### nutrition_meal_log_started
### nutrition_meal_log_completed
### nutrition_meal_log_updated

Propriedades possíveis:
- `mealSlot`
- `usedRecommendedOption`
- `itemCountBucket`
- `usedCustomFood`
- `usedRecipe`

Não enviar nomes dos alimentos.

## 8. Frequência de registro

Evento derivado/agregado:

### nutrition_daily_logging_completed

Critério pode ser definido posteriormente como presença de pelo menos um registro válido no dia.

## 9. Troca de refeição

### nutrition_meal_alternative_requested
### nutrition_meal_alternative_generated
### nutrition_meal_alternative_accepted
### nutrition_meal_alternative_rejected

Propriedades:
- `mealSlot`
- `reasonCategory`
- `retryCount`
- `fallbackUsed`

Motivos devem ser enum estruturado, não texto livre.

## 10. Alimentos próprios

### nutrition_custom_food_created
### nutrition_custom_food_used

Sem nome ou macros detalhados no analytics.

## 11. Receitas

### nutrition_recipe_created
### nutrition_recipe_used

Propriedades:
- `ingredientCountBucket`

## 12. Favoritos

### nutrition_meal_favorited
### nutrition_meal_unfavorited

Não enviar conteúdo da refeição.

## 13. Visão semanal

### nutrition_weekly_summary_opened

Propriedades possíveis:
- `loggedDaysBucket`
- `hasWeightTrend`

## 14. Recomendações de novo plano

### nutrition_regeneration_recommended
### nutrition_regeneration_cta_clicked

Motivo em enum:
- `weight_change`
- `profile_change`
- `exclusion_conflict`
- `other_supported_reason`

## 15. Segurança

### nutrition_generation_blocked

Pode registrar somente:
- `gateType`

Exemplos:
- `pregnancy`
- `lactation`

## 16. Erros de produto

### nutrition_error_shown

Propriedades:
- `screen`
- `errorCode`
- `recoverable`

Nunca enviar stack trace para analytics de produto.
