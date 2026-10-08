# ADR-001 — Nutrition Architecture

Status: `ACCEPTED`

Date: 2026-10-08

Decision owners: AJ Fit

---

## 1. Contexto

O AJ Fit adicionará um módulo de Nutrição capaz de:

- gerar um plano alimentar personalizado;
- permitir registro diário livre de alimentação;
- comparar consumo real com metas nutricionais;
- integrar peso e progresso já existentes no app;
- usar IA para composição e personalização de refeições.

O principal risco arquitetural identificado foi transformar a IA em fonte de verdade nutricional.

Também era necessário preservar os padrões já existentes do AJ Fit:

- Firebase/Firestore;
- dados privados sob `users/{uid}/...`;
- backend autoritativo para operações sensíveis;
- snapshots versionados;
- segurança por Rules + Admin SDK;
- histórico imutável.

---

## 2. Decisão

A arquitetura adotada separa responsabilidades em cinco camadas principais:

```text
AJ Fit App
  -> Perfil Nutricional
  -> Nutrition Engine
  -> Food Catalog
  -> AI Generation
  -> Deterministic Validator
  -> Firestore
```

A IA não possui autoridade sobre:

- gasto energético;
- déficit;
- superávit;
- proteína;
- gordura;
- carboidratos;
- fibra;
- safety gates;
- exclusões;
- composição nutricional dos alimentos.

---

## 3. Nutrition Engine

O Nutrition Engine é 100% determinístico e versionado.

Responsável por:

- RMR;
- TDEE;
- objetivo;
- pace;
- calorias;
- macros;
- fibra;
- distribuição por refeição;
- tolerâncias;
- safety limits.

A fórmula de energia basal adotada para V1 é Mifflin–St Jeor.

Os valores clínicos exatos ainda não validados permanecem fora da versão final de produção até revisão profissional.

Esses valores vivem em:

`canonical/nutrition_rules.json`

---

## 4. Food Catalog

O catálogo é uma fonte canônica independente da IA.

Hierarquia inicial de fontes:

1. TBCA;
2. TACO;
3. USDA FoodData Central;
4. rótulos/cadastro próprio para industrializados brasileiros.

A V1 é Brasil-first.

O catálogo-base possui apenas alimentos simples.

Receitas são entidades separadas compostas por alimentos simples e quantidades.

---

## 5. IA

A OpenAI é o provider inicial.

A integração deve ficar atrás de uma abstração para permitir troca futura.

Estratégia:

- modelo intermediário para geração completa;
- modelo econômico para operações simples;
- fallback para modelo mais forte em falhas específicas.

Toda resposta deve usar Structured Outputs.

Máximo:

`2 retries`

Se falhar após validação/retries:

- não persistir;
- informar erro tratável;
- permitir nova tentativa.

---

## 6. Validação pós-IA

A resposta da IA nunca é persistida diretamente.

Pipeline obrigatório:

```text
AI output
-> schema validation
-> food ID validation
-> restriction validation
-> allergen validation
-> nutrition recomputation
-> macro/calorie validation
-> deterministic quantity correction
-> retry/fallback if necessary
-> persistence
```

Macros declarados pela IA não são fonte de verdade.

Os nutrientes são sempre recalculados a partir do catálogo.

---

## 7. Plano recomendado vs. consumo real

A arquitetura separa explicitamente:

```text
recommendedPlan != actualIntake
```

O plano gerado é uma recomendação.

O usuário registra livremente o que realmente consumiu.

O registro real:

- pode divergir completamente do plano;
- pode usar alimentos próprios;
- pode usar receitas próprias;
- não altera a recomendação original.

Não haverá na V1:

- score por refeição;
- percentual diário de aderência.

Existe comparação semanal agregada.

---

## 8. Estrutura do plano

O plano:

- não tem duração fixa;
- permanece ativo até nova geração/restauração;
- é igual em todos os dias da semana na V1;
- não diferencia treino e descanso;
- possui 2–3 opções por refeição;
- possui exatamente uma opção principal.

A V1 permite troca de uma refeição completa.

Não permite edição individual de alimento dentro da recomendação como mecanismo de personalização do plano.

---

## 9. Firestore

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

---

## 10. Autoridade de escrita

Cliente pode escrever diretamente, sob Rules fortes:

- perfil nutricional;
- diário;
- receitas próprias;
- alimentos próprios;
- parte explícita de preferências.

Backend/Admin SDK escreve:

- planos;
- jobs;
- catálogo global;
- observabilidade de IA;
- rate limits;
- estados autoritativos.

---

## 11. Geração assíncrona

A geração completa usa job assíncrono.

Motivos:

- latência variável da IA;
- retries;
- background/restart;
- idempotência;
- observabilidade;
- proteção contra double tap.

Apenas uma geração completa ativa por usuário.

---

## 12. Safety

Gates bloqueadores na V1:

- gravidez;
- lactação.

Comportamento:

- bloquear geração;
- não chamar IA;
- não oferecer bypass;
- recomendar profissional.

Além disso:

- `excludedFoodIds` são hard exclusions;
- alergênicos são segunda camada de proteção;
- produtos compostos incompatíveis conhecidos são bloqueados;
- limites calóricos e de agressividade são determinísticos.

---

## 13. Condições médicas

A V1 não coleta:

- diabetes;
- doença renal;
- doença hepática;
- doença cardiovascular;
- transtornos alimentares;
- outras condições clínicas.

O sistema não deve inferir diagnóstico.

Suporte clínico futuro exige ADR próprio, regras canônicas e revisão profissional/legal.

---

## 14. Integração com Treino

Nutrição pode usar frequência semanal de treino no cálculo de gasto energético.

A V1 não usa:

- treino do dia;
- intensidade;
- volume;
- horário;
- pré/pós-treino.

Não existe diferenciação entre dieta de treino e descanso.

---

## 15. Integração com Evolução

Peso vem do módulo Evolução.

O plano guarda snapshot do peso usado.

Novo peso:

- não recalcula plano automaticamente;
- pode gerar recomendação de nova geração.

---

## 16. Notificações

Nutrição reutiliza a infraestrutura existente do AJ Fit.

V1:

- plano pronto;
- lembrete de registro;
- resumo semanal;
- recomendação de nova geração.

Sem horários personalizados por refeição na V1.

---

## 17. Analytics

Métricas principais:

- usuários que registram refeições;
- usuários ativos semanalmente em Nutrição.

Analytics não recebe:

- peso exato;
- alergias;
- alimentos específicos;
- conteúdo integral de dieta;
- prompts;
- respostas brutas de IA.

---

## 18. Testing

A estratégia inclui:

- unit tests;
- Nutrition Engine golden cases;
- AI evals;
- Firestore Rules tests;
- Functions integration;
- E2E crítico;
- safety regression tests.

CI normal usa provider fake/mock.

Evals reais de IA ficam separados.

---

## 19. Rollout

Rollout progressivo por feature flag.

Ordem sugerida:

```text
canonical
-> catalog
-> engine
-> profile
-> backend
-> AI
-> frontend
-> diary
-> history/substitutions
-> integrations
-> analytics/hardening
-> beta
-> progressive rollout
```

Safety gates nunca são desligáveis por feature flag comum.

---

## 20. Alternativas consideradas

### IA calcula tudo

Rejeitada.

Motivos:

- baixa reprodutibilidade;
- risco de segurança;
- dificuldade de teste;
- inconsistência de macros;
- custo de debugging.

### Catálogo inteiro no prompt

Rejeitada.

Motivos:

- custo;
- contexto excessivo;
- pior previsibilidade;
- latência.

### Cliente chama OpenAI diretamente

Rejeitada.

Motivos:

- exposição de chave;
- falta de controle de custo;
- falta de validação autoritativa;
- dificuldade de rate limit.

### Plano e diário no mesmo modelo

Rejeitada.

Motivos:

- mistura recomendação com realidade;
- histórico frágil;
- UX confusa.

### Regenerar automaticamente com novo peso

Rejeitada.

Motivos:

- mudança silenciosa;
- quebra de histórico;
- perda de previsibilidade.

### Mapa manual completo de substituições

Rejeitado na V1.

A IA propõe candidatos e o engine valida equivalência.

---

## 21. Consequências positivas

- engine testável;
- IA substituível;
- segurança determinística;
- histórico reproduzível;
- custos observáveis;
- menor risco de hallucination;
- integração consistente com arquitetura atual do AJ Fit.

---

## 22. Consequências negativas

- maior complexidade inicial;
- necessidade de catálogo robusto;
- necessidade de validator próprio;
- maior esforço de versionamento;
- necessidade de revisão profissional para regras numéricas.

Essas consequências são aceitas em troca de segurança e previsibilidade.

---

## 23. Pontos ainda pendentes

Ainda não estão fechados para produção:

- multiplicadores exatos de atividade;
- deficit por goal × pace;
- surplus por goal × pace;
- regra exata de recomposição;
- calorie floors;
- ranges de proteína;
- ranges de gordura;
- fibra por 1000 kcal;
- tolerâncias;
- pesos de distribuição das refeições;
- source-of-truth policy para futuras integrações Apple Health / Health Connect / similares.

Esses pontos não devem ser preenchidos por conveniência durante implementação.

---

## 24. Source of truth

As decisões humanas detalhadas vivem nos documentos `01_...` a `13_...`.

Os contratos machine-readable vivem em:

`canonical/`

Este ADR registra a decisão arquitetural e seu racional.
