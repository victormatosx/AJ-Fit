# AJ Fit — Nutrition

## 1. Objetivo

Esta pasta documenta a arquitetura, regras, contratos e plano de implementação do módulo **Nutrição** do AJ Fit.

A V1 permitirá que um usuário elegível:

1. crie seu Perfil Nutricional;
2. gere uma dieta personalizada;
3. visualize refeições recomendadas;
4. registre livremente o que realmente consumiu;
5. acompanhe calorias e macronutrientes;
6. veja evolução semanal;
7. mantenha histórico de planos;
8. gere alternativas de refeições quando necessário.

A dieta gerada é uma **recomendação**.

O diário alimentar representa o **consumo real**.

Esses dois conceitos nunca devem ser confundidos na arquitetura.

---

# 2. Princípio arquitetural central

A arquitetura da Nutrição segue este fluxo:

```text
AJ Fit App
  -> Perfil Nutricional
  -> Nutrition Engine
  -> Food Catalog
  -> AI Generation
  -> Deterministic Validator
  -> Firestore
```

A IA é responsável por:

- combinar alimentos;
- criar opções de refeições;
- adaptar preferências;
- gerar alternativas.

A IA **não é autoridade** sobre:

- calorias;
- RMR;
- TDEE;
- déficit;
- superávit;
- proteína;
- gordura;
- carboidratos;
- fibra;
- safety gates;
- alergênicos;
- exclusões;
- composição nutricional dos alimentos.

Essas responsabilidades pertencem ao backend, ao Nutrition Engine e ao Food Catalog.

---

# 3. Source of truth

A documentação é dividida em três níveis.

## Documentação humana

Pastas:

```text
01_product
02_questionnaire
03_nutrition_engine
04_food_catalog
05_meal_plan
06_ai
07_backend
08_frontend
09_safety
10_integrations
11_analytics
12_testing
13_rollout
```

Explicam:

- decisões;
- racional;
- fluxos;
- comportamento esperado.

## Contratos machine-readable

Pasta:

```text
canonical/
```

Contém os arquivos que devem evoluir para fonte estruturada das regras:

```text
nutrition_rules.json
questionnaire.json
nutrition_constraints.json
meal_plan_schema.json
ai_output_schema.json
```

## Decisões arquiteturais

Pasta:

```text
decisions/
```

Contém ADRs.

O principal atualmente é:

```text
ADR-001-nutrition-architecture.md
```

---

# 4. Estrutura completa

```text
docs/
└── nutrition/
    ├── README.md
    │
    ├── 01_product/
    │   ├── vision_and_scope.md
    │   ├── user_flows.md
    │   ├── feature_matrix.md
    │   └── terminology.md
    │
    ├── 02_questionnaire/
    │   ├── nutrition_questionnaire.md
    │   ├── question_dependencies.md
    │   └── answer_schema.md
    │
    ├── 03_nutrition_engine/
    │   ├── energy_calculation.md
    │   ├── macro_calculation.md
    │   ├── goals_and_adjustments.md
    │   ├── meal_distribution.md
    │   ├── special_conditions.md
    │   └── nutrition_engine_contract.md
    │
    ├── 04_food_catalog/
    │   ├── food_catalog_model.md
    │   ├── nutritional_data_sources.md
    │   ├── portions_and_units.md
    │   ├── food_tags_and_classification.md
    │   └── substitutions.md
    │
    ├── 05_meal_plan/
    │   ├── meal_plan_model.md
    │   ├── meal_generation_rules.md
    │   ├── meal_substitution_rules.md
    │   ├── plan_versioning.md
    │   └── adherence_and_feedback.md
    │
    ├── 06_ai/
    │   ├── ai_architecture.md
    │   ├── ai_responsibilities.md
    │   ├── generation_contract.md
    │   ├── prompts_and_context.md
    │   ├── validation_pipeline.md
    │   ├── cost_and_rate_limits.md
    │   └── ai_observability.md
    │
    ├── 07_backend/
    │   ├── firestore_schema.md
    │   ├── cloud_functions.md
    │   ├── firestore_rules.md
    │   ├── indexes.md
    │   ├── secrets_and_api_keys.md
    │   └── backend_flows.md
    │
    ├── 08_frontend/
    │   ├── navigation.md
    │   ├── screens.md
    │   ├── components.md
    │   ├── states_and_loading.md
    │   ├── error_states.md
    │   └── offline_and_cache.md
    │
    ├── 09_safety/
    │   ├── nutrition_safety_rules.md
    │   ├── eligibility_and_gates.md
    │   ├── allergies_and_restrictions.md
    │   ├── medical_red_flags.md
    │   └── disclaimers_and_legal.md
    │
    ├── 10_integrations/
    │   ├── workout_integration.md
    │   ├── bodyweight_and_progress.md
    │   ├── notifications.md
    │   └── future_health_integrations.md
    │
    ├── 11_analytics/
    │   ├── events.md
    │   ├── product_metrics.md
    │   └── ai_metrics.md
    │
    ├── 12_testing/
    │   ├── test_strategy.md
    │   ├── nutrition_engine_cases.md
    │   ├── ai_evaluation_cases.md
    │   ├── firestore_rules_tests.md
    │   └── end_to_end_cases.md
    │
    ├── 13_rollout/
    │   ├── implementation_phases.md
    │   ├── migration_and_backward_compatibility.md
    │   ├── feature_flags.md
    │   └── launch_checklist.md
    │
    ├── canonical/
    │   ├── nutrition_rules.json
    │   ├── questionnaire.json
    │   ├── nutrition_constraints.json
    │   ├── meal_plan_schema.json
    │   └── ai_output_schema.json
    │
    └── decisions/
        ├── README.md
        └── ADR-001-nutrition-architecture.md
```

---

# 5. Escopo da V1

A V1 inclui:

- Perfil Nutricional;
- dieta gerada por IA;
- metas de calorias e macros;
- 2–3 opções por refeição;
- uma opção principal;
- diário alimentar livre;
- alimentos próprios;
- receitas próprias;
- troca de refeição completa;
- favoritos;
- histórico de planos;
- restauração;
- visão semanal;
- integração com peso/evolução;
- notificações;
- analytics;
- observabilidade de IA.

---

# 6. Fora da V1

Não entram inicialmente:

- reconhecimento de alimento por foto;
- leitura de código de barras;
- chat com IA;
- receitas geradas automaticamente;
- lista de compras;
- horários personalizados de refeição;
- dieta diferente em dia de treino e descanso;
- estratégia pré/pós-treino;
- Apple Health;
- Health Connect;
- Google Fit;
- suporte clínico para condições médicas;
- ajuste automático da dieta por novo peso.

---

# 7. Perfil Nutricional

O fluxo se chama:

`Perfil nutricional`

CTA final:

`Criar minha dieta`

O sistema reutiliza dados já existentes do AJ Fit:

- sexo;
- nascimento/idade;
- altura;
- objetivo;
- peso mais recente.

O Perfil Nutricional coleta principalmente:

- ritmo de progressão;
- peso-alvo opcional;
- atividade fora do treino;
- 2–6 refeições;
- slots de refeições;
- padrão alimentar;
- alimentos preferidos;
- alimentos habituais;
- alimentos excluídos;
- suplementos;
- lactação;
- preferência por repetição/variedade.

Gravidez vem da fonte já existente no AJ Fit.

---

# 8. Nutrition Engine

O engine é:

- determinístico;
- versionado;
- independente da IA.

A fórmula de energia basal definida para V1 é:

`Mifflin–St Jeor`

Macros:

- proteína: g/kg de peso atual;
- gordura: mínimo g/kg + ajuste;
- carboidratos: calorias restantes;
- fibra: baseada em kcal.

O engine também define:

- distribuição por refeição;
- tolerâncias;
- safety floors;
- limites de agressividade.

---

# 9. Food Catalog

A V1 é Brasil-first.

Hierarquia inicial de fontes:

1. TBCA;
2. TACO;
3. USDA FoodData Central;
4. rótulos/cadastro próprio para industrializados brasileiros.

O catálogo global contém apenas alimentos simples.

Receitas são entidades separadas.

Nutrientes são armazenados de forma canônica por:

`100 g`

A V1 não utiliza medidas caseiras.

---

# 10. Plano alimentar

O plano:

- não possui duração fixa;
- permanece ativo até nova geração/restauração;
- é igual todos os dias na V1;
- possui 2–3 opções por refeição;
- possui exatamente uma opção principal.

O usuário pode pedir nova opção para uma refeição completa.

A IA propõe.

O backend valida.

---

# 11. Diário alimentar

O usuário pode registrar livremente:

- qualquer alimento do catálogo;
- alimento próprio;
- receita própria;
- quantidades diferentes;
- refeições diferentes da recomendação.

Regra obrigatória:

```text
recommendedPlan != actualIntake
```

O consumo real nunca altera silenciosamente o plano recomendado.

---

# 12. IA

Provider inicial:

`OpenAI`

A arquitetura mantém abstração de provider.

Estratégia inicial:

- modelo intermediário para geração completa;
- modelo econômico para tarefas simples;
- modelo mais forte como fallback controlado.

Toda saída usa Structured Outputs.

Máximo:

`2 retries`

Antes de persistir:

1. validar schema;
2. validar IDs;
3. validar restrições;
4. validar alergênicos;
5. recalcular nutrientes;
6. validar macros;
7. corrigir quantidades deterministicamente;
8. retry/fallback quando necessário.

---

# 13. Backend

Estrutura principal:

```text
users/{uid}/nutritionProfile/current
users/{uid}/nutritionPlans/{planId}
users/{uid}/nutritionDailyLogs/{YYYY-MM-DD}
users/{uid}/nutritionRecipes/{recipeId}
users/{uid}/nutritionFoods/{foodId}
users/{uid}/nutritionPreferences/current
users/{uid}/nutritionGenerationJobs/{generationId}

nutritionFoods/{foodId}
nutritionCatalogMeta/current

nutritionAiOperations/{operationId}
nutritionRateLimits/{limitId}
```

O padrão segue a arquitetura atual do AJ Fit:

- owner-only para dados privados;
- backend autoritativo para dados sensíveis;
- Admin SDK para planos/jobs;
- Rules fechadas;
- histórico por snapshot.

---

# 14. Frontend

Nutrição é uma aba principal.

Telas principais:

- NutritionHome;
- NutritionOnboarding;
- NutritionGenerating;
- NutritionPlan;
- MealDetails;
- LogMeal;
- FoodSearch;
- CreateCustomFood;
- CreateRecipe;
- WeeklyNutrition;
- NutritionHistory;
- NutritionProfile.

A Home prioriza:

1. calorias/macros;
2. próxima refeição;
3. refeições do dia;
4. resumo semanal.

Plano e diário usam navegação interna:

`Plano | Diário`

---

# 15. Safety

Bloqueios da V1:

- gravidez;
- lactação.

Comportamento:

- bloquear geração;
- não chamar IA;
- sem bypass;
- recomendar profissional.

Exclusões alimentares são hard exclusions.

Alergênicos são uma segunda camada de proteção.

O Nutrition Engine impõe:

- calorie floors;
- limites de déficit/superávit;
- limites de agressividade.

---

# 16. Condições médicas

A V1 não coleta nem trata especificamente:

- diabetes;
- doença renal;
- doença hepática;
- doença cardiovascular;
- transtornos alimentares;
- outras condições clínicas.

O sistema não deve inferir diagnóstico.

Qualquer expansão clínica exige nova revisão de produto, safety, legal e arquitetura.

---

# 17. Integrações

## Treino

Nutrição pode usar frequência semanal de treino para estimar gasto energético.

Não usa treino do dia na V1.

## Evolução

Peso vem do módulo Evolução.

Novo peso não altera plano automaticamente.

## Notificações

V1:

- plano pronto;
- lembrete de registro;
- resumo semanal;
- recomendação de nova geração.

## Health integrations

Apple Health / Health Connect / Google Fit:

fora da V1.

A política futura de source of truth ainda está pendente.

---

# 18. Analytics

Métricas principais:

- usuários que registram refeições;
- Nutrition WAU;
- Logging WAU;
- dias registrados por semana;
- funil de geração;
- uso de opções recomendadas;
- uso de alternativas;
- criação de receitas/alimentos;
- AI cost/latency/validation.

Analytics não deve receber:

- peso exato;
- alergias detalhadas;
- alimentos consumidos;
- dieta integral;
- prompts;
- resposta bruta da IA.

---

# 19. Testing

Testes obrigatórios:

- unitários;
- Nutrition Engine golden cases;
- AI evaluation cases;
- Firestore Rules;
- Functions integration;
- E2E.

Safety, isolamento cross-user, idempotência e histórico são release blockers.

---

# 20. Rollout

Ordem recomendada:

```text
canonical
-> food catalog
-> nutrition engine
-> nutrition profile
-> backend
-> AI
-> frontend
-> diary
-> substitutions/history
-> integrations
-> analytics/hardening
-> beta
-> progressive rollout
```

Rollout:

```text
internal
-> 1%
-> 5%
-> 10%
-> 25%
-> 50%
-> 100%
```

Progressão manual.

---

# 21. Pendências antes de produção

Os seguintes valores ainda não devem ser tratados como definitivos:

- multiplicadores de atividade;
- percentuais de déficit;
- percentuais de superávit;
- regra de recomposição;
- calorie floors por sexo;
- ranges de proteína;
- ranges de gordura;
- fibra por 1000 kcal;
- tolerâncias;
- pesos de distribuição por refeição.

Esses campos permanecem marcados como:

`PENDING_PROFESSIONAL_VALIDATION`

em `canonical/nutrition_rules.json`.

Também permanece pendente:

- política de source of truth para futuras integrações de saúde.

---

# 22. Regra para implementação

Nenhuma implementação deve:

- inventar valor pendente;
- alterar contrato sem atualizar documentação;
- duplicar source of truth já existente;
- permitir que IA substitua regra determinística;
- relaxar safety para fazer uma geração passar.

Se uma decisão arquitetural relevante mudar:

1. atualizar a documentação correspondente;
2. atualizar `canonical/`;
3. criar ou atualizar ADR;
4. atualizar testes.

---

# 23. Ordem recomendada de leitura

Para entender o produto:

```text
README.md
-> 01_product
-> 02_questionnaire
-> 03_nutrition_engine
-> 04_food_catalog
-> 05_meal_plan
```

Para implementar:

```text
canonical/
-> decisions/
-> 03_nutrition_engine
-> 04_food_catalog
-> 06_ai
-> 07_backend
-> 08_frontend
-> 09_safety
-> 12_testing
-> 13_rollout
```

---

# 24. Status atual

Arquitetura funcional da V1:

`DEFINIDA`

Contratos canonical:

`DRAFT`

Regras numéricas clínicas:

`PENDING_PROFESSIONAL_VALIDATION`

Implementação:

`NOT STARTED / DEPENDE DO ESTADO REAL DO REPOSITÓRIO`

Lançamento:

`NOT READY`
