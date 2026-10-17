# Onboarding nutricional — rollout e recuperação

Data: 2026-10-17. Base local: `d1846d5`, incluindo a integração `9daedbf`.

## Firebase confirmado

Projeto `ajfit-2f321`, região das Functions `us-central1`.

Foi alterado somente `nutritionRolloutConfig/onboardingAutomatic`, com máscara de atualização dos três campos autorizados:

```json
{ "schemaVersion": 1, "enabled": true, "percentage": 100 }
```

Antes: `enabled: false`, `percentage: 0`. Depois: ON em 100%, confirmado por GET após a escrita e por nova leitura depois dos testes. `updateTime`: `2026-10-17T13:29:12.883862Z`.

`nutritionRolloutConfig/active` permanece com `nutritionEnabled` e `nutritionPlanGenerationEnabled` em `{ schemaVersion: 1, enabled: true, percentage: 100 }`. Seu `updateTime` continua `2026-10-09T02:06:27.885662Z`: esse documento não foi escrito.

Evidência sem credenciais: [onboarding_rollout_confirmed_2026-10-17.json](onboarding_rollout_confirmed_2026-10-17.json). Não há expiração nem rotina de desligamento adicionada. Os testes usam exclusivamente o emulador `ajfit-rules-test` e não desligam o flag remoto.

A inspeção do runtime, contrato de rollout e request/worker não encontrou outro bloqueio de rollout. Permanecem os requisitos existentes de acesso ao app, Premium autoritativo para `initial_onboarding`, App Check, autenticação/e-mail quando aplicável, conta ativa, matrícula do cadastro, perfil e contexto de treino válidos, cooldown e transações de idempotência. Não foi criada allowlist nem restrição adicional por UID.

## Resultados A–E

| Cenário | Evidência automatizada e resultado | Limite da validação |
| --- | --- | --- |
| A — Internet interrompida | SDK cliente real conectado ao Firestore Emulator: `disableNetwork`, conclusão atômica de job/plano por outro contexto, `enableNetwork`. O listener recuperou `completed`, o plano `active` e a consulta de jobs ativos ficou vazia; nenhuma callable foi chamada. | Ainda testar modo avião/Wi-Fi e mudança de rede no iPhone. |
| B — Sair/reabrir | Reinscrição dos listeners e nova instância/cache do SDK recuperaram o ID da matrícula e o plano concluído. Request repetido enquanto o backend estava rodando e após a conclusão retornou o mesmo ID. Estado local persistido também foi validado após recarregar o módulo. | Encerramento nativo pelo sistema, suspensão iOS e troca de abas precisam do dispositivo. |
| C — Demora | Timers simulados ultrapassaram 12 minutos; acompanhamento entrou em estado recuperável e voltou ao receber snapshot. Renderização cobriu `queued`, `running`, `validating`, `completed`, instrução de poder sair e mensagem específica de acompanhamento interrompido. A transição espera o plano correspondente em ambas as ordens de entrega. | Não houve espera real de 12 minutos nem avaliação visual/nativa. |
| D — Falha recuperável | Provedor simulado testou timeout/HTTP transitório, rate limit, validação de macros, reparo/fallback, segurança e esgotamento. Emulador testou retomada de lease expirado com tentativas persistidas, falha gRPC 14 ao salvar, recuperação do mesmo job e bloqueio de uma quarta tentativa. Falha definitiva deixa `failed`, sem plano; recuperação explícita respeita cooldown e registra `latestGenerationId`. | O scheduler foi analisado; a retomada automatizada chamou o worker diretamente, sem aguardar o Cloud Scheduler real. |
| E — Concorrência/idempotência | Requests simultâneos de cadastro/dispositivos, corrida manual × automática, worker repetido, resposta perdida, repetição após conclusão e seis retries explícitos locais reutilizaram o estado existente. Recuperação explícita backend concorrente criou somente um job novo. Testes existentes confirmaram deduplicação de notificação e adiamento por silêncio. | Ordem entre listeners foi exercitada por projeção e pelo SDK real; não é uma prova de todas as interações do iOS. |

Os mocks de IA não fazem chamadas externas. O orçamento persistido limita o job a três tentativas; lease expirado não reinicia esse orçamento. O worker usa lease de oito minutos e o scheduler existente executa a cada cinco minutos. A confirmação de plano e conclusão do job ocorre na mesma transação. Nenhuma lógica de cobrança ou RevenueCat foi alterada. Não foram criadas contas, assinaturas ou dietas reais.

## Bugs encontrados e correções locais

1. **Rollout preso em OFF após abertura offline:** `useNutritionEnabled` fazia uma única leitura; uma falha inicial podia esconder a aba até remontagem. O gate agora acompanha o documento por listener, mantém o fail-safe e atualiza quando a configuração chega. A tela também acompanha o flag de geração.
2. **Erro de acompanhamento permanecia após retomada:** o timeout só era limpo por status terminal. O monitor agora limpa o erro a cada snapshot válido, rearma o prazo enquanto o job está ativo e cancela timers ao desmontar. Reconsultar o andamento não cria job.
3. **Retry não reinscrevia o listener ativo:** o efeito ignorava `reloadKey`; agora o retry reinstala também essa assinatura. Erros terminais dos listeners de plano/job ativo deixam um estado de erro recuperável, em vez de serem tratados como ausência de dados.
4. **Conclusão antes da entrega do plano:** a tela podia abandonar a geração e mostrar ausência de dieta entre callbacks independentes. Agora espera o plano cujo `planId` corresponde ao job concluído.
5. **Mensagem ambígua no timeout:** a tela usava erro genérico para ausência de atualizações. Agora informa que a dieta pode continuar sendo preparada e oferece “Consultar andamento”, em português, inglês e espanhol.

Essas mudanças estão somente no workspace. O código de execução das Functions e as regras não foram alterados; somente testes backend foram ampliados. Não há correção backend pendente de autorização para deploy.

## Arquivos alterados/criados nesta tarefa

- `src/services/nutritionGeneration.ts`
- `src/nutrition/rollout.ts`
- `src/nutrition/useNutritionEnabled.ts`
- `src/screens/nutrition/NutritionShell.tsx`
- `src/screens/nutrition/NutritionGeneratingScreen.tsx`
- `src/i18n/resources/pt-BR/nutrition.json`
- `src/i18n/resources/en/nutrition.json`
- `src/i18n/resources/es/nutrition.json`
- `src/services/__tests__/initialNutritionRequest.test.ts`
- `src/services/__tests__/nutritionGeneration.test.ts`
- `src/nutrition/__tests__/rollout.test.ts`
- `src/screens/nutrition/__tests__/nutritionGenerationPresentation.test.ts` (novo)
- `src/services/__tests__/nutritionRecovery.emulator.integration.test.ts` (novo)
- `functions/src/nutrition/__tests__/initialOnboarding.integration.test.ts`
- Este relatório e o JSON de evidência do rollout (novos).

`docs/releases/` já existia sem rastreamento e foi preservado. O log versionado do emulador foi restaurado ao conteúdo anterior após os testes.

## Testes finais

| Verificação | Resultado |
| --- | --- |
| Frontend: initialNutritionRequest, nutritionGeneration, telas nutricionais, domínio UI, rollout e i18n | **964 testes aprovados, 57 arquivos** |
| Backend unitário: generation, mealAlternative, sync e nutritionNotifications | **66 testes aprovados, 4 arquivos** |
| Firestore Emulator: cliente offline/reconexão/reinicialização do SDK | **1 teste aprovado** |
| Firestore Emulator: initialOnboarding, jobs, nutritionJourney e nutritionNotifications | **21 testes aprovados, 4 arquivos** |
| TypeScript do app e Functions | Aprovado |
| ESLint dos arquivos frontend alterados | Zero erros; quatro avisos preexistentes em NutritionShell |
| `git diff --check` | Aprovado |

Total das seleções finais acima: **1.052 testes aprovados**, sem sobrepor contagens. A suíte geral do repositório não foi executada; os resultados não afirmam que áreas fora do escopo estejam verdes.

Comandos principais:

```sh
npm run typecheck
npm run typecheck --prefix functions
npx vitest run src/services/__tests__/initialNutritionRequest.test.ts src/services/__tests__/nutritionGeneration.test.ts src/screens/nutrition/__tests__ src/nutrition/ui/__tests__ src/nutrition/__tests__/rollout.test.ts src/i18n/__tests__
npm test --prefix functions -- --run src/nutrition/__tests__/generation.test.ts src/nutrition/__tests__/mealAlternative.test.ts src/nutrition/__tests__/sync.test.ts src/notifications/__tests__/nutritionNotifications.test.ts
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npx firebase emulators:exec --only firestore --project ajfit-rules-test 'npx vitest run src/services/__tests__/nutritionRecovery.emulator.integration.test.ts && npm test --prefix functions -- --run src/nutrition/__tests__/initialOnboarding.integration.test.ts src/nutrition/__tests__/jobs.integration.test.ts src/nutrition/__tests__/nutritionJourney.e2e.integration.test.ts src/notifications/__tests__/nutritionNotifications.integration.test.ts'
```

O primeiro ensaio do novo teste de reinicialização falhou pelo uso da API modular `terminate` sobre a instância compat do test environment; o harness foi corrigido para `clientContext.firestore().terminate()` e reexecutado com sucesso. A primeira checagem TypeScript da nova renderização também exigiu usar o harness `createRequire` tipado já adotado no projeto; a checagem final passou. O sandbox exigiu execução ampliada para portas locais do emulador e credenciais gcloud; não houve deploy.

Logs locais finais: `/private/tmp/ajfit-recovery-client-unit.log`, `ajfit-recovery-backend-unit.log`, `ajfit-recovery-emulator.log`, `ajfit-recovery-typecheck-app.log`, `ajfit-recovery-typecheck-functions.log` e `ajfit-recovery-lint.log` (os nomes abreviados também estão em `/private/tmp/`).

## Verificação manual pendente no iPhone

Usar o development build existente com o código local atualizado, sem criar build ou publicar atualização:

1. Durante uma geração de teste já autorizada, desligar e religar a rede; conferir retomada do mesmo ID e exibição do plano.
2. Alternar abas, mandar para segundo plano, encerrar o processo e reabrir enquanto a geração está em andamento; conferir que o mesmo job/plano reaparece e que não há aviso duplicado.
3. Conferir visualmente as mensagens de preparação, acompanhamento interrompido, retry e conclusão, incluindo retorno de conexão após o tempo limite.
4. Para provocar demora/falhas deliberadas, usar ambiente isolado e mocks. Não interromper serviços remotos reais para testar esses casos.

A persistência Firestore usada pelo app nativo é em memória: um processo novo sem internet não consegue carregar a dieta do servidor até reconectar. Os documentos remotos continuam preservados; estes testes não adicionam cache offline durável nem comprovam entrega push real ou comportamento de suspensão do iOS.

Não houve build, submit, update, distribuição, commit, push, deploy de Functions/regras ou alteração comercial do RevenueCat. A única escrita remota foi o rollout expressamente autorizado, que permanece ligado.
