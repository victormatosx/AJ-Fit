# Correção dos bloqueadores do onboarding nutricional — 16/10/2026

Implementação local das correções autorizadas após a auditoria. Sem commit, push, deploy, geração real de IA ou envio real de push. Este documento complementa e atualiza as ressalvas do relatório `onboarding_integration_2026-10-16.md`.

## Correções e causas

1. **Cadastro interrompido.** A captura descartava o snapshot quando já havia transferência vinculada. Agora recaptura a mesma sessão e a vinculação exige o UID original antes do provisionamento. O aceite fornecido no cadastro é preservado no rascunho como evidência local, sem inferir consentimento para rascunhos v1, parciais ou sem vínculo. Bootstrap e login retomam uma identidade incompleta somente com o UID correspondente e evidência do cadastro: aceite registrado ou snapshot v2 completo, vinculado na etapa de plano pelo fluxo anterior, que também exigia aceite antes da vinculação, usando o provisionamento existente. A recuperação fica dentro do tratamento de erro/retry do carregamento de perfil; contas com perfil existente não passam a depender da leitura do rascunho. Single flight local e reconhecimento do batch vencedor da mesma sessão tornam repetições recuperáveis. As regras existentes do marcador impedem que um batch perdedor sobrescreva uma conta já criada.
2. **Biblioteca de alimentos personalizados.** A transferência filtrava pelos IDs selecionados. Agora valida e transfere todos os alimentos criados na sessão, mantendo os IDs e checando colisões. Perfil e biblioteca são confirmados na mesma transação. A confirmação de perfil idêntico também verifica os alimentos, sem sobrescrever o perfil. A limpeza automática confere UID e sessão do rascunho novamente antes de remover o arquivo local.
3. **Notificações abandonadas.** O scheduler agora encontra `CLAIMED` com `updatedAt` anterior ao lease de dez minutos e converte para retry na mesma transação que confere a posse atual. O dispatcher renova/confere o token de posse antes do envio e ignora tickets já persistidos nos retries. Redelivery mantém a identidade do dispatch. Replays nutricionais históricos aceitam somente as diferenças aditivas de roteamento, verificando UID, geração e demais identificadores; o hash/request histórico é preservado, sem migração destrutiva. Resultados desconhecidos do provedor mantêm retry limitado da mesma notificação lógica.
4. **Preparação sem job.** Matrícula pendente não é mais apresentada como geração em processamento. Há estados de solicitação ainda não iniciada, solicitação interrompida e automático desativado, preservando respostas e oferecendo recuperação quando possível. Reservas locais expiradas deixam de bloquear a recuperação explícita. Jobs reais continuam com acompanhamento e erros existentes.
5. **Tentativas persistentes.** Um pequeno registro AsyncStorage por UID reserva cada tentativa antes da rede, com lease de dois minutos, até três tentativas automáticas e intervalo de trinta segundos para falhas transitórias. Falhas definitivas interrompem as tentativas. Recuperação explícita abre outro orçamento limitado, sem ignorar uma reserva ainda válida. O registro sobrevive à remontagem/reabertura; o marcador backend continua sendo a proteção global contra múltiplos jobs/dispositivos. O orçamento local é por instalação/UID, não um rate limit global comercial.
6. **Aviso visualizado.** O banner só confirma o aviso depois de layout nativo seguido de um frame em primeiro plano. Desmontagem cancela a confirmação. São conferidos UID, acesso, preferência e rollout nutricional; o rollout é acompanhado por listener. A gravação deixou de ocorrer antes da renderização. A navegação continua dependendo do toque e dos gates existentes.
7. **Saúde e rascunhos antigos.** A escolha é capturada antes da autenticação e vinculada localmente ao UID. Pode ser consumida independentemente da conclusão nutricional. Após a gravação da escolha de saúde, um acknowledgement local impede reativação a cada recuperação. Rascunho parcial é mantido; outro UID não recebe a escolha. Erros opcionais de vinculação da escolha são registrados sem abortar autenticação.
8. **Interruptor automático independente.** Foi criado o documento de configuração `nutritionRolloutConfig/onboardingAutomatic`, reutilizando o formato de flag existente. O documento `active` mantém exatamente seu contrato histórico de dois flags. Ausência ou documento inválido significa OFF. A callable confere o interruptor antes da RevenueCat e novamente dentro da transação de enfileiramento. A geração manual e os workers não consultam esse interruptor. Jobs já enfileirados continuam normalmente. RevenueCat e modelo comercial foram preservados.

O build revelou uma dependência antes ausente na sincronização do motor de treino: `onboarding/steps.ts` passou a importar o domínio nutricional puro. O script de sincronização agora inclui esses arquivos e suas dependências puras. Não houve mudança de cálculo, prompt ou comportamento de treino nesta correção.

## Arquivos alterados nesta etapa

### Aplicativo e persistência

- `App.tsx`
- `src/state/AuthContext.tsx`
- `src/onboarding/draftStorage.ts`
- `src/services/onboardingNutritionHandoff.ts`
- `src/services/onboardingHealthHandoff.ts` — novo
- `src/services/initialNutritionRequest.ts` — novo
- `src/services/nutritionNoticePresentation.ts` — novo
- `src/services/nutritionGeneration.ts`
- `src/components/OnboardingNutritionRuntime.tsx`
- `src/components/NutritionReadyBanner.tsx`
- `src/screens/nutrition/NutritionShell.tsx`
- `src/nutrition/rollout.ts`
- `src/nutrition/rolloutCore.ts`
- `src/i18n/resources/{pt-BR,en,es}/nutrition.json`

### Backend, regras e build

- `functions/src/nutrition/generation/request.ts`
- `functions/src/notifications/{dispatcher,idempotency,retryScheduler}.ts`
- `firestore.rules`
- `firestore.indexes.json`
- `scripts/syncPrescriptionEngineToFunctions.cjs`
- Cópias geradas e ignoradas pelo Git, sincronizadas pelos scripts existentes.

### Testes

- `src/services/__tests__/{initialNutritionRequest,nutritionNoticePresentation,onboardingHealthHandoff}.test.ts` — novos
- `src/services/__tests__/onboardingNutritionHandoff.integration.test.ts`
- `src/onboarding/__tests__/{draftStorage,onboardingFunnelWiring}.test.ts`
- `src/nutrition/__tests__/rollout.test.ts`
- `src/screens/nutrition/__tests__/nutritionShellRegression.test.ts`
- `functions/src/nutrition/__tests__/initialOnboarding.integration.test.ts`
- `functions/src/notifications/__tests__/{foundation.integration,nutritionNotifications.integration,dispatcherMode}.test.ts`
- `firestore-tests/nutrition.rules.test.ts` — somente teste da nova configuração; catálogo do diário intacto.

O workspace já continha alterações da integração e da refatoração nutricional. Esta lista identifica o escopo das correções, não todo o diff do repositório.

## Validação

- Aplicativo: **1.160 testes aprovados / 75 arquivos**, incluindo domínio do onboarding, orçamento persistente, confirmação do banner, saúde, autenticação/concorrência, telas nutricionais, geração, perfil, push e traduções.
- Firestore Emulator (Java 21), cadastro/treino/transferência e recuperação social: **16 testes aprovados / 3 arquivos**, após a inclusão do caso legado v2 vinculado. Os testes cobrem interrupção antes/depois do provisionamento, UID diferente, recuperação concorrente, biblioteca desmarcada, conflito e batch de matrícula.
- Regras do novo flag: **1 aprovado / 12 omitidos explicitamente pelo filtro**. Foi selecionado somente o teste `onboarding automatic rollout`; a falha preexistente do catálogo de diário não foi alterada nem declarada resolvida.
- Backend/notificações, primeira geração e jobs/motor com provedores simulados: **496 aprovados / 13 omitidos pelas condições das suítes / 40 arquivos**. Inclui claim expirado/válido, concorrência, sender antigo cercado, ticket persistido sem reenvio, resultado desconhecido do provedor, replay histórico e interrupção do automático durante preflight.
- TypeScript do app e das Functions: **aprovado**.
- Build das Functions com sincronização completa: **aprovado**.
- Exportação Expo iOS e Android: **aprovada**, artefatos em `/tmp/ajfit-blockers-{ios,android}-verified`, sem publicação.
- ESLint dos arquivos de aplicativo revisados: **zero erros / cinco avisos** em AuthContext e NutritionShell; não foram feitas refatorações fora do escopo para eliminá-los.
- Sincronização nutricional `--check` e `git diff --check`: aprovados.
- Não foi reexecutada a suíte geral nem corrigidas suas 22 falhas. Contagens de execuções intermediárias não devem ser somadas aos resultados finais.

Logs locais: `/tmp/ajfit-blockers-app-complete.log`, `/tmp/ajfit-blockers-emulator-complete.log`, `/tmp/ajfit-blockers-recovery-final.log`, `/tmp/ajfit-blockers-{app,functions}-tsc.log`, `/tmp/ajfit-blockers-build-final.log`, `/tmp/ajfit-blockers-{ios,android}-final.log` e `/tmp/ajfit-blockers-lint.log`. O log rastreado do emulador foi restaurado ao conteúdo anterior aos testes.

## Deploy coordenado — somente plano

1. Fixar o pacote revisado e conferir secrets, credenciais de push, App Check e versões publicadas. O único alias de projeto atualmente registrado em `.firebaserc` é `production`; não presumir que exista ambiente staging configurado.
2. Publicar o novo índice de coleção `notificationDispatches`: `status ASC, updatedAt ASC`. Aguardar estado pronto antes de publicar o scheduler que faz a nova consulta. Manter índices de jobs, retries e receipts já existentes.
3. Publicar regras com leitura autenticada de `nutritionRolloutConfig/onboardingAutomatic` e matrícula nutricional no batch inicial. Nenhuma leitura anônima foi liberada; nenhuma alteração de Storage Rules.
4. Publicar `retryNotificationDispatches` com recuperação de claims e compatibilidade histórica antes dos emissores. Para incorporar a proteção de posse em todos os remetentes que empacotam o dispatcher compartilhado, coordenar as revisões de `onNutritionGenerationCompleted`, `evaluateDailyWorkoutNotifications`, `dispatchTestNotification`, `processNotificationCampaigns`, `adminTestCampaign`, `revenueCatWebhook`, `onTrustedWorkoutLifecycleEventCreated` e `onSupportAdminMessageCreated`. Isso não altera seus contratos de produto/comerciais. Não voltar a uma versão incapaz de ler os dispatches novos durante a drenagem da fila.
5. Publicar `requestNutritionPlanGeneration` com `REVENUECAT_API_SECRET_KEY` e novo interruptor; manter `onNutritionGenerationCompleted` na versão da integração, com retry habilitado.
6. Incluir no pacote da integração `onAccountDeletionRequested` e `cleanupPendingAccountDeletions`, para limpeza da matrícula. Conferir que `onNutritionGenerationJobCreated` e `retryNutritionGenerationJobs` estão na versão compatível com a refatoração atual, com `OPENAI_API_KEY`. Se a refatoração nutricional ainda não estiver publicada, revisar também a callable de alternativas e suas dependências; não publicar indiscriminadamente todo o workspace sujo.
7. Garantir schedulers de geração, retry e receipts ativos. O secret RevenueCat já existe, mas sua vinculação à callable deve ser conferida. Conferir `EXPO_ACCESS_TOKEN` caso o controle de acesso do Expo Push esteja habilitado, e credenciais APNs/FCM.
8. Criar por ferramenta administrativa autorizada o documento `nutritionRolloutConfig/onboardingAutomatic`, inicialmente OFF: `{ "schemaVersion": 1, "enabled": false, "percentage": 0 }`. Os clientes não podem escrevê-lo.
9. Distribuir builds internos após backend/regras. Validar primeiro o automático desligado e a geração manual preservada. Para a coorte autorizada, habilitar o flag com percentual explícito; os flags de nutrição e geração do documento `active` também precisam permitir acesso.
10. Validar em iOS/Android e só então ampliar distribuição. Repetir a conferência remota do catálogo no projeto de destino antes da liberação; ela não foi repetida nesta etapa.

### Rollback

- Desligar somente `onboardingAutomatic` interrompe novos enfileiramentos automáticos, inclusive requisições que ainda estavam em preflight. Não cancela jobs já criados nem interrompe geração manual.
- Manter regras, índice e backend compatíveis com o aplicativo já distribuído. Não remover matrículas, perfis, alimentos, jobs ou planos para desfazer a versão.
- Preservar o scheduler capaz de recuperar claims e interpretar requests históricos/novos. O campo de roteamento aditivo não exige reescrever dispatches antigos.
- Reverter distribuição do app/OTA apenas para artefato compatível. Se for necessário reverter backend, preparar versão que mantenha o novo intent e retorne automático desabilitado; a callable anterior à integração não é rollback seguro.
- Falhas de notificação não invalidam uma dieta persistida. Recuperações operacionais devem manter o mesmo dispatch e seus tickets conhecidos.

## Limites e testes reais pendentes

- Expo/APNs/FCM não oferecem transação junto ao Firestore: aceite externo sem ticket persistido pode causar reenvio. A recuperação implementa deduplicação da identidade lógica e dos tickets conhecidos, sem prometer entrega exatamente uma vez.
- O worker nutricional existente mantém sua política de lease e tentativas de IA; esta etapa não refez esse motor nem corrigiu a janela de lease identificada na auditoria. Um plano persistido continua protegido pela transação final. Ausência absoluta de processamento/custo repetido em falhas externas não está comprovada.
- Orçamento pré-job é local por instalação/UID; a exclusividade do job é global no backend. Uma reinstalação elimina o orçamento local, mas não a matrícula backend.
- Rascunhos v1, parciais ou sem vínculo não autorizam provisionamento automático. Snapshots v2 legados completos e vinculados na etapa de plano são retomados para o mesmo UID, preservando a autorização já exigida pelo fluxo que originalmente os vinculou. Uma interrupção antes de gravar qualquer vínculo de UID também não autoriza importar um rascunho para uma identidade inferida.
- Ainda testar em dispositivos: teclado/voltar/retomada; cadastro e recuperação por e-mail/Apple/Google; compra/restauração/expiração/fechamento de paywall; App Check; dois dispositivos; push aberto/background/encerrado, permissões e tokens; banner e navegação durante treino; horário de silêncio; rollback do flag com job existente.
- Permanecem fora do escopo as 22 falhas gerais identificadas na auditoria e a expectativa preexistente de deduplicação do catálogo do diário. Não foram corrigidas ou ocultadas nesta etapa.

Não declarar pronto para produção antes de publicação coordenada autorizada e validação real em dispositivos.
