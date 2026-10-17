# Integração nutricional ao onboarding — implementação local

> Atualização posterior: as correções dos bloqueadores e o plano de publicação revisado estão em [onboarding_blockers_2026-10-16.md](onboarding_blockers_2026-10-16.md). As garantias descritas abaixo devem ser lidas junto dessas correções e limitações.


Data: 2026-10-16. Sem commit, push, deploy ou geração real de IA.

## Resultado e limites

Implementadas as sete fases no código local. O fluxo anônimo intercala nove perguntas (dez para objetivo ambíguo) entre `interstitial_ajFitProgress` e `socialProof`, sem revisão extra. A revisão e a edição internas permanecem. `forcedQuestionnaire` não recebe nutrição.

A implementação não deve ser distribuída antes da publicação coordenada das regras e Functions correspondentes: o novo marcador de cadastro participa do batch inicial e depende das novas regras. Nenhuma publicação foi executada.

Ainda faltam validação visual/interativa em dispositivos, compra/restauração reais e entrega push real. Exportação de bundles não substitui esses testes. A suíte geral do repositório não está integralmente verde; as falhas fora do escopo estão registradas abaixo.

## Fases e decisões implementadas

1. **Domínio:** `PROFILE_STEP_IDS`, defaults e validação compartilhados. Categoria resolvida pelo motor existente; ritmo obrigatório em perda de gordura/ganho muscular, opcional em manutenção/recomposição. Cálculos e prompts não foram alterados nesta implementação.
2. **Catálogo:** asset gerado dos 173 itens aprovados da curadoria canônica, com IDs `nf_*`, nomes, aliases, nutrientes, procedência pública e prefixos normalizados. A busca pré-login é local. Cadastro manual usa o formulário/validação existentes e IDs `custom_*` estáveis. Sem nova função de busca ou leitura anônima do Firestore.
3. **Onboarding:** IDs derivados da sequência nutricional compartilhada, progresso global, estrutura visual e animação nativas. Rascunho v2 migra v1, conserva texto/unidade do peso e remove abandonados após 30 dias. Transferências vinculadas não expiram silenciosamente. Login/descartes explícitos permitem resolver rascunhos pendentes sem mostrá-los a outra conta.
4. **Persistência:** snapshot confirmado antes da autenticação. O cadastro cria `users/{uid}/onboardingNutritionState/current` no mesmo batch de usuário/questionário. As regras só permitem criar esse marcador quando o usuário também está sendo criado. Perfil e alimentos personalizados selecionados são transferidos atomicamente; transações repetidas reconhecem dados idênticos. Perfil diferente, catálogo incompatível ou colisão preservam o rascunho e não sobrescrevem dados. Limpeza ocorre depois da confirmação e do consumo da escolha de integração de saúde.
5. **Geração:** a callable existente aceita intenção `initial_onboarding`. O cliente solicita somente após liberação real da entrada no app e Premium resolvido. O backend verifica e-mail quando necessário, conta ativa, matrícula no onboarding, rollout, contexto de treino/agenda e entitlement ativo diretamente na RevenueCat, reutilizando seu reconciliador. O marcador registra o primeiro job na mesma transação do enfileiramento; histórico, concorrência, reabertura e outras solicitações não criam outra tentativa automática. Falha terminal exige tentativa explícita. A tentativa manual posterior acompanha `latestGenerationId`, sem apagar a matrícula da primeira tentativa.
6. **Experiência/notificações:** a aba acompanha perfil, matrícula e jobs por listeners; antes de existir job não inventa uma etapa "queued". O evento backend de conclusão existente verifica plano persistido, deduplica por geração e utiliza dispositivos/permissões/preferências existentes. Horários de silêncio adiam o envio na fila de retry existente. Banner interno observa o job e funciona sem token; payload de primeira dieta suprime o alerta nativo em primeiro plano. Avisos têm deduplicação local por UID/geração e não mudam de tela sem ação do usuário. Push tocado usa o deep link existente, aguarda rollout/navegação e respeita o UID destinatário.
7. **Validação:** TypeScript, lint, testes unitários, emulador e bundles nativos; detalhes abaixo.

## Arquivos desta implementação

### Domínio, interface e catálogo

- `src/nutrition/ui/profileSteps.ts`
- `src/screens/nutrition/NutritionProfileScreen.tsx` (corpo controlado compartilhado `NutritionProfileQuestion`)
- `src/screens/nutrition/FoodSearchScreen.tsx`
- `src/screens/nutrition/CreateCustomFoodScreen.tsx`
- `src/nutrition/catalog/onboardingCatalog.ts`
- `src/nutrition/catalog/onboardingCatalog.json`
- `scripts/nutrition/buildOnboardingCatalog.ts`
- `scripts/nutrition/checkOnboardingCatalogRemote.ts`
- Traduções `src/i18n/resources/{pt-BR,en,es}/nutrition.json`

### Onboarding, autenticação e transferência

- `src/onboarding/steps.ts`
- `src/onboarding/useOnboardingFunnel.ts`
- `src/onboarding/draftStorage.ts`
- `src/onboarding/nutritionDraft.ts`
- `src/screens/OnboardingFunnelScreen.tsx`
- `src/components/onboarding/QuestionStepScreen.tsx`
- `src/services/onboardingNutritionHandoff.ts`
- `src/services/userProfile.ts`
- `src/state/AuthContext.tsx`
- `src/components/OnboardingNutritionRuntime.tsx`
- `App.tsx`
- `firestore.rules`
- `functions/src/accountDeletion/firestoreCleanup/resources.ts` (inclusão do novo documento na exclusão de conta)

### Geração, experiência e notificações

- `functions/src/nutrition/generation/request.ts`
- `src/services/nutritionGeneration.ts`
- `src/screens/nutrition/NutritionShell.tsx`
- `src/screens/nutrition/NutritionGeneratingScreen.tsx`
- `src/components/NutritionReadyBanner.tsx`
- `src/services/pushNotifications.ts`
- `src/state/DeepLinkContext.tsx`
- `src/lib/deepLinks.ts`
- `src/screens/AppShell.tsx`
- `functions/src/notifications/{contentPolicy,dispatcher,idempotency,notificationPreflight,nutritionNotifications}.ts`

### Testes alterados/adicionados

- `src/nutrition/ui/__tests__/profileSteps.test.ts`
- `src/nutrition/catalog/__tests__/onboardingCatalog.test.ts`
- `src/onboarding/__tests__/{steps,draftStorage,onboardingFunnelWiring}.test.ts`
- `src/services/__tests__/onboardingNutritionHandoff.integration.test.ts`
- `src/services/__tests__/pushNotifications.test.ts`
- `functions/src/nutrition/__tests__/initialOnboarding.integration.test.ts`
- `functions/src/notifications/__tests__/nutritionNotifications.integration.test.ts`

O diretório já continha alterações da refatoração nutricional antes deste trabalho. As mudanças preexistentes em prompts, motor, worker, documentos e outros arquivos foram preservadas; a lista acima descreve o escopo desta implementação, não todo o `git diff` do workspace.

## Validações executadas

- TypeScript do aplicativo e Functions: aprovado.
- ESLint dos arquivos do escopo: nenhum erro; seis avisos em trechos preexistentes de App, AuthContext e NutritionShell.
- Seleção final de onboarding, telas nutricionais, domínio, traduções, deep links e push: **1.095 testes aprovados**. Seleção anterior incluindo equivalência do catálogo local: também aprovada; as contagens se sobrepõem.
- Regressão focada em autenticação, concorrência e gate comercial: **263 testes aprovados**, sobrepostos a outras seleções.
- Firestore Emulator, Java 21: **7 testes aprovados** de cadastro/treino e transferência; repetição final dos quatro testes de transferência também aprovada após endurecimento de conflitos.
- Regras de nutrição: execução completa teve **11 aprovações e uma falha** no teste existente de busca do catálogo amplo de diário. Esse serviço não foi alterado. Nova execução isolando essa falha: **11 aprovações / 1 omitido explicitamente**.
- Backend/notificações no emulador: **385 aprovações / 71 omitidos por flags das próprias suítes**. Validação posterior de primeira geração, persistência, notificações e limpeza: **37 aprovações**; nova execução após proteção de conflitos e compatibilidade de cópias históricas: **34 aprovações**. Contagens se sobrepõem.
- Unitários nutricionais/backend: **84 aprovações / 13 omitidos**. Provedor real de IA não foi chamado.
- Catálogo local: geração reprodutível (`--check`), **173 aprovados / 131.951 bytes**.
- Checagem remota **somente leitura** em `ajfit-2f321`: **173 IDs conferidos, nenhum ausente, não aprovado ou com nome incompatível**, no momento da execução.
- Exportação Expo para iOS e Android: bundles gerados localmente em `/tmp`, sem publicação.
- Contratos nutricionais compartilhados com Functions: `syncNutritionToFunctions.cjs --check` sem divergências.

### Suíte geral

Execução ampla: **7.792 aprovações, 22 falhas, 215 omitidos**. As 22 falhas restantes pertencem a testes de áreas não corrigidas por esta tarefa: cargas, atualização de agenda, Live Activity/descanso, estrutura de WorkoutScreen, edição de perfil, integração de saúde, apresentação comercial/paywall e temas. Não foram alteradas funcionalidades dessas áreas para satisfazer testes estruturais fora do escopo.

A falha de regras de busca do diário compara os IDs `['a', 'b']` com o resultado `['a']`. Ela foi reportada, não escondida nem corrigida por uma refatoração adicional.

## Pendências antes de liberar

1. Validar visualmente onboarding, teclado, busca, modal manual, retorno e retomada em iOS e Android. Não havia Android conectado nem simulador iOS em execução; os bundles validam empacotamento, não interação.
2. Validar compra e restauração com RevenueCat em ambiente apropriado e a transição real paywall → app → primeiro job.
3. Validar push em dispositivos habilitados: primeiro plano, segundo plano, processo encerrado, permissão negada, token inválido, preferências desativadas e troca de conta. Os testes locais não comprovam entrega em produção.
4. Publicar regras e backend de forma coordenada **antes** de distribuir o aplicativo atualizado, quando houver autorização separada de deploy. A callable reutilizada passa a declarar o secret RevenueCat já existente.
5. Investigar separadamente as falhas fora do escopo. A suíte geral não está verde, embora as seleções diretamente relacionadas tenham passado.
6. Reexecutar a checagem remota do catálogo no ambiente de destino em cada liberação que altere o asset.

## Comandos operacionais

```sh
node --import tsx scripts/nutrition/buildOnboardingCatalog.ts --check
node --import tsx scripts/nutrition/checkOnboardingCatalogRemote.ts --project PROJECT_ID
node scripts/syncNutritionToFunctions.cjs --check
npx tsc --noEmit
```

O primeiro comando com `--check` e os dois comandos seguintes são verificações sem escrita remota. Gerar novamente o asset local exige executar `buildOnboardingCatalog.ts` sem `--check`.
