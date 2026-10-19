# AJ Fit — rollback do Food Matcher

Executado em 18/10/2026, projeto `ajfit-2f321`, região `us-central1`.

**Resultado: rollback do código e da infraestrutura concluído e validado.** Não há dependência ativa das três callables, do gateway, do marcador ou da configuração do Matcher. O diário voltou ao protocolo manual anterior. Nenhum commit, push ou publicação em loja foi executado.

O escopo foi ajustado pelo usuário durante a execução: “Não se preocupe com o iphone fisico e o build. Depois eu mesmo gero um novo build. Preocupe-se somente com o codigo e os deploys”. Validação visual no aparelho e distribuição de um próximo build ficam sob responsabilidade do usuário.

1. **Arquivos removidos**

As 34 adições exclusivas abaixo foram identificadas pelo diff local, conteúdo e relatórios A–D, e arquivadas antes da remoção. Os relatórios históricos completos estão no backup, inclusive C, D, diff reconciliado e piloto.

- `docs/nutrition/food-matcher-phase-a.md`
- `docs/nutrition/food-matcher-phase-b.md`
- `docs/nutrition/food-matcher-phase-c.md`
- `docs/nutrition/food-matcher-phase-d-rules-reconciled.diff`
- `docs/nutrition/food-matcher-phase-d.md`
- `docs/nutrition/food-matcher-pilot-test.md`
- `docs/nutrition/food-matcher-resolution-audit.md`
- `functions/src/nutrition/mealConsumption/authority.ts`
- `functions/src/nutrition/mealConsumption/manualDiary.ts`
- `functions/src/nutrition/mealConsumption/service.ts`
- `scripts/nutrition/diaryAuthority.cjs`
- `scripts/nutrition/nativeReleasePreflight.cjs`
- `src/components/nutrition/PreparedMealConfirmation.tsx`
- `src/components/nutrition/__tests__/preparedMealConfirmation.test.ts`
- `src/nutrition/matcher/__tests__/matcher.test.ts`
- `src/nutrition/matcher/index.ts`
- `src/nutrition/matcher/lexicon.ts`
- `src/nutrition/ui/__tests__/mealRegistration.fixtures.ts`
- `src/nutrition/ui/__tests__/mealRegistration.test.ts`
- `src/nutrition/ui/mealRegistration.ts`
- `src/nutrition/ui/mealRegistrationFlag.ts`
- `src/services/__tests__/diaryAuthority.emulator.integration.test.ts`
- `src/services/__tests__/diaryAuthorityPlan.test.ts`
- `src/services/__tests__/mealRegistrationPhaseB.emulator.integration.test.ts`
- `src/services/__tests__/nutritionDiaryBackend.test.ts`
- `src/services/__tests__/nutritionMealIntent.test.ts`
- `src/services/__tests__/nutritionMealPreparation.test.ts`
- `src/services/__tests__/nutritionNativeReleasePreflight.test.ts`
- `src/services/__tests__/plannedMealConsumption.emulator.integration.test.ts`
- `src/services/nutritionDiaryBackend.ts`
- `src/services/nutritionMealIntent.ts`
- `src/services/nutritionMealPreparation.ts`
- `src/types/nutritionDiaryMutation.ts`
- `src/types/nutritionMealPreparation.ts`

O arquivo misto `firestore-tests/nutritionWorkoutReconciliation.rules.test.ts` foi substituído por `firestore-tests/workoutLastPerformedLocalDate.rules.test.ts`: foram mantidos os 21 casos independentes de treino e retirados quatro casos exclusivos da autoridade nutricional. Espelhos gerados e código compilado exclusivos de Matcher, contratos e servings importado apenas pelo Matcher também foram removidos. Diretórios `ios/` e `android/` foram preservados.

2. **Arquivos restaurados**

- `functions/src/accountDeletion/firestoreCleanup/resources.ts` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `functions/src/index.ts` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `scripts/syncNutritionToFunctions.cjs` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `src/screens/nutrition/NutritionShell.tsx` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `src/screens/nutrition/RegisterMealScreen.tsx` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `src/services/nutritionDiary.ts` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `src/i18n/resources/en/nutrition.json` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `src/i18n/resources/es/nutrition.json` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.
- `src/i18n/resources/pt-BR/nutrition.json` — conteúdo de `83566d76f20e8cc44b022489311cd2f358162e0b`.

Não foi usado reset global nem revert de commit. `HEAD` e `origin/main` coincidiam no começo. As mudanças do Matcher eram locais e não commitadas; o histórico anterior contém melhorias de geração/onboarding/receitas preservadas. O fluxo de planos, alternativas e favoritos volta a abrir a busca manual com os alimentos planejados apenas como referência. Add/edit/remove/move do diário usam novamente o serviço legado, sem callable, marcador, recibo ou base congelada.

`firestore.rules` foi reconstruído a partir do ruleset remoto capturado, e não publicado a partir de uma versão histórica. `.env` teve somente as duas linhas `EXPO_PUBLIC_NUTRITION_MEAL_REGISTRATION_ENABLED` e `EXPO_PUBLIC_NUTRITION_MEAL_REGISTRATION_UIDS` removidas. Os demais bytes do arquivo foram conferidos e preservados.

3. **Alterações preservadas**

- Proteção remota independente de `lastPerformedLocalDate`: create permite ausência/null; update preserva o valor atribuído pelo backend; grant de treino continua obrigatório quando aplicável.
- Compatibilidade dos favoritos livres com o contrato que o serviço de favoritos já usava antes do Matcher. Retirar essa validação quebraria uma funcionalidade compartilhada; não existe preparação ou consumo inteligente nessa regra.
- `src/nutrition/foodLog/rank.ts` e seu teste: deduplicação por identidade/barcode preserva composições independentes de mesmo nome. Correção compartilhada da busca manual, sem dependência do Matcher.
- `src/screens/nutrition/MealDetailsScreen.tsx`: preservada a retirada do sucesso prematuro disparado apenas ao abrir o registro, antes de qualquer gravação.
- Gerador de dietas, correções de macros, onboarding, receitas, busca federada, notificações, pagamento, autenticação e código nativo compartilhado preservados.

A comparação integral dos arquivos rastreados com o snapshot inicial encontrou dez arquivos alterados pela operação e nenhuma alteração inesperada. As três alterações compartilhadas acima já existiam no início e permaneceram intactas. Evidência: `scope-verification.json`.

4. **Functions excluídas**

`prepareNutritionMeal`, `confirmNutritionMeal` e `mutateNutritionDiary`, somente em `us-central1`. Exclusões retornaram sucesso; inventário final não contém os três nomes e os três serviços Cloud Run correspondentes retornaram HTTP 404. Implementações, exports, tipos, adaptadores e chamadas removidos do código e do pacote publicado.

Evidências: `delete-matcher-functions.log`, `remote/functions-after.json`, `remote/infra-cleanup-validation.json`.

5. **Functions preservadas**

`onAccountDeletionRequested` e `cleanupPendingAccountDeletions` foram preservadas e republicadas seletivamente para retirar somente a enumeração das sete coleções exclusivas do Matcher de `firestoreCleanup/resources.ts`. A comparação com o archive publicado anterior ao Matcher mostrou que essa enumeração era a única mudança no código de exclusão de conta (além do sourcemap). O arquivo compilado publicado ao final é idêntico ao anterior ao Matcher.

- `onAccountDeletionRequested`: `onaccountdeletionrequested-00012-sul`, `ACTIVE`.
- `cleanupPendingAccountDeletions`: `cleanuppendingaccountdeletions-00012-tud`, `ACTIVE`.
- Bindings de secrets, service account e triggers preservados. Nenhuma exclusão real de conta foi disparada para testar.
- 77 Functions antes → 74 depois. As outras 72 têm metadados integralmente iguais aos capturados antes.

Evidências: `account-deletion-comparison.json`, `remote/published-source-verification.json`, `deploy-account-deletion-functions.log`, `remote/final-summary.json`.

6. **Firestore Rules antes e depois**

| Estado | SHA-256 do conteúdo | Ruleset |
|---|---|---|
| Antes | `284fa21e584e322d397f9523a468a0cc0df75f9933705fe7b0670c19634b2f16` | `34e4a0fd-6691-4ebe-9799-f001bc52f03a` |
| Depois | `7a707fbadbdbf55c8d5fe8c281fbb4c4da06525d39e3cc8b4b587bcf372a63ed` | `ab948231-559b-4842-ac3f-d7a72676c994` |

Removidos `legacyDiaryWriteAllowed` e seus sete gates de escrita, mais os matches das coleções exclusivas. O diário legado mantém validação de proprietário, conta ativa, formatos, quantidades e totais. Coleções aposentadas e configuração global ficam sem permissão de cliente; tentativas reais de recriação foram negadas. Favoritos compartilhados e proteção de treino foram preservados. Nenhum outro domínio de Rules foi revertido.

O conteúdo remoto coincidiu com o local inicial. Antes da publicação foram conferidos novamente ruleset, updateTime e hash para detectar concorrência. Os 570 testes de Rules passaram antes do deploy. Após o deploy, a API confirmou igualdade byte a byte com o arquivo aprovado e os testes de cliente autenticado/anônimo confirmaram permissões positivas e negativas.

Arquivos completos e diff: `remote/firestore-before.rules`, `remote/firestore-after.rules`, `rules-before-after.diff`, releases/rulesets JSON e `deploy-rules.log` no backup.

7. **Configurações e artefatos removidos; ordem da transição**

O aplicativo piloto foi encerrado e o Metro deste projeto parado. Depois do backup e sua verificação, uma única transação administrativa colocou a flag em false e o marcador em modo maintenance. As Rules então publicadas continuaram impedindo escrita direta, e os handlers rejeitaram a autoridade em manutenção. Transações backend concorrentes que leram o marcador ficam sujeitas a conflito/precondição; a auditoria posterior comprovou dados e recibos estáveis.

Passados os deadlines das callables, foram relidos todos os documentos legítimos e auditados os quatro dias nutricionais das contas internas. Não havia item `pm_`, base congelada ou recibo de consumo inteligente a converter. O único recibo manual correspondia a um item já persistido, que foi preservado.

Uma única operação Firestore com precondições de updateTime retirou os seis documentos abaixo, incluindo o marcador. As Rules existentes só liberaram o protocolo legado após essa operação atômica; o gateway passou a falhar por ausência de autoridade. Recibos aposentados não podem voltar a gravar, porque os endpoints e leitores de intenções foram removidos. Depois foram publicados Rules sem o protocolo e excluídas as três callables.

- `users/q1BaTl9IT4QtZbP5ZLPoa6DBHg63/nutritionDiaryAuthority/current`
- `users/q1BaTl9IT4QtZbP5ZLPoa6DBHg63/nutritionDiaryMutationReceipts/d94b4662-2b3e-4515-b200-78a1e5463136`
- `users/q1BaTl9IT4QtZbP5ZLPoa6DBHg63/nutritionDiaryVerifiedDays/2026-10-18`
- `users/q1BaTl9IT4QtZbP5ZLPoa6DBHg63/nutritionMatcherLimits/current`
- `users/q1BaTl9IT4QtZbP5ZLPoa6DBHg63/nutritionMealPreparations/7adb19603aad5cf70c801db3b5a08e3c4fc4232bd296fc86b86acd409b5c5e7e`
- `nutritionMatcherConfig/current`

Todas as 13 contas internas foram inspecionadas; a consulta global encontrou exatamente uma autoridade antes e zero depois. Consultas globais das sete coleções exclusivas retornaram zero documentos ao final. App Check compartilhado, provedores, enforcement, índices, Auth e Storage não foram desabilitados nem reconfigurados. Scripts de migração e preflight exclusivos foram retirados; não há novas dependências npm a remover.

8. **Estado final da conta piloto**

UID `q1BaTl9IT4QtZbP5ZLPoa6DBHg63`: conta Auth idêntica ao backup, perfil e dieta preservados, nenhum marcador de autoridade, diário manual compatível. Plano existente `962ee17d-7ce3-459d-9f22-270893508971` preservado; nenhuma dieta regenerada. Favoritos e demais dados nutricionais capturados permanecem idênticos, incluindo updateTimes. A operação não escreveu em dados de treino ou pessoais.

9. **Comparação nutricional antes e depois**

| Data do piloto | Itens antes → depois | kcal antes → depois | Proteína g, preservada | Carboidrato g, preservado | Gordura g, preservada | Fibra g, preservada |
|---|---|---|---|---|---|---|
| 2026-10-17 | 6 → 6 | 1848.30 → 1848.30 | 65.04 | 334.58 | 25.50 | 38.85 |
| 2026-10-18 | 1 → 1 | 130.00 → 130.00 | 2.40 | 28.00 | 0.30 | 0.40 |

O sétimo item foi um registro manual posterior ao relatório inicial do piloto, com prefixo `md_`; foi mantido, pois não há evidência de que possa ser apagado como teste descartável. Seu formato já era compatível com o legado.

Os 61 documentos legítimos capturados — incluindo raízes de 13 usuários, quatro planos, quatro dias, seis refeições e 15 itens de todas as contas — permaneceram exatamente iguais em JSON canônico e updateTimes. Não foi necessário recalcular nem regravar nenhum total. Todos os quatro dias foram auditados com comparação de somas por item/refeição/dia, tolerância de arredondamento de 0,011 para doubles legados.

Evidências privadas: `remote/documents-before.json`, `remote/documents-preserved-after.json`, `remote/data-audit-maintenance.json`, `remote/pilot-auth-before.json`, `remote/pilot-auth-after.json`.

10. **Testes executados e resultados**

| Verificação | Resultado |
|---|---|
| TypeScript app | Passou, antes e depois |
| TypeScript Functions completo e build | Passaram |
| Sync nutricional `--check` | Passou, sem divergências |
| Firestore Rules | 25 arquivos; 570 testes passaram |
| Jornada/recuperação nutricional com Emulator e Rules | 2 arquivos; 3 testes passaram |
| Functions nutrição + cleanup resources | 157 passaram; 22 skips sem opt-in de integrações adicionais |
| Suíte geral antes | 7.974 passaram; 22 falharam; 272 skips |
| Suíte geral depois | 7.835 passaram; 22 falharam; 219 skips |
| Comparação das falhas gerais | Mesmos 22 casos, em 13 arquivos; zero nova falha |
| ESLint integral bruto | 175 erros/704 avisos; inclui artefatos/caches gerados |
| ESLint em fontes comparáveis | 96 erros no snapshot anterior; 71 depois; zero erro novo |
| ESLint dos arquivos afetados | Zero erros; quatro avisos já presentes |
| Firebase real com Firebase ID token, sem Admin nas escritas testadas | 21 verificações passaram |
| `git diff --check` e comparação de escopo | Passaram |
| iOS Release local | Compilou; assinatura verificada |
| Android Debug local | Compilou |

A redução de casos da suíte geral corresponde à remoção dos testes exclusivos. As 22 falhas preexistentes são de treino/descanso/layout/saúde/assinatura/tema; os nomes exatos constam em `unit-baseline-comparison.json`. O lint global continua reprovado por problemas preexistentes; não se declara o projeto inteiro verde. Na comparação de lint foram excluídos `functions/lib`, `.expo` e arquivos AppleDouble, e as mensagens foram confrontadas por arquivo/regra/posição. Nenhum arquivo externo foi corrigido para encobrir o baseline.

Os 21 probes reais cobriram autenticação Firebase, create/edit/remove com totais e persistência por nova leitura, leitura entre contas negada, escrita entre contas negada, leitura anônima negada, shape inválido negado, bootstrap de treino permitido com null, falsificação de `lastPerformedLocalDate` negada, sete coleções aposentadas negadas e configuração global negada. Duas contas temporárias de verificação foram criadas em execuções sucessivas e removidas integralmente em `finally`; nenhuma conta interna foi usada para escrita destrutiva. Inventário final voltou a 13 contas. Não foram criados ou logados tokens de bypass App Check. Uma tentativa anterior de assinar token de usuário foi negada pelo IAM; nenhuma permissão IAM foi ampliada e a alternativa usada foi a conta temporária com senha aleatória mantida apenas em memória.

A suíte de jornada com Emulator validou perfil/plano, registro manual, edição, exclusão, favoritos, isolamento, histórico e resumo semanal; as suítes nutricionais da execução geral cobriram telas, alternativas e contratos. Persistência real foi validada por nova leitura REST. Não equivale a teste visual de fechar/reabrir o iPhone, retirado do escopo pelo usuário.

11. **Deploys realizados**

```text
firebase deploy --project ajfit-2f321 --only firestore:rules --non-interactive
firebase functions:delete prepareNutritionMeal confirmNutritionMeal mutateNutritionDiary --region us-central1 --project ajfit-2f321 --force --non-interactive
firebase deploy --project ajfit-2f321 --only functions:onAccountDeletionRequested,functions:cleanupPendingAccountDeletions --non-interactive
```

Todos retornaram sucesso. Não houve deploy geral de Functions, deploy de geração ou alteração de índices. O pacote final das duas Functions foi baixado e inspecionado: nenhum módulo/export do Matcher e resources compilado igual ao pré-Matcher. SHA-256 do archive publicado: `3f147d5753f2f808d66a56edaebaf61078693c8eda106daf843f8c6e10a8e10f`.

12. **Aplicativo no iPhone e builds**

Antes de o usuário dispensar essa parte, o Release foi compilado e verificado sem referências às três callables, ao UID piloto, à flag, à autoridade ou aos namespaces de intenções do Matcher. SHA-256 do bundle: `8c9456f40d476d8a25847da6e84871d6535d2739a92caa4ea430a39fce459a21`. A instalação que já estava em andamento retornou sucesso, preservando o contêiner, sem uninstall. Não foi feito teste visual, nem declarada homologação física. Nenhuma ação adicional no aparelho foi exigida após o ajuste do escopo; o próximo build e sua instalação ficam com o usuário.

O código que lê/envia intenções SecureStore foi removido. O Keychain compartilhado não foi apagado nem exportado: eventuais chaves órfãs são inertes no novo cliente e não têm endpoint backend disponível para executar novamente. Dados pessoais e sessão não foram limpos.

13. **Backup, integridade e pendências**

Backup privado fora do repositório:

`/Users/victor/.local/share/ajfit-rollback-backups/2026-10-18T16-53-00Z`

Inclui `workspace-before.tar.gz` (código rastreado/untracked, arquivos locais, configs e fontes nativas; exclui dependências reinstaláveis e caches de build), `repository.bundle`, `git-state.tar.gz`, patches staged/unstaged, refs/log/status, Rules publicadas, metadados de todas as 77 Functions, cinco archives de código publicado, documentos de todas as contas internas no escopo nutricional, configurações/recibos/preparações, evidências anteriores e cópia do contêiner do iPhone. O arquivo do Release anterior também foi preservado. O backup de fontes não depende exclusivamente do Git.

O backup remoto de 67 documentos foi conferido por segunda leitura antes da primeira mutação. Archives ZIP foram testados com unzip; tar e Git bundle foram verificados. O manifesto inicial foi verificado e reconferido ao final, sem divergências:

`manifest-before.json` SHA-256: `c5fd6b50e90dd90909140a25174e0cb133a16ee682470808eeb1041009cde62e`.

`manifest-final.json` e `manifest-final.sha256` registram as evidências finais. O script `verify-integrity.py` verifica os arquivos contra ambos os manifestos. Dados de usuários/configurações e archives são privados no diretório de backup, sem segredos no relatório. Uma restauração remota exigiria repetir a coordenação entre dados, cliente, Rules e Functions; os snapshots não devem ser importados isoladamente sobre um sistema em uso.

**Pendências do rollback de código/deploy/dados: nenhuma.** Persistem o baseline geral de testes/lint descrito acima e a validação visual do próximo build pelo usuário, fora do escopo final. Não há autoridade, configuração, preparação, recibo ou Function ativa do Matcher.
