# Fase B — configurações a preservar na publicação

Levantado em 22/10/2026 por **leitura** da configuração publicada em
`ajfit-2f321` (Cloud Functions v2 API). **Nada foi criado nem alterado em
produção.** Nenhum valor de segredo foi lido ou armazenado — apenas os nomes
das variáveis e os valores das flags não sensíveis.

---

## 1. Segredo vs variável de ambiente — a distinção que decide o risco

As duas coisas se comportam de forma **oposta** num deploy:

| tipo | onde vive | o que acontece num deploy |
|---|---|---|
| `defineSecret('X')` | Secret Manager, referenciado por nome | **sobrevive** — o deploy só re-vincula a referência |
| `process.env.X` | `functions/.env`, materializado na Function | **é apagado** se o `.env` não estiver presente |

Por isso a ausência de `functions/.env` não ameaça todos os valores — só os do
segundo grupo.

### Segredos (não ameaçados pelo deploy)

`REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_SECRET_KEY`,
`REVENUECAT_ADMIN_GRANTS_API_KEY`, `WORKOUT_ACTION_CAPABILITY_SECRET`,
`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`,
`APPLE_NATIVE_CLIENT_ID`, `APPLE_SERVICES_CLIENT_ID`,
`FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`, `OPENAI_API_KEY`.

### Variáveis de ambiente puras (apagadas sem `.env`)

| variável | lida em | estado publicado |
|---|---|---|
| `NUTRITION_PLAN_SNAPSHOT_ENABLED` | `nutrition/diary/config.ts` | **`true`** nas cinco Functions-alvo |
| `NUTRITION_CATALOG_LINKING_ENABLED` | `nutrition/catalogLinking/config.ts` | **ausente** (= desligada) |
| `EXPO_ACCESS_TOKEN` | `notifications/expoPushClient.ts` | ausente nas cinco; relevante só para as Functions de notificação |

`NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS` **não existe mais no código** e também
não aparece mais na configuração publicada — o deploy de 20/10 19:42 a
removeu. Não há nada a preservar.

---

## 2. Ponto que exige decisão explícita

`NUTRITION_PLAN_SNAPSHOT_ENABLED=true` está **ativa em produção** nas cinco
Functions, definida pelo deploy de 20/10 19:42 — que não foi feito por este
agente. Isso contraria a instrução permanente de não ativar essa flag em
produção.

Qualquer caminho a partir daqui **altera** o estado atual:

- publicar **com** `.env` contendo `NUTRITION_PLAN_SNAPSHOT_ENABLED=true`
  mantém produção como está (flag ligada, contrariando a instrução);
- publicar **sem** `.env` desliga a flag nas cinco Functions — uma mudança de
  comportamento em produção, não uma preservação.

Não há opção neutra. A decisão é do responsável, não do deploy.

---

## 3. Estado publicado das cinco Functions-alvo

Todas em `us-central1`, atualizadas em **2026-10-20 19:42 UTC**:

| Function | revisão |
|---|---|
| `authorizeWorkoutLifecycleMutation` | `00020-mem` |
| `initializeWorkoutProgramV127` | `00008-bef` |
| `installActiveWorkoutProgram` | `00004-qin` |
| `applyExerciseSubstitution` | `00005-rub` |
| `finalizeWorkoutSession` | `00016-kab` |

Nenhuma delas tem segredo vinculado. Fora as variáveis injetadas pelo próprio
Firebase (`FIREBASE_CONFIG`, `GCLOUD_PROJECT`, `FUNCTION_*`,
`EVENTARC_CLOUD_EVENT_SOURCE`), a única variável de ambiente é
`NUTRITION_PLAN_SNAPSHOT_ENABLED=true`.

---

## 4. Por que o deploy precisa nomear as cinco explicitamente

As 76 Functions publicadas **não compartilham uma versão de fonte**. Cada uma
carrega o pacote do seu próprio deploy:

| data do deploy | Functions |
|---|---|
| 21/10 23:45 | `requestNutritionPlanGeneration`, `onNutritionGenerationJobCreated`, `retryNutritionGenerationJobs`, `requestNutritionMealAlternative` |
| 21/10 15:17 | `monitorNutritionAiOperations`, `logCatalogMeal` |
| **20/10 19:42** | **as cinco Functions-alvo** |
| 19/10 e antes | as demais 65 |

Consequência prática: `firebase deploy --only functions` (sem nomear) republica
**tudo** a partir desta árvore e regride os pacotes mais novos — ver §5.

O comando correto nomeia apenas o alvo:

```bash
firebase deploy --project ajfit-2f321 --only \
  functions:authorizeWorkoutLifecycleMutation,\
functions:initializeWorkoutProgramV127,\
functions:installActiveWorkoutProgram,\
functions:applyExerciseSubstitution,\
functions:finalizeWorkoutSession
```

Antes de publicar é obrigatório rodar os três sincronizadores — os espelhos em
`functions/src/**` são **gerados e gitignored**, então um clone limpo não os
tem:

```bash
node scripts/syncPrescriptionEngineToFunctions.cjs
node scripts/syncNutritionToFunctions.cjs
node scripts/syncScheduleEngineToFunctions.cjs
```

---

## 5. Trabalho de colaborador que está em produção e **não** está em git

O pacote publicado em **21/10 23:45** (`requestNutritionPlanGeneration`)
contém um módulo inteiro ausente de toda a árvore:

- `functions/src/nutrition/generation/portionOptimizer.ts` — ajustador
  determinístico de porções **por alimento**, com modelo de mínimos quadrados
  e penalidade hinge. O corretor da main (`correction.ts`) aplica um **único**
  fator uniforme por refeição, que por construção não corrige uma refeição cuja
  razão de nutrientes divirja da razão dos alimentos escolhidos. O módulo
  publicado resolve exatamente esse caso.

E a fiação correspondente, também só em produção:

| arquivo | linhas só no publicado |
|---|---|
| `nutrition/generation/domain.ts` | 13 (inclui `import { optimizePortions }`) |
| `nutrition/generation/diagnostics.ts` | 4 (`optimizer_infeasible`, `method: 'uniform' \| 'per_item'`) |
| `nutrition/generation/correction.ts` | 3 (`CORRECTION_SCALE_MIN/MAX`) |
| `nutrition/generation/restrictions.ts` | 10 — e **10 só na main**: divergência de via dupla, exige merge real |

Procurado e **não encontrado** em: todas as refs locais e remotas, os 6
stashes, os 12 worktreees e o disco.

**Isto não afetou a consolidação** — a main é superconjunto estrito de todas as
refs do git, e o que nunca esteve no git não podia ter sido perdido por ela.
O risco é **futuro**: publicar as Functions de nutrição a partir desta árvore
apagaria esse módulo de produção.

Publicar **as cinco Functions-alvo não regride a nutrição**: cada Function tem
seu próprio pacote, e as de nutrição conservam o deles.
