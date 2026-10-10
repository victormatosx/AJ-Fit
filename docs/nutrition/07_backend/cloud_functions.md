# AJ Fit Nutrition — Cloud Functions

## 1. Princípio

Operações que alteram estado autoritativo, chamam IA, validam segurança ou coordenam múltiplos documentos devem passar pelo backend.

Seguir o padrão já usado pelo AJ Fit em fluxos autoritativos.

---

## 2. Callables principais

### requestNutritionPlanGeneration

Responsável por:

1. autenticar usuário;
2. validar conta ativa;
3. impedir geração concorrente;
4. carregar perfil e fontes autoritativas;
5. criar `generationJob`;
6. iniciar orquestração;
7. retornar `generationId`.

Não retorna um plano não validado.

### regenerateNutritionMeal

Responsável por gerar nova opção completa de uma refeição.

### activateNutritionPlan

Ativa/restaura um plano por transação.

### updateNutritionPlanMealOption

Confirma substituição validada de uma opção de refeição.

---

## 3. Serviços internos

Não exportar tudo como endpoint.

Separar internamente:

```text
nutrition/
  engine/
  catalog/
  ai/
  validation/
  generation/
  plans/
  dailyLogs/
  recipes/
  observability/
```

Funções internas:

- buildNutritionEngineInput;
- calculateNutritionTargets;
- selectAllowedFoodCandidates;
- generateMealPlanWithAI;
- validateGeneratedPlan;
- correctGeneratedQuantities;
- persistNutritionPlanTransactionally;
- recordAiOperation.

---

## 4. Geração assíncrona

Implementação: `requestNutritionPlanGeneration` é callable com auth + App Check. Faz preflight de flags, lock de exclusão, perfil/gravidez/lactação, fontes físicas e Engine; então cria `queued` e o lock em `nutritionRateLimits/{uid}` na mesma transação. `onNutritionGenerationJobCreated` processa o job fora da conexão móvel; `retryNutritionGenerationJobs` (5 min) recupera `queued` e leases expirados. O worker só grava plano em transação depois de validar e recalcular. `nextAttemptAt` limita a varredura a jobs vencidos. O schema de persistência é versionado em `meal_plan_schema.json` 1.1.0.

App e Functions usam as mesmas regras puras de rollout em `src/nutrition/rolloutCore.ts`, sincronizadas no build de Functions; configuração ausente ou inválida permanece OFF.

O job muda `queued -> running -> validating -> completed/failed`. `generationId` também é `planId`, de modo que redelivery não pode criar outro plano. `nutritionRateLimits/{uid}.activeGenerationId` é lock de single-flight e `activePlanId` aponta para o único plano ativo. O commit de ativação arquiva o plano anterior e cria o novo na mesma transação. Um `requestId` opcional do cliente é somente chave de idempotência, nunca autoridade de UID.

`aiAttemptCount` é gravado antes de cada chamada externa; após crash, a retomada começa na tentativa seguinte e não ultrapassa três tentativas totais. `lastFailureCode` preserva a elegibilidade do fallback na retomada. Falhas determinísticas usam códigos estáveis (`FEATURE_DISABLED`, `INVALID_NUTRITION_CONTEXT`, `CATALOG_INSUFFICIENT`, `AI_*`); erros transitórios de Firestore deixam o lease vencer para reprocessamento. O catálogo usado deve ter `catalogVersion` igual a `nutritionCatalogMeta/current`.

A geração completa deve usar modelo de job persistido.

Motivos:

- chamadas de IA podem demorar;
- retries não precisam manter request mobile aberta;
- app pode sobreviver a background/restart;
- permite status explícito;
- reduz risco de duplicidade;
- facilita observabilidade.

O callable inicial cria/agenda o trabalho e retorna rapidamente.

---

## 5. Concorrência

Só uma geração completa ativa por usuário.

Usar lock transacional/documento de job autoritativo.

Double tap ou retry de rede deve convergir para a mesma operação quando possuir a mesma chave de idempotência.

---

## 6. Idempotência

Toda operação sensível deve possuir identificador estável:

- `generationId`;
- `operationId`;
- `requestId` quando necessário.

Persistência final deve verificar se a operação já foi concluída antes de criar outro plano.

---

## 7. Transações

Usar transações para:

- arquivar plano anterior + ativar novo;
- restaurar plano antigo;
- garantir single-active-plan;
- adquirir/release lock de geração;
- atualizar job + referência de resultado quando necessário.

---

## 8. Diário alimentar

O registro cotidiano pode ser escrito diretamente pelo cliente sob Rules estritas.

Não transformar cada adição de alimento em Cloud Function sem necessidade.

Isso reduz latência, custo e complexidade.

Qualquer métrica autoritativa derivada usada para decisões futuras pode ser recomputada pelo backend.

---

## 9. Receitas e alimentos próprios

CRUD cotidiano pode ser cliente -> Firestore, protegido por Rules.

Operações que alimentarem cálculos autoritativos devem validar novamente os dados.

---

## 10. Erros

Callables expõem apenas códigos seguros e estáveis.

Nunca retornar:

- prompt;
- stack trace;
- chave;
- resposta bruta do provedor;
- dados internos de outro usuário.

---

## 11. Notificações de Nutrição (Fase 27)

Nutrição reutiliza o dispatcher central, dispositivos elegíveis, preferences,
retries, receipts, content policy, timezone e a janela diária compartilhada.
A categoria `NUTRITION` controla `NUTRITION_PLAN_READY`,
`NUTRITION_DAILY_LOG_REMINDER` e `NUTRITION_WEEKLY_SUMMARY`.

Plan-ready exige a transição real do job para `completed`, plano ativo
persistido e o mesmo `generationId`. O lembrete diário exige plano ativo e
diário local sem itens. O resumo roda na segunda-feira, uma vez para a semana
anterior e somente quando há algum log útil. Não há meal reminder porque o
produto não coleta horários de refeição.

Scheduler diário opera entre 08:00–10:00 local; o evento plan-ready somente
entre 08:00–22:00 local. Timezone inválido falha fechado. A preferência
`notificationPreferences.nutrition`, deletion lock, device/permissão e o
limite compartilhado de uma notificação de produto/dia são reavaliados.
Idempotência usa data/semana ou `generationId`.

## 12. Account deletion e fences finais

O cleanup cobre `nutritionProfile`, `nutritionPlans`, `nutritionDailyLogs`,
`nutritionRecipes`, `nutritionFoods`, `nutritionPreferences`, `nutritionFavoriteMealOptions`,
`nutritionGenerationJobs` e `nutritionMealAlternatives`; apaga
`nutritionAiOperations` por `ownerUid` e `nutritionRateLimits/{uid}`. Catálogo,
metadata e rollout globais compartilhados são preservados.

`nutritionDailyLogs/{localDate}` tem as subcoleções `meals/{slot}` e
`meals/{slot}/items/{itemId}` (`07_backend/firestore_schema.md` §5) — o
cleanup genérico de uma coleção é deliberadamente de um nível só, então
esse recurso usa `db.recursiveDelete` por documento de dia, como o
histórico de notificações já fazia, para não deixar refeições/itens
órfãos depois que o documento do dia é apagado.

Workers de plano e alternativa revalidam `accountDeletionLocks/{uid}` na
transação final. Exclusão iniciada durante a chamada externa impede a
persistência. O dispatcher evita criar histórico suprimido para usuário
ausente/deleting, impedindo recriação depois do cleanup.
