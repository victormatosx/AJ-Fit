# 25. Exclusão de Conta — Arquitetura (Fase 1 + Fase 2)

> **Para a arquitetura ATUAL (produção, E2E validado nos 3 providers), veja
> [`account-deletion.md`](./account-deletion.md).** Este documento permanece
> como histórico/retrospectiva fase a fase — útil para entender POR QUE
> certas decisões foram tomadas, mas não é a fonte de verdade sobre o estado
> atual do sistema.

## 0. Status deste documento

Este documento descreve a arquitetura da **Fase 1 — Contrato técnico e máquina
de estados** e da **Fase 2 — Reautenticação para exclusão de conta**, ambas
concluídas sem excluir nenhum dado real. Nesta fase:

* **nenhum dado real de usuário foi excluído**;
* **nenhuma Cloud Function foi registrada** (`functions/src/index.ts` não
  importa nada de `accountDeletion/`);
* **nenhum Admin SDK call existe** em `functions/src/accountDeletion/`;
* **nenhum deploy foi feito**.

O código vive em `functions/src/accountDeletion/` (tipos, máquina de
estados, políticas, testes) e é 100% puro — sem I/O de Firestore, Storage,
RevenueCat, Apple ou Google. As fases seguintes (Fase 2+, fora do escopo
deste documento) implementam a callable `requestAccountDeletion`, o worker
que de fato executa os passos, e a integração com cada provedor.

Pré-condição obrigatória herdada da Fase 0, registrada aqui novamente: `firestore.rules` linha 3 se autodenomina "SUGESTÃO / pendente de validação
humana" — **não presuma que as regras do repositório são as regras
deployadas em produção**. A segurança desta arquitetura nunca depende das
Firestore/Storage Rules: toda operação destrutiva roda via Admin SDK (que
ignora as rules), e a autorização de quem pode iniciar uma exclusão vem
exclusivamente de `request.auth.uid`/`request.auth.token.auth_time`
verificados pelo runtime de Callable Functions, nunca das rules do cliente.
Antes de qualquer fase que efetivamente apague dados reais, é necessário
confirmar no Firebase Console quais regras estão de fato publicadas.

## 1. Por que uma máquina de estados

O cliente nunca executa a sequência de deletes. Ele faz uma única chamada
conceitual (`requestAccountDeletion`, contrato em `requestContract.ts`) que
cria um registro e devolve um `deletionId`. Todo o resto — travar a conta,
revogar providers, destruir a chave do Photo Vault, apagar Firestore/Storage,
processar retenção, decidir o que fazer com o RevenueCat, e por fim excluir o
Firebase Auth user — é responsabilidade de um worker de backend que não
depende do app permanecer aberto, nem do usuário continuar autenticado depois
que a solicitação foi aceita.

```text
CLIENT                    BACKEND (Fase 2+)
  |                          |
  |--- requestAccountDeletion (recent-auth) ---> [cria/reusa AccountDeletionRecord]
  |<-- { deletionId, accepted: true } ----------|
  |                          |
  |                    (app pode fechar)         |
  |                          |
  |                          |--- worker assíncrono processa etapas ---
  |                          |     (não depende de sessão do usuário)
```

## 2. Máquina de estados global

Definida em `functions/src/accountDeletion/stateMachine.ts:1-83`.

| Estado | Significado |
|---|---|
| `REQUESTED` | Registro criado; nenhum worker começou a processar ainda. |
| `PROCESSING` | Um worker está executando etapas ativamente agora. |
| `RETRY_SCHEDULED` | Uma etapa falhou de forma retryable; o workflow aguarda `nextAttemptAt` antes de voltar a `PROCESSING`. |
| `COMPLETED` | Terminal. Toda etapa exigida pela política da versão está `SUCCEEDED` ou `SKIPPED_BY_POLICY`. |
| `FAILED_TERMINAL` | Terminal. Uma etapa falhou de forma não-recuperável, ou o orçamento de retries de uma etapa se esgotou. |

Transições permitidas (`GLOBAL_TRANSITIONS`, `stateMachine.ts:19-25`):

```text
REQUESTED       -> PROCESSING
PROCESSING      -> RETRY_SCHEDULED | COMPLETED | FAILED_TERMINAL
RETRY_SCHEDULED -> PROCESSING | FAILED_TERMINAL
COMPLETED       -> (nenhuma)
FAILED_TERMINAL -> (nenhuma)
```

**Decisão arquitetural explícita** (Fase 1 §7): o estado global **não**
replica um valor por etapa (`CLEANUP_FAILED`, `REVOCATION_FAILED`, etc.). Um
estado por falha cresceria linearmente com o número de etapas e pararia de
ser um diagrama pequeno e auditável. Em vez disso, o detalhe "qual etapa,
quantas tentativas, quando tenta de novo" vive exclusivamente em
`AccountDeletionRecord.steps` (máquina de estados das etapas, seção 3). O
único valor global que reflete "algo falhou e está aguardando" é
`RETRY_SCHEDULED` — deliberadamente distinto de `PROCESSING` para que um
operador (ou um futuro job de reconciliação) saiba diferenciar "um worker
está rodando agora" de "nada está rodando, isso volta em `nextAttemptAt`"
sem precisar ler todas as etapas.

## 3. Máquina de estados das etapas

Definida em `functions/src/accountDeletion/steps.ts:1-90`.

| Estado da etapa | Significado |
|---|---|
| `PENDING` | Ainda não tentada. |
| `RUNNING` | Uma tentativa está em andamento agora. |
| `SUCCEEDED` | Terminal — objetivo da etapa confirmado atingido (inclusive via sucesso lógico, ver seção 8). |
| `SKIPPED_BY_POLICY` | Terminal — a política da versão determinou `RETAIN`/`SKIP` para tudo que essa etapa cobre; nenhuma ação destrutiva foi executada. |
| `FAILED_RETRYABLE` | Falhou por uma condição transitória; pode voltar para `RUNNING`. |
| `FAILED_TERMINAL` | Terminal — falha não-recuperável, ou orçamento de retries esgotado. |

Transições (`STEP_STATUS_TRANSITIONS`, `steps.ts:27-37`):

```text
PENDING           -> RUNNING
RUNNING           -> SUCCEEDED | SKIPPED_BY_POLICY | FAILED_RETRYABLE | FAILED_TERMINAL
FAILED_RETRYABLE  -> RUNNING
SUCCEEDED         -> (nenhuma)
SKIPPED_BY_POLICY -> (nenhuma)
FAILED_TERMINAL   -> (nenhuma)
```

## 4. As oito etapas, em ordem de dependência

`ACCOUNT_DELETION_STEP_NAMES`, `functions/src/accountDeletion/types.ts:56-65`.

```text
1. ACCOUNT_ACCESS_LOCK       — desabilita o Firebase Auth user + revoga refresh tokens
2. PROVIDER_REVOCATION       — revoga tokens Apple/Google (quando tecnicamente possível)
3. VAULT_KEY_DESTRUCTION     — destrói o material criptográfico do Photo Vault  [PONTO DE NÃO RETORNO]
4. FIRESTORE_CLEANUP         — hard delete de perfil/preferências/questionários/avaliações/
                                metadados do Vault/subscription mirror/attribution mirror
5. STORAGE_CLEANUP           — hard delete de avatar/fotos de evolução/thumbnails
6. RETAINED_DATA_PROCESSING  — support + couponRedemptions, conforme política versionada
7. REVENUECAT_PROCESSING     — RevenueCat customer, conforme política versionada
                                (NUNCA significa cancelar a assinatura nativa)
8. AUTH_DELETION             — admin.auth().deleteUser(uid) — sempre a última etapa
```

`COMPLETION` não é uma nona etapa: é a checagem derivada
(`isEligibleForCompletion`, `steps.ts:180-186`) que autoriza a transição
global `PROCESSING -> COMPLETED`. Ela não executa I/O — apenas confirma que
toda etapa exigida pela política está `SUCCEEDED` ou `SKIPPED_BY_POLICY`.

`nextRunnableStep` (`steps.ts:168-178`) é o único ponto que decide "qual
etapa roda agora": ele percorre a ordem canônica e retorna a primeira etapa
exigida que ainda não está terminal-aceitável. Isso É a garantia de
dependência — uma etapa posterior nunca roda enquanto uma anterior exigida
não estiver concluída, sem precisar de nenhuma tabela de dependências
separada.

### Por que essa ordem

* `ACCOUNT_ACCESS_LOCK` primeiro: revoga a capacidade de login antes de
  qualquer dado ser tocado, reduzindo a janela em que o próprio usuário (ou
  alguém com a sessão) poderia interferir com a exclusão em andamento. É
  **totalmente reversível** — um admin pode reabilitar o Auth user
  (`updateUser(uid, { disabled: false })`) se o workflow falhar cedo.
* `PROVIDER_REVOCATION` em seguida: revoga tokens Apple/Google enquanto o
  Auth user ainda existe (algumas APIs de revogação podem exigir a
  associação ainda válida). É **irreversível como ação** (um token revogado
  não volta), mas **não destrói dado do usuário** — o pior caso é o usuário
  precisar vincular o provider novamente se o processo fosse abortado (o que
  a política atual não permite de qualquer forma).
* `VAULT_KEY_DESTRUCTION`: ver seção 5 — é o ponto de não retorno.
* `FIRESTORE_CLEANUP` antes de `STORAGE_CLEANUP`: remove primeiro os
  ponteiros/metadados (que referenciam paths do Storage), depois os objetos
  binários — evita um metadado órfão apontando para nada, prioriza o
  contrário (objeto órfão sem metadado), que já tem uma rotina de
  reconciliação equivalente no domínio do Photo Vault
  (`functions/src/photoVault/cleanupOrphans.ts`) que pode servir de modelo
  para uma futura consolidação, se necessário.
* `RETAINED_DATA_PROCESSING`/`REVENUECAT_PROCESSING`: rodam depois dos dados
  "de produto" já estarem limpos, porque sua política pode ser `RETAIN`/
  `SKIP` (nenhuma ação) e não têm motivo para bloquear ou ser bloqueadas por
  nada anterior.
* `AUTH_DELETION` por último: preserva, pelo maior tempo possível, um
  identificador estável (o próprio Auth user, ainda que desabilitado) que um
  processo de reconciliação administrativa poderia usar para investigar uma
  falha em qualquer etapa anterior. Nada na arquitetura do Admin SDK exige
  que o Auth user exista para que Firestore/Storage sejam apagados — Admin
  SDK ignora Firestore/Storage Rules e opera por uid como uma string,
  independentemente do registro em Auth. A ordem é uma escolha de
  auditabilidade/reconciliação, não uma exigência técnica do SDK.

## 5. Ponto de não retorno

**`VAULT_KEY_DESTRUCTION`** (`POINT_OF_NO_RETURN_STEP`, `steps.ts:230-249`).

Destruir a chave do Photo Vault não apaga nenhum objeto do Firestore/Storage
por si só — mas torna todo ciphertext remanescente (fotos de evolução,
thumbnails, o próprio metadado de criptografia) permanentemente
indecifrável. A partir do momento em que essa etapa está `SUCCEEDED`
(`isPastPointOfNoReturn`, `steps.ts:251-256`):

* os dados do usuário são irrecuperáveis, independentemente de qualquer ação
  posterior — inclusive um `FAILED_TERMINAL` a partir daqui deve ser
  reconciliado **continuando/repetindo a mesma exclusão**, nunca tentando
  "desfazê-la";
* isso é consistente com a política já definida na Fase 0 ("não existe
  recuperação após solicitação confirmada") — mas captura uma distinção mais
  fina: a UI já pode dizer "sua exclusão foi aceita" assim que o registro é
  criado (`REQUESTED`), só que a garantia técnica de irreversibilidade de
  dado só é atingida quando `VAULT_KEY_DESTRUCTION` termina.

`ACCOUNT_ACCESS_LOCK` e `PROVIDER_REVOCATION` — embora também difíceis ou
impossíveis de desfazer como AÇÕES individuais — não destroem dado do
usuário, e por isso não são o ponto de não retorno da arquitetura: uma falha
terminal antes de `VAULT_KEY_DESTRUCTION` ainda deixa, em teoria, os dados do
usuário intactos e reversíveis via reabilitação do Auth user, mesmo que
alguns tokens de provider já tenham sido revogados.

## 6. Modelo do deletion record

`AccountDeletionRecord`, `functions/src/accountDeletion/types.ts:170-193`.
Vive conceitualmente em uma coleção própria (`accountDeletions/{deletionId}`),
**nunca aninhado sob `users/{uid}`** — precisamente porque `users/{uid}` é um
dos recursos que o próprio workflow apaga (`FIRESTORE_CLEANUP`). Se o
progresso da exclusão vivesse dentro de `users/{uid}`, apagar o documento
destruiria o único registro de "onde a exclusão parou", tornando reconciliação
impossível (o problema descrito explicitamente na Fase 1 §6).

| Campo | Tipo | Mutabilidade | Finalidade |
|---|---|---|---|
| `deletionId` | `string` | Imutável | Identidade própria da tentativa, distinta do uid. |
| `uid` | `string` | **Imutável** (invariante testado) | UID do Firebase sendo processado. |
| `workflowVersion` | `number` | **Imutável** (invariante testado) | Versão da política congelada na criação. |
| `policy` | `AccountDeletionPolicy` | **Imutável** (invariante testado) | Snapshot completo da política — nunca re-resolvida durante retries. |
| `status` | `AccountDeletionStatus` | Mutável via `stateMachine.ts` | Estado global (seção 2). |
| `steps` | `Record<StepName, StepRecord>` | Mutável via `steps.ts` | Estado de cada uma das 8 etapas. |
| `revision` | `number` | Mutável, **estritamente crescente** | Token de concorrência otimista (seção 9). |
| `requestedAt` | `number` | Imutável | Quando a solicitação foi criada. |
| `updatedAt` | `number` | Mutável | Última escrita. |
| `completedAt` | `number \| null` | Mutável (só grava uma vez) | Quando `COMPLETED` foi atingido. |
| `lease` | `AccountDeletionLease \| null` | Mutável | Posse temporária de um worker (seção 9). |
| `requestMetadata` | `AccountDeletionRequestMetadata` | Imutável | Telemetria segura da criação — nunca influencia transições. |

Um documento auxiliar e minúsculo, `AccountDeletionLockDocument`
(`types.ts:195-205`, doc id = uid), garante no máximo uma operação ativa por
uid (seção 8) sem duplicar o registro inteiro.

### Ciclo de vida

1. **Durante o processamento**: o registro completo acima existe, com todo o
   detalhe operacional (tentativas, códigos de erro sanitizados, lease).
2. **Ao atingir `COMPLETED`**: `minimizeCompletedRecord`
   (`functions/src/accountDeletion/record.ts:96-118`) reduz o registro a um
   `AccountDeletionAuditRecord` — apenas uid, deletionId, versão,
   timestamps e o status final de cada etapa. Detalhe de tentativas, códigos
   de erro e lease são descartados: não têm valor de auditoria depois que o
   resultado final é conhecido.
3. **Depois de um prazo**: `recordRetentionExpiresAt` (opcional,
   `null` por padrão) e `isAuditRecordExpired` (`record.ts:120-122`) dão à
   arquitetura a capacidade de expirar/anonimizar esse registro mínimo — mas
   **nenhum prazo é inventado aqui**. Quanto tempo mesmo o registro mínimo
   pode ser mantido é uma decisão pendente da Fase 0
   (`DECISÃO JURÍDICA/NEGÓCIO NECESSÁRIA`); a arquitetura só garante que,
   quando essa decisão vier, ela se expressa como um número passado a
   `minimizeCompletedRecord`, sem precisar redesenhar nada.

## 7. Política versionada (support, couponRedemptions, RevenueCat)

`functions/src/accountDeletion/policy.ts:1-100`.

Cada `AccountDeletionPolicy` inclui um `retention` com três chaves —
`support`, `couponRedemptions`, `revenueCat` — cada uma valendo `DELETE` |
`ANONYMIZE` | `RETAIN` | `SKIP` (`RetentionAction`/`RevenueCatProcessingAction`,
`types.ts:117-131`). A política v1 (`POLICY_V1`, `policy.ts:22-42`) define:

```ts
support: 'RETAIN',            // Fase 0: DECISÃO JURÍDICA/NEGÓCIO NECESSÁRIA
couponRedemptions: 'RETAIN',  // Fase 0: DECISÃO JURÍDICA/NEGÓCIO NECESSÁRIA
revenueCat: 'SKIP',           // depende de capacidade externa + decisão de produto
```

**O cliente nunca escolhe isso.** O contrato de `requestAccountDeletion`
(`requestContract.ts`) não tem nenhum campo `policy`/`retentionPolicy` no
tipo, e `rejectClientSuppliedIdentityOrPolicy`
(`requestContract.ts:57-64`) rejeita em runtime qualquer payload que tente
incluir `uid`, `policy`, `retentionPolicy`, `workflowVersion`,
`requiredSteps` ou `deletionId` — defesa em profundidade contra o fato de que
o payload real de uma callable chega como JSON não tipado, mesmo que o tipo
declarado não tenha esses campos.

Quando a decisão jurídica/de negócio sobre `support`/`couponRedemptions`
chegar, ou quando a capacidade do RevenueCat for confirmada, a mudança é uma
**nova versão de política** (`WORKFLOW_POLICIES[2]`, etc.) — nunca uma edição
silenciosa da v1, que continuaria válida para qualquer deleção já em
andamento sob ela (seção 10 — versionamento).

`REVENUECAT_PROCESSING` é modelado deliberadamente como uma etapa distinta de
qualquer noção de "cancelar assinatura" — o comentário em
`types.ts:127-134` declara isso explicitamente, e nenhuma etapa desta
arquitetura jamais deve ser implementada como "cancelar a assinatura nativa
Apple/Google", que permanece uma ação separada, do usuário (ou, futuramente,
de uma integração dedicada), fora deste workflow.

## 8. Invariantes

Todas testadas (`functions/src/accountDeletion/__tests__/`):

1. **`COMPLETED` ⇒ toda etapa exigida terminal-aceitável.** Enforçado por
   `transitionGlobal` (`stateMachine.ts:65-79`), que lança
   `IncompleteRequiredStepsError` se `isEligibleForCompletion` for falso.
2. **Nenhuma regressão de etapa.** Um status terminal de etapa
   (`SUCCEEDED`/`SKIPPED_BY_POLICY`/`FAILED_TERMINAL`) não tem transição de
   saída (`STEP_STATUS_TRANSITIONS`, `steps.ts:27-37`).
3. **Nenhuma regressão global.** Idem para `COMPLETED`/`FAILED_TERMINAL`
   (`GLOBAL_TRANSITIONS`, `stateMachine.ts:19-25`); `assertNoGlobalRegression`
   (`record.ts:70-82`) trata até uma "transição" de um estado terminal para
   si mesmo como regressão — nenhum dos dois aceita nenhuma saída.
4. **`workflowVersion` imutável.** `assertImmutableFieldsUnchanged`
   (`record.ts:57-68`).
5. **`uid` imutável.** Idem.
6. **`policy` imutável depois de `REQUESTED`.** Idem — comparação estrutural
   completa, não campo a campo, então nem uma troca do objeto inteiro por
   outra versão escapa da checagem.
7. **`COMPLETED` é terminal.** Nenhuma transição de saída existe
   (`GLOBAL_TRANSITIONS.COMPLETED = new Set([])`).
8. **`FAILED_TERMINAL` é terminal.** Idem.
9. **`revision` estritamente crescente, nunca decrescente.** `compareAndSet`
   (`concurrency.ts:79-90`) só aceita a mutação se `expectedRevision` bater
   com o atual, e sempre incrementa por exatamente 1.
10. **Uma assinatura ativa nunca bloqueia `REQUESTED -> PROCESSING`.**
    `transitionGlobal` não recebe nenhum parâmetro de assinatura —
    `subscriptionActiveAtRequest` existe só em `requestMetadata`, nunca é lido
    por nenhuma função de transição.
11. **`AUTH_DELETION` e `VAULT_KEY_DESTRUCTION` sempre exigidos.**
    `validatePolicy` (`policy.ts:80-99`) rejeita qualquer política que os
    omita de `requiredSteps`.

## 9. Idempotência

Regra central: **executar uma etapa duas vezes deve produzir sucesso lógico,
nunca um erro fatal.** Isso é resolvido em uma única costura, não repetido
por etapa:

* Um (futuro) executor de etapa nunca decide o status persistido diretamente
  — ele reporta um `AccountDeletionStepOutcome`
  (`errors.ts:64-70`: `SUCCEEDED` | `SKIPPED_BY_POLICY` | `{ FAILED, code }`).
* `resolveStepStatusFromOutcome` (`errors.ts:80-92`) é o único lugar que
  transforma esse outcome em `AccountDeletionStepStatus`. Uma falha cujo
  código é classificado `LOGICAL_SUCCESS` (`ALREADY_ABSENT`,
  `ALREADY_REVOKED`, `ALREADY_DISABLED`, `ALREADY_DELETED`) resolve para
  `SUCCEEDED` — nunca para `FAILED_RETRYABLE`/`FAILED_TERMINAL`.
* Exemplo concreto testado (`workflow.test.ts`, "already missing"): a etapa
  `AUTH_DELETION` encontrando `user-not-found` (porque uma tentativa anterior
  já apagou o Auth user, ou um worker duplicado chegou depois) é reportada
  como `{ kind: 'FAILED', code: 'ALREADY_DELETED' }` e vira `SUCCEEDED`
  automaticamente — nenhuma lógica especial por etapa é necessária.

## 10. Concorrência

Dois problemas independentes, duas mecânicas independentes
(`functions/src/accountDeletion/concurrency.ts`):

### a) Duas solicitações lógicas quase simultâneas para o mesmo uid

`resolveDeletionRequest` (`concurrency.ts:29-45`), pensada para rodar dentro
de uma transação Firestore contra um documento de lock indexado por uid
(`AccountDeletionLockDocument`, doc id = uid):

* se não existe lock → cria um novo `deletionId`;
* se existe lock com status não-terminal, ou `COMPLETED` → reutiliza o
  `deletionId` já existente (idempotente — a segunda chamada nunca cria uma
  segunda máquina rodando em paralelo);
* se existe lock `FAILED_TERMINAL` → bloqueia a criação de uma nova operação
  (`BLOCKED_TERMINAL_FAILURE`) até reconciliação administrativa — uma falha
  terminal pode ter deixado dados parcialmente apagados, e uma nova tentativa
  ingênua correria contra efeitos colaterais já aplicados pela primeira.

### b) Dois workers processando o MESMO `deletionId`

* **Concorrência otimista** via `revision` — `compareAndSet`
  (`concurrency.ts:79-90`): um worker só escreve se a revisão que ele leu
  ainda for a atual; caso contrário, `REVISION_MISMATCH` e o worker deve
  reler antes de tentar de novo. Testado explicitamente
  (`concurrency.test.ts`, "worker A lê revision 5 / worker B lê revision 5 /
  worker A grava revision 6 / worker B tenta gravar baseado em revision 5" →
  rejeitado).
* **Lease opcional** (`AccountDeletionLease`, posse curta e com expiração,
  `concurrency.ts:97-116`) como otimização em cima disso — permite a um
  worker manter exclusividade prática durante uma etapa com múltiplos
  `await`s sem precisar reabrir uma transação a cada um. A garantia final,
  porém, continua sendo o `compareAndSet` no momento da escrita — a lease
  nunca é, sozinha, a fonte de verdade de exclusividade.

## 11. Recent-auth e boundary de segurança (cliente vs. backend)

A fronteira é deliberadamente estreita:

* **`requestAccountDeletion` (a única chamada do cliente)** exige
  `request.auth.uid` (nunca `request.data.uid` — o contrato nem tem esse
  campo, `requestContract.ts:33-40`) e recent-auth via
  `request.auth.token.auth_time`, reaproveitando o padrão já existente em
  `functions/src/lib/auth.ts:47-72` (`requireRecentAuth`,
  `RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60`). Essa é a ÚNICA vez que o
  usuário precisa provar identidade recentemente.
* **Todo retry subsequente do worker** roda como o backend (Admin SDK),
  nunca "como o usuário". O worker não pode e não deve exigir nova
  interação do usuário — a exclusão precisa terminar mesmo com o app
  fechado e, mais tarde no workflow, com o próprio Auth user desabilitado
  (etapa 1) ou já excluído (etapa 8).
* Nenhuma etapa do worker lê `request.auth` — todas operam sobre o `uid`
  armazenado, imutável, no `AccountDeletionRecord`.

## 12. Retry e classificação de erros

`functions/src/accountDeletion/errors.ts` (taxonomia) +
`functions/src/accountDeletion/retry.ts` (cálculo de backoff).

| Classe | Exemplos (`KnownErrorCode`) | Efeito |
|---|---|---|
| `RETRYABLE` | `TIMEOUT`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `INTERNAL_TRANSIENT` | Etapa vai para `FAILED_RETRYABLE`; `computeRetryDecision` agenda `nextAttemptAt` com backoff exponencial (`retry.ts:23-41`), até `retry.maxAttempts`. |
| `TERMINAL` | `INVALID_CONTRACT`, `IMPOSSIBLE_STATE`, `WORKFLOW_CORRUPTION`, `UNKNOWN_WORKFLOW_VERSION`, `MISSING_REQUIRED_CONFIGURATION`, `RETRY_BUDGET_EXHAUSTED` | Etapa vai direto para `FAILED_TERMINAL` — nenhum retry é agendado. |
| `LOGICAL_SUCCESS` | `ALREADY_ABSENT`, `ALREADY_REVOKED`, `ALREADY_DISABLED`, `ALREADY_DELETED` | Etapa vai para `SUCCEEDED` (seção 9). |

Estado persistido por tentativa (`AccountDeletionStepRecord`,
`types.ts:96-111`): `attemptCount`, `lastAttemptAt`, `nextAttemptAt`,
`lastErrorCode` (código sanitizado, nunca mensagem/stack trace),
`completedAt`. Uma falha retryable cujo orçamento se esgota
(`decision.exhausted`, `retry.ts:33-35`) é automaticamente escalada para
`FAILED_TERMINAL` com `lastErrorCode: 'RETRY_BUDGET_EXHAUSTED'`
(`steps.ts:145-155`) — uma etapa nunca fica retryable para sempre sem
próxima tentativa agendada.

## 13. Observabilidade

Este documento **não implementa** logging ainda (nenhum SDK de logging é
chamado em `accountDeletion/`), mas define a allowlist que qualquer
implementação futura de eventos (`account_deletion_requested`,
`..._step_started`, `..._step_succeeded`, `..._step_failed`,
`..._retry_scheduled`, `..._completed`, `..._terminal_failure` ou nomes
equivalentes) deve respeitar:

**Nunca logar**: senha, Apple `authorizationCode`/token, Google token,
Firebase ID token, segredo do RevenueCat, chave do Photo Vault, conteúdo de
fotos, conteúdo de avaliações, conteúdo de suporte.

**Seguro para logar**: `deletionId`, `uid` (já é o identificador operacional
central, não um segredo), `workflowVersion`, nome da etapa
(`AccountDeletionStepName`), status (`AccountDeletionStatus`/
`AccountDeletionStepStatus`), `attemptCount`, timestamps,
`lastErrorCode` (é, por construção, um valor do vocabulário fechado
`KnownErrorCode` — nunca uma mensagem livre de provedor).

## 14. Firebase Auth como etapa final

Análise formal pedida na Fase 1 §23:

* **Por que desabilitar antes?** `ACCOUNT_ACCESS_LOCK` roda primeiro para
  revogar a capacidade de login o quanto antes, minimizando a janela em que
  a sessão do usuário poderia interagir com dados que estão prestes a ser
  removidos — sem, no entanto, destruir nada ainda (é reversível).
* **Quando revogar refresh tokens?** Na mesma etapa (`ACCOUNT_ACCESS_LOCK`),
  imediatamente após desabilitar o usuário — evita que um token de sessão já
  emitido continue autenticando chamadas depois que a conta foi marcada para
  exclusão.
* **O worker continua funcionando sem credenciais do usuário?** Sim — a
  partir de `REQUESTED`, todo trabalho roda com Admin SDK, autenticado como o
  backend, nunca "como o usuário". Nenhuma etapa depende de um ID token do
  usuário permanecer válido.
* **Quais operações dependem do Auth user ainda existir?** Nenhuma técnica —
  Admin SDK lê/escreve Firestore e Storage por uid, sem consultar o registro
  de Auth. A única razão para manter o Auth user (desabilitado) durante as
  etapas intermediárias é preservar um ponto de referência estável para
  reconciliação administrativa em caso de falha, não uma dependência real de
  SDK.
* **Qual o momento seguro para `deleteUser(uid)`?** Depois que
  `FIRESTORE_CLEANUP`, `STORAGE_CLEANUP`, `RETAINED_DATA_PROCESSING` e
  `REVENUECAT_PROCESSING` já estiverem em um estado terminal-aceitável —
  `AUTH_DELETION` é a última etapa exigida antes de `COMPLETION`.

## 15. Versionamento do workflow

`CURRENT_WORKFLOW_VERSION`/`WORKFLOW_POLICIES`/`resolveWorkflowPolicy`,
`functions/src/accountDeletion/policy.ts:16,44,66-70`.

Uma solicitação resolve `currentPolicy()` **uma única vez**, na criação do
registro, e essa política inteira (incluindo `requiredSteps` e `retry`) é
copiada para dentro do `AccountDeletionRecord`. Um deploy posterior que
introduza `WORKFLOW_POLICIES[2]` e mude `CURRENT_WORKFLOW_VERSION` para `2`
**não afeta** nenhum registro já criado sob a versão 1 — `resolveWorkflowPolicy(1)`
continua resolvendo exatamente a mesma política, e a invariante de
imutabilidade (seção 8, itens 4-6) impede qualquer mutação subsequente do
registro de trocar `workflowVersion`/`policy`. Um registro cujo
`workflowVersion` não existir mais em `WORKFLOW_POLICIES` (cenário
hipotético de uma versão removida) causa `UnknownWorkflowVersionError`
(`policy.ts:58-63`, classificado `TERMINAL`) — uma falha explícita, nunca uma
tentativa silenciosa de aplicar outra versão.

## 16. O que a Fase 1 explicitamente NÃO faz

* Não registra nenhuma Cloud Function (`functions/src/index.ts` inalterado).
* Não chama Admin SDK, Firestore, Storage, RevenueCat, Apple ou Google em
  nenhum lugar de `functions/src/accountDeletion/`.
* Não implementa a UI de "Excluir Conta" no app.
* Não implementa o worker que de fato executaria as oito etapas contra
  provedores reais.
* Não decide o tratamento final de `support`/`couponRedemptions`/RevenueCat
  — apenas garante que a arquitetura absorve essa decisão como uma nova
  versão de política, sem redesenho.
* Não altera `firestore.rules`/`storage.rules`/`docs/12`.

---

# Fase 2 — Reautenticação para exclusão de conta

## 17. Objetivo e escopo

A Fase 2 conecta os dois lados do boundary de segurança que a Fase 1 já
havia desenhado (seção 11 acima): **client prova identidade recente →
backend valida essa prova a partir do próprio token verificado, nunca do que
o client afirma.** Nada destrutivo foi implementado — nenhum Auth user foi
desabilitado/excluído, nenhum Firestore/Storage foi tocado, nenhuma
revogação Apple/Google ocorreu, nenhuma Cloud Function foi registrada.

Dois arquivos novos materializam essa conexão:

* **Client** — `src/services/accountDeletionReauth.ts`: compõe
  `reauthenticateCurrentUser` (`src/services/reauthentication.ts`, inalterado)
  com o padrão de desafio MFA/TOTP já comprovado em
  `startTotpUnenrollment`/`finishTotpUnenrollment`
  (`src/services/mfaTotp.ts:269-347`), mais uma checagem final de
  consistência de UID e um refresh forçado do ID token.
* **Backend** — `functions/src/accountDeletion/authGuard.ts`: compõe
  `requireRecentAuth` (`functions/src/lib/auth.ts:47-72`, inalterado) com
  `rejectClientSuppliedIdentityOrPolicy` (Fase 1,
  `functions/src/accountDeletion/requestContract.ts:57-64`, inalterado).

Nenhuma das duas infraestruturas reaproveitadas teve sua assinatura ou
comportamento alterado — ambas continuam servindo seus call sites
pré-existentes (MFA/TOTP, alteração de senha, Photo Vault) exatamente como
antes.

## 18. Janela de recent-auth (auditoria, não redefinição)

* **Valor atual**: `RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60` (5 minutos),
  definido em `functions/src/lib/auth.ts:27`. Client-side, um valor mais
  conservador e independente, `CLIENT_RECENT_AUTH_MAX_AGE_MS = 4 * 60 * 1000`
  (4 minutos), agora em `src/lib/recentAuth.ts:14` (extraído do valor
  idêntico já usado por `src/services/photoVault.ts`).
* **Unidade**: segundos no backend, milissegundos no client (cada lado já
  usava sua própria unidade antes da Fase 2; preservado).
* **Como `auth_time` é calculado**: `requireRecentAuth` lê
  `request.auth.token.auth_time` — um claim do ID token já verificado pelo
  runtime de Callable Functions antes do handler rodar, nunca um valor que o
  corpo da requisição possa influenciar (`functions/src/lib/auth.ts:52`,
  testado em `functions/src/accountDeletion/__tests__/authGuard.test.ts`
  contra `{ authTime: ... }`/`{ recentAuth: true }` plantados no payload).
* **Comportamento no limite**: `ageSeconds > maxAgeSeconds` rejeita
  estritamente ACIMA da janela; exatamente na janela é aceito (já coberto
  pelos testes existentes de `functions/src/lib/auth.ts` e reconfirmado para
  o guard composto em `authGuard.test.ts`).
* **Relógio do cliente**: irrelevante — a única leitura de tempo que importa
  é `Date.now()` do **servidor** comparado ao `auth_time` do **token
  assinado pela Google/Firebase**, nunca a um timestamp que o dispositivo
  do usuário produza.
* **Dependência apenas de dados confiáveis**: sim — `auth_time` vem
  exclusivamente do ID token verificado; `CLOCK_SKEW_TOLERANCE_SECONDS = 60`
  (`functions/src/lib/auth.ts:33`) já absorve pequenas divergências de
  relógio entre o emissor do token e o runtime, sem depender de nada vindo
  do cliente.

**Decisão arquitetural**: a Fase 2 reutiliza a janela de 5 minutos tal como
está — a mesma já usada por `recoverVaultKey` (Photo Vault) — em vez de
inventar uma janela mais curta específica para exclusão de conta. Não foi
identificada nenhuma característica da ameaça descrita na Fase 2 §4 (sessão
de dias + acesso físico momentâneo) que a janela de 5 minutos deixe de
mitigar — o ataque descrito depende precisamente de `auth_time` estar
**velho**, e qualquer janela de minutos (5 ou menos) já rejeita isso. Uma
janela nova e mais curta só para exclusão adicionaria uma segunda constante
para manter sincronizada sem evidência de que a atual seja insuficiente.

## 19. Refresh do ID token após reautenticação

Investigado explicitamente (Fase 2 §7): o Firebase JS SDK já atualiza o
token STS em cache internamente como parte de um
`reauthenticateWithCredential`/reauth de senha bem-sucedido, e uma chamada
posterior a `getIdToken()`/`getIdTokenResult()` normalmente devolveria esse
token já atualizado sem round-trip de rede. **Esse comportamento não é
testado neste repositório contra o SDK real** (não há Firebase Auth
Emulator configurado — `firebase.json` só declara emuladores de Firestore e
Storage), então a Fase 2 não assume silenciosamente que a suposição está
correta.

**Decisão**: `finalizeReauthentication`
(`src/services/accountDeletionReauth.ts`, função interna) chama
explicitamente `user.getIdTokenResult(true)` — a API oficial de refresh
forçado do SDK — imediatamente após qualquer reautenticação bem-sucedida
(senha, Google, Apple, ou conclusão de desafio MFA). Isso custa uma chamada
de rede extra no momento da reautenticação (não em cada retry do worker,
que nunca depende de token do usuário — seção 11) em troca de nunca depender
de um detalhe de cache não auditado do SDK continuar válido entre versões.
Nenhuma flag local substitui essa prova — o valor retornado
(`authTimeSeconds`) é apenas telemetria segura já interpretada, nunca o
token em si.

## 20. Multi-provider: política determinística

`getReauthenticationProviders` (`src/lib/authProviders.ts:25-36`, já
existente, inalterado) já resolve isso corretamente: retorna os provedores
vinculados numa ordem FIXA e deliberada —
`['password'?, 'google'?, 'apple'?]` — nunca a ordem incidental de
`user.providerData`. O comentário original do arquivo já declara a
intenção ("password remains the familiar default... No caller may infer
identity from providerData array position").

A Fase 2 não precisou (nem deveria) redesenhar isso: `startAccountDeletion
Reauthentication` recebe o provider já escolhido como parâmetro
(`ReauthenticationRequest`, reaproveitado de `reauthentication.ts`) — a
escolha de QUAL provider oferecer/pré-selecionar na UI é responsabilidade
de uma tela (Fase 3+) que chame `getReauthenticationProviders(user)` e
apresente as opções nessa mesma ordem determinística. Nenhuma seleção por
posição de array ocorre em nenhum ponto novo desta fase.

## 21. Provider incompatível → fail closed

Já garantido pela infraestrutura reaproveitada: `assertProviderLinked`
(`src/services/reauthentication.ts:59-63`) lança
`ReauthenticationServiceError('reauthProviderUnsupported')` ANTES de
adquirir qualquer credencial, se o provider pedido não estiver entre
`getReauthenticationProviders(user)`. `accountDeletionReauth.ts` mapeia
isso para `PROVIDER_MISMATCH` sem nenhum caminho de fallback que marcasse
recent-auth como válido — testado em
`src/services/__tests__/accountDeletionReauth.test.ts`.

## 22. Mudança de UID durante o fluxo

Três camadas independentes, cada uma testada:

1. **Dentro de `reauthenticateCurrentUser`** (já existente): captura
   `originalUid` antes de qualquer `await` e revalida antes/depois da
   credencial ser aplicada (`reauthentication.ts:104-133`).
2. **Em `startAccountDeletionReauthentication`** (novo): `expectedUid` é
   capturado antes de QUALQUER `await`
   (`accountDeletionReauth.ts`), e o resultado de
   `reauthenticateCurrentUser` é revalidado contra ele mesmo depois da
   camada 1 já ter revalidado internamente — protege contra uma mudança de
   Auth state entre o retorno da camada 1 e a checagem desta função.
3. **Em `finalizeReauthentication`** (novo, chamada tanto pelo caminho
   direto quanto pelo pós-MFA): última checagem, imediatamente antes de
   devolver `{status:'completed'}` ao chamador — é o ponto mais próximo
   possível de uma futura chamada ao `requestAccountDeletion`.

Teste dedicado (`accountDeletionReauth.test.ts`, "IDENTITY_CHANGED when a
DIFFERENT account signs in during the reauthentication call") simula
exatamente o cenário descrito na Fase 2 §14: UID A inicia, o mock de
`reauthenticateCurrentUser` troca `auth.currentUser` para UID B como efeito
colateral antes de resolver — o resultado é `IDENTITY_CHANGED`, nenhuma
solicitação seria criada.

## 23. Logout durante o fluxo

Testado tanto no caminho direto (`startAccountDeletionReauthentication`)
quanto no pós-MFA (`finishAccountDeletionReauthentication`): se
`auth.currentUser` se torna `null` a qualquer momento antes da checagem
final, o resultado é `USER_SIGNED_OUT` — nunca uma exceção não tratada, nunca
uma solicitação. No caminho MFA, a checagem ocorre ANTES de tocar o
`resolver`, então um logout durante o prompt de código nunca chega a chamar
`resolveSignIn`.

## 24. Sessão recente vs. nova reautenticação obrigatória (decisão §16)

Duas opções foram avaliadas:

* **A — sempre exigir reautenticação explícita.**
* **B — se `requireRecentAuth` já aceitaria o token atual, permitir seguir
  sem novo prompt.**

**Decisão: B**, por consistência com o padrão já em produção para outra
operação sensível: `src/services/photoVault.ts`'s `hasRecentAuth`/
`ensureVaultKey` (`EnsureVaultKeyResult`, incluindo o caso
`'reauthentication-required'`) já segue exatamente essa política — só pede
reautenticação quando a janela de frescor já expirou. Nenhuma característica
adicional da exclusão de conta foi identificada que justifique um padrão
diferente (mais restritivo) só para ela. `needsAccountDeletionReauthentication()`
(`accountDeletionReauth.ts`) expõe essa decisão como uma função só —
`!hasRecentAuth(auth.currentUser)` — para a futura tela de exclusão (Fase 3+)
consultar antes de decidir se mostra o prompt.

## 25. Sessão antiga → reauth → sessão recente (teste crítico)

Ver seção 18. O teste central
(`functions/src/accountDeletion/__tests__/authGuard.test.ts`, describe
"critical test: old token rejected -> reauth -> fresh token accepted")
comprova, **unitariamente**, a metade backend da propriedade:

```text
TOKEN A (auth_time antigo) -> requireAccountDeletionAuthorization -> REJECT
TOKEN B (auth_time recente, mesmo uid) -> requireAccountDeletionAuthorization -> ACCEPT
```

A metade client (`reauthenticate -> getIdTokenResult(true) produz um token
cujo auth_time o backend aceitaria`) está coberta unitariamente até o ponto
em que o SDK realmente troca o token internamente — o teste
`accountDeletionReauth.test.ts` confirma que `getIdTokenResult(true)` É
chamado no momento certo, mas **não pode confirmar, sem um Firebase Auth
real, que o token resultante de fato carrega um `auth_time` que o backend
aceitaria**. Ver seção 26.

## 26. Nível de confiança e E2E pendente

```text
E2E REAL DE auth_time PENDENTE
```

Este repositório não tem Firebase Auth Emulator configurado (`firebase.json`
só declara `firestore`/`storage`). A Fase 2 não criou infraestrutura de
teste improvisada contra Auth de produção — toda a cobertura desta fase é
unitária, com mocks nos limites de SDK (`firebase/auth`,
`@react-native-google-signin/google-signin` via os mocks já existentes de
`reauthentication.test.ts`, `expo-apple-authentication`). O que fica
comprovado unitariamente:

* o backend rejeita `auth_time` velho e aceita `auth_time` recente para o
  MESMO uid (seção 25);
* o client chama `reauthenticateCurrentUser` corretamente por provider,
  força `getIdTokenResult(true)` após sucesso, e propaga um desafio MFA
  quando o Firebase o exige.

O que só um teste E2E contra o Auth Emulator (ou um projeto de
staging) pode comprovar, e fica pendente para uma fase posterior:

* que `reauthenticateWithCredential`/o reauth de senha real de fato produz
  um ID token cujo `auth_time` está dentro da janela no momento em que uma
  callable real o receberia;
* o comportamento real de `getMultiFactorResolver`/`resolveSignIn` contra o
  serviço TOTP do Firebase (hoje só mockado, seguindo o mesmo nível de
  confiança que o resto da suíte MFA/TOTP já aceita neste repositório).

## 27. O que a Fase 2 explicitamente NÃO faz

* Não registra nenhuma Cloud Function (`requireAccountDeletionAuthorization`
  não está conectado a nenhum `onCall`).
* Não desabilita, revoga ou exclui o Firebase Auth user.
* Não revoga tokens Apple/Google (`GoogleSignin.revokeAccess()` não é
  chamado; nenhum endpoint de revoke da Apple é chamado).
* Não captura/persiste `authorizationCode` da Apple — confirmado disponível
  em `credential.authorizationCode` (tipagem de `expo-apple-authentication`,
  `AppleAuthentication.types.d.ts:150`) mas deliberadamente descartado por
  `src/services/providers/apple.native.ts`, exatamente como já documentado
  na Fase 0. Capturá-lo pertence à fase de revogação de provider.
* Não cria nenhum `AccountDeletionRecord` real — nada nesta fase persiste
  estado em Firestore.
* Não implementa a tela final de "Excluir Conta".

---

# Fase 3 — Revogação Apple e Google

## 28. Escopo e resultado

Nenhum dado real foi apagado; nenhum Auth user foi desabilitado/excluído;
nenhum token Apple/Google real foi revogado (todos os testes usam mocks/
fakes — nenhuma chamada de rede real ocorreu); nenhuma configuração externa
(Apple Developer, Firebase, Google Cloud, Secret Manager) foi alterada.
`functions/src/index.ts` continua sem nenhuma Cloud Function nova
registrada.

## 29. Apple — arquitetura escolhida

**Fluxo**: reauth Apple fresca → `authorizationCode` fresco → backend troca
por `refresh_token`/`access_token` → backend persiste o `refresh_token`
temporariamente (criptografado via KMS) → backend chama `/auth/revoke` →
material temporário é apagado.

Este fluxo foi confirmado tecnicamente suficiente (não foi abandonado) —
ver `functions/src/accountDeletion/providerRevocation/appleClientSecret.ts`
e `appleIdentityClient.ts` para a documentação oficial citada inline.

**Por que persistir o `refresh_token` temporariamente**: `authorizationCode`
é de uso único e vida curta (~5 minutos, documentado pela Apple). Se o
`/auth/revoke` der timeout DEPOIS de uma troca bem-sucedida, um retry não
pode reenviar o mesmo `authorizationCode` (já consumido) — precisa reutilizar
o `refresh_token` já obtido. Esse material é criptografado via um KeyRing/
CryptoKey KMS **dedicado** (`ajfit-account-deletion`/
`apple-provider-revocation-kek`, `appleKmsClient.ts`), separado do KEK do
Photo Vault, e vive em `accountDeletions/{deletionId}/privateSecurity/
appleProviderRevocation` (nunca sob `users/{uid}`, pelo mesmo motivo do
próprio deletion record — Fase 1 §6). É apagado assim que o sub-passo Apple
atinge `SUCCEEDED` ou `FAILED_TERMINAL` (`appleProviderRevocation.ts`).

**`authorizationCode` no client**: `getAppleCredentialForAccountDeletion()`
(nova função em `src/services/providers/apple.native.ts`, aditiva —
`getAppleCredential()` original permanece byte-a-byte idêntica em
comportamento, confirmado pelos testes pré-existentes de
`apple.native.test.ts` continuarem passando sem alteração) é a ÚNICA função
do repositório que lê `credential.authorizationCode`. O valor nunca é
persistido em AsyncStorage/SecureStore/Firestore, nunca logado, e só existe
na variável de retorno de `prepareAppleProviderRevocationMaterial`
(`src/services/accountDeletionProviderRevocation.ts`) até ser enviado ao
backend.

**Client secret Apple**: gerado como JWT ES256 (`appleClientSecret.ts`),
assinado com `node:crypto` (`dsaEncoding: 'ieee-p1363'`, sem dependência
nova de biblioteca JWT), TTL curto (5 minutos, bem abaixo do teto de 6 meses
documentado pela Apple) gerado a cada tentativa em vez de cacheado. Testado
com um par de chaves EC descartável gerado pelo próprio teste
(`generateKeyPairSync`), nunca com a chave real da Apple — a assinatura é
verificada criptograficamente no teste (`crypto.verify`), não apenas
inspecionada por forma.

**Backend Apple**: `AppleIdentityClient` (`appleIdentityClient.ts`) isola
inteiramente o HTTP — a máquina de estados nunca vê status HTTP, apenas os
`KnownErrorCode` já existentes (`../errors.ts`, estendido com 3 códigos:
`PROVIDER_AUTHORIZATION_INVALID`, `IDENTITY_MISMATCH`,
`PROVIDER_RESPONSE_INVALID`) — nenhuma segunda taxonomia paralela.

**Idempotência confirmada**: o endpoint de revoke da Apple segue RFC 7009 —
HTTP 200 cobre tanto "revogado agora" quanto "já estava inválido"; o client
não tem nenhum branch especial para "já revogado" porque a própria Apple já
absorve esse caso. Testado explicitamente
(`appleIdentityClient.test.ts`, "is idempotent by construction").

## 30. Google — decisão arquitetural (Fase 3 §19)

**Opção escolhida: A — revoke client-side, confirmado ao backend.**

* Opção B (revoke backend-side via `oauth2.googleapis.com/revoke`) foi
  **rejeitada por enquanto**: exigiria que o backend possuísse um token
  Google revogável, o que exigiria pedir "offline access"
  (`serverAuthCode`) durante o login — uma mudança real de escopo de
  consentimento visível ao usuário, não algo a introduzir silenciosamente
  dentro de uma feature de exclusão. Fica sinalizada como candidata para
  fase futura.
* Opção C (nenhuma revogação adicional) foi **rejeitada**:
  `GoogleSignin.revokeAccess()` genuinely revoga o grant OAuth
  (`COMPORTAMENTO ENCONTRADO`, documentação do pacote + issues do GitHub,
  citado em `googleProviderRevocation.ts`), distinto de `signOut()` — pular
  isso deixaria a autorização do AJ Fit visível em "Apps conectados" do
  Google indefinidamente após a exclusão.

**Risco do client-side explicitamente endereçado (Fase 3 §20)**:
`revokeAccess()` só roda DEPOIS que a solicitação de exclusão já existe
duravelmente no backend — nunca antes/como pré-condição. Se o app fechar
antes da confirmação chegar ao backend, a exclusão em si prossegue
normalmente; apenas o sub-passo `google.com` fica pendente, o que bloqueia
`COMPLETED` (é um passo obrigatório na política v1) até o app reabrir e
tentar de novo, ou até um processo de reconciliação futuro (Fase 4+,
pendência explícita, não resolvida aqui).

**Achado real de robustez**: issues abertas do próprio pacote
`@react-native-google-signin/google-signin` (pesquisadas nesta fase)
relatam `revokeAccess()` travando indefinidamente no iOS. Por isso
`revokeGoogleAccess()` (`google.native.ts`) aplica um timeout explícito de
10s (`REVOKE_ACCESS_TIMEOUT_MS`) e nunca lança — sempre resolve para
`'revoked' | 'unavailable' | 'failed'`.

## 31. Integração com `PROVIDER_REVOCATION` (Fase 1 §25/§26)

`PROVIDER_REVOCATION` continua sendo UMA etapa na lista canônica
(`ACCOUNT_DELETION_STEP_NAMES`) — Apple e Google são modelados como
sub-passos independentes dentro dela
(`providerRevocation/types.ts`'s `ProviderRevocationState`), reutilizando a
EXATA mesma máquina de estados de `steps.ts` (que foi generalizada nesta
fase — `step` passou de `AccountDeletionStepName` para `string`, mudança
compatível, sem regressão em nenhum teste da Fase 1) em vez de duplicá-la.

* `deriveProviderRevocationOutcome(state)` decide o status agregado da
  etapa externa: `SUCCEEDED` só quando AMBOS os sub-passos estão
  terminal-aceitáveis; `FAILED_TERMINAL` se QUALQUER sub-passo falhar
  terminalmente (a máquina nunca avança para `VAULT_KEY_DESTRUCTION` com
  uma revogação obrigatória pendurada); `NOT_DONE` caso contrário.
* `nextRunnableProviderSubStep(state)` garante retry independente: Apple
  `SUCCEEDED` + Google `FAILED_RETRYABLE` preserva o progresso do Apple e
  só tenta Google de novo (testado explicitamente, nos dois sentidos).
* Um provider não vinculado nunca chega a `PENDING` —
  `initialProviderRevocationSubState` já o inicializa `SKIPPED_BY_POLICY`
  no momento da criação do registro, então nenhuma sheet nativa é aberta e
  nenhuma chamada de backend ocorre para ele.

**Decisão consciente**: `AccountDeletionRecord` (Fase 1) não foi alterado
para embutir `ProviderRevocationState` diretamente nesta fase — o tipo e a
lógica de agregação já existem, prontos, mas a integração literal no
registro fica para quando o worker real for construído (Fase 4+), evitando
mexer no núcleo já testado da Fase 1/2 sem necessidade imediata.

## 32. Segurança de identidade (Fase 3 §16/§37)

Em toda camada, a checagem de identidade vem PRIMEIRO, antes de qualquer
I/O:

* `appleProviderRevocation.ts`: `capturedForUid !== expectedUid` →
  `IDENTITY_MISMATCH` imediato, zero chamada de rede/KMS/repositório
  (testado).
* `accountDeletionProviderRevocation.ts` (client): `expectedUid` é
  comparado contra `auth.currentUser` ANTES de abrir a sheet Apple/tentar
  revoke Google, e DE NOVO depois que a operação nativa retorna — mesmo
  padrão de "sheet ficou aberta tempo suficiente para a sessão trocar" já
  estabelecido na Fase 2.
* Um payload que tenta enviar `{ provider: 'apple.com', authorizationCode:
  '...', uid: 'victim' }` nunca é suficiente: a identidade de quem está
  sendo processado vem do `AccountDeletionRecord.uid` (resolvido
  server-side na criação — Fase 1/2), nunca de um campo do payload —
  `capturedForUid` é comparado contra ESSE valor, não contra nada que o
  cliente possa declarar como "a conta certa".

## 33. Firebase unlink — decisão (Fase 3 §23)

**Decisão: não fazer unlink de providers individualmente durante o
workflow.** Como o Firebase Auth user inteiro é excluído ao final
(`AUTH_DELETION`, última etapa), um unlink intermediário não teria efeito
prático e só adicionaria uma operação a mais para dar errado/precisar de
reconciliação em caso de falha parcial. Revogar a autorização externa
(Apple/Google) e desvincular o provider do Firebase são operações
independentes; esta fase implementa apenas a primeira.

## 34. Erros e retries — tabela completa

| Provider | Cenário | Classificação | Comportamento |
|---|---|---|---|
| Apple | Timeout na troca do code ou no revoke | `TIMEOUT` — RETRYABLE | Retry mantém material já trocado (se houver) |
| Apple | HTTP 429/5xx | `UNAVAILABLE` — RETRYABLE | Idem |
| Apple | `invalid_grant` (code gasto/expirado) | `PROVIDER_AUTHORIZATION_INVALID` — TERMINAL | Exige nova captura client-side; material limpo |
| Apple | HTTP 401/403 ou `invalid_client` | `MISSING_REQUIRED_CONFIGURATION` — TERMINAL | Config errada; material limpo |
| Apple | Corpo 200 não parseável / campos ausentes | `PROVIDER_RESPONSE_INVALID` — TERMINAL | Material limpo |
| Apple | uid divergente | `IDENTITY_MISMATCH` — TERMINAL | Nenhuma chamada de rede feita |
| Apple | Já revogado (Apple responde 200) | *(não é um código — 200 já é sucesso, RFC 7009)* | `SUCCEEDED` diretamente |
| Apple | Sem code E sem material em cache | `PROVIDER_AUTHORIZATION_INVALID` — TERMINAL | Exige nova reauth do cliente |
| Google | `revokeAccess()` falha (qualquer motivo, incl. timeout de 10s) | `UNAVAILABLE` — RETRYABLE | App reaberto tenta de novo |
| Google | Não vinculado | *(não é erro)* | `SKIPPED_BY_POLICY` |
| Google | Módulo nativo ausente | `'unavailable'` → mapeado para `UNAVAILABLE` — RETRYABLE | Idem |

## 35. Observabilidade

Allowlist idêntica à da Fase 1/2, com os campos específicos desta fase:
`provider` (`'apple.com' | 'google.com'`), `outcome`, `attemptCount`,
`elapsedMs`, código de erro sanitizado. **Nunca logados** (confirmado por
não haver NENHUMA chamada de log em todo `providerRevocation/` nem em
`accountDeletionProviderRevocation.ts`): `authorizationCode`, `access_token`,
`refresh_token`, `identityToken`, Google idToken, Apple `client_secret`,
Apple private key, nonce, credential Firebase.

## 36. Secrets necessários (Fase 3 §26 — nomes apenas, nenhum valor)

Nenhum destes foi provisionado, feito upload, ou configurado nesta fase:

* `APPLE_TEAM_ID` — 10 caracteres, não sensível por si só, mas mantido junto.
* `APPLE_KEY_ID` — 10 caracteres, identifica a chave privada Apple.
* `APPLE_PRIVATE_KEY` — o arquivo `.p8` (PEM), **backend-only**, via
  `defineSecret` (padrão já usado por `REVENUECAT_API_SECRET_KEY`,
  `functions/src/billing/revenueCatApi.ts:6`).
* `APPLE_SERVICES_ID` (o `client_id` REST — Services ID, não o bundle id do
  app).
* Provisionamento do KeyRing/CryptoKey KMS `ajfit-account-deletion`/
  `apple-provider-revocation-kek` (`appleKmsClient.ts`) — infraestrutura
  GCP, não uma variável de ambiente.

## 37. Plano E2E controlado (não executado)

**Apple Sandbox**: conta de teste Apple ID → Sign in with Apple no app →
`prepareAppleProviderRevocationMaterial` → confirmar `authorizationCode`
chega ao backend (ambiente de teste) → confirmar troca produz
`refresh_token` → confirmar `/auth/revoke` retorna 200 → tentar
`reauthenticateWithCredential` de novo com a MESMA conta Apple e confirmar
que o Firebase ainda aceita login (revoke não afeta login futuro, só a
autorização OAuth anterior) ou documentar o comportamento real observado se
divergir.

**Google test account**: conta de teste Google → login → `revokeAccess()`
via `revokeGoogleProviderAccess` → verificar em
myaccount.google.com/permissions que o AJ Fit não aparece mais → novo login
→ confirmar que um novo consentimento é solicitado (evidência de que o
grant anterior foi mesmo revogado).

Nenhum dos dois foi executado nesta fase. Não usar conta pessoal/produção
sem autorização explícita.

## 38. O que a Fase 3 explicitamente NÃO faz

* Não registra nenhuma Cloud Function nova.
* Não chama nenhum endpoint Apple/Google real (todos os testes usam
  mocks/fakes).
* Não provisiona KMS, Secret Manager, ou qualquer configuração Apple
  Developer/Google Cloud.
* Não implementa a Opção B do Google (backend revoke via offline access).
* Não embute `ProviderRevocationState` dentro de `AccountDeletionRecord`
  (Fase 1) — a lógica existe e está pronta, a integração literal é Fase 4+.
  **[Atualização Fase 4]**: essa integração foi de fato feita na Fase 4 —
  ver seção 39 abaixo. Este item permanece registrado como estava escrito
  na época, por transparência histórica.
* Não implementa reconciliação para o caso "app fechou antes da confirmação
  Google chegar ao backend" — sinalizado como pendência real, não
  resolvido.
* Não implementa a UI final de "Excluir Conta".

---

# Fase 4 — Backend `requestAccountDeletion`

## 39. Resumo e resultado

`requestAccountDeletion` (`functions/src/accountDeletion/requestAccountDeletion.ts`)
é agora uma Cloud Function `onCall` real, registrada em
`functions/src/index.ts`. Ela autentica, valida recent-auth, resolve o
snapshot de providers server-side, e persiste — pela primeira vez em
Firestore real (via transação) — um `AccountDeletionRecord` +
`AccountDeletionLockDocument`. **Nenhum passo destrutivo é executado.**
Nenhum deploy foi feito; todos os testes usam um fake de Firestore
transacional, nunca o Emulator real ou produção.

`ProviderRevocationState` (Fase 3) foi integrado literalmente ao
`AccountDeletionRecord` nesta fase — `types.ts`/`record.ts` foram
estendidos (`createAccountDeletionRecord` ganhou um parâmetro
`linkedProviders` opcional, com default `[]` para não quebrar nenhum teste
das Fases 1-3).

## 40. Contrato da callable

**Input**: `{}` ou `undefined` — literalmente nada mais. Qualquer campo
extra (`uid`, `policy`, `workflowVersion`, `deletionId`, `revision`,
`status`, `steps`, `recentAuth`, `reauthenticated`, `authTime`, ou qualquer
nome não previsto) é rejeitado com `invalid-argument`, via o novo
`validateRequestAccountDeletionPayload` (`requestContract.ts`) — mais
estrito que a denylist da Fase 1 (`rejectClientSuppliedIdentityOrPolicy`):
em vez de proibir uma lista de nomes conhecidos, proíbe QUALQUER chave,
porque o contrato real não tem nenhuma.

**Output**:
```ts
{
  deletionId: string;
  status: 'REQUESTED' | 'PROCESSING' | 'RETRY_SCHEDULED' | 'COMPLETED' | 'FAILED_TERMINAL';
  accepted: true;
  deduplicated: boolean;
  requiresReconciliation: boolean; // true somente quando status é FAILED_TERMINAL
}
```
Nunca expõe: `policy` completa, `revision`, `steps`, `providerRevocation`,
`lease`, mensagens internas do Admin SDK/Firestore.

## 41. Guards — ordem e comportamento

1. `validateRequestAccountDeletionPayload(request.data)` — síncrono, sem
   I/O, resultado idêntico independente do estado de autenticação. Rodar
   primeiro não vaza nada a um chamador não autenticado que autenticar
   primeiro já não revelaria via outro código de erro.
2. `requireRecentAuth(request)` (Fase 2, **inalterado**) — lança
   `unauthenticated` se `request.auth` ausente, `failed-precondition` se
   `request.auth.token.auth_time` ausente/velho.
3. Só depois de (2): `admin.auth().getUser(uid)` para o snapshot de
   providers, então a transação do repository.

**Nenhuma leitura/escrita de `accountDeletions`/`accountDeletionLocks`
ocorre antes de (2) suceder** — confirmado por teste explícito (payload
malicioso E token velho juntos → zero chamada ao repository).

## 42. Identidade

`uid` vem exclusivamente do retorno de `requireRecentAuth(request)`
(que por sua vez só lê `request.auth.uid`, nunca `request.data`). Testado
com `uid`/`userId`/`targetUid` no payload — todos rejeitados por
`invalid-argument` antes mesmo de a identidade importar.

## 43. Repository

`FirestoreAccountDeletionRepository` (`repository.ts`), interface
`AccountDeletionRepository` com um único método,
`createOrReuse(params): Promise<CreateOrReuseAccountDeletionResult>`.
Toda a decisão "criar vs. reutilizar vs. bloquear" acontece dentro de UMA
`db.runTransaction`, reaproveitando `resolveDeletionRequest`/
`lockDocumentAfterCreate` (Fase 1's `concurrency.ts`, **inalterados**) e
`createAccountDeletionRecord` (Fase 1's `record.ts`, estendido). O handler
(`requestAccountDeletion.ts`) nunca chama `admin.firestore()` diretamente.

## 44. Paths Firestore criados

* `accountDeletions/{deletionId}` — `AccountDeletionRecord` completo.
* `accountDeletionLocks/{uid}` — `AccountDeletionLockDocument` (`uid`,
  `activeDeletionId`, `status`, `revision`).

Ambos backend-only: nenhuma Firestore Rule concede qualquer acesso a essas
coleções (Admin SDK bypassa rules de qualquer forma); o cliente não tem
nenhum contrato de leitura nesta fase.

## 45. Atomicidade

Uma única transação: lê o lock → decide (`resolveDeletionRequest`) → se
`CREATED`, escreve lock + record no MESMO commit; se `REUSED_EXISTING`/
`BLOCKED_TERMINAL_FAILURE`, lê o record existente (sem escrita nenhuma).
Testado com um fake de Firestore que implementa versionamento otimista real
e retry de conflito (não um mapa em memória ingênuo) — 5 chamadas
simultâneas para o mesmo uid convergem em exatamente uma operação criada;
uids diferentes nunca interferem entre si.

## 46. `deletionId`

Gerado server-side via `randomUUID()` (Node `crypto`), fora da transação
(reaproveitado em caso de retry interno do Firestore por contenção — ainda
resolve a mesma tentativa lógica). Só é persistido se a transação
determinar que nenhuma operação existe para o uid.

## 47. `AccountDeletionRecord` — schema final da Fase 4

Idêntico ao da Fase 1, com um campo novo:

```ts
interface AccountDeletionRecord {
  deletionId: string;
  uid: string;
  workflowVersion: number;
  policy: AccountDeletionPolicy;       // congelada, imutável
  status: AccountDeletionStatus;
  steps: Record<StepName, StepRecord>; // todas PENDING (ou SKIPPED_BY_POLICY p/ política v1 — nenhuma nesta versão)
  providerRevocation: ProviderRevocationState; // NOVO NESTA FASE
  revision: number;                    // 0
  requestedAt: number;
  updatedAt: number;
  completedAt: null;
  lease: null;
  requestMetadata: { subscriptionActiveAtRequest: null; requestAuthTimeSeconds: number };
}
```

## 48. Provider snapshot

`admin.auth().getUser(uid)` — nunca `request.data`. Apenas
`providerData.map(p => p.providerId)` é usado, filtrado para
`['apple.com', 'google.com']`; nenhum email/displayName/photoURL é lido ou
persistido (testado explicitamente). `password` não gera nenhum
sub-estado de revogação — só afeta se `apple.com`/`google.com` aparecem no
resultado.

## 49. Provider revocation state

`providerRevocation.apple`/`.google`, cada um `{ linked: boolean, step:
AccountDeletionStepRecord }`, construído por `initialProviderRevocationState`
(Fase 3, **inalterado**): providers vinculados começam `PENDING`; não
vinculados começam `SKIPPED_BY_POLICY` imediatamente, sem nunca abrir uma
sheet nativa ou chamar um backend de provider. `linked` é imutável depois
da criação (Fase 4 §21) — o worker futuro nunca precisa reconsultar
`providerData`.

## 50. Google gap — como fica representado

O gap identificado na Fase 3 (`revoke` client-side confirmado a um
endpoint que ainda não existe) **não foi eliminado nesta fase** — não podia
ser, sem construir o worker/endpoint de confirmação, que é Fase 5+.
Modelagem explícita adotada: o sub-passo `google.com`, quando vinculado,
começa `PENDING` exatamente como qualquer outro passo — semanticamente,
"pendente" aqui já significa "aguardando ação + confirmação do cliente",
sem precisar de um estado novo (`PENDING_CLIENT_ACTION` foi considerado e
descartado por não agregar nada que `PENDING` já não expresse dentro da
máquina existente). O que falta, e fica pendência explícita: (a) o
endpoint de confirmação (`ReportGoogleProviderRevokedRequestData`, Fase 3,
tipo definido mas sem callable registrada), e (b) uma estratégia de
reconciliação para quando a confirmação nunca chega (app fechado antes de
enviar). Nenhum destes foi resolvido nesta fase — permanecem pendência
real para Fase 5+.

## 51. Policy/version

`currentPolicy()` (Fase 1, **inalterado**) é resolvida uma vez, dentro do
handler, e passada ao repository — que a congela dentro de
`createAccountDeletionRecord` exatamente como já acontecia nas Fases 1-3.
Nenhuma mudança na v1 (`support: RETAIN`, `couponRedemptions: RETAIN`,
`revenueCat: SKIP`) — nenhuma decisão jurídica nova foi tomada.

## 52. Estados existentes — comportamento

| Estado do registro existente | Resultado da nova chamada |
|---|---|
| `REQUESTED` | Reutiliza — `deduplicated: true`, mesmo `deletionId` |
| `PROCESSING` | Idem — nunca reinicia, nunca regride |
| `RETRY_SCHEDULED` | Idem |
| `COMPLETED` | Idem — sucesso lógico, nenhuma nova operação |
| `FAILED_TERMINAL` | Reutiliza o MESMO `deletionId`, mas `requiresReconciliation: true` — nenhuma segunda operação é criada automaticamente (Opção A da Fase 4 §16, escolhida deliberadamente sobre permitir uma nova tentativa automática) |

## 53. Conta inconsistente (`users/{uid}` ausente, Auth existe)

Esta callable **nunca lê `users/{uid}`** — não tem nenhuma dependência
dele, então esse cenário não afeta seu comportamento de forma alguma. A
única fonte de verdade que ela consulta é `accountDeletionLocks/{uid}`/
`accountDeletions/{deletionId}`. Se não existir nenhum lock, ela cria uma
operação nova normalmente — não tenta inferir "conta já excluída" a partir
da ausência de `users/{uid}`, exatamente como o enunciado da Fase 4 exigiu.

## 54. Account access lock — diferenciação explícita

Nesta fase, **nenhum lock de acesso real acontece** —
`providerRevocation`/`steps.ACCOUNT_ACCESS_LOCK` começam `PENDING`. O
"fechamento da conta" que esta fase entrega é inteiramente o registro
durável da SOLICITAÇÃO — `accountDeletions/{deletionId}` existindo com
status `REQUESTED` — não qualquer ação sobre o Firebase Auth user. A tensão
descrita na Fase 4 §29 (desabilitar Auth cedo demais quebraria a captura de
material Apple/confirmação Google, que ainda dependem de o usuário
conseguir se autenticar) foi resolvida adiando qualquer ação de Auth
inteiramente para o worker futuro.

## 55. Segurança — ataques testados

* uid/userId/targetUid no payload → rejeitado antes de qualquer leitura.
* policy/retentionPolicy/workflowVersion/deletionId/revision/status/steps
  no payload → rejeitado.
* `recentAuth`/`reauthenticated`/`authTime` forjados → nunca usados como
  prova; token real continua sendo a única fonte.
* Token velho + payload forjado simultaneamente → rejeitado (qualquer um
  dos dois gates já bastaria).
* `getUser` falhando para um uid autenticado → erro controlado, nenhuma
  operação criada.
* Falha da transação → erro controlado, nenhuma operação parcial.

## 56. Observabilidade

Eventos: `request created`/`request deduplicated` (via `logInfo`), erro de
`getUser`/transação (via `logFunctionError`), e um log dedicado quando
`blockedTerminalFailure` é verdadeiro. Metadata: `uid` (mascarado
automaticamente por `logger.ts`'s `IDENTIFIER_KEYS`), `workflowVersion`,
`status`, `deduplicated`, `appleLinked`/`googleLinked` (booleanos, nunca os
provider IDs brutos nem dados do usuário).

## 57. O que a Fase 4 explicitamente NÃO faz

* Não executa nenhum passo destrutivo — todos os 8 steps permanecem
  `PENDING` (ou `SKIPPED_BY_POLICY` quando a política determina, nenhum
  caso na v1) após a chamada.
* Não desabilita nem exclui o Firebase Auth user.
* Não apaga Firestore/Storage do usuário.
* Não altera RevenueCat, não revoga Apple/Google.
* Não implementa o worker/trigger que executaria os passos — nenhum
  Pub/Sub, Cloud Task ou trigger foi criado.
* Não resolve o gap de reconciliação do Google (Fase 4 §22) — apenas o
  modela explicitamente.
* Não faz deploy nem toca infraestrutura real.

---

# Fase 5 — Bloqueio imediato da conta

## 58. Três locks — distinção explícita (Fase 5 §4)

1. **Workflow lock** (`accountDeletionLocks/{uid}`, Fase 1/4): garante uma
   única exclusão ativa por uid. Não bloqueia uso do app por si só.
2. **Firebase Auth `disabled`** (Fase 5, `accountAccessLock.ts`): impede
   NOVO login. Não invalida um ID token já emitido antes da expiração
   natural (~1h).
3. **Application access lock** (Fase 5, `accountActive()` nas Firestore/
   Storage Rules + `requireActiveAccount()` nos callables): a camada que
   efetivamente barra uma SESSÃO ANTIGA com token ainda criptograficamente
   válido de continuar lendo/escrevendo dados privados. É esta última —
   não a existência do lock (1) nem `disabled` (2) sozinhos — que fecha o
   gate exigido pela Fase 5 §39.

O MESMO documento (1) alimenta a checagem (3): `accountActive(userId)`
verifica apenas a EXISTÊNCIA de `accountDeletionLocks/{userId}`, nunca seu
`status` — todo status (`REQUESTED`/`PROCESSING`/`RETRY_SCHEDULED`/
`COMPLETED`/`FAILED_TERMINAL`) significa igualmente "não ativo".

## 59. Commit point client-side

O ponto exato em que o backend pode fechar a conta sem depender mais do
client é: **`requestAccountDeletion` retornar com sucesso** (Fase 4) — a
partir daí, `accountDeletionLocks/{uid}` existe duravelmente, o que já é
suficiente para (3) acima entrar em vigor IMEDIATAMENTE (as Rules avaliam
`accountActive()` a cada request, não dependem de nenhuma etapa adicional
rodar). `ACCOUNT_ACCESS_LOCK` (Auth `disabled`+revoke, item 2) é uma
camada REFORÇANDO esse fechamento — importante para impedir NOVO login —
mas o fechamento de acesso a dados privados já está em vigor antes dela
rodar, contanto que as Rules estejam deployadas (ver §65).

## 60. Apple antes/depois do lock

O material Apple (`authorizationCode`) nasce de uma reautenticação
CLIENT-SIDE que acontece ANTES de `requestAccountDeletion` ser chamado, ou
como uma etapa preparatória separada cujo resultado (refresh token,
criptografado) já fica persistido backend-side assim que capturado — ver
Fase 3's `appleProviderRevocation.ts`. Uma vez que esse material está
persistido (criptografado, backend-only), o Apple revoke pode terminar
inteiramente sem o app: `AppleIdentityClient.revokeToken` (Fase 3) roda
Admin-SDK-side, consumindo o refresh token já guardado, nunca dependendo de
uma nova interação do usuário. **Garantia confirmada**: `ACCOUNT_ACCESS_LOCK`
pode começar (e terminar) mesmo que o app feche imediatamente após
`requestAccountDeletion` aceitar — o Apple revoke, quando de fato executado
por um worker futuro, não precisa do client vivo, DESDE QUE a captura do
material Apple já tenha acontecido antes desse ponto (não resolvido nesta
fase — é uma dependência de ORDEM que a Fase 6+ (worker real) precisa
respeitar: captura de material Apple deve ocorrer ANTES ou durante a
criação da solicitação, nunca depois).

## 61. Google antes/depois do lock — gap não eliminado, formalizado

**Não foi eliminado** — não podia ser sem Google conceder "offline access"
(mudança de escopo de consentimento, Fase 3 §19, deliberadamente fora de
escopo). Formalização adotada nesta fase: o sub-passo `google.com`
permanece `PENDING` até uma confirmação client-side chegar (endpoint ainda
não implementado). Isso é seguro porque **o Firestore/Storage access lock
(3) já protege os dados independentemente de esse sub-passo terminar** — a
conta fica com acesso privado bloqueado assim que
`accountDeletionLocks/{uid}` existe, `revokeAccess()` do Google pendente ou
não. O único efeito de o gap persistir é: o AJ Fit pode continuar
autorizado nas "Contas conectadas" do Google do usuário por mais tempo do
que o ideal, até uma reconciliação futura (Fase 6+, não resolvida) — um
problema de HIGIENE de autorização externa, não de VAZAMENTO de dados do
AJ Fit, já que o `ACCOUNT_ACCESS_LOCK`/Rules já isolam os dados
independentemente.

## 62. Account Access Lock — implementação

`functions/src/accountDeletion/accountAccessLock.ts`'s `lockAccountAccess(uid)`.
Duas chamadas Admin Auth, nesta ordem: `updateUser(uid, {disabled:true})`
depois `revokeRefreshTokens(uid)`. **Nenhum sub-estado é necessário** —
ambas chamadas são idempotentes por natureza (repô-las nunca "desfaz" nada,
diferente do `authorizationCode` de uso único da Apple), então um retry
simplesmente as refaz com segurança.

## 63. Firebase Auth disable

Idempotente: chamar duas vezes só reaplica `disabled:true`. `auth/user-not-found`
é tratado como sucesso lógico (`ALREADY_DELETED`, reaproveitado) — o
objetivo da etapa ("este uid não pode se autenticar") já está satisfeito se
o Auth user simplesmente não existe.

## 64. Refresh token revocation

`revokeRefreshTokens(uid)` também idempotente. Ordem confirmada
(disable → revoke): se revoke falhar/der timeout, a conta já está
`disabled` — nenhum NOVO login pode suceder nesse meio-tempo, mesmo que o
retry do revoke demore.

## 65. ID tokens já emitidos — como são bloqueados

Este é o gate central da fase (§39). **Nem `disabled`, nem
`revokeRefreshTokens`, sozinhos, invalidam um ID token já emitido antes de
sua expiração natural.** O que efetivamente bloqueia esse token é a
COMBINAÇÃO com a Fase 5's Application Access Lock:

* **Firestore/Storage Rules** (`accountActive(userId)`, `firestore.rules`/
  `storage.rules`): avaliadas a cada request do SDK cliente, independente
  de qual token foi usado para autenticar — comprovado com 39+35 testes
  reais contra o Firestore/Storage Emulator (não simulados), incluindo
  explicitamente sessões cujo único "problema" é a EXISTÊNCIA do lock, não
  a idade do token.
* **`requireActiveAccount()`** (`activeAccountGuard.ts`): mesma checagem
  para callables Cloud Functions — testado, e já integrado em
  `createVault`/`recoverVaultKey` (os dois callables normais mais
  sensíveis do backend hoje).

Combinados, qualquer chamada — direta ao Firestore/Storage SDK, ou via
callable — feita com um token ainda tecnicamente válido, depois que
`accountDeletionLocks/{uid}` existe, é rejeitada. **Isto foi comprovado
contra o Firestore/Storage Emulator real nesta fase** (não apenas
unitariamente) — ver §69.

## 66. Subestados/retry

Nenhum necessário para `ACCOUNT_ACCESS_LOCK` (§62). Falha parcial
(disable ok, revoke falha) deixa a conta MAIS protegida, não menos — um
retry completa com segurança. **Nunca reabilitar automaticamente**:
`lockAccountAccess` não tem, e nunca deve ganhar, nenhum caminho que
escreva `disabled:false`.

## 67. Backend guards

`requireActiveAccount(uid)` aplicado a: `createVault`, `recoverVaultKey`
(Photo Vault — os dois candidatos mais óbvios, dado que recuperar/criar uma
chave de vault para uma conta prestes a ser apagada é exatamente o tipo de
operação normal que não deve continuar). **Nunca aplicado a**:
`requestAccountDeletion` (precisa funcionar com o lock JÁ existindo — é o
próprio dedup) nem a nenhum futuro worker Admin-SDK (não é uma
`request.auth`-bound call). Candidatos não resolvidos nesta fase (custo/
risco de regressão vs. benefício marginal, dado que Rules já protegem o
dado subjacente): `validatePromoCode`, `authorizePromoPurchase`.

## 68. Firestore / Storage

Ver §65. `accountActive()` duplicada manualmente entre `firestore.rules` e
`storage.rules` — mesma disciplina já estabelecida por `hasServerPremium()`
(FASE 7, comentário original já documentava essa necessidade de
sincronização manual entre os dois engines de rules independentes).

## 69. Rules — arquivos alterados, testes, status de deploy

**Arquivos**: `firestore.rules` (função `accountActive` + gate em
`users/{userId}` read/create/update, `questionnaires`, `assessments`,
`progressPhotos` read/create/delete, blocos deny explícitos para
`accountDeletionLocks`/`accountDeletions`), `storage.rules` (função
`accountActive` + gate em avatar/progressPhotos/support attachments
read/create/update/delete).

**Testes — rodados contra o Firestore/Storage Emulator real** (Java 21 via
`PATH` local para esta sessão — `firebase-tools` exige Java ≥21; o `java`
padrão do ambiente é 17, mas um `openjdk@21` já instalado via Homebrew
estava disponível):
- `npm run test:rules:firestore` → **235/235 passando** (196 pré-existentes
  + 39 novos em `firestore-tests/accountDeletionLock.rules.test.ts`).
- `npm run test:rules:storage` → **74/74 passando** (35 pré-existentes +
  39 novos em `storage-tests/accountDeletionLock.rules.test.ts`).
- Zero regressão em qualquer teste pré-existente.

**Status de deploy**: **NENHUM DEPLOY FOI FEITO.** Reforço do achado da
Fase 0: as rules do repositório podem não ser as publicadas em produção —
confirmar isso, e então fazer um deploy controlado e autorizado da versão
aprovada, continua sendo bloqueador explícito antes de produção.

## 70. RevenueCat client

**Nenhum código novo foi necessário.** Auditoria confirmou que
`SubscriptionContext` (`src/state/SubscriptionContext.tsx`) já reage a
`useAuth().user` tornando-se `null` chamando `logoutRevenueCat()` +
`detachCustomerInfoListener()` automaticamente — esse mecanismo já existia,
já testado, e já é exatamente o que a Fase 5 pedia. `AuthContext.logout()`
→ `signOutUser()` → Firebase `signOut()` → `onAuthStateChanged` dispara →
`user` vira `null` → efeito do `SubscriptionContext` roda. `Purchases.logOut()`
pode transicionar o SDK para um App User ID anônimo — comportamento da
biblioteca, não alterado nem contornado nesta fase; o gate real é "nenhuma
identidade/Premium do UID excluído permanece", que a cadeia acima já
garante.

## 71. Limpeza local

Novo nesta fase, porque NÃO coberto pelo logout comum (corretamente — logout
normal não é "esta conta está sendo excluída"): cache de thumbnails
criptografados do Photo Vault (`removeCachedThumbnailsForUser(uid)`, já
existia como função exportada, agora chamada no fluxo de exclusão) e
rascunho de onboarding (`clearOnboardingDraft()`, idem). JÁ coberto pelo
logout comum, reaproveitado sem alteração: sessão segura + chave do Vault
(`signOutUser()`, `src/services/auth.ts`).

## 72. Photo Vault local

Tratado explicitamente: a CHAVE do vault já é apagada por `signOutUser()`
(preexistente); o CACHE de thumbnails (dado derivado, não a chave em si) é
o que esta fase adiciona à limpeza — `finalizeAccountDeletionClientShutdown`
chama ambos, em best-effort, antes do `logout()`.

## 73. Firebase logout

`finalizeAccountDeletionClientShutdown(uid, logout)` chama `logout` (a
função `logout` de `AuthContext`) por último, depois da limpeza local
best-effort. Uma falha em `logout` se propaga ao chamador — a limpeza local
já ocorreu independentemente (testado).

## 74. Navegação

**Nenhum código novo foi necessário.** `App.tsx` já gateia toda a árvore de
telas declarativamente em `useAuth()`'s `user`/`profile`/`questionnaire`/
`initializing` — quando `user` vira `null`, toda tela privada desmonta da
árvore React (não apenas fica escondida atrás de uma entrada de stack) e
`AuthScreen` renderiza. Não existe nenhuma rota privada residual para a
qual um "voltar" pudesse navegar.

## 75. Falhas client-side

Limpeza local usa `Promise.allSettled` — uma falha em uma etapa nunca
impede as demais (testado: falha em thumbnails não impede draft nem
logout; falha em draft não impede thumbnails nem logout). Falha em
`logout` propaga ao chamador (uma decisão de UI futura, não resolvida
nesta fase, sobre como a tela reage) — mas o backend (Rules + Access Lock)
já é autoridade independentemente do resultado desse client-side.

## 76. App fechado / rede cai após accept

Por construção: assim que `requestAccountDeletion` retorna sucesso (Fase
4), `accountDeletionLocks/{uid}` já existe duravelmente, e `accountActive()`
já nega acesso privado a partir desse instante — sem depender de mais
nenhuma chamada do client. Se o app fechar imediatamente após, ou a rede
cair antes do client rodar `finalizeAccountDeletionClientShutdown`, os
dados do usuário JÁ estão protegidos (Rules); o único efeito é a limpeza
LOCAL (dispositivo) e o Firebase `signOut()` ficarem pendentes até a
próxima abertura do app — nunca um problema de segurança de dados
remotos.

## 77. Observabilidade

Eventos: nenhum logging novo foi adicionado nesta fase além do já existente
em `requestAccountDeletion.ts` (Fase 4) — `lockAccountAccess`/
`requireActiveAccount` são funções puras/thin o suficiente para não
precisarem de logging próprio nesta fase (chamador — o futuro worker —
logará o outcome, seguindo o padrão já estabelecido em
`appleProviderRevocation.ts`).

## 78. O que a Fase 5 explicitamente NÃO faz

* Não executa `VAULT_KEY_DESTRUCTION`, `FIRESTORE_CLEANUP`,
  `STORAGE_CLEANUP`, `RETAINED_DATA_PROCESSING`, `REVENUECAT_PROCESSING`,
  `AUTH_DELETION`.
* Não exclui o Firebase Auth user — apenas desabilita.
* Não cancela nenhuma assinatura Apple/Google.
* Não altera RevenueCat backend.
* Não faz deploy das Rules alteradas — testadas apenas no Emulator.
* Não resolve o gap de reconciliação Google (formalizado, não eliminado).
* Não implementa um worker/trigger real que chame `lockAccountAccess`
  contra uma conta de produção — apenas o executor da etapa, pronto para
  ser chamado por um worker futuro (Fase 6+).

---

# Fase 6 — Engine idempotente de limpeza Firestore

## 79. Inventário confirmado

Nenhuma coleção nova encontrada além do já mapeado nas fases anteriores —
confirmado via grep exaustivo de todo `collection(`/`doc(` do repositório
(cliente + backend): `users`, `users/{uid}/questionnaires`,
`users/{uid}/assessments`, `users/{uid}/progressPhotos`,
`users/{uid}/privateSecurity`, `supportTickets` (+ `messages`),
`couponRedemptions`, `promoCodes`, `accountDeletions`,
`accountDeletionLocks`, `_ids` (helper efêmero, sem dado).

## 80. Matriz de política aplicada por esta engine

| Recurso | Path | Política Fase 0 | Nesta engine? |
|---|---|---|---|
| Perfil | `users/{uid}` | DELETE | Sim — último, não-recursivo |
| Questionários | `users/{uid}/questionnaires/*` | DELETE | Sim |
| Avaliações | `users/{uid}/assessments/*` | DELETE | Sim |
| Fotos de evolução (metadado) | `users/{uid}/progressPhotos/*` | DELETE | Sim (só metadado — objeto Storage é Fase 7) |
| Photo Vault | `users/{uid}/privateSecurity/photoVault` | DELETE, mas via `VAULT_KEY_DESTRUCTION` | **Não** — fora de escopo desta engine, deliberadamente |
| Suporte | `supportTickets`, `.../messages` | RETAIN (v1) | Não |
| Atribuição/cupom | `couponRedemptions/{uid}` | RETAIN (v1) | Não |
| Catálogo de promoções | `promoCodes/{code}` | Não é dado do usuário | Não |
| Control plane | `accountDeletions`, `accountDeletionLocks` | Nunca tocado por nenhuma engine | Não |

## 81. Arquitetura da engine

`functions/src/accountDeletion/firestoreCleanup/`:
- `deleteCollectionDocuments.ts` — primitive genérica, paginada
  (`orderBy('__name__')`/`limit`/`startAfter`), via `BulkWriter` — nunca
  `db.recursiveDelete()` (que cascatearia para dentro de subcollections não
  revisadas, incluindo potencialmente `privateSecurity` se aplicada
  ingenuamente ao documento pai).
- `resources.ts` — `deleteUserQuestionnaires`, `deleteUserAssessments`,
  `deleteProgressPhotoDocuments`, `deleteUserProfileDocument` (este último
  com `.delete()` simples e não-recursivo em `users/{uid}` — garante que
  `privateSecurity` sobrevive).
- `engine.ts` — `runFirestoreCleanup(uid)`: orquestra os quatro na ordem
  exigida (subcollections → documento pai), mapeia erros para a taxonomia
  compartilhada (`errors.ts`), nunca lança.

## 82. Photo Vault — separação de responsabilidade confirmada e testada

`VAULT_KEY_DESTRUCTION` continua sendo a única etapa responsável por
`privateSecurity/photoVault`. Esta engine nunca lê, escreve ou apaga esse
path — comprovado por teste unitário E pelo teste de integração contra o
Emulator real (§85): a chave sobrevive intacta após `runFirestoreCleanup`,
independentemente de já ter sido destruída ou não por uma etapa anterior.

## 83. Escala e paginação

`BulkWriter` + paginação manual (`orderBy('__name__')`/`startAfter`),
página padrão de 300 documentos — nunca carrega mais que uma página na
memória. Testado com 400+200 documentos (unitário) e 120+30 documentos
reais contra o Emulator.

## 84. Idempotência e retry

Cada função de recurso é independentemente idempotente — coleção vazia ou
documento ausente é sucesso lógico (`deletedCount: 0`/`alreadyAbsent: true`),
nunca erro. `runFirestoreCleanup` não mantém sub-estado: um retry após
falha parcial simplesmente re-executa do início, e cada recurso já
concluído responde `0` imediatamente. Testado explicitamente: falha no
1º recurso (nada aplicado, retry completa tudo) e falha em recurso
posterior (recursos anteriores preservados, retry completa o resto).

## 85. Prova via Firestore Emulator real

`functions/src/accountDeletion/firestoreCleanup/__tests__/engine.integration.test.ts`
(opt-in, `FIRESTORE_CLEANUP_INTEGRATION=1`, rodado via
`npm run test:integration:firestoreCleanup` — projeto descartável
`ajfit-rules-test`, nunca produção). Populou um usuário completo (perfil,
1 questionário, 120 avaliações, 30 fotos, Vault) + dados retidos
(`supportTickets`, `couponRedemptions`) + control plane
(`accountDeletionLocks`, `accountDeletions`) + um segundo uid completo como
controle. **Resultado, via query direta ao Emulator (não inferido por
contagem)**: todo recurso DELETE ausente; Vault presente; dados retidos
presentes; control plane presente; segundo uid 100% intacto (120
avaliações, Vault). Um segundo teste comprovou idempotência de retry contra
Firestore real. **2/2 passando.**

## 86. O que a Fase 6 explicitamente NÃO faz

* Não conecta a engine ao workflow real — nenhum worker/trigger a invoca.
* Não apaga `privateSecurity/photoVault` (responsabilidade de
  `VAULT_KEY_DESTRUCTION`).
* Não apaga `supportTickets`/`couponRedemptions` (policy v1: RETAIN).
* Não apaga `accountDeletions`/`accountDeletionLocks` (control plane).
* Não apaga nenhum objeto Storage (Fase 7).
* Não altera Firebase Auth, RevenueCat, Apple, Google.
* Não faz deploy.

# Fase 7 — Engine idempotente de limpeza Storage

## 87. Inventário confirmado

Nenhum path novo encontrado além do já mapeado — confirmado via grep
exaustivo de todo uso de `storage()`/`ref(`/`bucket.file(` do repositório
(cliente + backend): `users/{uid}/profile/*` (avatar), `users/{uid}/progressPhotos/*`
(ciphertext original + thumbnail do Photo Vault), `users/{uid}/support/{ticketId}/attachments/*`.
Nenhum outro prefixo sob `users/{uid}/` é referenciado em código algum.

## 88. Matriz de política aplicada por esta engine

| Recurso | Path | Política Fase 0 | Nesta engine? |
|---|---|---|---|
| Avatar | `users/{uid}/profile/*` | DELETE | Sim |
| Fotos de evolução (ciphertext) | `users/{uid}/progressPhotos/*` | DELETE | Sim — originais e thumbnails |
| Anexos de suporte | `users/{uid}/support/*` | RETAIN (v1) | **Não** — nunca referenciado por esta engine, nem por allowlist negativa: simplesmente nunca aparece em nenhum prefixo construído |
| Metadado Firestore de fotos | `users/{uid}/progressPhotos/*` (Firestore) | DELETE | Não — já é a Fase 6 |
| Control plane / dados de outro uid | — | Nunca tocado | Não |

## 89. Arquitetura da engine

`functions/src/accountDeletion/storageCleanup/`:
- `deletePrefixObjects.ts` — primitive genérica, paginada
  (`getFiles({prefix, maxResults, pageToken, autoPaginate:false})` +
  `file.delete({ignoreNotFound:true})` por objeto) — **interna, nunca
  exportada** pelo `index.ts` do módulo, exatamente para impedir que algum
  chamador externo monte um prefixo arbitrário e apague dado retido por
  acidente.
- `resources.ts` — `deleteUserAvatarObjects`, `deleteUserProgressPhotoObjects`;
  ambas constroem o prefixo a partir de um template fixo e hardcoded
  (`users/${uid}/profile/`, `users/${uid}/progressPhotos/`), nunca a partir
  de input externo; validam o `uid` (`assertSafeUid` — rejeita vazio, `/`,
  `..`) como defesa em profundidade mesmo sendo backend-only.
- `engine.ts` — `runStorageCleanup(uid)`: orquestra avatar → progressPhotos
  nessa ordem, mapeia erros do Admin SDK/`@google-cloud/storage` (código
  HTTP-like: 429/500/503/403/400) para a mesma taxonomia compartilhada
  (`errors.ts`) usada pelas Fases 5 e 6, nunca lança.

**Independência do Firestore, por construção**: nenhuma função deste módulo
lê um documento Firestore em momento algum — a descoberta de objetos é
puramente por listagem do namespace Storage (`getFiles({prefix})`). Um
objeto cujo documento de metadado no Firestore já foi apagado (Fase 6 já
rodou) ou nunca existiu (orphan) é encontrado e removido do mesmo jeito —
comprovado por teste unitário dedicado e pelo teste de integração (§93),
que nem sequer instancia um cliente Firestore.

## 90. Photo Vault — mesma separação de responsabilidade da Fase 6

`VAULT_KEY_DESTRUCTION` torna o ciphertext sob `progressPhotos/`
criptograficamente ilegível (ponto sem volta, Fase 1). Esta engine torna
esse mesmo ciphertext fisicamente ausente. Duas garantias complementares,
independentes uma da outra — testado explicitamente: a remoção do
ciphertext funciona identicamente, tenha a chave sido destruída antes ou
não.

## 91. Orphans — testados nas duas direções

* Objeto Storage sem documento Firestore correspondente: removido
  normalmente (não há dependência a checar).
* Documento Firestore sem objeto Storage correspondente: não é
  responsabilidade desta engine — `deletePrefixObjects` trata prefixo vazio
  como sucesso lógico (`deletedCount: 0`), nunca erro.

## 92. Escala, paginação e idempotência

Paginação real via `getFiles({prefix, maxResults, pageToken,
autoPaginate:false})`, página padrão de 500 objetos, nunca carrega mais que
uma página na memória. Testado com 850 objetos (unitário, múltiplas
páginas) e 600 objetos (unitário, engine completa). Cada função de recurso
é independentemente idempotente — prefixo vazio é sucesso lógico, nunca
erro; `runStorageCleanup` não mantém sub-estado, um retry após falha
parcial reconfirma prefixos já vazios e completa o que faltou. Testado:
falha na listagem do 1º recurso (nada apagado, retry completa tudo) e
falha no delete de um objeto individual (retry completa o resto).
Concorrência testada: duas execuções simultâneas para o mesmo uid convergem
para o mesmo estado final vazio.

## 93. Prova via Storage Emulator real

`functions/src/accountDeletion/storageCleanup/__tests__/engine.integration.test.ts`
(opt-in, `STORAGE_CLEANUP_INTEGRATION=1`, rodado via `npm run
test:integration:storageCleanup` — projeto descartável `ajfit-rules-test`,
Storage + Firestore emulators juntos, nunca produção). Populou um usuário
completo (avatar, 40 fotos originais + 40 thumbnails, 1 anexo de suporte) +
um segundo uid completo como controle. **Resultado, via listagem direta ao
Emulator (`getFiles({prefix})`, não inferido por contador)**: `profile/` e
`progressPhotos/` do uid alvo vazios; `support/` do uid alvo preservado;
segundo uid 100% intacto (avatar, 80 objetos de fotos, anexo de suporte). Um
segundo teste comprovou idempotência de retry contra Storage real; um
terceiro comprovou remoção de um objeto órfão (sem documento Firestore
algum) contra Storage real. **3/3 passando.**

Durante esta prova foi descoberto um comportamento real do Storage Emulator
não documentado pelo tipo declarado do SDK: quando não há mais páginas,
`getFiles()` retorna `null` (não `{}`) como segundo elemento da tupla —
`deletePrefixObjects.ts` fazia `'pageToken' in nextQuery` sem checar
null primeiro, o que quebrava exatamente nesse caso (silenciosamente
correto contra o fake em memória, que sempre retornava `{}`). Corrigido com
uma checagem de null antes do `in`, e coberto por um teste unitário
dedicado que reproduz esse mesmo formato de resposta via uma opção
`emulatorNullNextQuery` no fake bucket — para que essa regressão não volte
a depender exclusivamente do Emulator real para ser pega.

## 94. O que a Fase 7 explicitamente NÃO faz

* Não conecta a engine ao workflow real — nenhum worker/trigger a invoca.
* Não apaga `users/{uid}/support/*` (policy v1: RETAIN).
* Não depende do Firestore para descobrir o que existe no Storage.
* Não expõe uma API genérica `deletePrefix(path)` para chamadores externos
  ao módulo — `deletePrefixObjects` é interna, só `resources.ts` a chama, e
  sempre com um prefixo fixo construído internamente.
* Não apaga `accountDeletions`/`accountDeletionLocks` nem qualquer dado
  Firestore (isso é a Fase 6).
* Não altera Firebase Auth, RevenueCat, Apple, Google.
* Não faz deploy.

# Relatório consolidado — Fases 6 e 7

## 95. Contrato de integração futura (não implementado)

Um worker futuro (fora de escopo desta fase) invocaria
`runFirestoreCleanup(uid)` e `runStorageCleanup(uid)` como dois passos
independentes do state machine da Fase 1 (`FIRESTORE_CLEANUP` e
`STORAGE_CLEANUP`), cada um mapeando para seu próprio
`AccountDeletionStepOutcome`. Nenhuma ordem entre os dois é exigida pela
arquitetura atual — ambos são independentes um do outro e do
`VAULT_KEY_DESTRUCTION` — mas o worker real precisará decidir e persistir
essa ordem quando for construído; isso não foi decidido nem implementado
aqui.

## 96. Prova de independência Firestore/Storage

As duas engines não compartilham nenhuma dependência de runtime entre si:
`firestoreCleanup/` nunca importa `storageCleanup/` nem `@google-cloud/storage`;
`storageCleanup/` nunca importa `firestoreCleanup/` nem `firebase-admin/firestore`.
Os testes de integração de cada uma rodam isoladamente (scripts npm
separados) e os testes unitários da Fase 7 comprovam explicitamente (§91)
que a engine de Storage funciona idênticamente com ou sem o Firestore já
limpo.

## 97. O que permanece intocado (control plane, dados retidos, contas externas)

* `accountDeletions`, `accountDeletionLocks` (control plane) — nunca lidos
  nem escritos por nenhuma das duas engines.
* `supportTickets`/mensagens (Firestore) e `users/{uid}/support/*`
  (Storage) — retidos, policy v1.
* `couponRedemptions` — retido, policy v1.
* RevenueCat — não tocado (fora de escopo até uma fase futura de
  cancelamento de assinatura, se aplicável).
* Firebase Auth — não tocado por estas engines (a desativação/lock é
  responsabilidade da Fase 5, já concluída em fase anterior).
* Apple/Google — não tocados (revogação é responsabilidade da Fase 3, já
  concluída em fase anterior).
* Qualquer recurso não listado no inventário confirmado das Fases 6/7 fica
  fora de escopo — nada foi apagado por inferência ou suposição.

Todo hard-delete executado durante o desenvolvimento e teste destas duas
fases rodou exclusivamente contra o projeto descartável `ajfit-rules-test`
via Firestore/Storage Emulator local — nunca contra produção, nunca contra
uma conta Firebase real.

## 98. Veredito consolidado

Prova, em ambiente artificial controlado (Emulator, projeto descartável):
`Firestore deletável = vazio` (§85) · `Storage deletável = vazio` (§93) ·
`Retained data = preservado` (§85, §93) · `Outro uid = preservado` (§85,
§93) · `Control plane = preservado` (§85).

**FASES 6 E 7 — APROVADAS**

# Fase 8 — Retained Data Processing (Support + Coupon Redemptions)

## 99. Confirmação da frozen policy v1

Confirmado em `functions/src/accountDeletion/policy.ts` (`POLICY_V1.retention`):
`support = RETAIN`, `couponRedemptions = RETAIN`, `revenueCat = SKIP`. Nada
foi alterado — Fase 8 não reabre a decisão da Fase 0.

## 100. Auditoria Support

Schema confirmado em `firestore.rules` (`supportTicketValid`/
`supportMessageValid`) e `src/services/supportTickets.ts` — nenhum campo
inventado:
- `supportTickets/{ticketId}`: `id, userId, userName, userEmail, type,
  subject, status, priority, lastMessage, createdAt, updatedAt, appVersion,
  platform, osVersion, deviceModel, language, attachmentsCount`. **Sem**
  `photoURL` no ticket.
- `supportTickets/{ticketId}/messages/{messageId}`: `senderType, senderId,
  message, attachments (≤1, {url, path, type}), createdAt, readAt`.
- Anexos no Storage: `users/{uid}/support/{ticketId}/attachments/*` — o
  mesmo prefixo que a Fase 7 deliberadamente nunca toca.
- Nenhuma Cloud Function escreve em `supportTickets` — toda escrita é
  client-side (regras) ou de um painel admin fora deste repositório.

## 101. Auditoria CouponRedemptions

Schema confirmado em `functions/src/attribution/types.ts`
(`CouponRedemption`) e `constants.ts` — doc ID É o uid
(`couponRedemptions/{uid}`), ownership estrutural, não uma query: `uid,
couponCode, campaignId, influencerId, androidOffer, iosPromotion,
purchaseIntent?, appliedAt, createdAt, updatedAt, trialStartedAt,
convertedAt, lockedAt`.

`lockedAt`: escrito uma única vez (write-once latch), exclusivamente por
`applyAttributionRevenueCatEvent` (`attribution/attributionSync.ts`), assim
que a loja confirma trial/compra real. Lido/checado por
`decidePromoCodeAttributionOutcome` (recusa trocar código já locked),
`decideInitialPurchaseAttributionConfirmation` (recusa reconfirmar) e
`authorizePromoPurchaseTransactionally`. É o gate antifraude/comissão de
influenciador — uma vez setado, `couponCode`/`androidOffer`/`iosPromotion`/
`influencerId`/`campaignId` tornam-se evidência imutável do que foi
realmente pago. Este módulo (Fase 8) nunca inspeciona `lockedAt` —
RETAIN preserva o documento inteiro, locked ou não.

## 102. Inventário de PII

| Recurso | Campo | Contém UID/PII? | Tratamento policy v1 |
|---|---|---|---|
| Ticket | userId | sim | RETAIN |
| Ticket | userEmail | sim | RETAIN |
| Ticket | userName | sim | RETAIN |
| Message | message | potencial (texto livre) | RETAIN |
| Message | attachments[].path/url | potencial (imagem) | RETAIN |
| Coupon redemption | uid | sim | RETAIN |
| Coupon redemption | influencerId/campaignId | não (identifica campanha, não o usuário) | RETAIN |
| Coupon redemption | lockedAt | não | RETAIN (antifraude/comissão) |

Fase 8 §8 confirmado: mesmo que `uid`/`email`/`name` fossem removidos, o
corpo da mensagem e o anexo ainda poderiam conter PII — por isso nenhuma
"anonimização" é fingida aqui; RETAIN preserva o conteúdo integralmente,
sem qualquer transformação.

## 103. Executor — arquitetura

`functions/src/accountDeletion/retainedDataProcessing/`:
- `support.ts` — `processSupportRetention(uid, action, {db, storage})`.
  RETAIN: leitura de inventário apenas (`where('userId','==',uid)`), zero
  mutação. DELETE (suportado pelo contrato, não usado pela v1): apaga
  messages (BulkWriter) → ticket doc → prefixo de anexos no Storage, nessa
  ordem, idempotente ponta a ponta. ANONYMIZE: lança
  `UnsupportedRetentionActionError` — nenhum algoritmo é inventado.
- `couponRedemptions.ts` — `processCouponRedemptionsRetention(uid, action,
  {db})`. Mesmo padrão RETAIN/DELETE/ANONYMIZE, sobre o único documento
  `couponRedemptions/{uid}`.
- `engine.ts` — `runRetainedDataProcessing(uid, retentionPolicy, {db,
  storage})`: delega às duas funções acima (nunca um switch monolítico),
  agrega em `AccountDeletionStepOutcome`. `SKIPPED_BY_POLICY` quando nenhuma
  categoria executou ação destrutiva (caso da policy v1); `SUCCEEDED` quando
  ao menos uma categoria executou DELETE/ANONYMIZE com sucesso; `FAILED`
  `MISSING_REQUIRED_CONFIGURATION` quando uma categoria pede ANONYMIZE sem
  contrato.

`retentionPolicy` é sempre o valor passado pelo chamador — nunca
`currentPolicy()` internamente. O worker futuro (não implementado nesta
fase) é responsável por extrair esse valor de
`AccountDeletionRecord.policy.retention` (a snapshot congelada).

## 104. Distinção RETAIN vs SKIP (Fase 8 §3)

`RETAIN` = a categoria foi analisada e a policy manda preservar (o executor
faz uma leitura de inventário, por observabilidade). `SKIP` = nenhuma ação é
executada, sem sequer a leitura de inventário obrigatória — tratamento
idêntico ao RETAIN no resultado final (nenhuma mutação), mas
conceitualmente distinto. Policy v1 usa `RETAIN` para support/coupon e
nunca `SKIP` nessas duas categorias (`SKIP` é exclusivo de `revenueCat` —
Fase 9).

## 105. Policy versioning — prova

`__tests__/engine.test.ts`'s "policy versioning" case: lê a policy
realmente congelada em `resolveWorkflowPolicy(CURRENT_WORKFLOW_VERSION)`
(RETAIN/RETAIN), processa com ela (resultado: `SKIPPED_BY_POLICY`, nada
apagado), e então processa o MESMO uid com uma policy hipotética
DELETE/DELETE construída apenas no teste (nunca registrada em
`policy.ts` real) para provar que o executor É capaz de apagar quando
mandado — ou seja, o resultado RETAIN acima foi genuinamente dirigido pela
policy passada, não uma incapacidade hardcoded. Nenhuma chamada a
`currentPolicy()` existe em lugar algum deste módulo.

## 106. Idempotência

RETAIN é idempotente por construção (nenhuma mutação, nunca). DELETE:
recurso ausente = sucesso lógico (`ALREADY_ABSENT`), nunca erro; uma
segunda chamada após deleção completa retorna `ALREADY_ABSENT`
imediatamente. Testado explicitamente: retry após deleção completa, e
retry que precisa terminar um prefixo de Storage órfão deixado por uma
tentativa anterior interrompida (ticket já apagado, anexo ainda presente).

## 107. Outro UID

Testado explicitamente (unitário e Emulator real): processar `uid-A` nunca
toca tickets/mensagens/anexos/coupon redemption de `uid-B`.

## 108. Prova via Firestore + Storage Emulator real

`functions/src/accountDeletion/retainedDataProcessing/__tests__/engine.integration.test.ts`
(opt-in, `RETAINED_DATA_INTEGRATION=1`, `npm run
test:integration:retainedData` — projeto descartável `ajfit-rules-test`,
nunca produção). Populou um usuário completo (ticket + mensagem + anexo +
coupon redemption com `lockedAt` setado) + um segundo uid como controle.
**Resultado, via leitura direta ao Emulator**: policy v1 (RETAIN/RETAIN) →
`SKIPPED_BY_POLICY`; ticket, mensagem, anexo e coupon redemption do uid alvo
100% presentes; segundo uid 100% intacto. Um segundo teste comprovou
idempotência de retry. **2/2 passando.**

## 109. Referências restantes ao UID

Toda referência a `uid` que sobrevive após esta fase (ticket.userId,
message.senderId, couponRedemption.uid) é **permitida por RETAIN** — a
policy v1 explicitamente autoriza preservar essas categorias inteiras,
inclusive suas referências ao usuário. Nenhum recurso cuja policy exigisse
DELETE/ANONYMIZE permanece identificando o usuário (não há nenhum, já que
v1 não usa essas ações para support/coupon) — o gate correto (Fase 8 §18) é
"nenhum recurso com policy DELETE/ANONYMIZE mantém identificação proibida",
não "grep uid = zero em todo o banco".

## 110. Fases 6/7 continuam preservando dados retidos

Confirmado por leitura de código (sem alteração): `firestoreCleanup/
resources.ts` nunca referencia `supportTickets`/`couponRedemptions`;
`storageCleanup/resources.ts` nunca referencia `users/{uid}/support/*`. As
suítes de teste de ambas as fases (Fases 6/7) continuam passando 100% sem
modificação nesta fase.

## 111. O que a Fase 8 explicitamente NÃO faz

* Não conecta o executor ao workflow real.
* Não altera a policy v1 (continua RETAIN/RETAIN).
* Não implementa ANONYMIZE (lança erro terminal explícito).
* Não inspeciona/modifica `lockedAt`.
* Não apaga `accountDeletions`/`accountDeletionLocks` (control plane).
* Não toca RevenueCat (Fase 9).
* Não faz deploy.

# Fase 9 — RevenueCat Processing

## 112. Confirmação da frozen policy v1

`revenueCat = SKIP` em `policy.ts` — confirmado, não alterado.

## 113. Auditoria RevenueCat

- Client SDK: `src/services/revenueCatService.ts` — `Purchases.configure`,
  `Purchases.logIn(uid)` (o `appUserID` É o Firebase uid, por design),
  `Purchases.logOut()`.
- Backend: `functions/src/billing/revenuecat.ts` (`handleRevenueCatWebhook`,
  Cloud Function `revenueCatWebhook`), `revenueCatApi.ts`
  (`RevenueCatV2Client` — **somente leitura**: `getCustomerIdentityGraph`,
  `getCustomerSubscriptions`; nenhuma operação de delete/anonymize
  administrativa implementada ou confirmada), `revenueCatIdentity.ts`
  (`resolveRevenueCatFirebaseUid`), `subscriptionSync.ts`
  (`applySubscriptionEventAtomically`, `validFirebaseUserExists`).
- Eventos tratados: `INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION,
  BILLING_ISSUE, PRODUCT_CHANGE` (comerciais) + `TRANSFER` (identidade,
  caminho separado). `UNCANCELLATION` e tipos desconhecidos: reconhecidos e
  ignorados (200).

## 114. Mapeamento de identidade Firebase UID ↔ RevenueCat

`Purchases.logIn(uid)` usa o Firebase UID diretamente como `appUserID`
(`revenueCatService.ts`) — confirmado no código, não presumido pelo nome.
No backend, `resolveRevenueCatFirebaseUid` tenta primeiro o `app_user_id`
direto do payload e, se necessário, consulta a V2 API
(`getCustomerIdentityGraph`) para resolver aliases/original app user id.
Todo candidato passa por `validFirebaseUserExists`, que exige o uid existir
SIMULTANEAMENTE em `users/{uid}` (Firestore) E no Firebase Auth
(`auth.getUser`) — zero matches = `unresolved`, mais de um match =
`ambiguous`. Fail-closed nas duas direções.

## 115. Aliases

RevenueCat pode reter aliases/IDs anônimos associados a um customer. A
resolução de identidade (`revenueCatIdentity.ts`) trata aliases apenas como
EVIDÊNCIA a validar contra Firebase — nunca como autoridade por si só. Um
alias que aponta para um uid sem `users/{uid}`/Auth correspondente nunca
resolve. Nenhuma anonimização/exclusão RevenueCat foi implementada nesta
fase (policy v1 = SKIP), então a questão "DELETE/ANONYMIZE precisa tratar
aliases" permanece em aberto — documentado, não decidido.

## 116. API administrativa — o que existe de fato

Auditado nesta fase: `RevenueCatV2Client` (`revenueCatApi.ts`) implementa
**somente leitura** contra `https://api.revenuecat.com/v2/projects/{id}/...`
— busca de customer, aliases, subscriptions, entitlements. **Nenhum
endpoint de delete/anonymize de customer é chamado, referenciado ou
confirmado em lugar algum deste repositório.** Não foi inventado nenhum
endpoint para esta fase — DELETE/ANONYMIZE ficam sem contrato de execução
até uma decisão de produto/jurídica confirmar contra a documentação oficial
da RevenueCat qual operação administrativa (se alguma) é apropriada.

## 117. Executor — arquitetura

`functions/src/accountDeletion/revenueCatProcessing/engine.ts`:
`runRevenueCatProcessing(action)`. `SKIP`/`RETAIN`: **zero I/O** — nenhum
`RevenueCatV2Client` é construído, nenhum secret é lido, nenhuma chamada de
rede é feita, retorna `SKIPPED_BY_POLICY`. `DELETE`/`ANONYMIZE`: lança
`UnsupportedRevenueCatActionError` (Fase 9 §31 — nunca inventar endpoint),
o `engine` converte em `FAILED`/`MISSING_REQUIRED_CONFIGURATION` — terminal,
nunca mascarado como sucesso.

## 118. Regra absoluta: assinatura nunca cancelada

Confirmado estruturalmente: `revenueCatProcessing/engine.ts` não importa
nada de `providerRevocation/` (Apple/Google) nem qualquer superfície
StoreKit/Play Billing. Nenhuma chamada de cancelamento de assinatura existe
em código algum tocado por esta fase. `RevenueCatProcessingAction`
(`../types.ts`) documenta explicitamente que esta ação NUNCA significa
cancelar a assinatura nativa.

## 119. Webhook — fail-closed, provado (não apenas herdado)

Auditoria + teste dedicado (`functions/src/billing/__tests__/
accountDeletionLateWebhook.test.ts`, 9 casos novos, arquivo não existia
antes desta fase) provam, contra uma conta com `users/{uid}` E Firebase
Auth AMBOS ausentes (estado real pós-exclusão):
- Late `RENEWAL`/`INITIAL_PURCHASE`/`CANCELLATION`/`EXPIRATION`: identidade
  nunca resolve, `applySubscriptionEventAtomically` nunca chamado,
  `applyAttributionRevenueCatEvent` nunca chamado, resposta 200
  `{status:'ignored', reason:'identity_unresolved'}`.
- Late `TRANSFER` com uid excluído como destino OU como origem: mesmo
  resultado, nenhuma reconciliação tentada.
- Entrega duplicada do mesmo evento tardio: ambas seguras, sem acumulação.
- Assinatura da loja ainda ATIVA no RevenueCat pós-exclusão AJ Fit
  (customer RevenueCat não é tocado, policy v1 = SKIP): mesmo assim, a
  conta AJ Fit NUNCA é recriada — a existência do customer RevenueCat não
  confere autoridade alguma sobre a identidade AJ Fit.

Mecanismo estrutural (não um patch desta fase — já existia,
`subscriptionSync.ts`/`attributionSync.ts`): `applySubscriptionEventAtomically`
reconfirma `snapshot.exists` DENTRO da própria transação antes de
qualquer escrita ("Guard again inside the transaction so the merge-set
below can never recreate `users/{uid}`" — comentário original do código);
`applyAttributionRevenueCatEvent` idem para `couponRedemptions/{uid}`.
Nenhum caminho de código encontrado recria `users/{uid}`, Auth, ou
subscription/attribution para um uid excluído.

## 120. TRANSFER, aliases antigos, UID reutilizado

`TRANSFER` já tratado em separado (`handleTransferEvent`) com a mesma
`validFirebaseUserExists` fail-closed em ambos os lados (origem/destino).
Nenhuma lógica de "mesmo email → mesmo uid antigo" foi encontrada em
código algum — `resolveRevenueCatFirebaseUid` só aceita candidatos que já
existem em Firebase Auth/Firestore, nunca reconstrói identidade a partir de
email/provider isoladamente.

## 121. Tombstone — não introduzido

O webhook já é fail-closed apenas por `users/{uid}` (e Auth) estarem
ausentes — nenhum tombstone adicional foi necessário ou criado nesta fase
(Fase 9 §60: só introduzir se houver necessidade concreta; não há).

## 122. Testes — executor

`revenueCatProcessing/__tests__/engine.test.ts` (10 testes): SKIP →
`SKIPPED_BY_POLICY`; RETAIN → mesmo tratamento; DELETE/ANONYMIZE → `FAILED`
terminal, nunca chama `onCompleted`; prova estrutural de que SKIP nunca
constrói um client RevenueCat (nenhum secret mockado, teste falharia se
tocasse Secret Manager); policy versioning (mesma prova estrutural da Fase
8 — o valor processado é sempre o passado pelo chamador).

## 123. Testes — webhook

`billing/__tests__/accountDeletionLateWebhook.test.ts` (9 testes, novo) +
suíte pré-existente (`webhookHandler.test.ts`,
`missingUserTransaction.test.ts`, `validFirebaseUserExists.test.ts` — não
modificadas, continuam 100% passando) cobrindo identidade
ambígua/não-resolvida, TRANSFER, usuário removido no meio da transação,
etc.

## 124. Regressões

`functions`: typecheck limpo, 1031/1031 testes unitários passando (47 novos
desta sessão: 28 Fase 8 + 10 executor Fase 9 + 9 webhook Fase 9). Raiz:
typecheck limpo, 2727/2727. Rules (`test:rules`): 309/309. Três scripts de
integração via Emulator real (`test:integration:firestoreCleanup`,
`test:integration:storageCleanup`, `test:integration:retainedData`): 2/2,
3/3, 2/2.

## 125. Alterações externas

```text
RevenueCat real: NÃO ALTERADO
Apple subscription: NÃO ALTERADA
Google subscription: NÃO ALTERADA
Firebase produção: NÃO ALTERADO
Deploy: NÃO
```

## 126. O que a Fase 9 explicitamente NÃO faz

* Não conecta o executor ao workflow real.
* Não implementa DELETE/ANONYMIZE para o customer RevenueCat (sem
  endpoint confirmado).
* Não cancela nem tenta cancelar assinatura Apple/Google.
* Não modifica o webhook de produção (só adiciona testes).
* Não introduz tombstone.
* Não faz deploy.

# Relatório consolidado — Fases 8 e 9

## 127. Estado pós-Fases 6–9

```text
Personal Firestore data      → deletion engine pronta (Fase 6)
Personal Storage data        → deletion engine pronta (Fase 7)
Support                      → tratamento conforme frozen policy (RETAIN, Fase 8)
CouponRedemptions            → tratamento conforme frozen policy (RETAIN, Fase 8)
RevenueCat                   → tratamento conforme frozen policy (SKIP, Fase 9)
Late RevenueCat webhooks     → fail-closed (provado, Fase 9)
```

## 128. Recursos deliberadamente restantes (por design/policy)

* `supportTickets`/mensagens/anexos — RETAIN, policy v1.
* `couponRedemptions/{uid}` (incluindo `lockedAt` locked) — RETAIN, policy
  v1.
* Customer RevenueCat (subscriber history, `appUserID`=uid antigo, receipts)
  — SKIP, policy v1; nunca tocado por esta feature.
* `accountDeletions`/`accountDeletionLocks` (control plane) — nunca
  apagado por nenhuma engine/executor de nenhuma fase.

## 129. O que ainda NÃO foi feito

* Worker completo que orquestra `request → lock → vault → firestore →
  storage → retained data → revenuecat → auth delete` em sequência — não
  implementado em nenhuma fase até aqui, deliberadamente.
* Integração automática de qualquer engine/executor ao workflow real.
* `VAULT_KEY_DESTRUCTION` real (a step existe no contrato desde a Fase 1,
  a implementação real do executor não foi construída em nenhuma das Fases
  6-9).
* `AUTH_DELETION` final (exclusão real do Firebase Auth user).
* Deploy de qualquer artefato desta feature.
* UI final de "Excluir Conta".
* Qualquer teste E2E real (todos os testes desta feature, em todas as
  fases, rodaram contra fakes/mocks ou o Emulator local com projeto
  descartável `ajfit-rules-test`, nunca produção).

## 130. Veredito consolidado

Prova, em ambiente artificial controlado: RETAIN preserva Support/Coupon
integralmente (§108); SKIP não executa nenhuma mutação RevenueCat (§117,
prova estrutural); webhook tardio pós-exclusão é fail-closed em todos os
cenários testados (§119); nenhuma assinatura foi cancelada (§118); nenhum
customer RevenueCat real, conta Apple/Google, ou Firebase de produção foi
alterado (§125).

**FASES 8 E 9 — APROVADAS**

# Fase 10 — Hard Delete Firebase Auth

## 131. Auditoria Auth

`functions/src/lib/firebaseAdmin.ts` exporta `auth: Auth = getAuth()` —
mesmo singleton já usado por `accountAccessLock.ts` (Fase 5),
`subscriptionSync.ts` (billing) e `attributionSync.ts`. `ACCOUNT_ACCESS_LOCK`
(Fase 5) já usa `updateUser(uid, {disabled:true})` +
`revokeRefreshTokens(uid)` — nenhum dos dois apaga o Auth user, apenas o
desativa/invalida tokens. `AUTH_DELETION` é a primeira etapa desta feature a
chamar `admin.auth().deleteUser(uid)`.

## 132. Executor AUTH_DELETION

`functions/src/accountDeletion/authDeletion.ts`:
`executeAuthDeletion(uid, adminAuth)` — uma única chamada
`adminAuth.deleteUser(uid)`, `Pick<Auth, 'deleteUser'>` injetável (mesmo
padrão de `accountAccessLock.ts`'s `lockAccountAccess`), nunca lança —
sempre resolve `AccountDeletionStepOutcome`. Deliberadamente sem
`getUser(uid)` como pré-checagem (Fase 10 §18): `deleteUser` já reporta
`auth/user-not-found` quando não há nada a apagar, e essa é a própria
condição de sucesso lógico — uma checagem extra só adicionaria uma
segunda chamada de rede e uma janela TOCTOU.

## 133. Pré-condições

`canRunAuthDeletion(policy, steps)` — reutiliza `steps.ts`'s
`nextRunnableStep` (a MESMA lógica de ordenação que toda outra etapa já
obedece) em vez de reimplementar manualmente "todas as etapas anteriores
terminalmente aceitáveis". `AUTH_DELETION` (última na ordem canônica) só
pode ser o resultado de `nextRunnableStep` quando toda etapa obrigatória
anterior estiver `SUCCEEDED`/`SKIPPED_BY_POLICY`. Testado explicitamente:
`REVENUECAT_PROCESSING = SKIPPED_BY_POLICY` (policy v1 SKIP) NÃO bloqueia;
`RETAINED_DATA_PROCESSING = SKIPPED_BY_POLICY` (support/coupon RETAIN) NÃO
bloqueia; qualquer etapa anterior ainda `PENDING`, `FAILED_RETRYABLE` ou
`FAILED_TERMINAL` bloqueia.

## 134. Provider Revocation — situação atual

`PROVIDER_REVOCATION` já possui executores reais (Fase 3):
`appleProviderRevocation.ts`/`googleProviderRevocation.ts` +
`deriveProviderRevocationOutcome`/`nextRunnableProviderSubStep`
(`providerRevocation/types.ts`). O executor existe e é testado, mas
**nenhum worker real o invoca** — nenhuma mudança nesta fase. A state
machine (`nextRunnableStep`) já impede `AUTH_DELETION` de rodar enquanto
`PROVIDER_REVOCATION` não estiver terminal-aceitável; nenhuma regra foi
contornada.

## 135. Vault Key Destruction — situação atual

**Nenhum executor real existe** para `VAULT_KEY_DESTRUCTION` em nenhum
arquivo do repositório (confirmado por grep exaustivo — só há referências
em tipos/policy/docs/comentários de outras engines explicando por que elas
NÃO tocam esse path). Isso significa: **o workflow real ainda não pode
chegar legitimamente a `AUTH_DELETION`**, porque `nextRunnableStep` nunca
avançaria além de `VAULT_KEY_DESTRUCTION` sem um executor que a complete.
Os testes desta fase constroem um `steps` record artificial onde essa etapa
já está `SUCCEEDED`, exatamente como a Fase 10 instruiu — isso prova o
EXECUTOR de `AUTH_DELETION` e suas pré-condições, não que o workflow real
já pode alcançá-lo.

## 136. Idempotência

`auth/user-not-found` → `ALREADY_DELETED` (logical success, mesmo código
que `accountAccessLock.ts` já reusa pela mesma razão). Testado: delete →
delete novamente → segunda chamada relata `ALREADY_DELETED`; retry após
falha transitória completa com sucesso, redoing safely.

## 137. Retry/error mapping

| Código Admin Auth | Classificação | Código compartilhado |
|---|---|---|
| `auth/user-not-found` | LOGICAL_SUCCESS | `ALREADY_DELETED` |
| `auth/internal-error`, `auth/network-request-failed` | RETRYABLE | `UNAVAILABLE` |
| `auth/invalid-uid`, `auth/project-not-found` | TERMINAL | `MISSING_REQUIRED_CONFIGURATION` |
| qualquer outro | RETRYABLE (default seguro) | `INTERNAL_TRANSIENT` |

## 138. Access lock e deletion record

Nenhum código desta fase toca `accountDeletionLocks/{uid}` ou
`accountDeletions/{deletionId}` — `authDeletion.ts` só chama
`adminAuth.deleteUser(uid)`, nada de Firestore. Ambos os control-plane
documents permanecem intocados por design (Fase 10 §22/§23) — cleanup do
lock/record é decisão de uma fase futura (worker real), não desta.

## 139. Arquivos criados/alterados

`functions/src/accountDeletion/authDeletion.ts` (novo);
`functions/src/accountDeletion/__tests__/authDeletion.test.ts` (novo, 24
testes); `functions/src/accountDeletion/__tests__/authDeletion.integration.test.ts`
(novo, 4 testes, Auth Emulator real); `functions/src/accountDeletion/index.ts`
(barrel, +1 linha); `firebase.json` (emulador `auth` adicionado, porta
9099); `package.json` (script `test:integration:authDeletion`).

## 140. Testes unitários

24/24 passando: happy path, idempotência (duplicate call), retry após falha
transitória, classificação de erro completa (4 casos + default), isolamento
de uid, e 8 casos de pré-condição (`canRunAuthDeletion`): todas as etapas
`SUCCEEDED` → runnable; `REVENUECAT_PROCESSING`/`RETAINED_DATA_PROCESSING`
`SKIPPED_BY_POLICY` → não bloqueia; cada uma das 7 etapas anteriores
`PENDING` → bloqueia (parametrizado); `FAILED_RETRYABLE` → bloqueia;
`FAILED_TERMINAL` (Vault Key, orçamento de retry exaurido) → bloqueia.

## 141. Auth Emulator — resultado

`npm run test:integration:authDeletion` (opt-in,
`AUTH_DELETION_INTEGRATION=1`, `firebase emulators:exec --only auth
--project ajfit-rules-test`, Admin app nomeado próprio, nunca a produção).
**4/4 passando**: usuário artificial criado → `executeAuthDeletion` →
`getUser` real reporta `auth/user-not-found`; retry após deleção real →
`ALREADY_DELETED`; `updateUser` num uid já apagado também falha
`user-not-found` (prova de que não é um soft-disable, o registro
desapareceu de fato); segundo uid controle permanece 100% intacto.

## 142. `getUser(uid)` pós-delete

Comprovado no Emulator real (§141): `auth.getUser(user.uid)` rejeita com
`auth/user-not-found` após `executeAuthDeletion`.

## 143. Login antigo

Comprovado indiretamente: `auth.updateUser(uid, {disabled:false})` também
falha `user-not-found` pós-delete — não há registro algum para autenticar
contra. Um teste de "criar sessão real e tentar logar de novo" adicional
não foi construído (o Auth Emulator não expõe um endpoint de sign-in
completo a partir do Admin SDK sem simular o cliente OAuth) — coberto por
inferência estrutural, não por E2E de sign-in real.

## 144. Alterações externas

```text
produção = intocada
deploy = nenhum
Auth real = intocado (Admin app próprio, projeto descartável ajfit-rules-test)
```

## 145. Workflow readiness — executor pronto ≠ workflow pronto

**Executor `AUTH_DELETION`: PRONTO.** Testado unitariamente e contra o Auth
Emulator real. **Workflow real capaz de alcançá-lo: NÃO PRONTO** —
`VAULT_KEY_DESTRUCTION` não tem executor real (§135); nenhum worker
orquestra a sequência completa em nenhuma fase até aqui. `AUTH_DELETION`
nunca foi conectado a `requestAccountDeletion`/qualquer trigger real.

## 146. Pendências (Fase 10)

* `VAULT_KEY_DESTRUCTION` real — bloqueia o workflow de alcançar
  `AUTH_DELETION` legitimamente até ser construído.
* Worker/orquestrador completo — nenhuma fase até aqui o constrói.
* Conexão de `AUTH_DELETION` a qualquer trigger real.

## 147. Veredito

**FASE 10 — APROVADA** (o executor foi provado inclusive contra o Auth
Emulator real, §141) — com a ressalva explícita e não-negociável do §145:
o workflow real ainda não pode chegar legitimamente até esta etapa
enquanto `VAULT_KEY_DESTRUCTION` não tiver um executor.

# Fase 11 — Limpeza local e isolamento entre contas

## 148. Auditoria local completa

Auditoria exaustiva de `AsyncStorage`, `expo-secure-store`,
`expo-file-system` (API nova do Expo 56 — `File`/`Directory`/`Paths`, não
as constantes antigas), Contexts, estado a nível de módulo, filas de
pending sync, e persistência offline do Firestore. Achados completos na
seção de auditoria interna desta fase (matriz §149).

## 149. Matriz de escopo

| Dado | Storage | Namespaced por uid? | Escopo | Tratamento |
|---|---|---|---|---|
| `ajfit-units-preference` | AsyncStorage | Não (global) | USER_SCOPED | Seguro por reconciliação (`reconcileUnitsOnLoad`) + **agora também limpo proativamente no shutdown de exclusão** (§151.3, fecha a janela de corrida antes da próxima reconciliação) |
| `ajfit-pending-units-sync` | AsyncStorage | Não (registro tem `uid` interno) | USER_SCOPED | Seguro — descarta se `pending.uid !== uid` atual |
| `ajfit-language` | AsyncStorage | Não | USER_SCOPED | Seguro — `reconcileLanguageOnLoad`, mesmo padrão |
| `ajfit-pending-language-sync` | AsyncStorage | Não | USER_SCOPED | Seguro — mesmo uid-check |
| `ajfit-onboarding-draft` | AsyncStorage | Não | USER_SCOPED | Já limpo por `finalizeAccountDeletionClientShutdown` (Fase 5) |
| `ajfit-photo-vault-has-content-v1:{uid}` | AsyncStorage | **Sim** | USER_SCOPED | Já namespaced |
| `ajfit-subs` (substituições de exercício) | AsyncStorage | **Não — e a tela não tem uid algum** | USER_SCOPED | **Gap real, corrigido nesta fase** (§150) |
| Vault key | SecureStore | Sim (`deleteVaultKey(uid)`) | USER_SCOPED | Já limpo (Fase 5, `signOutUser()`) |
| Sessão Auth criptografada | SecureStore (chave) + AsyncStorage (envelope) | — | SESSION_SCOPED | Já limpo (Fase 5) |
| Encrypted thumbnails | expo-file-system | Sim (`{uid}/`) | USER_SCOPED (ciphertext) | Já limpo (`pruneCachedThumbnailsExcept`, `PhotoVaultContext.tsx`) |
| Plaintext decriptado / temp / share export | expo-file-system | Sim (sessão) | SESSION_SCOPED | Já limpo (`lockPhotoVault` → `discardDecryptedPhotos`; `cleanupPhotoVaultShareFiles`) |
| Gallery metadata (`photoVaultGallery.ts` `state.photos`) | módulo (memória) | Não (singleton único) | USER_SCOPED (metadados, sem bytes) | **Gap real, corrigido nesta fase** (§151) |
| `theme` | Nenhum — lido direto do profile Firestore | — | USER_SCOPED | Seguro por construção (sem cache separado) |
| `language`/preferences síncronas | ver acima | — | USER_SCOPED | Seguro |
| Avatar (`expo-image` cache) | disco (biblioteca) | Sim (URL contém uid) | CACHE_DERIVED | Seguro — chave de cache nunca colide entre contas |
| PromoCodeContext | memória (Context) | — | SESSION_SCOPED | Já reseta em `useEffect([uid])` com generation guard |
| Firestore client cache | memória (SDK) | Por path de documento | CACHE_DERIVED | Sem persistência durável (RN não suporta IndexedDB) — confirmado em `src/lib/firebase.ts` |

## 150. Rotina existente da Fase 5 — o que já fazia

`finalizeAccountDeletionClientShutdown(uid, logout)`
(`src/services/accountDeletionShutdown.ts`) já: limpava o cache de
thumbnails criptografados (`removeCachedThumbnailsForUser(uid)`) e o
rascunho de onboarding (`clearOnboardingDraft()`), via `Promise.allSettled`
best-effort, depois `await logout()`. RevenueCat logout/detach,
Vault key local, sessão segura e navegação já eram cobertos por outros
mecanismos já existentes e reutilizados (`SubscriptionContext`,
`signOutUser()`, `App.tsx`'s gating declarativo).

## 151. Mudanças realizadas

Três gaps reais encontrados e corrigidos — nenhuma rotina paralela criada,
todos evoluem a infraestrutura existente:

1. **`ajfit-subs` (substituições de exercício, `WorkoutScreen.tsx`)**: a
   chave `SUBS_KEY` foi extraída para um novo módulo dedicado,
   `src/services/workoutSubstitutionsStorage.ts`
   (`WORKOUT_SUBSTITUTIONS_STORAGE_KEY` + `clearWorkoutSubstitutionPreferences()`),
   seguindo o mesmo padrão de `unitsStorage.ts`/`languageStorage.ts`.
   `WorkoutScreen.tsx` agora importa a constante de lá em vez de
   defini-la localmente — mesmo valor, mesmas chamadas
   `AsyncStorage.getItem/setItem`, nenhuma mudança de comportamento da UI.
   `finalizeAccountDeletionClientShutdown` agora também chama
   `clearWorkoutSubstitutionPreferences()` no mesmo `Promise.allSettled`
   best-effort. **Limitação documentada**: `WorkoutScreen` não tem uid
   algum hoje (não está integrada a um modelo de dados por usuário no
   Firestore) — a chave continua global/não-namespaced, então esta
   correção fecha o vazamento no caminho de EXCLUSÃO de conta, mas uma
   troca de conta comum (sem exclusão) ainda carrega essa preferência
   entre contas até a tela ser conectada a um uid real.
2. **`photoVaultGallery.ts`'s `resetGallery()` nunca era chamado**: a
   função pública já existia (limpa `state.photos`, `viewerOwnerId`,
   `generation` e todos os Maps/Sets de controle de download) mas nenhum
   caminho de produção a invocava — grep exaustivo confirmou que só
   `resetGalleryForTesting()` (função distinta) era usado, e só em
   testes. Corrigido chamando `resetGallery()` dentro do `useEffect`
   de mudança de identidade em `PhotoVaultContext.tsx`, logo após
   `lockPhotoVault()` e antes de `pruneCachedThumbnailsExcept(uid)` —
   a mesma ordem de guarda por geração que já protegia o cache de
   thumbnails agora também fecha a janela para os metadados/contadores
   da galeria.
3. **`ajfit-units-preference` (`units/unitsStorage.ts`)**: é dado de conta
   de verdade — `units/syncUnits.ts`'s `pushRemoteUnits` escreve o mesmo
   valor em `users/{uid}.preferences.units`. `reconcileUnitsOnLoad` já
   recusa aplicar um valor pendente com `uid` diferente do uid atual, então
   isto NÃO era um vazamento cross-account completo — mas esse auto-reparo
   só age quando a reconciliação de fato roda no próximo login. Adicionado
   `clearStoredUnitsPreference()` (novo export em `unitsStorage.ts`) e
   chamado em `finalizeAccountDeletionClientShutdown`, fechando a janela de
   corrida inteiramente para o caminho de exclusão — mesmo tratamento
   defensivo já dado ao rascunho de onboarding. `language`
   (`i18n/languageStorage.ts`) foi deliberadamente EXCLUÍDO desta mudança:
   seu próprio comentário documenta que logout/exclusão NÃO deve limpá-lo —
   o idioma escolhido pelo usuário que está saindo permanece como default
   pré-autenticação, por decisão de produto já tomada.

## 152. SecureStore

Tratamento: sem mudanças nesta fase — já coberto (Fase 5, `signOutUser()`):
`deleteVaultKey(uid)` + `clearSecureAuthSession()`.

## 153. AsyncStorage

Tratamento: ver matriz §149. Único gap real (`ajfit-subs`) corrigido —
ver §151.1.

## 154. Filesystem

Tratamento: `photoVaultEncryptedCache.ts` (ciphertext, uid-namespaced,
epoch-guarded) e `photoVaultFileCrypto.ts`'s `tmp/`/`enc/`/`share/`
(plaintext temporário e fila de exportação para compartilhamento) — ambos
já corretamente limpos no `useEffect` de mudança de identidade de
`PhotoVaultContext.tsx`. Nenhuma mudança nesta fase.

## 155. Photo Vault — key/cache/temp/ciphertext

* Vault key (SecureStore): já limpa (Fase 5).
* Cache de ciphertext (thumbnails): já limpo (`pruneCachedThumbnailsExcept`).
* Plaintext decriptado temporário: já limpo (`discardDecryptedPhotos`,
  disparado automaticamente por `lockPhotoVault()` via subscription de
  status).
* Metadados da galeria (contagem, datas, ids — sem bytes de imagem):
  **gap corrigido nesta fase** (§151.2).

## 156. Share/comparison files

`cleanupPhotoVaultShareFiles()` (`photoVaultFileCrypto.ts`) já é chamado
explicitamente no `useEffect` de identidade
(`PhotoVaultContext.tsx:284-289`), com comentário próprio confirmando que
cobre exatamente o risco de export para Instagram/share sheet apontado
por esta fase. Nenhuma mudança necessária — verificado, não modificado.

## 157. Avatar

`ProfileAvatar.tsx` usa `expo-image`, cache chaveado pela URL completa
(`users/{uid}/profile/avatar`, namespaced por uid estruturalmente) — duas
contas nunca compartilham chave de cache. Sem ação necessária.

## 158. Workout state

Estado de sessão (`order`, `skipped`, `logged`, `resting`, `elapsed` etc.)
é `useState` comum, SESSION_SCOPED, desmonta automaticamente porque
`App.tsx` já desmonta toda a árvore de telas privadas quando `user` vira
`null`. Único dado persistido (`permSubs`/`ajfit-subs`) — ver §151.1.
Nenhum rascunho de treino ativo (Firestore-backed) existe no código —
`TODAY_WORKOUT` é uma constante estática, não dado de usuário.

## 159. Drafts

Único rascunho encontrado além do onboarding (já coberto): nenhum. Não
existe rascunho de questionário/avaliação/suporte em nenhum lugar do
`src/`.

## 160. Pending sync

Dois encontrados (units, language) — ambos protegidos por checagem de uid
em `reconcileUnitsOnLoad`/`reconcileLanguageOnLoad` (App.tsx, chamados a
cada login). Nenhuma fila de sync de treino/avaliação/questionário existe.

## 161. Firestore local/offline cache

`src/lib/firebase.ts` — `getFirestore(app)` padrão, SEM
`initializeFirestore`/`enableIndexedDbPersistence`/cache config alguma.
Confirmado pelo próprio comentário do arquivo: persistência offline
durável não é suportada pelo Firebase JS SDK em React Native (só
IndexedDB, web-only) e está registrada como pendência arquitetural em
outro documento. Cache em memória, por processo, chaveado por path de
documento — nunca colide entre contas (paths são `users/{uid}/...`), e
Security Rules bloqueiam leitura cross-account no servidor
independentemente.

## 162. Contexts/stores

`PromoCodeContext.tsx` — `useEffect` em `[uid]` despacha
`identity-changed` com guarda de `generation`; documentado explicitamente
como "logout/account switch resets it". `PhotoVaultContext.tsx` — o
`useEffect` de identidade é o ponto de reset mais importante do app:
`lockPhotoVault()` → `resetGallery()` (novo, §151.2) →
`pruneCachedThumbnailsExcept(uid)` → `cleanupPhotoVaultShareFiles()`.
`UnitsContext`/`PremiumActionContext` não seguram dado sensível
diretamente (derivam de outras fontes já reconciliadas).

## 163. Module-level caches

Auditoria ampla confirmou um padrão consistente de "generation counter"
em todo o subsistema Photo Vault (`photoVaultLock.ts`, `photoVaultSession.ts`,
`photoVaultCompareShare.ts`, `photoVaultCompareController.ts`,
`photoVaultCompareExport.ts`, `photoVaultGallery.ts`) especificamente para
proteger contra callbacks tardios de uma sessão anterior. Um caso
confirmado como fio morto (`resetGallery()`) foi corrigido (§151.2); os
demais seguem o padrão defensivo já estabelecido e não foram alterados.

## 164. RevenueCat

Sem mudanças — comportamento já comprovado na Fase 5
(`SubscriptionContext` reage a `user = null`, chama `logoutRevenueCat()` +
`detachCustomerInfoListener()`) e reforçado pela Fase 9 (late-webhook
fail-closed, lado backend).

## 165. Late callbacks

`photoVaultEncryptedCache.ts`'s `cacheEpoch` e `photoVaultGallery.ts`'s
`generation` (agora corretamente bumped em toda mudança de identidade via
`resetGallery()`) são a prova estrutural de isolamento contra callback
tardio: um download iniciado pela sessão de A que resolve depois que B já
está ativo falha a checagem de epoch/generation e não pode repopular o
estado de B nem recriar o namespace de A.

## 166. Preferências preservadas

Nenhuma preferência puramente device-scoped foi encontrada além de
`theme` (que sequer tem cache local — lida direto do profile) — não há
`language`/`units` device-scoped: ambos são sincronizados por usuário e
corretamente reconciliados por uid a cada login.

## 167. Arquivos criados/alterados

`src/services/workoutSubstitutionsStorage.ts` (novo);
`src/services/__tests__/workoutSubstitutionsStorage.test.ts` (novo, 2
testes); `src/units/unitsStorage.ts` (`clearStoredUnitsPreference` novo
export); `src/units/__tests__/unitsStorage.test.ts` (+3 testes);
`src/services/accountDeletionShutdown.ts` (duas chamadas adicionais + doc
comment); `src/services/__tests__/accountDeletionShutdown.test.ts` (+4
testes); `src/screens/WorkoutScreen.tsx` (import da chave, sem outra
mudança); `src/lib/__tests__/workoutLogicIntact.test.ts` (assertion
atualizada para o novo import); `src/state/PhotoVaultContext.tsx`
(`resetGallery()` adicionado ao efeito de identidade); `src/state/__tests__/photoVaultContextStructure.test.ts`
(+1 teste estrutural).

## 168. Testes unitários

12 novos testes diretos (`workoutSubstitutionsStorage.test.ts` ×2,
`unitsStorage.test.ts` ×3, `accountDeletionShutdown.test.ts` ×4 novos,
`photoVaultContextStructure.test.ts` ×1 novo, `workoutLogicIntact.test.ts`
atualizado) — todos passando, mais toda a suíte pré-existente de
`photoVaultGallery.test.ts` (65 testes) e `photoVaultEncryptedCache.test.ts`
(não modificados) continuando 100% verde sem alteração.

## 169. Teste A → B

Consistente com a convenção já estabelecida neste repositório (ver o
próprio comentário de `photoVaultContextStructure.test.ts`: "The project
has no component renderer"), a prova de isolamento é feita em duas
camadas, ambas verificadas: (1) testes ESTRUTURAIS sobre o código-fonte de
`PhotoVaultContext.tsx` provando que `resetGallery()`/
`pruneCachedThumbnailsExcept(uid)`/`cleanupPhotoVaultShareFiles()` estão
todos no `useEffect([uid])`, na ordem correta; (2) testes COMPORTAMENTAIS
reais (não mocados) sobre os módulos subjacentes
(`photoVaultGallery.test.ts`, `photoVaultEncryptedCache.test.ts`) que já
provam, com um fake filesystem in-memory, que os dados de um uid nunca
vazam para outro. Não foi construído um teste de renderização de
componente completo — o próprio código-base já rejeitou esse padrão para
este arquivo especificamente.

## 170. Restart

Não testado nesta fase com um harness dedicado — o comportamento pós-restart
já é coberto estruturalmente: `photoVaultEncryptedCache.ts` é
explicitamente projetado para sobreviver a um restart (é um cache em
disco, não em memória) e `pruneCachedThumbnailsExcept` roda de novo a cada
mudança de identidade real, incluindo após um restart. `resetGallery()`/
estado de módulo em memória naturalmente já começa vazio após um restart
(processo novo).

## 171. Filesystem final / SecureStore final / AsyncStorage final / Outro UID

Cobertos pelos testes comportamentais existentes e não modificados de
`photoVaultEncryptedCache.test.ts` (namespacing por uid, `pruneCachedThumbnailsExcept`
mantém outros uids intactos) e `photoVaultGallery.test.ts`. Não
re-duplicados nesta fase.

## 172. Regressões

Raiz: typecheck limpo, 2737/2737 (+10 desde Fase 9: 12 novos testes menos
2 testes ajustados/substituídos, não adicionados). `functions`: typecheck
limpo, 1055/1055 (inalterado desde Fase 10, Fase 11 não toca `functions/`).
Rules: 309/309. Quatro integrações via Emulator real: 2/2, 3/3, 2/2, 4/4.
Todos os números re-verificados de forma independente após a correção do
gap de `units` (§151.3), não apenas herdados do relatório do agente de
auditoria.

## 173. Alterações externas

```text
Nenhuma. Fase 11 é inteiramente client-side/local.
```

## 174. Veredito

**FASE 11 — APROVADA.** Três gaps reais de isolamento entre contas foram
encontrados por auditoria e corrigidos, evoluindo a rotina existente da
Fase 5 (nenhuma rotina paralela criada). Uma limitação residual documentada
e não fingida: `ajfit-subs` continua sem namespace por uid para uma troca
de conta comum (sem exclusão), porque a tela que o usa ainda não está
integrada a nenhum modelo de dado por usuário — resolvido apenas no
caminho de exclusão de conta, que é o gate desta fase.

**Nota de processo**: a auditoria/correção inicial desta fase (dois dos
três gaps — `ajfit-subs` e `resetGallery()`) foi produzida por um subagente
de pesquisa que excedeu seu escopo explicitamente somente-leitura. Toda
mudança de código resultante foi revisada e reverificada de forma
independente (typecheck + suíte completa rodados do zero, diffs lidos
linha a linha) antes de ser aceita como parte deste relatório; o terceiro
gap (`units`) foi identificado e corrigido separadamente. Nenhuma mudança
de produção, deploy, ou dado real foi afetado por este desvio de processo.

# Relatório consolidado — Fases 10 e 11

## 175. Estado de cada executor (Fases 1–11)

| Executor | Status |
|---|---|
| `ACCOUNT_ACCESS_LOCK` | IMPLEMENTADO (Fase 5, testado c/ Emulator) |
| `PROVIDER_REVOCATION` | IMPLEMENTADO (Fase 3, Apple+Google, testado) |
| `VAULT_KEY_DESTRUCTION` | **PENDENTE** — nenhum executor existe em nenhuma fase |
| `FIRESTORE_CLEANUP` | IMPLEMENTADO (Fase 6, testado c/ Emulator) |
| `STORAGE_CLEANUP` | IMPLEMENTADO (Fase 7, testado c/ Emulator) |
| `RETAINED_DATA_PROCESSING` | IMPLEMENTADO (Fase 8, testado c/ Emulator) |
| `REVENUECAT_PROCESSING` | IMPLEMENTADO (Fase 9 — só o caminho SKIP; DELETE/ANONYMIZE sem contrato) |
| `AUTH_DELETION` | IMPLEMENTADO (Fase 10, testado c/ Auth Emulator) |
| LOCAL CLIENT SHUTDOWN | IMPLEMENTADO (Fase 5 + correções da Fase 11) |

Nenhum executor é marcado IMPLEMENTADO só porque um tipo/state existe —
todos os marcados IMPLEMENTADO têm código real + testes reais (unitários
e, onde aplicável, contra Emulator real) provando o comportamento.

## 176. Principal próximo passo

Construir o executor real de `VAULT_KEY_DESTRUCTION` — é o único bloqueador
estrutural que impede o workflow real de sequer alcançar `AUTH_DELETION`
(`nextRunnableStep` nunca avança além dele sem um executor). Depois disso,
o próximo passo é o worker/orquestrador real que chama cada executor na
ordem, algo que NENHUMA fase até aqui constrói deliberadamente.

## 177. Produção

```text
Nenhum deploy foi realizado em nenhuma fase.
Nenhuma conta Auth real foi excluída (Auth Emulator + Admin app próprio, projeto descartável).
Nenhuma assinatura Apple/Google foi cancelada.
Nenhum customer RevenueCat real foi alterado.
```

## 178. Veredito consolidado

**FASES 10 E 11 — APROVADAS**, com a ressalva explícita e reportada (não
enfraquecida) de que o workflow real ainda não pode alcançar
`AUTH_DELETION` legitimamente até `VAULT_KEY_DESTRUCTION` ter um executor
real.

# Fase 12.5 — VAULT_KEY_DESTRUCTION

## 179. Modelo criptográfico encontrado

Envelope encryption, confirmado por leitura direta de
`functions/src/photoVault/{kmsClient,vaultKeyCrypto,createVault,
recoverVaultKey,vaultRepository,schema}.ts`:

```text
Vault Key (DEK, 32 bytes, CSPRNG, gerada em memória por createVault.ts)
↓ wrapVaultKey() — KMS.encrypt() contra a KEK compartilhada
wrappedVaultKey (ciphertext base64)
↓ persistido, uma única vez
users/{uid}/privateSecurity/photoVault  (o único documento)
↓ recoverVaultKey.ts lê o MESMO documento e chama unwrapVaultKey()
KMS.decrypt() contra a MESMA KEK compartilhada
↓
Vault Key em texto puro, devolvida ao cliente, nunca persistida no backend
```

A KEK (`projects/{p}/locations/us-central1/keyRings/ajfit-photo-vault/
cryptoKeys/photo-vault-kek`, `kmsClient.ts`) é um recurso ÚNICO, compartilhado
por TODOS os usuários — nunca por-usuário. Destruí-la tornaria o Vault de
todo mundo irrecuperável, não só o de um uid. Por isso ela nunca é tocada
por esta fase.

## 180. Material criptográfico

| Material | Local | Persistente? | Permite recuperar Vault? | Precisa destruir? |
|---|---|---:|---:|---:|
| KEK (`photo-vault-kek`) | Cloud KMS, compartilhada | Sim | Sim, mas para TODOS os uids | **Não** — destruiria outros usuários |
| Vault Key (DEK) em texto puro | Memória da function (`createVault`/`recoverVaultKey`) | Não — `finally { vaultKey.fill(0) }`, best-effort | — | Não há o que destruir (nunca persistida) |
| `wrappedVaultKey` (DEK cifrado) | `users/{uid}/privateSecurity/photoVault` | **Sim — única cópia backend** | Sim (é o único material que, com a KEK, reconstrói a DEK) | **SIM — esta é a etapa** |
| `kmsKeyVersion` | Mesmo documento | Sim | Não sozinho (é só um ponteiro de auditoria) | Sim, junto com o documento (mesmo doc) |
| Vault Key local (dispositivo) | SecureStore | Sim, por device | Sim, localmente | Fora de escopo — Fase 5/11 (`deleteVaultKey(uid)`), não backend |
| "Recovery material" separado | — | **Não existe** | — | N/A |
| Chaves antigas/rotacionadas | — | **Não existe** — schema tem um único `vaultKeyVersion` int, sem histórico, e nenhuma função de rotação existe no repositório | — | N/A |

Nenhum recurso foi inventado — tabela derivada exclusivamente do código
lido.

## 181. Localização da chave

Path real, único: `users/{uid}/privateSecurity/photoVault`, campos
`wrappedVaultKey` + `encryptionVersion` + `vaultKeyVersion` + `kmsKeyVersion`
+ `algorithm` + `createdAt` + `updatedAt` (`schema.ts`'s
`PhotoVaultDocument`, fechado — `assertValidPhotoVault` rejeita qualquer
campo extra).

## 182. Recovery

`recoverVaultKey.ts`'s `handleRecoverVaultKey` NÃO é um sistema de recovery
separado — é uma segunda LEITURA do mesmíssimo documento seguida de um
segundo `unwrapVaultKey()`. Não existe blob de recovery, backup, ou
material equivalente em nenhum outro path. Já exige `requireRecentAuth` +
`requireActiveAccount(uid)` (Fase 5) — uma sessão associada a uma exclusão
em andamento já é recusada, mesmo antes desta fase existir.

## 183. Client vs backend

Cópia LOCAL (dispositivo, `SecureStore`, `deleteVaultKey(uid)`) já é
responsabilidade da Fase 5/11 (`src/services/auth.ts`'s `signOutUser()`) —
completamente distinta e já resolvida. Esta fase trata exclusivamente da
cópia REMOTA (`wrappedVaultKey` em Firestore).

## 184. Fase 6 / privateSecurity

Confirmado por leitura de `firestoreCleanup/resources.ts`: `FIRESTORE_CLEANUP`
usa um `.delete()` NÃO-recursivo em `users/{uid}` especificamente para NUNCA
cascatear para dentro de `privateSecurity` — a hipótese arquitetural do
enunciado está CORRETA. `VAULT_KEY_DESTRUCTION` é, portanto, a única etapa
que remove esse documento; `FIRESTORE_CLEANUP` continua sem nenhuma
responsabilidade criptográfica, antes ou depois desta fase.

## 185. Propriedade de destruição

**"Vault criptograficamente destruído"** = o ciphertext `wrappedVaultKey`
para este uid não existe mais em nenhum lugar controlado pelo backend. Sem
ele, `KMS.decrypt()` não tem nada para decifrar — a KEK compartilhada
permanecer operacional para outros usuários é irrelevante para ESTE uid,
porque não existe mais nenhum ciphertext seu para submeter a ela. Ciphertext
de FOTOS em Cloud Storage pode continuar existindo neste ponto (Storage
Cleanup é etapa posterior e independente) — isso é esperado e aceitável, não
uma falha desta etapa.

## 186. Executor implementado

- `functions/src/photoVault/vaultRepository.ts`: novo `deleteVaultDocument(uid)`
  — `.delete()` simples no documento único, idempotente por construção
  (Firestore nunca lança "not found" em delete de doc ausente). Colocado no
  mesmo módulo que `createVaultDocument`/`readVaultDocument` — única fonte de
  verdade do path, sem duplicação.
- `functions/src/accountDeletion/vaultKeyDestruction.ts`:
  `executeVaultKeyDestruction(uid, {deleteVaultDocument?})` — dependência
  injetável (mesmo padrão de `accountAccessLock.ts`/`authDeletion.ts`),
  classificador de erro reaproveitando os mesmos códigos gRPC de
  `firestoreCleanup`/`retainedDataProcessing`, nunca lança, sempre resolve
  `AccountDeletionStepOutcome`. Zero chamada a KMS (a destruição nunca pede
  a KMS para fazer nada — só remove o documento que segura o ciphertext).

## 187. Operações realizadas

Exatamente: `DELETE users/{uid}/privateSecurity/photoVault`. Nenhuma outra
escrita, nenhuma chamada a KMS, nenhum outro documento, nenhum objeto
Storage.

## 188. Idempotência

Comprovada: delete de documento ausente é sucesso silencioso — nunca um
"not found" a mapear. Execução repetida (3×) converge no mesmo `SUCCEEDED`.

## 189. Falha parcial

Não aplicável neste modelo: há um único material a destruir (um documento),
não múltiplos passos internos — não existe "A destruído, B falha" para esta
etapa especificamente (diferente de, por exemplo, Fase 8's support+coupon).
Testado mesmo assim que uma falha transitória do próprio delete (código gRPC
14) não corrompe nada e uma repetição completa com sucesso.

## 190. Retry

Testado: falha transitória → `FAILED`/`UNAVAILABLE` → retry → `SUCCEEDED`.
Nunca tenta recriar o documento apagado.

## 191. Outro UID

Testado (unitário e Emulator real): apagar o vault de A nunca toca o de B.

## 192. State machine

`canRunAuthDeletion`/`nextRunnableStep` (reaproveitados, não duplicados)
provam: com `VAULT_KEY_DESTRUCTION = SUCCEEDED`, a cadeia avança
corretamente para `FIRESTORE_CLEANUP`; com `VAULT_KEY_DESTRUCTION` ainda
`PENDING`, nada depois dele (incluindo `AUTH_DELETION`) pode rodar — exatamente
o comportamento que faltava antes desta fase.

## 193. Ponto de não retorno

Confirmado, não corrigido: nenhuma outra cópia do material foi encontrada em
lugar algum do código, então `POINT_OF_NO_RETURN_STEP =
'VAULT_KEY_DESTRUCTION'` (`steps.ts`, Fase 1) continua correto.

## 194. Firestore Emulator

`functions/src/accountDeletion/__tests__/vaultKeyDestruction.integration.test.ts`
(opt-in, `VAULT_KEY_DESTRUCTION_INTEGRATION=1`, `npm run
test:integration:vaultKeyDestruction`, Firestore+Storage Emulator reais,
projeto descartável `ajfit-rules-test`). **4/4 passando**: destrói o vault de
A preservando ciphertext de fotos e o vault+ciphertext de B intactos; retry
idempotente; uid sem vault nenhum = sucesso; composição com
`runFirestoreCleanup` (Fase 6) real.

## 195. Integração com Firestore Cleanup

Provada no mesmo arquivo (§194): `VAULT_KEY_DESTRUCTION(A)` →
`FIRESTORE_CLEANUP(A)` → vault ausente E `privateSecurity` vazio E
`users/{uid}` ausente. Retry de `VAULT_KEY_DESTRUCTION` depois do Firestore
Cleanup também converge para sucesso lógico.

## 196. Ciphertext remanescente

Comprovado no Emulator (§194): depois de `VAULT_KEY_DESTRUCTION`, um objeto
de ciphertext em `users/{uid}/progressPhotos/*.enc` continua presente — e
isso é correto segundo o modelo auditado (§185): sem o `wrappedVaultKey`
apagado, nenhum caminho conhecido pelo AJ Fit pode voltar a obter a DEK para
decifrá-lo, independentemente do ciphertext ainda existir fisicamente no
Storage.

## 197. Provider Revocation — Apple

**Classificação: PARCIAL.**

Executor real, testado, idempotente (`appleProviderRevocation.ts`, Fase 3) —
distingue corretamente primeira tentativa (precisa de `authorizationCode`
fresco) de retry (reusa material cacheado/wrapped). PORÉM: auditoria desta
fase encontrou uma lacuna de ORQUESTRAÇÃO não resolvida em nenhuma fase
anterior — `src/services/accountDeletionProviderRevocation.ts`'s
`prepareAppleProviderRevocationMaterial` está documentado explicitamente
como destinado a "uma etapa POSTERIOR de um workflow JÁ ACEITO", mas:
(a) nenhum ponto do app (`grep` exaustivo em `src/`) chama essa função —
nenhuma tela/hook a invoca; (b) a ordem canônica da state machine roda
`ACCOUNT_ACCESS_LOCK` (desabilita Auth + revoga refresh tokens) ANTES de
`PROVIDER_REVOCATION`; (c) o cliente já chama `logout()` imediatamente após
`requestAccountDeletion()` aceitar (Fase 5/11,
`finalizeAccountDeletionClientShutdown`). Combinados, não existe hoje nenhum
momento arquitetado em que o cliente esteja autenticado, com uma sessão
Apple viva, E seja solicitado a capturar um `authorizationCode` fresco antes
que a conta seja bloqueada — exatamente o cenário que o próprio executor já
trata corretamente como `PROVIDER_AUTHORIZATION_INVALID` (terminal), mas sem
um caminho definido para nunca mais obter material fresco depois disso.
Resolver isso é trabalho de fase futura (redesenho de captura antecipada,
por exemplo dentro do próprio `requestAccountDeletion`) — não implementado
nem redesenhado aqui, conforme instruído.

## 198. Provider Revocation — Google

**Classificação: PARCIAL**, mesma causa raiz do Apple (§197) — nenhuma
orquestração chama `revokeGoogleProviderAccess` hoje — mais a fragilidade já
documentada desde a Fase 3 do próprio `GoogleSignin.revokeAccess()`
(reportado como não confiável em múltiplas issues públicas da biblioteca) e
sua dependência de uma sessão SDK do Google viva no dispositivo.

## 199. Matriz completa de steps

| Step | Executor real? | Idempotente? | Testado? | E2E/Emulator? | Blocker? |
|---|---:|---:|---:|---:|---:|
| `ACCOUNT_ACCESS_LOCK` | Sim (Fase 5) | Sim | Sim | Sim (Firestore/Storage Rules) | Não |
| `PROVIDER_REVOCATION` | Sim (Fase 3, Apple+Google) | Sim | Sim | Não (nem antes, nem agora) | **PARCIAL — sem orquestração de captura de material fresco (§197/§198)** |
| `VAULT_KEY_DESTRUCTION` | **Sim (esta fase)** | Sim | Sim | **Sim (novo, §194)** | Não |
| `FIRESTORE_CLEANUP` | Sim (Fase 6) | Sim | Sim | Sim | Não |
| `STORAGE_CLEANUP` | Sim (Fase 7) | Sim | Sim | Sim | Não |
| `RETAINED_DATA_PROCESSING` | Sim (Fase 8) | Sim | Sim | Sim | Não |
| `REVENUECAT_PROCESSING` | Sim (Fase 9, só SKIP) | Sim | Sim | N/A (zero I/O) | Não |
| `AUTH_DELETION` | Sim (Fase 10) | Sim | Sim | Sim | Não |

## 200. Testes adicionados

18 novos testes `functions`: `vaultRepository.test.ts` (4),
`vaultKeyDestruction.test.ts` (11), `stateMachineFullChain.test.ts` (3,
prova a ordenação completa dos 8 steps via `nextRunnableStep`), mais 4 novos
no Emulator real (`vaultKeyDestruction.integration.test.ts`, incluindo a
composição com `runFirestoreCleanup`).

## 201. Regressão completa

Reexecutada do zero por mim, não apenas herdada: root typecheck limpo,
2737/2737; `functions` typecheck limpo, 1073/1073 (+18); rules 309/309;
cinco integrações via Emulator real: Firestore Cleanup 2/2, Storage Cleanup
3/3, Retained Data 2/2, Auth Deletion 4/4, **Vault Key Destruction 4/4
(novo)**.

## 202. Arquivos criados/alterados

`functions/src/photoVault/vaultRepository.ts` (+`deleteVaultDocument`);
`functions/src/accountDeletion/vaultKeyDestruction.ts` (novo);
`functions/src/accountDeletion/index.ts` (+1 export);
`functions/src/__tests__/vaultRepository.test.ts` (novo, 4 testes);
`functions/src/accountDeletion/__tests__/vaultKeyDestruction.test.ts` (novo,
11 testes); `functions/src/accountDeletion/__tests__/
stateMachineFullChain.test.ts` (novo, 3 testes);
`functions/src/accountDeletion/__tests__/vaultKeyDestruction.integration.test.ts`
(novo, 4 testes); `package.json`
(`test:integration:vaultKeyDestruction`).

## 203. Alterações externas

```text
Deploy: NÃO
Firebase produção: NÃO ALTERADO
Auth real: NÃO ALTERADO
Storage real: NÃO ALTERADO
Vault real: NÃO ALTERADO
RevenueCat real: NÃO ALTERADO
Apple real: NÃO ALTERADO
Google real: NÃO ALTERADO
```

## 204. Blocker check

**SIM.** Além da ausência do worker/orquestrador (já conhecida, comum a
TODAS as fases): `PROVIDER_REVOCATION` tem uma lacuna real de orquestração
de captura de material (§197/§198) — não é "sem executor" como
`VAULT_KEY_DESTRUCTION` era, mas "executor correto sem um momento
arquitetado em que o material fresco necessário chegue até ele" antes que a
conta seja bloqueada/o cliente faça logout. Isto não foi contornado,
redesenhado, nem escondido — reportado exatamente como as regras exigiram.

## 205. Readiness para Fase 13 (fault injection sobre a cadeia completa)

**SIM**, com ressalva: fault injection sobre os 8 executores + a ordenação
da state machine já é totalmente viável hoje (todos têm executor real,
idempotente, testado) — mas qualquer cenário de fault injection que
dependa de `PROVIDER_REVOCATION` efetivamente completar com material
fresco vai esbarrar na mesma lacuna de orquestração (§197/§198), não em
um bug do executor em si.

## 206. Readiness para Fase 14 (worker/orquestrador)

**NÃO, ainda não, sem resolver §197/§198 primeiro** (ou decidir
conscientemente adiar Apple/Google para trás de `VAULT_KEY_DESTRUCTION`/
depois de um redesenho de captura antecipada). Um worker construído hoje,
seguindo estritamente `nextRunnableStep`, chegaria a
`PROVIDER_REVOCATION` e — na ausência de material fresco e de qualquer
mecanismo automático para obtê-lo pós-lock — ficaria preso em retry até
esgotar o orçamento e virar `FAILED_TERMINAL`, nunca alcançando
`VAULT_KEY_DESTRUCTION` em diante para uma conta com Apple/Google
linkado. Para contas SEM nenhum provider social linkado
(`PROVIDER_REVOCATION` = `SKIPPED_BY_POLICY` para ambos), o worker JÁ
poderia percorrer a cadeia inteira legitimamente hoje.

## 207. Veredito

**FASE 12.5 — APROVADA COM BLOQUEADOR EXTERNO.** `VAULT_KEY_DESTRUCTION`
está completamente implementada, testada (unitário + Emulator real,
inclusive composta com Firestore Cleanup), idempotente, e corretamente
posicionada como ponto de não retorno. O blocker que impedia o workflow de
chegar a `AUTH_DELETION` foi removido. Um segundo blocker pré-existente, não
introduzido por esta fase, foi encontrado e reportado com precisão em vez
de escondido: a orquestração de captura de material fresco para
`PROVIDER_REVOCATION` (Apple e Google) ainda não está desenhada em nenhuma
fase construída até aqui.

# Correção Fases 3/5 — Orquestração de Provider Revocation

## 208. Auditoria inicial — por que PROVIDER_REVOCATION estava incompleto

`appleProviderRevocation.ts`/`googleProviderRevocation.ts` (Fase 3) sempre
foram executores corretos e testados. O gap real, confirmado por leitura
direta do código: **nada em produção jamais chamava nenhum dos dois**.
`AppleProviderRevocationInput.authorizationCode` só existiria se algo
capturasse material Apple fresco e o entregasse ao executor — nenhum ponto
do app (`grep` exaustivo) fazia isso, e `requestContract.ts`'s contrato era
literalmente `Record<string, never>` (zero campos aceitos). Combinado com a
ordem da state machine (`ACCOUNT_ACCESS_LOCK` antes de
`PROVIDER_REVOCATION`) e o cliente já chamando `logout()` imediatamente após
`requestAccountDeletion` aceitar (Fase 5/11), não existia NENHUM momento
arquitetado em que o backend pudesse obter o material necessário antes de o
cliente poder desaparecer.

## 209. Apple — antes

```text
cliente autentica
↓
requestAccountDeletion() — contrato sem nenhum campo
↓
ACCOUNT_ACCESS_LOCK roda primeiro (Auth desabilitado, refresh tokens revogados)
↓
cliente já fez logout (Fase 5/11)
↓
PROVIDER_REVOCATION:apple tenta rodar
↓
nenhum authorizationCode, nenhum material cacheado
↓
PROVIDER_AUTHORIZATION_INVALID (terminal) — preso para sempre
```

## 210. Apple — depois

```text
cliente autentica
↓
[client] captura authorizationCode fresco (prepareAppleProviderRevocationMaterial, Fase 3, agora chamado)
↓
requestAccountDeletion({appleAuthorizationCode}) — contrato estendido
↓
[backend, DENTRO do mesmo callable, ANTES de criar o record]
   exchangeAppleAuthorizationCode() — troca com a Apple, server-side
   → falha? deletion NÃO criada, conta NÃO bloqueada (§37)
↓
record criado (Fase 4, lógica inalterada) → deletionId real
↓
[backend] cacheAppleRevocationMaterial(deletionId, refreshToken) —
   wrap (KMS) + save (Firestore), contra o deletionId real
↓
============= CLIENTE NÃO É MAIS NECESSÁRIO =============
↓
ACCOUNT_ACCESS_LOCK
↓
PROVIDER_REVOCATION:apple — revokeAppleProvider (Fase 3, inalterado)
   lê material JÁ cacheado, nunca precisa de authorizationCode de novo
↓
SUCCEEDED
```

## 211. Google — antes

Doc comment original (Fase 3) dizia explicitamente: revoke deve rodar
DEPOIS do commit. Isso é o oposto do necessário — não existe endpoint
backend equivalente a `GoogleSignin.revokeAccess()`, então se o cliente
desaparecesse antes de revogar, `PROVIDER_REVOCATION:google` ficaria
`PENDING` para sempre, sem nenhum caminho de conclusão.

## 212. Google — depois

```text
cliente autentica
↓
[client] revokeGoogleProviderAccess():
   GoogleSignin.revokeAccess() (real revogação, único mecanismo existente)
   ↓ sucesso
   firebase/auth unlink(currentUser, 'google.com')
↓
============= AGORA, E SÓ AGORA, ============= 
requestAccountDeletion() é chamado
↓
[backend] admin.auth().getUser(uid).providerData — snapshot real (Fase 4, inalterado)
   'google.com' NÃO aparece mais (foi unlinked de verdade)
↓
initialProviderRevocationSubState(linked=false) — SKIPPED_BY_POLICY automático
   (Fase 3, tipo/lógica inalterados — a MESMA regra que já existia para "não vinculado")
↓
PROVIDER_REVOCATION:google nunca precisa de nenhuma ação depois do commit
```

Nenhuma linha de `googleProviderRevocation.ts`/`providerRevocation/types.ts`
foi alterada — a correção é inteiramente de ORDEM (quando revoke acontece),
não de mecanismo.

## 213. Commit boundary

Definido exatamente como: o ponto em que `requestAccountDeletion()` retorna
`accepted: true`. A partir desse ponto, comprovado (§220):
`src/services/accountDeletionOrchestrator.ts`'s
`requestAccountDeletionWithProviderPreparation()` é a ÚNICA função
permitida a chamar o callable — sequencia Google → Apple → commit, nessa
ordem, e nunca chama o callable se qualquer preparação obrigatória falhar
antes.

## 214. Estado/preparação temporária

Nenhum mecanismo NOVO de persistência foi criado — `appleRevocationRepository.ts`
(Fase 3) já existia, completo, testado, e nunca tinha sido escrito por
código real. Schema/segurança/lifecycle são exatamente os já documentados
pela Fase 3 (`accountDeletions/{deletionId}/privateSecurity/appleProviderRevocation`,
KMS-wrapped, limpo automaticamente por `revokeAppleProvider` assim que o
sub-step alcança `SUCCEEDED`). O `authorizationCode` em si NUNCA é
persistido em lugar nenhum — vive apenas na pilha de chamada de
`exchangeAppleAuthorizationCode`, é gasto pela Apple no momento da troca, e
nunca é tocado de novo.

## 215. Segurança Apple

Secrets novos: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_SERVICES_CLIENT_ID`,
`APPLE_PRIVATE_KEY` — `defineSecret()` (Secret Manager), mesmo padrão de
`REVENUECAT_API_SECRET_KEY`. Nenhum valor real foi provisionado por esta
correção (requer um humano com acesso ao Apple Developer Portal, via
`firebase functions:secrets:set` — infraestrutura fora do escopo de
código). Bound à função `requestAccountDeletion` em vez de nunca lidos.
`authorizationCode` nunca logado, nunca no bundle do cliente — confirmado
por leitura de `exchangeAppleAuthorizationCode`/`accountDeletionProviderRevocation.ts`.

## 216. Segurança Google

Nenhum secret novo. A "confirmação" de que Google foi revogado é o
`providerData` do PRÓPRIO Firebase Auth, lido server-side
(`admin.auth().getUser(uid)`, Fase 4, inalterado) — nunca um booleano
client-supplied. Um payload malicioso `{googleRevoked: true}` seria
rejeitado pelo contrato fechado de `requestAccountDeletion` (só aceita
`appleAuthorizationCode`).

## 217. Multi-provider

Testado explicitamente (unitário, `requestAccountDeletion.test.ts` e
`accountDeletionOrchestrator.test.ts`): password-only (nenhum I/O
Apple/Google), Apple-only, Google-only, e a combinação tripla — Google
sempre revogado+unlinked antes de Apple ser preparado, ambos independentes
um do outro.

## 218. Password-only

Confirmado sem regressão: nenhuma preparação social é acionada; o fluxo
permanece exatamente `requireRecentAuth → snapshot providers (nenhum
social) → createOrReuse`, idêntico à Fase 4 original.

## 219. Recent-auth

Inalterado — `requireRecentAuth` continua a ÚNICA porta de entrada para um
NOVO record, chamada antes de qualquer lógica Apple. Material de provider
NUNCA substitui essa checagem.

## 220. UID isolation

`appleAuthorizationCode` nunca carrega nem implica um uid — o uid do
snapshot de providers e o uid usado pelo `repository.createOrReuse`
continuam vindo exclusivamente de `request.auth.uid` (Fase 1/4, inalterado).
Testado: payload tentando `{uid: 'attacker-uid', appleAuthorizationCode}`
rejeitado no contrato antes de qualquer exchange.

## 221. Idempotência

Apple: exchange só acontece uma vez por `authorizationCode` (single-use,
já garantido pela própria Apple); retry de `requestAccountDeletion` sem
dedup ainda cria só UM record (Fase 4 inalterada) — um segundo
`authorizationCode` fresco fornecido nesse retry é apenas descartado se o
resultado for `deduplicated: true` (custo aceito, documentado). Google:
`revokeGoogleAccess()`/`unlink()` chamados de novo em um retry são seguros
— revogar algo já revogado e unlink de algo já unlinked são idempotentes
pela própria natureza das operações.

## 222. Cenário Google revoked + request failed

Resultado confirmado pelo design: a conta AJ Fit continua existindo (nenhum
record criado), mas a autorização OAuth do Google já foi revogada e
`google.com` já foi unlinked do Firebase Auth user. Este é um estado
conhecido e seguro (não corrompido) — o usuário pode tentar excluir de
novo (o backend não exige Google linked para aceitar a exclusão) ou
re-vincular o Google manualmente se quiser continuar usando esse provider
para login. Não implementada nenhuma "re-autorização automática" (§40 —
proibido explicitamente).

## 223. Response lost

Inalterado — a idempotência já existente de `repository.createOrReuse`
(Fase 4) cobre esse caso: um retry (com ou sem novo material Apple)
encontra o record já existente e retorna `deduplicated: true` com o mesmo
`deletionId`, sem recriar nada.

## 224. App killed after commit

Comprovado por teste dedicado contra os Emuladores REAIS (§225) — não
inferido.

## 225. Account Access Lock

Inalterado — `lockAccountAccess` (Fase 5) continua exatamente como estava,
chamado na mesma posição (primeira etapa obrigatória), nenhuma linha
tocada.

## 226. Provider Revocation — resultado backend-only após commit

Comprovado: `PROVIDER_REVOCATION` (ambos sub-steps) alcança um estado
terminal legítimo — Apple via `revokeAppleProvider` consumindo material
cacheado, Google via `SKIPPED_BY_POLICY` automático (provider já não
aparece no snapshot) — sem NENHUMA chamada a função client-side depois do
commit.

## 227. Matriz dos 8 steps

| Step | Executor | Client needed after commit? | Idempotente | Testado | Blocker |
|---|---|---:|---:|---:|---:|
| `ACCOUNT_ACCESS_LOCK` | Sim (Fase 5) | **NÃO** | Sim | Sim | Não |
| `PROVIDER_REVOCATION` | Sim (Fase 3, corrigido nesta fase) | **NÃO** (corrigido) | Sim | Sim | **Não — corrigido** |
| `VAULT_KEY_DESTRUCTION` | Sim (Fase 12.5) | **NÃO** | Sim | Sim | Não |
| `FIRESTORE_CLEANUP` | Sim (Fase 6) | **NÃO** | Sim | Sim | Não |
| `STORAGE_CLEANUP` | Sim (Fase 7) | **NÃO** | Sim | Sim | Não |
| `RETAINED_DATA_PROCESSING` | Sim (Fase 8) | **NÃO** | Sim | Sim | Não |
| `REVENUECAT_PROCESSING` | Sim (Fase 9) | **NÃO** | Sim | Sim | Não |
| `AUTH_DELETION` | Sim (Fase 10) | **NÃO** | Sim | Sim | Não |

Toda a coluna "Client needed after commit?" é `NÃO`.

## 228. Teste de autossuficiência backend

`functions/src/accountDeletion/__tests__/backendAutonomy.integration.test.ts`
(opt-in, `BACKEND_AUTONOMY_INTEGRATION=1`, `npm run
test:integration:backendAutonomy`, Auth+Firestore+Storage Emulators reais,
projeto descartável `ajfit-rules-test`). Prepara Apple (exchange fake HTTP,
nunca uma chamada Apple real) + modela Google já revogado/unlinked antes do
commit, então caminha `ACCOUNT_ACCESS_LOCK → PROVIDER_REVOCATION →
VAULT_KEY_DESTRUCTION → FIRESTORE_CLEANUP → STORAGE_CLEANUP →
RETAINED_DATA_PROCESSING → REVENUECAT_PROCESSING → AUTH_DELETION`
invocando cada executor REAL diretamente (nenhum worker construído — Fase
14), sem NENHUMA chamada client-side depois do "commit". **1/1 passando**,
provando: Auth user apagado de verdade, vault apagado de verdade, material
Apple cacheado E limpo automaticamente ao suceder, `nextRunnableStep`
retorna `null` no final (toda etapa obrigatória concluída).

## 229. Arquivos criados/alterados

**Backend**: `functions/src/accountDeletion/providerRevocation/appleIdentityConfig.ts`
(novo — secrets + factory real); `.../appleRevocationPreparation.ts` (novo
— exchange pré-commit + cache pós-commit); `.../index.ts` (+2 exports);
`functions/src/accountDeletion/requestContract.ts` (contrato estendido com
`appleAuthorizationCode` opcional, validado); `functions/src/accountDeletion/requestAccountDeletion.ts`
(gate Apple pré-commit + cache pós-commit + secrets bound); `functions/src/accountDeletion/__tests__/requestAccountDeletion.test.ts`
(+9 testes); `.../providerRevocation/__tests__/appleRevocationPreparation.test.ts`
(novo, 8 testes); `functions/src/accountDeletion/__tests__/backendAutonomy.integration.test.ts`
(novo, 1 teste, Emulator real); `package.json` (`test:integration:backendAutonomy`).

**Client**: `src/services/accountDeletionProviderRevocation.ts`
(`revokeGoogleProviderAccess` agora também chama `unlink`, novo status
`revoked-unlink-failed`, doc comments corrigidos); `src/services/accountDeletionOrchestrator.ts`
(novo — o commit boundary real); `src/services/__tests__/accountDeletionProviderRevocation.test.ts`
(+4 testes); `src/services/__tests__/accountDeletionOrchestrator.test.ts`
(novo, 15 testes); `src/units/unitsStorage.ts` — não relacionado a esta
correção (residual da sessão anterior).

## 230. Testes adicionados

Total novo: 9 (requestAccountDeletion) + 8 (appleRevocationPreparation) + 1
(backendAutonomy, Emulator real) no backend; 4 (accountDeletionProviderRevocation)
+ 15 (accountDeletionOrchestrator) no client. **37 testes novos**, todos
passando.

## 231. Regressão completa

Reexecutada do zero por mim: root typecheck limpo, 2754/2754; `functions`
typecheck limpo, 1090/1090; rules 309/309; seis integrações via Emulator
real: Firestore Cleanup 2/2, Storage Cleanup 3/3, Retained Data 2/2, Auth
Deletion 4/4, Vault Key Destruction 4/4, **Backend Autonomy 1/1 (novo)**.
Nenhum teste externo Apple/Google real foi executado — nem poderia, sem
credenciais reais do Apple Developer Portal/Google Cloud Console
provisionadas, o que é explicitamente fora do escopo desta correção
(infraestrutura externa, não código).

## 232. Produção

```text
Deploy: NÃO
Firebase produção: NÃO ALTERADO
Auth real: NÃO ALTERADO
Apple real: NÃO ALTERADO (nenhuma chamada de rede real feita em teste algum)
Google real: NÃO ALTERADO
RevenueCat real: NÃO ALTERADO
Assinaturas: NÃO ALTERADAS
Vault real: NÃO ALTERADO
```

## 233. Blocker check

**NÃO.** Nenhum blocker estrutural conhecido das Fases 1–11/12.5 impede
iniciar a Fase 12. O único blocker que existia (`PROVIDER_REVOCATION` sem
orquestração de captura de material) foi corrigido e provado nesta
correção.

## 234. Backend autonomy check

**NÃO.** Depois que `requestAccountDeletion` é aceita, nenhum step
obrigatório depende do cliente — comprovado por `backendAutonomy.integration.test.ts`
contra os Emuladores reais (§228).

## 235. Readiness Fase 12

**FASE 12 PODE COMEÇAR — SIM.** Toda a cadeia de 8 steps tem executor real,
idempotente, testado, e comprovadamente independente do cliente após o
commit. A Fase 12 (UI) pode agora ser construída sabendo que
`requestAccountDeletionWithProviderPreparation()` (o commit boundary) é a
única função que uma tela de exclusão de conta precisa chamar.

## 236. Veredito

**CORREÇÕES DAS FASES 3/5 — APROVADAS COM PENDÊNCIA DE E2E EXTERNO** — a
lógica está completa, testada unitariamente e contra Emuladores reais
(Auth+Firestore+Storage), mas nenhum teste contra a API real da Apple ou do
Google foi (ou poderia ter sido) executado nesta correção — isso requer
credenciais reais provisionadas por um humano (Apple Developer Portal
Services ID/Team ID/private key via Secret Manager) antes de um primeiro
deploy real, permanecendo como pendência explícita de E2E externo, não
como um blocker de arquitetura.

# Fase 12 — UI/UX final

## 237. Auditoria UI existente

`SettingsScreen.tsx`/`SecurityScreen.tsx` já tinham um item "Excluir conta"
(`icon:'trash', danger:true, onPress: () => {}`) — stub puro, nunca
conectado. `AppShell.tsx` usa um roteador custom (não React Navigation):
flags `useState` booleanas + `<PersistentScreen>` (docs/23), prewarm
centralizado em `lib/prewarmRoutes.ts`. `ChangePasswordScreen.tsx`/
`TwoFactorSettingsScreen.tsx` (par hook+screen: `useChangePassword`/
`useTotpMfa`) são o padrão estabelecido para fluxos sensíveis — reutilizado
integralmente. `accountDeletionReauth.ts` (Fase 2), `accountDeletionOrchestrator.ts`
(correção Fases 3/5) e `accountDeletionShutdown.ts` (Fase 5/11) já existiam
completos e testados — a Fase 12 é inteiramente wiring, nenhuma
reimplementação.

## 238. Fluxo final implementado

Um único componente, `DeleteAccountScreen.tsx`, com estado dirigido por
`flow.step` (`'intro' → 'reauth' → 'confirm' → 'submitting'`) — não quatro
telas separadas. Toda a lógica vive em `useAccountDeletionFlow.ts` (mirror
exato do padrão `useChangePassword`/`useTotpMfa`), que compõe:
`needsAccountDeletionReauthentication`/`startAccountDeletionReauthentication`/
`finishAccountDeletionReauthentication` (Fase 2) →
`requestAccountDeletionWithProviderPreparation` (correção Fases 3/5,
**única** chamada ao callable em todo o app) →
`finalizeAccountDeletionClientShutdown` (Fase 5/11).

## 239. Settings/Security

Ambos os pontos de entrada agora abrem a MESMA tela — `onOpenDeleteAccount`
adicionado a `SettingsScreen`/`SecurityScreen`, ambos apontando para
`setShowDeleteAccount(true)` em `AppShell.tsx`. Nenhuma implementação
paralela.

## 240. Assinatura

Tela intro mostra aviso destacado ("Excluir sua conta não cancela sua
assinatura") + explicação de que a assinatura da loja continua até
cancelamento manual. CTA "Continuar com exclusão" NUNCA é desabilitado por
`isPremium`/estado de assinatura (testado estruturalmente) — Fase 0/12 §9
("nunca bloquear exclusão por causa da assinatura") preservado.

## 241. Manage Subscription

Reutiliza `manageSubscription({store, managementURL})` de
`useSubscription()` (mesma função que `SubscriptionCenterScreen` já usa) —
`store`/`managementURL` derivados de `customerInfo.entitlements.active[premium]`/
`customerInfo.managementURL`, sem reimplementar `resolveSubscriptionCenterModel`.
Nenhuma URL inventada, nenhum cancelamento implementado.

## 242. Reautenticação

Reutiliza `ReauthenticationMethods` (componente já existente,
`components/auth/`) para password/Google/Apple, e o mesmo par de strings
`security.twoFactor.reauth.*` (mesma ação semântica — confirmar
identidade). MFA/TOTP challenge reutiliza `finishAccountDeletionReauthentication`
(Fase 2) com um `TextInput` de código no mesmo padrão visual de
`TwoFactorSettingsScreen`. Bug real encontrado e corrigido durante a
implementação: o toggle de visibilidade da senha estava inicialmente
cabeado como um no-op (`passwordVisible={false}`,
`onTogglePassword={() => {}}`) — corrigido com `useState` local na tela
(não sensível por si só, mesmo padrão de `ChangePasswordScreen`), e coberto
por teste estrutural dedicado para não regredir.

## 243. Apple/Google orchestration

A tela NUNCA importa `accountDeletionOrchestrator.ts`/
`accountDeletionReauth.ts`/`accountDeletionShutdown.ts` diretamente
(confirmado por teste estrutural) — tudo passa por `useAccountDeletionFlow`.
Nenhuma manipulação direta de `authorizationCode`/tokens na UI.

## 244. Confirmação final

Etapa `'confirm'` — resumo de 4 bullets (conta encerrada, dados definidos
para exclusão removidos, alguns registros podem ser retidos, assinatura não
cancelada automaticamente) + botão destrutivo "Excluir minha conta"
(tratamento visual `dangerText`, mesmo padrão do botão "Desativar" de
`TwoFactorSettingsScreen`, já que `CtaButton` não tem variante destrutiva
própria — não alterado só para isto).

## 245. Loading/double tap

`operationLock` (ref) em `useAccountDeletionFlow`, mesmo padrão de
`useChangePassword`/`useTotpMfa` — `confirmDeletion`/`submitReauth`/
`submitMfaCode` todos guardados. Testado estruturalmente (não há renderer
de componente neste projeto — ver §248). Etapa `'submitting'` mostra
"Encerrando sua conta..." (nunca promete conclusão instantânea de todos os
dados).

## 246. Background/foreground

Não coberto por um teste automatizado dedicado — a base já é sólida sem
mudança nova: `PersistentScreen`/`inactiveMode="materialized"` (mesmo
mecanismo que já protege `ChangePasswordScreen`/`TwoFactorSettingsScreen`
contra qualquer perda de estado em background real de app RN, que nunca
desmonta o componente) + estado sensível vive em `useState` (sobrevive a
background, é limpo por `useScreenFocusEffect` apenas na DESATIVAÇÃO da
tela, não no backgrounding do app). App killed → relançamento passa pelo
bootstrap normal do `AuthContext`; se `ACCOUNT_ACCESS_LOCK` já rodou, o
usuário volta para `AuthScreen` via o gate declarativo já existente (Fase
5/11) — nada específico desta tela a proteger além disso.

## 247. Network loss/response lost

`accountDeletionOrchestrator.test.ts` já prova (correção Fases 3/5):
`deduplicated:true` é repassado fielmente; a UI trata `'accepted'`
identicamente independente de `deduplicated`. `requiresReconciliation:true`
agora também propagado (novo nesta fase) e exibido como aviso
(`reconciliationRequired`) sem impedir o shutdown local.

## 248. Client shutdown

`finalizeAccountDeletionClientShutdown(uid, logout)` chamado exatamente uma
vez, só após `status === 'accepted'`, com falha local capturada
(`.catch()`) e nunca propagada — backend permanece autoridade (Fase 5 §63).
Nenhuma segunda rotina de limpeza criada.

## 249. Logout/navigation

Reutiliza o gate declarativo já existente (`user === null` → `App.tsx` →
`AuthScreen`, Fase 5/11) — nenhum stack de navegação paralelo. Header back
desabilitado (`disabled={!backAllowed}`) durante `submitting`/após aceite —
testado estruturalmente.

## 250. Copy PT-BR / EN / ES

19 chaves novas × 3 idiomas em `security.deleteAccountFlow.*` (`settings.json`),
incluindo mapeamento completo de todos os `AccountDeletionFlowIssue`
(reauth + orchestrator). `npm run i18n:audit`: **0 blocking issues**, nenhum
hardcode novo introduzido (os 9 hardcodes suspeitos reportados são
pré-existentes em `PaywallScreen.tsx`, não tocados nesta fase).

## 251. Acessibilidade

`accessibilityRole="button"`/`"alert"` consistentes com o resto do app;
labels/hints reaproveitados dos componentes existentes
(`PasswordField`/`ReauthenticationMethods`/campo de código MFA). **Não foi
possível fazer uma revisão manual em dispositivo/simulador real** — nenhum
ambiente de execução visual estava disponível nesta sessão; a revisão desta
fase se limitou a garantias estruturais (fonte) e reuso comprovado de
componentes já auditados em fases anteriores.

## 252. Dark/light

Nenhuma cor hardcoded fora dos tokens (`colors.*`) e dos overlays `rgba(...)`
já usados no mesmo padrão por `TwoFactorSettingsScreen` — tema-aware por
construção, não testado visualmente pelo mesmo motivo do §251.

## 253. Arquivos alterados

**Novo**: `src/hooks/useAccountDeletionFlow.ts`,
`src/screens/DeleteAccountScreen.tsx`,
`src/hooks/__tests__/useAccountDeletionFlow.test.ts` (19 testes),
`src/screens/__tests__/deleteAccountScreenStructure.test.ts` (9 testes).
**Alterado**: `src/screens/SettingsScreen.tsx`/`SecurityScreen.tsx`
(+`onOpenDeleteAccount`), `src/screens/AppShell.tsx` (+state, +import,
+`PersistentScreen` block), `src/lib/prewarmRoutes.ts` (+`DELETE_ACCOUNT`),
`src/services/accountDeletionOrchestrator.ts` (+`requiresReconciliation`),
`src/i18n/resources/{pt-BR,en,es}/settings.json`,
`src/screens/__tests__/appShellNavigationStructure.test.ts` (+1 flag),
`src/services/__tests__/accountDeletionOrchestrator.test.ts` (+1 teste).

## 254. Testes adicionados

28 novos (19 hook + 9 screen), todos estruturais (fonte) — este projeto não
tem renderer de componente (`environment: 'node'`, sem
`@testing-library/react-native`), confirmado pelo padrão já estabelecido em
`usePremiumCapabilities.test.ts`/`useTotpMfaLoadingStructure.test.ts`/
`appShellNavigationStructure.test.ts`. +1 no orchestrator
(`requiresReconciliation`).

## 255. Revisão visual

**Não realizada com renderização real** — sem simulador/dispositivo
disponível nesta sessão. Reportado explicitamente, não fingido: espaçamento/
hierarquia/legibilidade/small devices/keyboard precisam de uma passada
manual antes de considerar a UI pronta para produção, apesar da lógica e
estrutura estarem comprovadamente corretas.

## 256. Regressões

root: typecheck limpo, 2783/2783; `functions`: inalterado, 1090/1090 (Fase
12 é client-only); i18n audit: 0 blocking issues.

## 257. Alterações externas

```text
Deploy: NÃO
Produção: NÃO ALTERADA
```

## 258. Veredito

**FASE 12 — APROVADA**, com a ressalva explícita do §251/§255: revisão
visual/acessibilidade em dispositivo real não foi possível nesta sessão e
permanece pendente antes de produção.

# Fase 13 — Testes automatizados de falha parcial

## 259. Harness de fault injection

`functions/src/accountDeletion/__tests__/faultInjectionHarness.ts`
(test-only, nunca importado por código de produção): `createHarness`,
`runnableStep` (delega a `nextRunnableStep` real), `applyStepOutcome`/
`applyProviderSubStepOutcome` (delegam a `beginStepAttempt`/
`completeStepAttempt` reais). Nenhum scheduler/worker construído — cada
teste invoca o executor real diretamente.

## 260. Cenário A / A1

`faultInjection.test.ts` — `ACCOUNT_ACCESS_LOCK` com sucesso total avança
para `PROVIDER_REVOCATION`; disable-succeeds-revoke-fails-transiently
bloqueia, e um retry reaplica `updateUser` com segurança (idempotente) e
completa. **2/2 passando.**

## 261. Cenário B / C (Firestore/Storage parcial)

Não re-derivados aqui — já exaustivamente cobertos em
`firestoreCleanup/__tests__/engine.test.ts` e
`storageCleanup/__tests__/engine.test.ts` (Fases 6/7), incluindo escala
(400+ documentos, 850+ objetos) e falha parcial + retry. Referenciados, não
duplicados.

## 262. Cenário D (RevenueCat)

Policy v1 = SKIP → zero I/O, já provado estruturalmente em
`revenueCatProcessing/__tests__/engine.test.ts` (Fase 9) — indisponibilidade
do RevenueCat é estruturalmente impossível de afetar o executor atual, pois
ele nunca chama a API. Não re-derivado.

## 263. Cenário E / E1 (Apple)

`faultInjection.test.ts` — falha retryable bloqueia
`PROVIDER_REVOCATION` (nunca avança para `VAULT_KEY_DESTRUCTION`), material
cacheado sobrevive à falha, retry reusa o cache sem re-exchange, sucesso
avança a cadeia. Falha genuinamente terminal (`PROVIDER_AUTHORIZATION_INVALID`,
sem material e sem código): `FAILED_TERMINAL`, `VAULT_KEY_DESTRUCTION`
comprovadamente nunca roda. **2/2 passando.**

## 264. Cenário F (duplicate callable)

`faultInjection.integration.test.ts` — **Firestore Emulator real**, fecha
um gap que o próprio `repository.test.ts` já documentava ("Firestore
Emulator/production integration is still a separate, unaddressed
concern"). Três chamadas `createOrReuse` concorrentes para o mesmo uid
convergem em exatamente um `deletionId`/uma criação real; retry após
resposta perdida retorna o MESMO `deletionId`; dois uids diferentes
concorrentes nunca interferem. **3/3 passando, real transaction do
Firestore, não simulação.**

## 265. Cenário G

Achado honesto documentado (não uma correção): `ACCOUNT_ACCESS_LOCK`
desabilita o Auth user mas não o apaga, e `validFirebaseUserExists` checa
apenas EXISTÊNCIA — um webhook tardio no meio do workflow (antes de
`FIRESTORE_CLEANUP`) poderia teoricamente escrever em
`users/{uid}.subscription`. Isso é inofensivo por design: `FIRESTORE_CLEANUP`
remove o documento INTEIRO, não campo a campo — provado com
`deleteUserProfileDocument` diretamente. O fail-closed forte (identidade
nunca resolve) só é garantido a partir de `AUTH_DELETION`, já coberto por
`accountDeletionLateWebhook.test.ts` e `backendAutonomy.integration.test.ts`.

## 266. Cenário H (app killed)

Já integralmente provado por `backendAutonomy.integration.test.ts`
(correção Fases 3/5) — não duplicado aqui.

## 267. Vault faults

Idempotência/retry já exaustivamente cobertos por
`vaultKeyDestruction.test.ts` (11 testes) + `.integration.test.ts` (4
testes, Emulator real, incluindo composição com Firestore Cleanup).

## 268. Auth deletion faults

`faultInjection.test.ts` — cenário específico "deleteUser succeeds,
persistence write fails, retry": segundo `deleteUser` retorna
`auth/user-not-found` → `ALREADY_DELETED` → resolve para `SUCCEEDED` via
harness. Nenhuma recriação, nenhum dado destrutivo repetido. **1/1
passando.**

## 269. Persistence-after-side-effect faults

Coberto pelo mesmo princípio em `authDeletion.test.ts`/
`vaultKeyDestruction.test.ts`/`accountAccessLock.test.ts` (idempotência já
testada por construção — o "efeito colateral" é sempre idempotente, então
uma falha de persistência isolada sempre converge em um retry).

## 270. Retry budget

`faultInjection.test.ts` — falhas `RETRYABLE` repetidas até o orçamento
(`policy.retry.maxAttempts`) esgotar → `FAILED_TERMINAL`/`RETRY_BUDGET_EXHAUSTED`,
nunca loop infinito; backoff exponencial comprovado com clock controlado
(nunca espera real). **2/2 passando.**

## 271. Revisão/concorrência

`faultInjection.test.ts` — `compareAndSet` com revision desatualizada é
rejeitado (`REVISION_MISMATCH`), nunca regride progresso já aplicado por
outro worker. **1/1 passando.**

## 272. Frozen policy

`faultInjection.test.ts` — a policy do harness é a MESMA referência de
objeto durante toda a vida do teste, nunca re-derivada de `currentPolicy()`;
comparação explícita contra uma "v2" hipotética prova que não haveria
confusão possível. Complementa os testes de policy versioning já existentes
em `retainedDataProcessing`/`revenueCatProcessing` (Fases 8/9). **1/1
passando.**

## 273. Outro UID

Coberto exaustivamente a nível de engine em todas as fases anteriores
(Fases 6/7/8/9/10/12.5, cada uma com prova via Emulator real). Não
re-derivado a nível de workflow completo nesta fase — decisão deliberada
para não duplicar prova já sólida, documentada aqui em vez de fabricada de
novo.

## 274. Matriz consolidada

| Cenário | Ponto da falha | Estado após falha | Retry? | Estado final |
|---|---|---|---|---|
| A | `ACCOUNT_ACCESS_LOCK` completo | `SUCCEEDED` | N/A | Avança para `PROVIDER_REVOCATION` |
| A1 | `revokeRefreshTokens` transiente | `FAILED_RETRYABLE` | Sim | `SUCCEEDED`, `updateUser` reaplicado com segurança |
| B | Firestore parcial (Fase 6) | `FAILED_RETRYABLE` | Sim | `SUCCEEDED`, sem duplicar/pular documentos |
| C | Storage parcial (Fase 7) | `FAILED_RETRYABLE` | Sim | `SUCCEEDED`, sem duplicar/pular objetos |
| D | RevenueCat (policy SKIP) | N/A — zero I/O | N/A | `SKIPPED_BY_POLICY` sempre |
| E | Apple revoke transiente | `NOT_DONE` (sub-step retryable) | Sim | `SUCCEEDED`, material cacheado reusado |
| E1 | Apple revoke terminal | `FAILED_TERMINAL` | Não | Bloqueado antes de `VAULT_KEY_DESTRUCTION`, para sempre |
| F | Callable duplicada | N/A | N/A | Um único `deletionId`, real Firestore transaction |
| G | Webhook mid-workflow | Escrita transitória possível | N/A | Removida por inteiro no `FIRESTORE_CLEANUP` |
| H | App killed pós-commit | N/A | N/A | Cadeia completa sem cliente (Emulator real) |

## 275. Arquivos criados/alterados

`functions/src/accountDeletion/__tests__/faultInjectionHarness.ts` (novo);
`functions/src/accountDeletion/__tests__/faultInjection.test.ts` (novo, 10
testes); `functions/src/accountDeletion/__tests__/faultInjection.integration.test.ts`
(novo, 3 testes, Emulator real); `package.json`
(`test:integration:faultInjection`).

## 276. Testes adicionados

13 novos (10 unitários + 3 Emulator real).

## 277. Emulator integration

`test:integration:faultInjection`: 3/3, provando pela primeira vez com
transação REAL do Firestore (não uma fake, por mais fiel que fosse) a
convergência de `requestAccountDeletion` duplicado — gap explicitamente
deixado aberto pela Fase 4.

## 278. Regressão completa

Reexecutada do zero: root typecheck limpo, 2783/2783; `functions` typecheck
limpo, 1100/1100 (+10); rules 309/309; sete integrações via Emulator real:
Firestore Cleanup 2/2, Storage Cleanup 3/3, Retained Data 2/2, Auth
Deletion 4/4, Vault Key Destruction 4/4, Backend Autonomy 1/1, **Fault
Injection 3/3 (novo)**.

## 279. Alterações externas

```text
Deploy: NÃO
Firebase produção: NÃO ALTERADO
Auth real: NÃO ALTERADO
Apple real: NÃO ALTERADO
Google real: NÃO ALTERADO
RevenueCat real: NÃO ALTERADO
Assinaturas: NÃO ALTERADAS
```

## 280. Correção manual silenciosa

**NÃO.** Todo cenário testado converge para um estado conhecido
(`SUCCEEDED`/`FAILED_TERMINAL`/`REVISION_MISMATCH`) via os mecanismos já
existentes (idempotência, retry budget, CAS) — nenhum cenário encontrado
exige edição manual do Firestore para sair de um estado travado
silenciosamente. `FAILED_TERMINAL`/`requiresReconciliation` já são a
representação explícita para os casos que genuinamente precisam de
intervenção humana (Fase 4, inalterado).

## 281. Readiness Fase 14

**SIM**, com a mesma ressalva já registrada na correção Fases 3/5: contas
sem Apple/Google linkado já podem percorrer a cadeia inteira legitimamente
hoje; contas COM Apple/Google linkado dependem da preparação client-side
(agora implementada e testada na Fase 12/correção Fases 3/5) acontecer
antes do commit — o que já é o caso via `accountDeletionOrchestrator.ts`.

## 282. Blockers

Nenhum blocker estrutural novo encontrado nesta fase.

## 283. Veredito

**FASE 13 — APROVADA.**

# Relatório consolidado — Fases 12 e 13

## 284. Status

```text
FASE 12 — APROVADA
FASE 13 — APROVADA
```

## 285. Cadeia atual

```text
UI (DeleteAccountScreen + useAccountDeletionFlow)
↓
interactive preparation (reauth Fase 2, Google/Apple correção Fases 3/5)
↓
requestAccountDeletion (commit boundary)
↓
backend-owned workflow (accountDeletions/{deletionId}, real Firestore transaction, Emulator-proven)
↓
fault-tolerant executors (8 steps, todos idempotentes, todos testados contra Emulator real onde aplicável)
```

## 286. Próximo passo

```text
Próxima fase do plano original:
FASE 14 — Worker de reconciliação
```

## 287. Produção

```text
Nenhum deploy foi realizado em nenhuma fase.
Nenhuma conta Apple/Google/RevenueCat real foi alterada.
Nenhuma assinatura foi cancelada.
Nenhum Firebase de produção foi tocado.
```

## 288. Veredito consolidado

**FASES 12 E 13 — APROVADAS**, com a única ressalva explícita do §251/§255
(revisão visual/acessibilidade em dispositivo real, pendente antes de
produção — não um blocker de arquitetura ou lógica).

# Fase 14 — Worker de reconciliação

## 289. Auditoria inicial

`functions/src/accountDeletion/repository.ts` (Fase 4, já aprovado) só
expõe `createOrReuse` — nenhuma função de leitura por id, consulta de
candidatos ou atualização protegida por CAS existia. `concurrency.ts`
(Fase 1) já definia `compareAndSet`/`AccountDeletionLease`/
`lockDocumentAfterStatusChange`, mas `lockDocumentAfterStatusChange` nunca
tinha um chamador real em produção — confirmado via busca no repositório
inteiro antes de qualquer código ser escrito. Nenhuma máquina de estados,
executor ou lógica de retry precisou ser recriada: todas as 8 fases
anteriores já forneciam tudo que o worker precisa consumir.

## 290. Arquitetura do worker

```text
Cloud Scheduler (a cada 15 min, Etc/UTC)
  ↓
cleanupPendingAccountDeletions (onSchedule)
  ↓
runReconciliationBatch (scheduler.ts)
  — queryReconciliationCandidates (bounded, sem full scan)
  — bounded concurrency (5 em paralelo, nunca Promise.all irrestrito)
  — try/catch por registro (um registro quebrado nunca aborta o lote)
  ↓
processAccountDeletionRecord (processRecord.ts) — por deletionId
  — readAccountDeletionRecord → valida terminal/due
  — tryAcquireReconciliationLease (curto prazo, ../concurrency.ts)
  — nextRunnableStep (../steps.ts, reutilizado sem alteração)
  — dispatcher.ts → executor exato já existente (Fases 5-10, 12.5)
  — beginStepAttempt/completeStepAttempt/transitionGlobal (reutilizados)
  — persistAccountDeletionRecordChange (CAS via compareAndSet real, 1 write = 1 checkpoint)
  — até DEFAULT_MAX_STEPS_PER_INVOCATION passos por chamada
```

Novos arquivos (todos em `functions/src/accountDeletion/reconciliation/`):
`recordAccess.ts` (leitura/consulta/CAS/lease reais contra Firestore),
`dispatcher.ts` (mapa nome-do-passo → executor existente),
`processRecord.ts` (`processAccountDeletionRecord`, a abstração central
pedida), `scheduler.ts` (`cleanupPendingAccountDeletions` +
`runReconciliationBatch`), `index.ts` (barrel).

## 291. Scheduler — nome, frequência, justificativa

Nome: `cleanupPendingAccountDeletions` (mantido literal, conforme
sugestão). Frequência: `every 15 minutes`, fuso `Etc/UTC` explícito (nunca
o fuso local do desenvolvedor). Justificativa: o acesso do usuário já é
bloqueado imediatamente (`ACCOUNT_ACCESS_LOCK`, normalmente executado no
próprio fluxo de `requestAccountDeletion`); o restante do hard-delete pode
ser eventual sem custo de UX. 15 minutos evita 96x mais invocações que um
schedule por minuto para uma tabela normalmente quase vazia, e é
suficiente para não atrapalhar o backoff exponencial já existente
(`policy.ts`: 30s a 6h). `timeoutSeconds: 300` é explícito (a duração
escala com o lote, diferente de um callable comum); `memory` foi deixado
no padrão da plataforma — nada neste código justifica mais.

## 292. Consulta de candidatos e índices

`queryReconciliationCandidates` usa `where('status','in',[REQUESTED,
PROCESSING, RETRY_SCHEDULED]).limit(n)` — uma consulta de campo único, que
o Firestore já indexa automaticamente por padrão. **Nenhum índice
composto foi adicionado** a `firestore.indexes.json` — testado contra o
Emulador real neste mesmo lote de testes. `COMPLETED`/`FAILED_TERMINAL`
são excluídos NA PRÓPRIA CONSULTA, nunca filtrados depois de ler — um
registro terminal nunca é sequer lido pelo worker num tick normal.
Filtragem de `nextAttemptAt` (aninhado por passo, não é campo top-level)
acontece em memória via `isRecordDueNow`/`effectiveNextAttemptAt`, que
reutiliza `nextRunnableStep` e `retry.ts`'s `isRetryDue` — nenhuma segunda
lógica de backoff foi criada.

## 293. Batch size e justificativa

`RECONCILIATION_BATCH_SIZE = 25`, `RECONCILIATION_CONCURRENCY = 5`.
Dimensionado para caber confortavelmente em `timeoutSeconds: 300` mesmo
sob latência do Apple, ficando muito abaixo de limites de taxa do Admin
SDK. Um volume maior que 25 registros não-terminais simultâneos não é
esperado na escala atual do app; se ocorrer, o PRÓXIMO tick (15 min
depois) continua o restante — nenhum registro é perdido, apenas adiado.

## 294. Estratégia de concorrência

`runReconciliationBatch` usa um pool de `N` workers (`Promise.all` de
funções que consomem um índice compartilhado) limitado a
`RECONCILIATION_CONCURRENCY` — nunca `Promise.all` irrestrito sobre o
lote inteiro. Cada registro é protegido individualmente por
`try/catch`: um registro quebrado incrementa `errors` e o loop continua
para o próximo candidato, nunca aborta o lote (provado em
`scheduler.test.ts`).

## 295. Ciclo de vida do lease

`tryAcquireReconciliationLease` (nova, `recordAccess.ts`) é a PRIMEIRA
chamada real de `acquireLease`/`canAcquireLease`/`isLeaseOwnedBy`
(`concurrency.ts`, Fase 1 — definidas mas nunca usadas em produção até
agora). Duração padrão: 5 minutos (`DEFAULT_LEASE_DURATION_MS`),
dimensionada acima do pior caso de uma chamada de rede Apple isolada. O
worker adquire o lease, executa EXATAMENTE um passo, persiste o
resultado com `lease: null` (libera na MESMA escrita/checkpoint) — nunca
segura o lease por múltiplos passos "em memória".

## 296. CAS/revision — proteção contra worker obsoleto

`persistAccountDeletionRecordChange` envolve `compareAndSet`
(`concurrency.ts`, puro, inalterado) numa transação real do Firestore. Um
worker cujo lease expirou e que tenta persistir depois que outro worker já
avançou a `revision` tem sua escrita REJEITADA (`{ok:false}`), nunca
sobrescreve. Provado tanto em unidade (`processRecord.test.ts`, cenário
"stale worker protection") quanto em integração real
(`accountDeletionReconciliation.integration.test.ts`, "lease handoff").

## 297. Comportamento por status

- `REQUESTED` abandonado: sempre due, sempre processável — nunca esperado
  a nenhum timer.
- `PROCESSING` travado: idem — sem lease ativo, é imediatamente
  reprocessável.
- `RETRY_SCHEDULED`: só processado quando `effectiveNextAttemptAt <= now`
  (`isRecordDueNow`), reutilizando `isRetryDue` (Fase 1) sem
  reimplementação.
- `COMPLETED`/`FAILED_TERMINAL`: excluídos da consulta; se por qualquer
  motivo `processAccountDeletionRecord` for chamado diretamente com um id
  terminal, retorna `ALREADY_TERMINAL` sem tocar em nada — nunca
  reprocessa, nunca reativa, nunca converte `FAILED_TERMINAL` em retry.

## 298. Dispatcher — mapeamento, não reimplementação

`dispatcher.ts`'s `runTopLevelStep`/`runProviderSubStep` só fazem *routing*
para o executor exato de cada fase (`lockAccountAccess`,
`executeVaultKeyDestruction`, `runFirestoreCleanup`, `runStorageCleanup`,
`runRetainedDataProcessing`, `runRevenueCatProcessing`,
`executeAuthDeletion`, `revokeAppleProvider`) — zero lógica de negócio
própria, confirmado por `dispatcher.test.ts` (mocka cada executor e prova
que os argumentos passados são exatamente `uid`/`policy.retention`
congelados do registro).

## 299. Checkpoints

Cada passo (top-level ou sub-passo de provider) é sua PRÓPRIA transação de
persistência — nunca todo o workflow guardado em memória e persistido só
no fim. `beginStepAttempt`/`completeStepAttempt` só existem em memória
durante a chamada síncrona ao executor; um crash entre o início e o fim de
um passo nunca deixa `RUNNING` persistido (que seria um beco sem saída na
máquina de estados) — o próximo tick simplesmente re-tenta o mesmo passo
do zero, seguro porque todo executor já é idempotente.

## 300. Retry/backoff — reutilização confirmada

Nenhuma segunda função de backoff foi criada. `computeRetryDecision`
(Fase 1, `retry.ts`) é chamado exclusivamente dentro de
`completeStepAttempt` (também reutilizado, não duplicado). O worker só
lê `nextAttemptAt` já calculado — nunca recalcula.

## 301. Budget de retry esgotado

Comportamento herdado sem alteração: `completeStepAttempt` já escalona
para `FAILED_TERMINAL` com `RETRY_BUDGET_EXHAUSTED` quando o budget
acaba — o worker simplesmente persiste esse resultado como qualquer
outro; nenhuma lógica adicional de "tentar mais uma vez" foi criada em
cima disso.

## 302. Material Apple — ciclo de vida e segurança

O worker nunca tem `authorizationCode` fresco — sempre `null`, consumindo
apenas o material cacheado em `accountDeletions/{deletionId}/
privateSecurity/appleProviderRevocation` no momento do commit (Fase 3/5).
Os 4 segredos Apple (`APPLE_TEAM_ID` etc.) são lidos via
`REQUEST_ACCOUNT_DELETION_SECRETS`/`defineSecret` (Secret Manager),
reexportados de `requestAccountDeletion.ts` e vinculados ao
`cleanupPendingAccountDeletions` — nunca copiados para um documento,
log ou variável de ambiente própria.

## 303. Google — sem executor backend (confirmado, não contornado)

`runProviderSubStep('google.com', ...)` retorna
`{kind:'FAILED', code:'MISSING_REQUIRED_CONFIGURATION'}` (terminal) sem
qualquer chamada de rede — decisão arquitetural da Fase 3, reafirmada
aqui: não existe endpoint backend de revogação Google neste código
(`providerRevocation/googleProviderRevocation.ts`). Se um registro chegar
ao worker com Google ainda vinculado (cliente não desvinculou antes do
commit), o worker falha SEGURO e observável (`FAILED_TERMINAL`) em vez de
travar ou inventar uma chamada. Isso é uma limitação pré-existente
exposta pela Fase 14, não criada por ela — documentada, não contornada.

## 304. VAULT_KEY_DESTRUCTION — confirmação

`dispatcher.ts` chama `executeVaultKeyDestruction(uid)` inalterado —
nenhum parâmetro de KMS é passado, a KEK compartilhada nunca é referenciada
pelo worker.

## 305. Política congelada — confirmação

`runTopLevelStep('RETAINED_DATA_PROCESSING', record)` e
`runTopLevelStep('REVENUECAT_PROCESSING', record)` usam exclusivamente
`record.policy.retention` (o snapshot congelado no `AccountDeletionRecord`
lido do Firestore) — `currentPolicy()` nunca é chamado em nenhum lugar de
`reconciliation/`. Confirmado por teste de unidade explícito em
`dispatcher.test.ts`.

## 306. RevenueCat — confirmação

Política v1 = `SKIP`; `runRevenueCatProcessing` não faz I/O algum. Nenhuma
chamada de rede RevenueCat, nenhum cancelamento de assinatura, em nenhum
caminho do worker.

## 307. AUTH_DELETION

Último passo, reutiliza `executeAuthDeletion` inalterado.
`auth/user-not-found` permanece sucesso lógico (`ALREADY_DELETED`) — nunca
logado como erro (`eventNameForStepStatus` mapeia `SUCCEEDED` para
`account_deletion_step_succeeded`, nunca para o evento de falha).

## 308. Minimização pós-COMPLETED

`minimizeCompletedRecord` (Fase 1, nunca chamado por código de produção
até agora) é invocado em `finalizeCompletedRecord` — mas escreve a cópia
minimizada numa coleção NOVA e SEPARADA (`accountDeletionAudit/
{deletionId}`), nunca sobrescrevendo o documento vivo em
`accountDeletions/{deletionId}`. Essa decisão corrigiu um bug real
encontrado durante os testes de integração desta fase: sobrescrever o
registro completo com o formato minimizado quebrava uma segunda leitura
do mesmo id (ex.: uma segunda chamada de reconciliação esperando
`ALREADY_TERMINAL`), já que o formato minimizado não bate com o shape
completo que `readAccountDeletionRecord` valida. `recordRetentionExpiresAt`
permanece `null` — nenhum prazo de retenção foi inventado.

## 309. Ciclo de vida do lock

`accountDeletionLocks/{uid}` NUNCA é deletado pelo worker — apenas seu
campo `status` é espelhado via `lockDocumentAfterStatusChange` (Fase 1,
primeiro chamador real) sempre que o status global do registro muda,
dentro da MESMA transação da escrita do registro. Isso preserva a
garantia já documentada em `concurrency.ts`: mesmo após `COMPLETED`, o
lock continua impedindo um segundo workflow para o mesmo uid — nenhuma
liberação automática de lock foi inventada.

## 310. Observabilidade

Eventos estruturados via `logInfo`/`logWarn`/`logFunctionError`
(`lib/logger.ts`, inalterado): `account_deletion_reconciliation_started`,
`account_deletion_step_started`, `account_deletion_step_succeeded`,
`account_deletion_step_retry_scheduled`,
`account_deletion_step_terminal_failure`,
`account_deletion_reconciliation_completed`,
`account_deletion_reconciliation_skipped`,
`account_deletion_reconciliation_stale_write_rejected`. Cada evento
carrega `deletionId` (opaco, seguro), `uid` (mascarado automaticamente
por `sanitizeLogContext` via a chave `uid`), `status`, `step`,
`attemptCount`, `revision`, `nextAttemptAt`, `lastErrorCode` sanitizado.

## 311. Confirmação de segurança de log

Nenhum segredo, token, chave de Vault ou conteúdo pessoal é passado a
`logInfo`/`logWarn`/`logFunctionError` em nenhum arquivo novo — auditado
manualmente linha por linha; `sanitizeLogContext` já redige qualquer chave
que combine com `SECRET_KEY` mesmo que um novo campo seja adicionado no
futuro por engano.

## 312. Arquivos criados/alterados

Criados: `functions/src/accountDeletion/reconciliation/{recordAccess,
dispatcher,processRecord,scheduler,index}.ts`,
`functions/src/accountDeletion/reconciliation/__tests__/{recordAccess,
dispatcher,processRecord,scheduler}.test.ts`,
`functions/src/accountDeletion/__tests__/
accountDeletionReconciliation.integration.test.ts`.
Alterados: `functions/src/index.ts` (export de
`cleanupPendingAccountDeletions`), `package.json` (novo script
`test:integration:accountDeletionReconciliation`),
`functions/src/__tests__/foundationStructure.test.ts` (lista de exports
esperados atualizada). **Nenhum arquivo de fase anterior foi alterado em
lógica** — `repository.ts`, `concurrency.ts`, `steps.ts`, `stateMachine.ts`,
`record.ts`, `errors.ts`, `retry.ts`, `policy.ts` e todos os 8 executores
permanecem bit-a-bit como estavam.

## 313. Testes de unidade

33 novos testes de unidade (clock injetado via parâmetro `now`, nenhum
`sleep` real): `recordAccess.test.ts` (13, contra um fake Firestore com
transações reais), `dispatcher.test.ts` (4), `processRecord.test.ts` (11,
incluindo o "main gate" via mocks, checkpoint-por-passo, budget de passos,
bloqueio por falha terminal de provider, rejeição CAS), `scheduler.test.ts`
(5, incluindo concorrência limitada e isolamento de erro por registro).

## 314. Resultado da integração — abandono/travamento

`npm run test:integration:accountDeletionReconciliation` — 6/6 passando
contra Auth+Firestore+Storage Emulator real:
1. **MAIN GATE**: `REQUESTED` abandonado reconciliado automaticamente até
   `COMPLETED`, Auth realmente deletado, lock realmente `COMPLETED`,
   reprocessamento seguinte é `ALREADY_TERMINAL`.
2. Registro travado após `ACCOUNT_ACCESS_LOCK` continua exatamente do
   ponto certo (nunca reexecuta o primeiro passo — `attemptCount`
   confirmado).
3. Lease handoff: worker A adquire e "morre"; worker B completa após o
   lease expirar; escrita tardia de A é rejeitada por CAS.
4. Dois workers concorrentes no mesmo registro convergem para um único
   `COMPLETED`, sem corrupção.
5. Isolamento entre uids: reconciliar uid A nunca toca Auth/registro de
   uid B.
6. Registro malformado: lança `AccountDeletionRepositoryError` em vez de
   qualquer ação destrutiva — Auth do uid permanece intocado.

## 315. Resultado de concorrência — dois workers

Ver §314.3/314.4 — provado com Firestore Emulator real, não simulado.

## 316. Isolamento entre uids

Ver §314.5 — provado com Firestore + Auth Emulator real.

## 317. Regressão completa — reexecutada nesta fase, não herdada de cache

```text
npm run typecheck                              → OK
npm run test (raiz)                            → 2782/2783 (1 falha
  pré-existente, não relacionada — recentAuth.test.ts, teste de borda de
  milissegundo, confirmado flake ao rodar isolado: 8/8 OK)
functions: npx tsc --noEmit                    → OK
functions: npx vitest run                      → 1133/1133 (27 skipped)
npm run test:rules                             → 235 + 74 = 309/309
test:integration:firestoreCleanup              → 2/2
test:integration:storageCleanup                → 3/3
test:integration:retainedData                  → 2/2
test:integration:authDeletion                  → 4/4
test:integration:vaultKeyDestruction            → 4/4
test:integration:backendAutonomy               → 1/1
test:integration:faultInjection                → 3/3
test:integration:accountDeletionReconciliation → 6/6 (NOVO)
```

## 318. Alterações externas

Nenhuma. Nenhum secret novo foi criado ou lido além dos 4 já existentes
para Apple. Nenhum índice do Firestore foi adicionado. Nenhum deploy foi
realizado.

## 319. Verificação — inferência perigosa

```text
O worker alguma vez infere intenção de exclusão pela ausência de um
recurso (Auth, users/{uid}, Storage, Vault)?
NÃO. Toda ação do worker depende exclusivamente de um
AccountDeletionRecord já existente e explicitamente criado por
requestAccountDeletion — confirmado por §314.6 (registro malformado
falha em vez de agir) e pela ausência de qualquer scan de users/Auth/
Storage/RevenueCat em todo o código novo.
```

## 320. Verificação — recuperação manual

```text
Algum FAILED_TERMINAL é automaticamente convertido em retry?
NÃO. §297 confirma exclusão da consulta e ALREADY_TERMINAL sem ação.
Intervenção manual futura para FAILED_TERMINAL permanece fora de escopo
desta fase — não implementada, apenas não bloqueada arquiteturalmente.
```

## 321. Verificação — autonomia backend

```text
Após um AccountDeletionRecord existir, o worker completa a exclusão sem
qualquer chamada de função cliente?
SIM — confirmado em §314.1: nenhuma função client-side é chamada em
accountDeletionReconciliation.integration.test.ts após a criação do
registro; o arquivo do worker (reconciliation/) não importa nenhum módulo
React Native.
```

## 322. GATE PRINCIPAL

```text
Uma exclusão artificialmente abandonada/travada foi reconciliada
automaticamente até estado conhecido?
SIM — §314.1 (abandono) e §314.2 (travamento parcial), ambos provados
contra Emulator real, sem qualquer chamada manual/cliente.
```

## 323. Prontidão para Fases 15/16/17

```text
Fase 15 (E2E iOS): worker não é bloqueador — depende de dispositivo real,
não implementada nesta fase (fora de escopo, conforme instrução).
Fase 16 (E2E Android): idem.
Fase 17 (E2E RevenueCat/assinatura ativa): idem — REVENUECAT_PROCESSING
permanece SKIP; nenhuma mudança de política foi feita.
Nenhuma das três foi executada nesta fase.
```

## 324. Pendências externas

Recuperação manual/operacional para registros `FAILED_TERMINAL` (ex.:
ferramenta de admin) permanece não implementada — fora do escopo desta
fase, documentada como pendência conhecida, não um blocker de arquitetura.

## 325. Veredito

```text
FASE 14 — APROVADA
```
