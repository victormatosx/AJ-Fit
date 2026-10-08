# AJ Fit Nutrition — Fases de Implementação

## 1. Objetivo

Implementar Nutrição de forma incremental, mantendo segurança, testabilidade e possibilidade de rollback.

A ordem das fases deve respeitar dependências reais do domínio.

---

## 2. Fase 0 — Canonical e contratos

Antes de UI ou IA em produção:

- fechar `canonical/nutrition_rules.json`;
- fechar `canonical/questionnaire.json`;
- fechar `canonical/nutrition_constraints.json`;
- fechar `canonical/meal_plan_schema.json`;
- fechar `canonical/ai_output_schema.json`;
- versionar enums e contratos;
- revisar regras nutricionais numéricas com profissional qualificado.

Saída:
- regras fechadas;
- schemas versionados;
- fixtures de teste.

---

## 3. Fase 1 — Food Catalog

Implementar:

- schema global de alimentos;
- importação TBCA/TACO/USDA/rótulos;
- categorias;
- aliases;
- dietary flags;
- alergênicos;
- `generationStatus`;
- versionamento;
- busca PT-BR.

Também:
- alimentos próprios do usuário;
- receitas próprias.

Critério de saída:
- catálogo utilizável sem IA;
- cobertura suficiente para os alimentos mais comuns do Brasil;
- testes de qualidade aprovados.

---

## 4. Fase 2 — Nutrition Engine

Implementar engine 100% determinístico:

- RMR;
- TDEE;
- activity;
- objetivo;
- pace;
- safety floors;
- proteínas;
- gorduras;
- carboidratos;
- fibras;
- distribuição por refeição;
- tolerâncias;
- snapshots;
- versionamento.

Critério:
- golden cases aprovados;
- safety tests verdes;
- determinismo comprovado.

---

## 5. Fase 3 — Perfil Nutricional

Implementar:

- fluxo progressivo;
- reaproveitamento de dados existentes;
- meal slots 2–6;
- preferências;
- exclusões;
- suplementos;
- activity outside training;
- pregnancy/lactation gates;
- revisão final.

Sem IA ainda.

Critério:
- perfil persistido;
- Rules testadas;
- snapshot de geração preparado.

---

## 6. Fase 4 — Backend base

Implementar:

- collections/subcollections;
- Rules;
- indexes necessários;
- Functions base;
- job model;
- locks;
- idempotência;
- secrets;
- observabilidade;
- account deletion integration.

Critério:
- flows no Emulator;
- cross-user isolation;
- geração job-safe mesmo com provider fake.

---

## 7. Fase 5 — IA e geração de plano

Implementar:

- provider abstraction;
- OpenAI provider;
- prompts versionados;
- Structured Outputs;
- seleção de food subset;
- validator;
- correção determinística;
- retries;
- fallback;
- persistência do plano.

Critério:
- AI eval suite aprovada;
- custo/latência dentro do budget;
- nenhuma saída inválida persistida.

---

## 8. Fase 6 — Frontend do plano

Implementar:

- Nutrition tab;
- NutritionHome;
- empty state;
- NutritionGenerating;
- NutritionPlan;
- MealDetails;
- Plano | Diário.

Critério:
- fluxo completo geração -> visualização;
- estados de erro;
- background reconciliation.

---

## 9. Fase 7 — Diário alimentar

Implementar:

- LogMeal;
- FoodSearch;
- registro livre;
- alimentos próprios;
- receitas;
- edição;
- totais do dia;
- comparação com metas.

Critério:
- plano e diário totalmente separados;
- performance aceitável;
- histórico íntegro.

---

## 10. Fase 8 — Trocas, favoritos e histórico

Implementar:

- gerar nova opção de refeição;
- feedback;
- favoritos;
- NutritionHistory;
- restauração de plano;
- conflitos com novas exclusões.

Critério:
- single-active-plan preservado;
- diário nunca alterado por mudanças de plano.

---

## 11. Fase 9 — Weekly e integrações

Implementar:

- WeeklyNutrition;
- peso da Evolução;
- notificações;
- resumo semanal;
- recomendação de nova geração.

Critério:
- sem recalcular plano automaticamente;
- integração sem duplicar source of truth.

---

## 12. Fase 10 — Analytics e hardening

Implementar:

- eventos;
- dashboards;
- IA metrics;
- alertas;
- rate limits finais;
- stress tests;
- privacy review.

---

## 13. Fase 11 — Beta controlado

Liberar por feature flag para grupo pequeno.

Monitorar:
- geração válida;
- failures;
- custo;
- latência;
- crashes;
- Rules;
- feedback de UX;
- cobertura do catálogo.

---

## 14. Fase 12 — Rollout progressivo

Exemplo:

- internal team;
- 1%;
- 5%;
- 10%;
- 25%;
- 50%;
- 100%.

A progressão não deve ser automática.

Cada etapa depende de critérios definidos em `launch_checklist.md`.

---

## 15. Princípio de rollout

Não usar “já está funcionando” como critério de escala.

A liberação depende de:
- safety;
- qualidade;
- custo;
- estabilidade;
- observabilidade.
