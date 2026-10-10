# Matriz E2E de Nutrição

Status da Fase 31. Todos os testes de IA usam provider injetável; nenhuma chamada externa é permitida.

| Feature | Happy path | Error | Security | Concurrency | Deletion | Status | Test file |
|---|---|---|---|---|---|---|---|
| Perfil | create/update | shape inválido | cross-user, conta bloqueada | transação do cliente | resource cleanup | Coberto | `firestore-tests/nutrition.rules.test.ts`; `src/services/__tests__/nutritionClientJourney.emulator.integration.test.ts` |
| Geração | queued → running → validating → completed | retry exhausted | safety, flag, conta inativa | single-flight/double tap | job ativo interrompido | Coberto | `functions/src/nutrition/__tests__/nutritionJourney.e2e.integration.test.ts`; `jobs.integration.test.ts` |
| Plano | snapshots, versões e ativação | resposta inválida/fallback | backend-only, ownership | geração + restore | plans removidos | Coberto | `nutritionJourney.e2e.integration.test.ts`; `mealAlternativeAndRestore.integration.test.ts` |
| Diário | opção, alimento, receita, edição e remoção | payload inválido | shape fechado/cross-user | edições concorrentes | logs removidos | Coberto | `nutritionClientJourney.emulator.integration.test.ts`; `firestore-tests/nutrition.rules.test.ts` |
| Alternativa | provider → validator → persistência | retry/falha/rate limit | ownership, safety, deletion lock | requestId/replay | retorno após exclusão não persiste | Coberto | `mealAlternativeAndRestore.integration.test.ts`; `nutritionJourney.e2e.integration.test.ts` |
| Favoritos | plano/alternativa/list/remove/use | snapshot inválido | documento isolado/cross-user | IDs independentes, lista limitada | collection cleanup | Coberto | `nutritionClientJourney.emulator.integration.test.ts`; `firestore-tests/nutrition.rules.test.ts` |
| Histórico/restore | A → B → restore A | restore inválido | ownership/deletion lock | restore idempotente | plans removidos | Coberto | `mealAlternativeAndRestore.integration.test.ts`; `nutritionJourney.e2e.integration.test.ts` |
| Resumo semanal/peso | logs + metas históricas + Assessments | semana parcial/sem peso | sem escrita derivada | query semanal única | dados fonte removidos | Coberto | `nutritionClientJourney.emulator.integration.test.ts`; `src/nutrition/weekly/__tests__/*` |
| Notificações | plan ready/daily/weekly | sem dados/preference off | preflight/account state | dedupe | metadata removido | Coberto | `functions/src/notifications/__tests__/nutritionNotifications.integration.test.ts` |
| Analytics | eventos UI/backend | provider no-op | allowlist sem dados sensíveis | autoridade única | sem persistência própria | Coberto | `src/nutrition/analytics/__tests__/*`; `functions/src/nutrition/__tests__/analytics.test.ts` |
| Observabilidade IA | tokens/custo/retry/fallback | uso/preço ausente/failure | sem prompt/output | operation idempotente | owner-linked cleanup | Coberto | `functions/src/nutrition/__tests__/observability.test.ts`; `nutritionJourney.e2e.integration.test.ts` |
| Navegação/reopen | tab/shell/home/plan/diary/weekly | destino desconhecido seguro | rotas internas tipadas | listener único + cleanup | n/a | Coberto estruturalmente | `src/screens/__tests__/appShellNutritionNavigationStructure.test.ts`; `src/screens/nutrition/__tests__/nutritionShellRegression.test.ts` |
| Data local | São Paulo, UTC, semana/mês/ano | boundaries | sem agrupamento por UTC | cálculo puro | n/a | Coberto | `src/nutrition/ui/__tests__/localDate.test.ts`; `src/nutrition/weekly/__tests__/weeklySummary.test.ts` |
| Account deletion | todos os recursos | retry/idempotência | usuário B e globais preservados | deletion + generation/alternative | execução repetível | Coberto | `functions/src/accountDeletion/firestoreCleanup/__tests__/resources.test.ts`; integrações de Nutrição |

## Limites do E2E automatizado

- Background/reopen e reconnect são cobertos pelo contrato de listeners persistentes e pelos testes estruturais; ciclo real do SO fica para beta em dispositivo.
- Entrega push nativa e abertura pelo sistema operacional exigem credenciais/APNs/FCM e ficam para smoke test de beta. Dispatcher, dedupe, preference, timezone e rotas são automatizados.
