# Publicação proposta — ainda não executada

> **Reverificação (segunda sessão):** este plano foi revisado contra o estado de código final e verificado (ver `REPORT.md` §11/§14 e `validation.json`). Um defeito real em `prescriptionMetadata.ts` (crash ao evoluir um ciclo a partir de um programa ativo sem `trace`/`versions`) foi encontrado e corrigido antes desta reverificação — os cinco endpoints listados abaixo continuam sendo o escopo correto; nenhum endpoint adicional precisa de republicação por causa dessa correção, pois ela está no mesmo módulo (`prescriptionMetadata.ts`) já consumido por `authorizeMutation.ts`/`initializeWorkoutProgramV127`. Nenhum deploy, commit, push ou EAS/OTA foi executado nesta sessão.

> **Fase B (esta seção em diante):** inventário remoto real, diffs concretos, matriz de compatibilidade e ordem segura de publicação, produzidos por leitura direta de produção (`firebase --project ajfit-2f321`) e do código local. Nenhum comando de publicação, build, commit ou push foi executado nesta sessão — apenas leitura.

Projeto configurado pelo alias `production`: `ajfit-2f321`. Estes comandos são um plano, não um registro de publicação. A Fase B exige autorização explícita. Gravações de QA em produção, build/distribuição do aplicativo e limpeza histórica têm escopos separados a autorizar.

## Sequência (original, mantida; detalhamento abaixo em §B)

1. Confirmar o diff revisado e as evidências da Fase A. Registrar o inventário remoto de Functions, nomes/regiões, Rules vigentes e versões instaladas do aplicativo por leitura. Conferir dependências remotas antes de qualquer exclusão.
2. Preparar a distribuição do cliente atualizado. O projeto não configura OTA com `expo-updates`; para usuários do iPhone será necessário gerar e distribuir novo build. Não executar EAS build, submit ou distribuição sem autorização que cubra essas ações. Não há mudança de dependências nativas nesta tarefa.
3. Em uma janela de lançamento coordenada, publicar os cinco endpoints abaixo. O backend novo deve estar disponível para o cliente novo. Clientes antigos ainda contêm a lógica retirada e não representam a versão final do produto; o backend sozinho não atualiza o binário instalado.
4. Distribuir/validar o cliente atualizado e coordenar a atualização dos usuários. Não há versionamento mínimo obrigatório identificado no código atual. As Rules finais recusam gravações antigas de `limits` e `substitutionPolicySnapshot`, portanto não antecipar essa etapa deixando clientes antigos como única versão disponível.
5. Publicar as Rules finais. Confirmar por leitura o projeto, o status das Functions e a versão publicada das Rules. Nenhum índice ou contrato de Storage precisa de alteração por este trabalho.
6. Observar logs das cinco Functions e confirmar ausência de consultas aos datasets clínicos. Repetir os cenários T004, conta existente, sessão em andamento, troca temporária/permanente e finalização em ambiente de QA. Em produção, limitar a verificação à leitura, a menos que exista autorização separada para contas/dados de teste e suas gravações.

## Build e publicação do backend

```sh
npm --prefix functions run build
npm --prefix functions run typecheck
npx firebase deploy --project production --only functions:initializeWorkoutProgramV127,functions:authorizeWorkoutLifecycleMutation,functions:installActiveWorkoutProgram,functions:applyExerciseSubstitution,functions:finalizeWorkoutSession
```

O build limpa `functions/lib` e reconstrói as cópias do motor compartilhado. Isso impede o empacotamento de arquivos obsoletos de builds anteriores.

## Publicação das Rules

Somente no ponto de coordenação com o cliente atualizado:

```sh
npx firebase deploy --project production --only firestore:rules
```

Não publicar todas as Functions ou Storage/índices por conveniência; o escopo local identificado contém cinco endpoints e Firestore Rules.

## Exclusões remotas

Nenhuma Function exclusivamente clínica foi encontrada entre os exports locais. Não há comando de exclusão preparado. Se o inventário remoto revelar um endpoint órfão, registrar seu nome exato, região, consumidores e evidências de ausência de dependências antes de propor a exclusão específica.

## Verificações de release

- Functions sem `MUSCULOSKELETAL_NO_SUBSTITUTE`, `NO_SAFE_CONFIGURATION` ou leituras de `limitationDatasetState`/perfis clínicos.
- T004 com cinco sessões normais; paridade local/autoritativa e instalação com referências consistentes.
- Questionário sem a pergunta/regiões removidas, progresso e retorno funcionando.
- Conta antiga acessa plano, cargas e histórico; sessão antiga finaliza; metadados antigos não alteram a nova prescrição.
- Trocas manuais temporárias e permanentes persistem, reabrem e preservam séries, repetições e cargas; equipamentos e duplicidade seguem validados.
- Clientes atualizados não enviam campos antigos. Rules impedem introduzi-los em criação ou restart.

## Contingência

Não republicar datasets clínicos como fallback nem reativar V3/legacy. Em caso de falha operacional, delimitar a operação afetada, inspecionar logs e usar somente os controles operacionais já existentes e previamente autorizados. Qualquer alteração adicional em produção exige seu próprio escopo revisável. A limpeza dos dados antigos não faz parte deste deploy.

---

# B. Fase B — Preparação de produção (leitura, sem publicação)

Executado em 2026-10-20, contra o projeto `ajfit-2f321` (`firebase use production`), via `firebase functions:list`, leitura direta da API `firebaserules.googleapis.com` (releases/rulesets de Firestore e Storage) e `git diff HEAD` sobre as alterações locais não commitadas. Nenhuma Function, Rule, dado ou dependência foi alterada nesta sessão.

## B.1 — Inventário remoto confirmado

`firebase functions:list --project ajfit-2f321` retorna **74 funções** publicadas, todas `v2`, `callable` (ou `firestore`/`schedule` trigger conforme o caso), região `us-central1`, runtime `nodejs22`. Os cinco endpoints do escopo da remoção estão todos presentes, publicados e saudáveis:

| Function | Versão | Trigger | Região | Memória | Runtime |
| --- | --- | --- | --- | --- | --- |
| `initializeWorkoutProgramV127` | v2 | callable | us-central1 | 256 | nodejs22 |
| `authorizeWorkoutLifecycleMutation` | v2 | callable | us-central1 | 256 | nodejs22 |
| `installActiveWorkoutProgram` | v2 | callable | us-central1 | 256 | nodejs22 |
| `applyExerciseSubstitution` | v2 | callable | us-central1 | 256 | nodejs22 |
| `finalizeWorkoutSession` | v2 | callable | us-central1 | 256 | nodejs22 |

**Funções órfãs/exclusivamente clínicas:** nenhuma encontrada. Revisei os 74 nomes publicados (`adminCampaignAction` … `validatePromoCode`) contra o código-fonte local; não existe nenhuma função com nome "limitation"/"musculoskeletal"/clínico publicada isoladamente. Isso confirma, pelo lado remoto, a afirmação do `REPORT.md` §8: nada precisa ser excluído por este trabalho. Nenhuma exclusão é proposta.

## B.2 — Diffs entre código local e o que está live nos 5 endpoints

Como o checkout não tem o SHA exatamente publicado disponível via CLI (a API de Functions não expõe hash de fonte), a evidência usada para "o que está live" é indireta mas consistente em dois pontos independentes: (a) as Rules de Firestore publicadas (ver B.3) são comprovadamente a versão **pré-remoção**, clínica; (b) todas as alterações da Fase A estão não commitadas (`git status`), logo o HEAD do repositório (`18c27fc`/anteriores) é o candidato a "o que está live". `git diff HEAD` sobre os arquivos que sustentam os 5 endpoints mostra:

- `functions/src/workoutLifecycle/authorizeMutation.ts` (sustenta `authorizeWorkoutLifecycleMutation` e `initializeWorkoutProgramV127`):
  - Remove o import de `mapQuestionnaireLimitations`/`limitationResolver`; passa a importar `CatalogExercise` de `exerciseCatalog.ts`.
  - `canonicalContentIdentity()` deixa de incluir `limitationDatasetVersion`/`limitationDatasetHash` na identidade canônica do plano (linha ~167-171 antes da remoção). **Mudança de contrato**: o hash `wpg_...` de um plano novo é calculado com menos campos — plano novo ≠ mesmo identity hash que o backend antigo produziria para o mesmo input.
  - `assertPlanSafe()` deixa de validar `exercise.limitationProfile` contra as regiões do usuário; passa a exigir apenas `exercise.status === 'active'` (linhas ~524-544 do arquivo antigo removidas).
  - `generateCanonicalCycleEvolution()` deixa de chamar `mapQuestionnaireLimitations` e de propagar `limitationRegions`/`limitationDatasetVersion`/`limitationDatasetHash`; passa a usar `currentPrescriptionMetadata(bundle.program)` (novo módulo, não rastreado em git) para derivar `trace`/`versions` com fallback seguro quando ausentes — este é o fix do bug de crash documentado no `REPORT.md` §11.
  - `validateRequest()` remove `'limits'` da lista de campos comparados entre o alvo da autorização e o questionário persistido (linha ~119) — consistente com `limits` deixar de ter qualquer papel na geração.
  - O `HttpsError` de falha de geração autoritativa (`authoritativePrescription.ts`) passa a incluir `details: { reasonCodes, trace }` — **aditivo**, não quebra clientes antigos que ignoram `details`.
- `functions/src/workoutLifecycle/exerciseSubstitution.ts` (sustenta `applyExerciseSubstitution`, e transitivamente `finalizeWorkoutSession` via `validateMaterializedExecutionSubstitutions`):
  - Remove `mapQuestionnaireLimitations`/`LimitationCatalog`/`LimitationRegionId` de toda a resolução de substituição manual; `isRequestedSubstitutionEligible()` perde o parâmetro `regions`.
  - Adiciona um ramo explícito de compatibilidade: quando a execução já persistida tem o campo legado `substitutionPolicySnapshot`, a revalidação (`validateMaterializedExecutionSubstitutions`) não tenta reinterpretar essa política — apenas confirma que o exercício efetivo continua ativo, disponível para seleção manual, compatível com equipamento e sem duplicidade, e preserva a troca já materializada. Isto é o resíduo inerte descrito no `REPORT.md` §10.2.
- `functions/src/workoutLifecycle/prescriptionContext.ts` (consumido por `initializeWorkoutProgramV127`/`authorizeWorkoutLifecycleMutation`):
  - Remove `loadLimitationDatasetIdentity()` por completo — **nenhum código remanescente consulta a coleção `limitationDatasetState`** (confirmado por `grep -rl limitationDatasetState src functions/src`, único hit é um teste de integração do app, não produção).
  - `buildPrescriptionGenerationContext()` deixa de popular `context.limitationDataset`.
- `functions/src/workoutLifecycle/authoritativePrescription.ts`: apenas o acréscimo aditivo de `details` no `HttpsError` mencionado acima.
- `functions/src/index.ts`: **sem diff** — as cinco assinaturas `onCall(...)` (linhas 146, 164, 180, 192, 211) não mudaram; a remoção é inteiramente interna às funções que elas chamam. Isso confirma o `REPORT.md` §7: "`finalizeWorkoutSession` recebe a mudança transitivamente", sem alteração direta no arquivo.

**Resumo do contrato:** nenhum dos 5 endpoints muda sua assinatura de entrada/saída externa (`request.data`/retorno) de forma que quebre um cliente antigo chamando-os — as mudanças são internas à lógica de geração/validação e ao cálculo de identidade do plano, mais uma adição aditiva (`details` em erros). O único ponto de atrito real é o hash de identidade do plano (`canonicalContentIdentity`) deixar de incluir os dois campos clínicos: um plano gerado pelo backend novo para o mesmo input produzirá um `wpg_...` diferente do que o backend antigo produziria — isso é esperado e não quebra nada porque identidade é recomputada a cada chamada, nunca comparada entre versões de backend.

## B.3 — Firestore Rules: diff concreto (publicado vs. local)

Busquei o ruleset publicado via `firebaserules.googleapis.com/v1/projects/ajfit-2f321/rulesets/<id>` (release `cloud.firestore`, `updateTime: 2026-10-20T16:30:32Z`, **mas o conteúdo é a versão anterior à Fase A** — a data recente reflete outra publicação não relacionada a este trabalho; o ponto relevante é o conteúdo, não a data). Local `firestore.rules` tem 3324 linhas; o publicado tem 3669 linhas (**345 linhas de lógica clínica só existem em produção hoje**). Diferenças confirmadas por `diff`:

| Elemento | Publicado (produção, hoje) | Local (Fase A) |
| --- | --- | --- |
| `workoutProgramLimitationValid(questionnaire, data)` | Existe; exige que `data.versions.limitationResolver in ['1.0.0','2.0.0']`, `data.trace.limitationResolverVersion == 1`, `data.trace.limitationDecisions` consistente com `sessions.size()` sempre que o questionário tiver `musculoskeletal_limitation` em `specialConditions` | **Removida** |
| `workoutProgramLimitationDatasetValid(data)` | Existe; lê `limitationDatasetState/active` via `get()` e exige `data.limitationDatasetVersion`/`data.limitationDatasetHash` coincidirem com o dataset ativo quando presentes | **Removida** |
| Campos aceitos em `workoutPrograms` novo | inclui `limitationDatasetVersion`, `limitationDatasetHash` na lista de chaves permitidas (linha ~443/490 do local antigo) | Campos **removidos** da lista de chaves aceitas — uma gravação nova que os inclua é **rejeitada** |
| `limitationProfileValid(profile, exerciseId)` + uso em `exercises/{id}` | Existe; valida `schemaVersion`, `protocolVersion`, `reviewStatus`, `regions` de `limitationProfile` | **Removida**; local apenas garante `!d.keys().hasAny(['limitationProfile'])` — documento novo/atualizado **não pode mais ter** esse campo |
| Coleção `limitationDatasetState/{stateId}` | `match` dedicado existe, Admin-SDK-write-only | **Removida** — coleção fica sob o bloqueio padrão (nenhum `match` específico) |
| `musculoskeletal_limitation` em `specialConditions` (questionário novo) | Permitido (é o gatilho de `workoutProgramLimitationValid`) | Explicitamente **proibido**: `!request.resource.data.answers.get('specialConditions', []).hasAny(['musculoskeletal_limitation'])` (linha 1554) |
| `substitutionPolicySnapshot` em `workoutExecutions` novo | Aceito com qualquer valor pinado em `['legacy','v3']` na criação | Campo mantido **apenas para imutabilidade de documentos antigos** — chave listada entre as aceitas na lista geral (linha ~610/675 local), mas sem a lógica V3 associada; novas escritas não a introduzem |

**Conclusão B.3:** as Rules publicadas hoje em produção são estritamente as Rules **anteriores** à Fase A — ainda validam o sistema clínico completo (perfis musculoesqueléticos, dataset ativo, trace do resolvedor). As Rules locais da Fase A são estritamente mais restritivas num sentido (rejeitam escrita de campos clínicos novos) e compatíveis num outro (ainda leem/aceitam campos antigos em documentos existentes, nunca os recusam em updates que não os tocam). Isso é exatamente a direção seguranças-primeiro esperada: publicar as Rules novas é **seguro para dados existentes** e **mais restritivo para escritas novas**, nunca o contrário.

## B.4 — Storage Rules

`diff storage.rules <publicado>` → **idêntico, 0 linhas de diferença**. `storage.rules` local (190 linhas) é byte-a-byte igual ao ruleset publicado (`release firebase.storage/ajfit-2f321.firebasestorage.app`, `updateTime: 2026-09-28T14:57:46Z`). Confirma o `REPORT.md` §9: não havia configuração clínica específica em Storage a remover, e nenhuma mudança de Storage está pendente de publicação. Nenhuma ação necessária aqui.

## B.5 — Matriz de compatibilidade (cliente × backend × Rules)

Legenda: "cliente antigo" = app já instalado que ainda contém a UI/questionário/geração local com musculoesquelético; "cliente novo" = build Fase A; "backend antigo"/"novo" = Functions pré/pós Fase A; "Rules antigas"/"novas" = conforme B.3.

| Cenário | Abrir treino | Finalizar sessão | Troca manual | Evolução de ciclo | Geração de novo programa |
| --- | --- | --- | --- | --- | --- |
| **Cliente antigo + Backend novo** (Rules ainda antigas, pois cliente não mudou) | OK. Leitura de `workoutPrograms`/`workoutExecutions` não muda de forma. | OK via `finalizeWorkoutSession`; o backend novo não exige mais `limitationProfile` nos exercícios, então um cliente antigo que ainda envie resquícios de UI clínica não é bloqueado — a validação apenas ignora esses campos (`functions/src/workoutLifecycle/authorizeMutation.ts`, `assertPlanSafe`, bloco que antes checava `regions`/`profile`, agora removido). | OK — `applyExerciseSubstitution` não dependia de UI, apenas do `programInstanceId`; segue igual. | **Risco**: se o cliente antigo ainda envia `answers.limits`/`specialConditions=['musculoskeletal_limitation']` para iniciar uma evolução/novo programa via `initializeWorkoutProgramV127`/`authorizeWorkoutLifecycleMutation`, o backend novo simplesmente ignora esses campos na geração (motor V1.27/V2 não os lê mais — `src/workoutPrescription`/cópia sincronizada em Functions). Resultado funcional correto (gera normal), mas a resposta ao cliente antigo não contém mais `limitationDatasetVersion`/`limitationDatasetHash`/trace clínico que a UI antiga pode esperar exibir — **não quebra a geração, pode deixar uma tela de resumo/clínica do cliente antigo sem dado para mostrar**, nunca um erro 500/permission-denied. | Mesma observação: geração ocorre normalmente; é a UI do cliente antigo (não o backend) que pode exibir uma tela da etapa de limitações vazia/obsoleta. Nenhum crash: `prescriptionMetadata.ts` tolera ausência de `trace`/`versions` (fix do `REPORT.md` §11). |
| **Cliente novo + Backend antigo** (publicar app antes do backend — **não recomendado pela ordem de B.6, mas avaliado aqui**) | OK — leitura não muda. | **Risco médio**: `finalizeWorkoutSession` antigo ainda chama o resolvedor clínico (`mapQuestionnaireLimitations`) dentro de `validateMaterializedExecutionSubstitutions`/`assertPlanSafe` (backend antigo, pré-diff de B.2); como o questionário novo nunca grava `limits`/`musculoskeletal_limitation` (removidos do app novo), `mapQuestionnaireLimitations(answers)` recebe um `answers` sem esses campos. Se o resolvedor antigo trata ausência como "status != MAPPED" e lança (`throw new HttpsError('failed-precondition', 'unmapped_limitation_region')` — linha removida em B.2, mas presente no backend antigo), **a troca manual e a evolução de ciclo quebram para todo usuário no app novo enquanto o backend não for publicado**. | **Quebra** pelo mesmo motivo: `applyExerciseSubstitution` (backend antigo) chama `mapQuestionnaireLimitations` em `loadSubstitutionResolutionContext` e lança `unmapped_limitation_region` quando as respostas não têm o shape clínico esperado. | **Quebra** pelo mesmo caminho em `authorizeMutation.ts` (backend antigo) → `generateCanonicalCycleEvolution` → `mapQuestionnaireLimitations`. | **Quebra** no `assertPlanSafe`/geração autoritativa do backend antigo pelo mesmo motivo. **Esta é a razão pela qual a ordem de publicação em B.6 exige Functions antes do cliente novo, nunca o inverso.** |
| **Cliente novo + Backend novo + Rules antigas** (backend e Functions publicados, Rules ainda não) | OK. | OK — Functions novo usa Admin SDK para os 5 endpoints (bypassa Rules de cliente nesses caminhos, conforme comentário em `exerciseSubstitution.ts`: "Admin SDK, bypasses these Rules entirely"). | OK pelo mesmo motivo — a escrita de substituição é 100% server-side. | OK — escrita de `workoutPrograms` em `CYCLE_EVOLUTION`/`ADAPT` passa por `sealTargetProgram` via Admin SDK, não pelas Rules do cliente. | **Atenção, não quebra, mas é o ponto de maior exposição**: se o app novo também fizer alguma escrita direta de cliente (não via Admin SDK) de um documento de questionário/plano com o shape novo (sem `limits`/`limitationImpact`), as Rules antigas ainda esperam/permitem o shape antigo — como Rules antigas **permitem** tanto a presença quanto, em geral, a ausência condicional desses campos (a validação só se ativa quando `specialConditions` contém `musculoskeletal_limitation`, que o app novo nunca envia), a escrita nova passa. **Não há bloqueio identificado neste cenário** porque a Rule clínica é condicional à presença do campo de gatilho, que o cliente novo nunca envia. |
| **Cliente novo + Backend novo + Rules novas** (publicação completa) | OK. | OK. | OK. | OK. | OK — este é o estado final pretendido; nenhum caminho ativo lê dados clínicos (confirmado em B.1/B.2). |

**Achado central da matriz:** o único cenário realmente perigoso é **"Cliente novo + Backend antigo"** — publicar o app antes do backend quebra troca manual, evolução de ciclo e geração para qualquer usuário que já tenha o app novo, porque o resolvedor clínico do backend antigo (`mapQuestionnaireLimitations`) lança erro ao não encontrar o shape de resposta clínico que o questionário novo nunca mais produz. Isso **confirma e fortalece** a ordem do plano original (Functions → cliente → Rules): o backend precisa estar atualizado **antes** de qualquer usuário rodar o app novo.

## B.6 — Ordem segura de publicação, com critérios go/no-go

1. **Publicar as 5 Functions** (comando em "Build e publicação do backend" acima).
   - Go/no-go: `npm --prefix functions run typecheck` e `npm --prefix functions run build` passam sem erro; `firebase functions:list --project ajfit-2f321` mostra as 5 funções com uma `Version` incrementada (nova revisão) logo após o deploy; logs das 5 funções sem exceção nos primeiros smoke tests de leitura (abrir treino de uma conta de teste já existente). **Não seguir** se o build não limpar `functions/lib` (checar `npm run clean` dentro de `prebuild`, confirmado presente no diff de `functions/package.json`).
   - Neste ponto, clientes antigos continuam funcionando (ver linha 1 da matriz) e nenhum cliente novo foi distribuído ainda — não há exposição ao cenário "cliente novo + backend antigo".
2. **Build e distribuição do cliente novo** (iPhone/Android), coordenada — ver B.7.
   - Go/no-go: build do passo 1 está em produção há tempo suficiente para smoke test (conta de teste simulando troca manual e evolução de ciclo, confirmando que o backend novo não lança `unmapped_limitation_region`/erros clínicos). Só então iniciar a distribuição.
3. **Publicar as Rules novas**, somente depois que uma fração relevante dos usuários já está no cliente novo (ou, no mínimo, depois que o backend novo já absorveu o tráfego do cliente antigo sem regressão por tempo suficiente).
   - Go/no-go: nenhuma escrita de cliente real no app ainda envia `limits`/`musculoskeletal_limitation`/`limitationProfile` (confirmar por amostragem de logs/Firestore, leitura apenas) — caso contrário, Rules novas rejeitariam essas gravações de clientes antigos ainda em uso. Dado que a Rule clínica atual só se ativa quando o cliente envia o campo de gatilho, e o cliente antigo só envia esse campo quando o usuário de fato passa pela etapa de limitações, **o risco real é um usuário de cliente antigo que ainda preenche a etapa clínica removida no app novo** — ou seja, Rules novas devem esperar a distribuição do cliente novo estar suficientemente avançada.
   - Se houver incerteza sobre a fração de clientes antigos restante, a estratégia de transição proposta (quando necessária) é: publicar uma versão intermediária das Rules que apenas **deixa de validar rigorosamente** o shape clínico (torna os campos antigos opcionais/ignorados em vez de obrigatórios-quando-presentes) sem ainda proibir a escrita — isto é, mover a proibição explícita (linha 1554 do local atual) para uma segunda publicação de Rules, depois que a telemetria confirmar client antigo residual ≈ 0. Isso evita qualquer janela em que um cliente antigo ainda ativo tenha uma gravação legítima recusada.
4. **Observar logs e repetir cenários de QA** (leitura apenas em produção; escrita apenas em ambiente de QA/emulador autorizado separadamente).

## B.7 — Build iPhone (Expo/EAS)

- `app.json`: `expo.version` = `1.0.6`, `ios.bundleIdentifier` = `com.ajfit.app`, `ios.buildNumber` = `"1"` (estático, mas `eas.json.build.production.autoIncrement = true` e `cli.appVersionSource = "remote"` — o número de build real é gerenciado remotamente pelo EAS, não precisa bump manual local).
- `eas.json`: perfil `production` existe, `android.buildType = "app-bundle"`, `autoIncrement: true`. Perfil `preview` (interno) e `development` (dev client) também presentes. `submit.production.ios.ascAppId` configurado (`6795349343`).
- **Sem `expo-updates`** no `package.json` (confirmado) — nenhum canal/runtime de OTA configurado; a única forma de atualizar o cliente iPhone é um novo build/distribuição via EAS/TestFlight, consistente com `REPORT.md` §13.
- **Sem mudança de dependências nativas**: `git status`/`git diff` não mostram alteração em `package.json` (além de scripts, não dependências), `package-lock.json`, `ios/`, `android/` ou `functions/package.json` (além dos scripts de build listados em B.2) — não há novo `expo prebuild`/pod install necessário por esta remoção.
- Comando recomendado para rodar **depois** da autorização de build (não executado nesta sessão):
  ```sh
  eas build --platform ios --profile production
  ```
  Checklist pré-distribuição: (a) backend (passo B.6.1) já publicado e validado; (b) `npm run typecheck` e a suíte focada (`vitest run src/workoutPrescription src/prescriptionEvolution src/onboarding ...`) verdes no commit que será buildado; (c) `app.json`/`eas.json` revisados (acima, sem achados pendentes); (d) `ascAppId` e credenciais de assinatura já configurados no EAS (fora do escopo desta tarefa verificar credenciais — apenas confirmar que o campo existe no `eas.json`, o que foi feito).

## B.8 — Confirmação: troca manual não é colocada em risco pela sequência de deploy

Pontos verificados em B.2/B.5, com citação de arquivo:

- Lista de alternativas e elegibilidade: `functions/src/workoutLifecycle/exerciseSubstitution.ts`, `isRequestedSubstitutionEligible()` — segue chamando `evaluateManualSubstitutionCandidate`/`evaluateRevertToAnchor` (motor normal, sem `regions`) em todas as combinações cliente/backend novo.
- Troca temporária/permanente: `applyExerciseSubstitutionHandler()` no mesmo arquivo — assinatura de `data` (`executionId`, `exerciseIndex`, `requestedExerciseId`, `scope`) não mudou; nenhuma alteração de contrato externo.
- Persistência/reabertura: `validateMaterializedExecutionSubstitutions()` — o ramo novo de compatibilidade (linha ~322-334 do diff em B.2) garante que uma troca antiga com `substitutionPolicySnapshot` continua sendo revalidada e aceita (catálogo ativo, equipamento, sem duplicidade) em vez de lançar por falta do mapeamento clínico.
- Séries/repetições/cargas/histórico: nenhum arquivo tocado por esta remoção grava ou lê esses campos; não fazem parte do diff de B.2.
- Autorização transacional: `authorizeWorkoutLifecycleMutationHandler`/Admin SDK — inalterado no ponto de entrada (`functions/src/index.ts`, sem diff).

**Conclusão:** a troca manual não é afetada pela mudança de sequência de deploy, exceto pelo cenário já identificado em B.5 ("cliente novo + backend antigo"), que a ordem recomendada em B.6 evita por construção.

## B.9 — Plano de validação pós-deploy (sem gravar dados de teste em produção)

Após cada etapa de B.6, validar **apenas por leitura** em produção:

1. **Após publicar as 5 Functions:** `firebase functions:list --project ajfit-2f321` confirma nova revisão; `firebase functions:log --project production` (ou console) nos primeiros minutos, filtrando por essas 5 funções, sem exceções novas (especialmente sem `unmapped_limitation_region`, `authoritative_limitation_dataset_identity_missing`, `authoritative_cycle_evolution_limitation_unmapped` — strings que só existiam no backend antigo e cuja presença nos logos após o deploy indicaria rollback incompleto/cache). Abrir (ler) uma conta de teste existente e confirmar que o treino ativo e o histórico continuam acessíveis.
2. **Após distribuir o cliente novo:** confirmar nas lojas (App Store Connect/Play Console, leitura) que a nova versão está disponível; acompanhar taxa de erro/crash nos consoles (leitura) por um período antes do passo 3.
3. **Após publicar as Rules novas:** reler `firebaserules.googleapis.com/.../releases` para confirmar `updateTime` novo na release `cloud.firestore`; repetir a consulta de B.3 e confirmar que o conteúdo publicado agora bate com o `firestore.rules` local (diff vazio). Observar logs de Functions por tentativas de escrita rejeitadas por Rules (indicaria cliente antigo residual tentando gravar campo agora proibido) — se aparecerem, é o sinal para acionar a estratégia de transição descrita em B.6.3 antes de prosseguir.
4. Em nenhum desses passos, criar/gravar dados de teste em produção; qualquer verificação que exija escrita (T004, troca manual ponta a ponta, evolução de ciclo) deve ocorrer em emulador/QA, como já feito na Fase A.

## B.10 — Plano de rollback

- **Functions:** `firebase functions:list` não expõe rollback de uma revisão anterior diretamente pela CLI atual; o caminho seguro é reverter o deploy republicando a revisão de código anterior (o commit/estado atual de produção, hoje idêntico ao HEAD do git antes das alterações não commitadas desta tarefa) com o mesmo comando de deploy, sem recriar nenhum dataset clínico novo — **o código-fonte antigo já existe no HEAD do repositório** (as exclusões da Fase A estão todas como alterações de working tree, não commitadas), então um rollback de Functions é "reverter para o HEAD atual e rodar o deploy do zero a partir dele", não "reativar um sistema que foi apagado permanentemmente".
- **Rules:** mesma lógica — `firestore.rules` no HEAD do git (sem as alterações da Fase A) é a versão que corresponde ao que está publicado hoje; rollback = publicar esse arquivo novamente. **Não é necessário reconstituir nada a partir de zero**, pois nada foi commitado/apagado do histórico do Git ainda.
- **Clientes já atualizados durante um rollback:** se o rollback de Functions ocorrer depois que parte dos usuários já está no cliente novo, esses usuários cairiam no cenário "cliente novo + backend antigo" da matriz B.5 — troca manual e evolução de ciclo quebrariam para eles. **Alerta explícito**: um rollback de backend só é seguro para 100% dos usuários enquanto nenhum cliente novo tiver sido distribuído; depois da distribuição, um rollback de backend exige rollback/pausa equivalente da distribuição do cliente (ex.: reverter o release na loja ou direcionar usuários para uma versão anterior), não apenas reverter Functions.
- **Alerta de segurança clínica:** em nenhuma hipótese o rollback deve reintroduzir os datasets/resolvedores clínicos (`limitationResolver.ts`, `musculoskeletalLimitationV127.ts`, etc.) como "solução" para uma falha operacional — esses arquivos foram deliberadamente excluídos por decisão de produto (remoção do sistema musculoesquelético), não por bug. Se uma falha operacional parecer exigir esse sistema de volta, a alternativa segura é **pausar a etapa de rollout afetada** (ex.: não publicar Rules ainda, ou pausar a distribuição do cliente) e investigar, nunca reinstaurar a lógica clínica como fallback automático.

## B.11 — Riscos e bloqueios remanescentes

1. Nenhuma forma automatizada de confirmar, por API, exatamente qual commit/SHA está rodando em cada Function hoje — a evidência de "backend live = pré-Fase A" é indireta (consistência com as Rules publicadas, que são inequivocamente a versão clínica antiga) e não um hash de build comparado diretamente. Recomenda-se, antes do deploy real, confirmar isso por outra via disponível à equipe (ex.: tag de build nos logs, console do Cloud Build/Cloud Functions) se possível.
2. Não há telemetria neste repositório que meça, hoje, quantos usuários ainda estão num cliente antigo o suficiente para preencher a etapa clínica removida — o critério de go/no-go do passo B.6.3 (publicar Rules) depende de uma medição operacional (App Store/Play Console ou analytics) fora do escopo deste repositório.
3. As 9 falhas de teste pré-existentes documentadas em `REPORT.md`/`validation.json` (4 de integração ampla + 5 de primeira geração/evolução) continuam não relacionadas a este removal, mas continuam falhando — não bloqueiam esta publicação, mas devem continuar rastreadas separadamente.
4. Nenhum versionamento mínimo obrigatório de cliente está implementado no backend — o backend novo aceita chamadas de qualquer versão de cliente instalada hoje; isso é intencional (ver matriz B.5), mas significa que a "janela de coordenação" do passo B.6.2 depende de processo/observação, não de um gate técnico.

## B.12 — Veredito final

**PRONTO PARA AUTORIZAR DEPLOY**, na ordem e com os critérios go/no-go de B.6: **Functions (5 endpoints) → distribuição do cliente novo → Rules de Firestore**, nunca a ordem inversa entre Functions e cliente. Justificativa concreta:

- O inventário remoto confirma os 5 endpoints certos, publicados, sem nenhuma função clínica órfã a remover (B.1).
- Os diffs de código (B.2) mostram que nenhuma mudança de contrato externo quebra um cliente antigo falando com o backend novo; o único efeito é a lógica interna (identidade de plano e remoção de validação clínica), com um ramo de compatibilidade explícito para substituições materializadas antigas.
- As Rules publicadas hoje são comprovadamente a versão clínica anterior (B.3), e a transição planejada (B.6.3) inclui uma estratégia explícita de tolerância a clientes antigos residuais antes de proibir campos antigos definitivamente.
- Storage não precisa de nenhuma ação (B.4).
- O único cenário realmente perigoso da matriz de compatibilidade — cliente novo rodando contra backend antigo — é evitado pela ordem recomendada, não por acaso.
- Build do iPhone está configurado corretamente (sem OTA, perfil de produção presente, sem dependências nativas novas); falta apenas autorização explícita separada para executar o build/distribuição, que esta tarefa não executa.

Pendências que não bloqueiam a autorização, mas devem acompanhar a execução: medição operacional de clientes antigos residuais antes do passo de Rules (B.11.2), e confirmação independente do SHA realmente em produção antes do primeiro deploy real (B.11.1).
