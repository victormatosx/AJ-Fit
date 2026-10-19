# Auditoria pré-produção — registro automático de refeições (`plan_snapshot`)

Data: 19/10/2026. Branch `main`, workspace local não commitado (ver `git status`).
Auditoria estática + execução local de testes/typecheck/emulador. **Nenhum deploy,
commit, push, build nativo, chamada paga de IA ou escrita em produção foi executado.**

## 1. Resumo executivo e veredito

**Veredito: APTO, com uma ressalva de processo (não de código).**

A implementação do registro automático por `plan_snapshot` é sólida. A auditoria não
encontrou nenhum problema **P0** ou **P1** no código da funcionalidade. Arquitetura,
transação, idempotência, Rules, limites e UI atendem ao que os documentos internos
declaram, e as 2 execuções de teste adversarial mais relevantes (o P1 de concorrência
de agregados e o P1 de equivalência "com/sem", ambos documentados para a feature
**separada** de geração vinculada ao catálogo) **não se reproduzem** na implementação
de `mutateNutritionDiaryV1`, porque ela faz todas as leituras dentro da própria
transação Firestore — ao contrário do escritor manual legado, que ainda carrega o
padrão antigo (ver P2-01 abaixo).

A única ressalva real é de **processo de liberação**, não de código: o workspace atual
contém, lado a lado e não comitado, uma terceira funcionalidade — geração vinculada ao
catálogo (`catalogLinking/*`) — cuja própria auditoria anterior
(`docs/nutrition/catalog-linked-generation-homologation.md`) identificou 2 P1 e
recomendou **não ativar**. Confirmei que essa flag está OFF por padrão e que todo
código consumidor falha fechado (nunca degrada silenciosamente para o caminho livre),
portanto **não bloqueia a liberação do `plan_snapshot`** — mas qualquer `git add`/commit
que capture o workspace inteiro vai incluir esse código inativo-mas-presente. Recomendo
decidir explicitamente se ele entra no mesmo commit/PR (inativo, documentado) ou é
isolado para uma entrega separada.

Testes executados nesta auditoria (ver seção 7): TypeScript (app+Functions) sem erros,
ESLint sem erros nos arquivos alterados, 576/576 testes de Rules, 101/101 testes
unitários de app, 260/261 testes de Functions (o único "pulado" é o smoke real de IA,
intencionalmente não executado), sync nutricional sem divergência.

## 2. Arquitetura e fluxo ponta a ponta

```
RegisterMealScreen / NutritionShell
  → src/services/nutritionDiaryProtocol.ts (registerPlanSnapshotOption)
    → Cloud Function mutateNutritionDiaryV1 (functions/src/nutrition/diary/mutate.ts)
      → requireAuth(request) + onCall({ enforceAppCheck: true })
      → 1 única transação Firestore:
          lê: accountDeletionLocks, users/{uid}, nutritionDiaryProtocol/current,
              nutritionDiaryOperationReceipts (2 níveis), plano/alternativa/favorito
              de origem, nutritionDailyLogs/{date} + 6 meals + itens (<=49/slot)
          valida: shape do option, totais do option vs soma dos itens, bases imutáveis,
              limites de 8/refeição e 48/dia, consistência histórica (DIARY_INCONSISTENT)
          escreve: itens tocados, meal/day aggregates, 2 recibos, protocolo
              (criado atomicamente na primeira mutação válida)
    ↔ Firestore Rules: nutritionDiaryProtocol (write:false), nutritionDiaryOperationReceipts
      (read,write:false), nutritionDailyLogs/meals/items (create/update/delete somente se
      !exists(nutritionDiaryProtocol/current))
```

Caminho legado (sem adesão): `src/services/nutritionDiary.ts` continua escrevendo
direto no Firestore via SDK cliente, protegido pelas mesmas Rules. Toda operação manual
(`addDiaryFood`, `updateDiaryEntryGrams`, `removeDiaryEntry`, `moveDiaryEntry`) primeiro
chama `usesTransactionalDiary(uid)` (lê `nutritionDiaryProtocol/current`) e, se a conta
já aderiu, roteia para o mesmo `mutateNutritionDiaryV1` em vez de escrever diretamente —
confirmado em código, não apenas na documentação.

### Pontos verificados linha a linha (`functions/src/nutrition/diary/mutate.ts`)

| # | Verificação | Resultado |
| --- | --- | --- |
| 1 | UID vem de `requireAuth(request)`; `expectedUid` do payload só é comparado, nunca usado como autoridade (`d.expectedUid !== uid` → `DIARY_ACCOUNT_CHANGED`) | ✅ Confirmado, linha 131-132 |
| 2 | Idempotência de request (hash do `requestId` + fingerprint do payload) | ✅ Confirmado, linhas 136-143 |
| 3 | Idempotência de opção (hash de `[data, slot, coleção, documento, optionId]`) | ✅ Confirmado, linhas 149-154 |
| 4 | Todas as leituras (lock, conta, protocolo, recibos, opção, dia, 6 meals, itens) ocorrem **dentro** da mesma transação, nenhuma lista capturada antes | ✅ Confirmado — zero `await` fora de `db.runTransaction` no caminho de escrita |
| 5 | `DIARY_ITEM_CHANGED` por revisão obsoleta se aplica a `edit` | ✅ Confirmado, linha 196. `remove`/`move` operam sobre o item persistido atual sem exigir revisão — **por desenho**, documentado e testado, não é uma lacuna |
| 6 | Limite de 8/refeição e 48/dia é atômico (operação inteira falha, nunca truncamento parcial) | ✅ Confirmado, linha 210-211 |
| 7 | Quantidade de snapshot limitada a 5000 (vs 10000 do manual) | ✅ Confirmado em `functions/src/nutrition/shared/nutrition/diary/snapshot.ts:validatePlanSnapshotBase`/`planSnapshotNutrition` |
| 8 | Edição sempre escala a partir da base imutável persistida, nunca do valor já arredondado da edição anterior | ✅ Confirmado — comentário e código (`planSnapshotNutrition`) usam `base.nutrition`, nunca `item.snapshot` anterior |
| 9 | Hierarquia de arredondamento item → refeição → dia, 2 casas | ✅ Confirmado, `sum`/`sumDay` |
| 10 | Fibra ausente bloqueia registro automático (não é inferida) | ✅ Confirmado via `validateNutritionValues`/`DIARY_NUTRIENTS` exigindo todos os 5 nutrientes numéricos |
| 11 | Protocolo é criado atomicamente com a primeira mutação válida (mesma transação) | ✅ Confirmado, linha 216: `if (!protocol.exists) tx.create(protocolRef, ...)` |
| 12 | `foodId`/`grams` nunca presentes em item `plan_snapshot` | ✅ Confirmado — tipo TS (`foodId?: never; grams?: never`) e `validateStored` rejeita explicitamente |

### UI

- `diary.planEstimate` ("Estimativa da dieta") aparece **apenas** no modal de edição de
  quantidade (`NutritionDiaryScreen.tsx:115`), não repetidamente na lista do diário —
  confirmado por teste (`nutritionDiaryPresentation.test.ts:209` afirma explicitamente
  que a linha da lista **não** contém essa string). Atende ao requisito visual do brief.
- `preparationNote` não é renderizado na lista principal; permanece nos dados
  (`base.preparationNote`/item `preparationNote`), disponível para quem precisar.

## 3. Segurança e Firestore Rules

Lido `firestore.rules` linhas 1129-1448 (bloco completo do diário/protocolo/recibos):

- `nutritionDiaryProtocol/current`: `allow write: if false` — cliente nunca cria/edita.
- `nutritionDiaryOperationReceipts/*`: `allow read, write: if false` — nem leitura
  cliente é permitida (mais estrito do que o mínimo necessário, por desenho).
- `legacyDiaryClientWriterAllowed(userId) = !exists(nutritionDiaryProtocol/current)` é
  usado **simetricamente** em `nutritionDailyLogs` (create/update/delete), em
  `meals/{slotId}` (create/update/delete) e em `items/{itemId}` (create/update/delete).
  Não há assimetria (ex.: delete liberado mas create bloqueado) em nenhum dos três
  níveis — verificado nas 3 ocorrências do helper.
- `nutritionLogItemValid` (validador do item legado) tem `keys().hasOnly(['id', 'foodId',
  'grams', 'source', 'snapshot', 'loggedAt'])` — um cliente legado não conseguiria
  gravar um item com forma `plan_snapshot` (`base`, `planReference`, `quantity`, `unit`,
  `preparationNote`, `revision`) mesmo que tentasse, defesa em profundidade além do
  bloqueio por `legacyDiaryClientWriterAllowed`.
- `mutateNutritionDiaryV1` e `logCatalogMeal` (callable da feature separada) são
  ambos `onCall({ enforceAppCheck: true, ... })` — App Check obrigatório confirmado em
  código, não apenas em documentação.
- `functions/src/index.ts` exporta exatamente `mutateNutritionDiaryV1` (de
  `diary/mutate`) e `logCatalogMeal` (de `catalogLinking/logMeal`) para esses domínios —
  nenhum export remanescente de `mutateNutritionDiary` (sem V1), `prepareNutritionMeal`
  ou `confirmNutritionMeal`.
- `functions/src/accountDeletion/firestoreCleanup/resources.ts`: diff é puramente
  aditivo — `'nutritionCatalogLogReceipts', 'nutritionDiaryProtocol',
  'nutritionDiaryOperationReceipts'` apenas anexados ao array existente, nenhuma entrada
  anterior removida/reordenada.
- `logCatalogMeal` (feature separada) recusa explicitamente contas já aderidas ao
  protocolo (`if (protocol.exists) throw ... DIARY_PROTOCOL_REQUIRED`, linha 40 de
  `logMeal.ts`) — confirma que a adesão ao `plan_snapshot` não pode ser contornada por
  esse segundo escritor backend.
- Nenhum segredo, chave ou token encontrado nos arquivos novos/alterados.
- Amplificação de leitura: cada chamada a `mutateNutritionDiaryV1` lê no máximo
  ~1 (lock) + 1 (conta) + 1 (protocolo) + 1 (recibo de request) + ~2-3 (opção de
  origem) + 1 (dia) + 6 (meals) + até 6×49 (itens, limitado) + leituras de receitas
  manuais (até 6 ingredientes). É limitado e determinístico; não há busca nem
  catálogo inteiro envolvido. Não constitui vetor de custo descontrolado diferente do
  que já existe para qualquer callable autenticada chamada em loop — mitigação
  adicional de rate-limit explícito não foi encontrada nem é claramente necessária
  dado o teto de itens, mas pode ser considerada como melhoria opcional (ver §10).

**Nenhum P0/P1 de segurança encontrado no código de `plan_snapshot`.**

## 4. Concorrência, idempotência e integridade

Testes adversariais de arquitetura (análise de código, não apenas confiança na
documentação anterior):

- **Corrida entre dois dispositivos no mesmo usuário, pós-adesão**: como `before` é lido
  dentro da própria transação (não antes dela), o Firestore aborta/retenta a transação
  automaticamente se o conjunto lido mudar antes do commit. Não há a classe de bug
  "lista capturada fora da transação" que o relatório de geração vinculada ao catálogo
  identificou como P1-02 para o escritor manual legado.
- **Double-tap / retry após timeout**: dedupe de 2 níveis (`request_` por
  requestId+fingerprint, `option_` por data+slot+opção) cobre tanto retry do mesmo
  request quanto uma segunda tentativa com `requestId` novo para a mesma opção/dia —
  confirmado em código e coberto por `planSnapshotDiary.integration.test.ts` (executado
  nesta auditoria, 31 testes, todos passando).
- **Replay após edição/exclusão**: os recibos não são removidos por edição/exclusão
  (não há código que os apague fora da exclusão de conta), portanto um replay do
  mesmo request retorna o resultado armazenado, não restaura itens apagados — correto
  por desenho, documentado e coberto por testes.
- **Edição concorrente**: revisão obsoleta em `edit` → `DIARY_ITEM_CHANGED` sem
  sobrescrever. `remove`/`move` atuam sobre o item persistido atual lido na mesma
  transação (não um estado obsoleto), coerente com o desenho documentado.
- **Limite de 8/48 com overflow**: falha atômica confirmada (`DIARY_ITEM_LIMIT`), sem
  truncamento parcial — a checagem só dispara quando o conjunto **cresce** além do
  limite, permitindo operações de remoção mesmo em um dia historicamente acima do
  limite (nunca bloqueia uma redução).

### P2-01 — Escritor manual legado mantém o padrão de "lista capturada antes da transação" (pré-existente, não introduzido por esta entrega) — **CORRIGIDO em 19/10/2026**

**Atualização:** corrigido após esta auditoria. `src/services/nutritionDiary.ts` agora
captura um contador `itemsRevision` no documento da refeição antes de ler os itens,
e revalida esse contador dentro da transação, abortando e reexecutando a operação
inteira (até 5 tentativas) sempre que outra escrita concorrente tiver alterado a
refeição nesse intervalo. `firestore.rules` recebeu uma permissão aditiva e limitada
para esse campo opcional (inteiro, 0–1.000.000.000), sem afrouxar nenhuma outra
validação. Prova adversarial em `src/services/__tests__/
nutritionDiaryManualConcurrency.integration.test.ts` (emulador real, Rules reais):
6 dos 7 casos falham deterministicamente contra o código anterior à correção e
passam com ela. Detalhes completos na seção 4 abaixo (texto original da auditoria,
preservado como registro histórico do problema).

Evidência: `src/services/nutritionDiary.ts:231-261` (`replaceMealItemsOnMeal`) chama
`loadMealItems` (uma query one-shot) **antes** de `runTransaction`, e dentro da
transação só lê/escreve os documentos de dia e refeição (agregados), nunca os itens
em si. Isso é o mesmo padrão de bug que `catalog-linked-generation-homologation.md`
documentou como P1-02 (lá, entre o escritor backend de catálogo e o escritor manual).

Aqui o cenário é mais restrito — **só afeta contas que ainda não aderiram ao
`plan_snapshot`**, e exige dois escritores manuais concorrentes do mesmo usuário (ex.:
celular + tablet editando o diário ao mesmo tempo, ou duplo toque que dispare duas
chamadas de `addDiaryFood` quase simultâneas). Dois documentos de item podem ser
criados, mas o agregado da refeição (`totals`/`loggedItemCount`) reflete apenas o
último `transaction.set(meal, ...)` a comitar — um real, embora estreito, risco de
divergência entre itens e totais para contas não aderidas.

O próprio código já documenta essa troca como aceitável ("acceptable for a single
user's own diary — no cross-user contention"), e o `plan_snapshot` **não piora** esse
cenário — ao contrário, toda conta que adere elimina esse risco porque todas as
operações passam a ser transacionais de ponta a ponta via `mutateNutritionDiaryV1`.
Não é um bloqueador desta entrega, mas é um argumento a favor de incentivar a adesão e,
eventualmente, migrar ou remover o escritor legado.

**Severidade: P2.** Não corrigir nesta etapa; registrar como risco residual conhecido,
não introduzido por este trabalho.

## 5. Código legado, duplicado ou removível

Varredura completa (grep em `src/`, `functions/src/`, `firestore.rules`,
`firestore-tests/`, `scripts/`) por resíduos do Food Matcher e do piloto por UID:

- **Zero ocorrências em código vivo** de: `prepareNutritionMeal`, `confirmNutritionMeal`,
  `mutateNutritionDiary` (sem `V1`), `nutritionDiaryAuthority`, `nutritionMatcherConfig`,
  `nutritionMealPreparations`, `nutritionDiaryMutationReceipts`,
  `nutritionDiaryVerifiedDays`, `nutritionMatcherLimits`, `PreparedMealConfirmation`,
  `src/nutrition/matcher/`, `NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS`,
  `EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS`, `OkGay33revNItgUuEVHbK2pB32A2`. Todas
  as ocorrências restantes estão exclusivamente em `docs/nutrition/*.md` como histórico.
- `functions/src/nutrition/diary/pilot.ts` **confirmado ausente** do repositório.
- `functions/src/nutrition/diary/config.ts` é um kill switch booleano puro (5 linhas),
  sem allowlist, com comentário explícito "No UID allowlist."
- Nenhum `console.log`/`debugger` de depuração encontrado nos arquivos novos de
  `diary/`, `catalogLinking/`, `nutritionDiaryProtocol.ts`, `snapshot.ts`.
- `functions/src/nutrition/diary/mutate.ts` e `functions/src/nutrition/catalogLinking/
  logMeal.ts` têm lógica de escrita no diário visualmente parecida, mas **não são**
  duplicação acidental: `logMeal.ts` recusa explicitamente contas já aderidas ao
  protocolo — é um guard de design, não código morto a unificar.
- `scripts/nutrition/checkPlanSnapshotDeployment.cjs` é somente leitura (SHA-256 +
  escrita opcional em um arquivo de evidência, nenhum `exec`/deploy/escrita Firestore).

### P3 — Documentação histórica com blocos de comando sem aviso forte o suficiente

`docs/nutrition/plan-snapshot-pilot.md` e `plan-snapshot-pilot-publication.md` têm um
aviso no topo do arquivo apontando para `plan-snapshot-main-workspace.md` como estado
atual, mas os próprios blocos de comando (allowlist por UID, pacote isolado) não
repetem esse aviso diretamente acima de si. Um leitor que pule o topo do documento e
vá direto ao bloco de comando pode executar um fluxo de publicação obsoleto.
**Recomendação:** adicionar um cabeçalho "HISTÓRICO — NÃO EXECUTAR" imediatamente acima
de cada bloco de comando nesses dois arquivos. Cosmético, não bloqueia produção.

### P3 — Discrepância numérica entre documentação e teste

`food-matcher-rollback.md` afirma que `workoutLastPerformedLocalDate.rules.test.ts`
preserva "21 casos independentes de treino"; o arquivo atual tem 12 blocos `it()`.
Provavelmente a contagem original somava asserções, não casos de teste — não é um
defeito de código (os 576 testes de Rules, incluindo este arquivo, passam
integralmente), apenas uma imprecisão de registro histórico. Recomendo reconciliar o
número na próxima edição do documento, sem urgência.

## 6. Compatibilidade com clientes antigos

- Contas **não aderidas**: fluxo manual legado inalterado, limite diário de 36
  (`nutritionDailyLogs` Rules, linha 1400/1411), sem nenhuma dependência do protocolo.
- Contas **aderidas**: Rules negam toda escrita direta (create/update/delete) em
  day/meal/item; toda operação (incluindo manual) passa pelo backend. Um cliente antigo
  tentando escrever diretamente após a adesão é negado pelas Rules, não por lógica de
  app — a negação sobrevive mesmo que o app antigo não saiba da mudança de protocolo.
- Builds antigos não sabem renderizar a origem `plan_snapshot`/unidade/base — risco de
  UI já documentado e aceito pelo time; não é uma falha de dados, é uma limitação de
  apresentação em clientes desatualizados, que a equipe já decidiu mitigar por política
  de atualização de dispositivos antes da ativação, não por código.
- Rollback operacional (desligar a flag `NUTRITION_PLAN_SNAPSHOT_ENABLED`): bloqueia
  **novas** adesões e registros automáticos, mas mantém CRUD backend para contas já
  aderidas (confirmado em código: `protocol.exists` sozinho basta para prosseguir,
  independentemente de `registrationEnabled`, exceto para a própria ação
  `register_option`). Não há código que apague protocolo/recibos.

## 7. Testes executados nesta auditoria

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` (app) | ✅ 0 erros |
| `cd functions && npm run typecheck` | ✅ 0 erros (inclui sync:nutrition sem divergência) |
| `node scripts/syncNutritionToFunctions.cjs --check` | ✅ `0 synchronized` |
| ESLint — 29 arquivos app alterados | ✅ 0 erros, 3 avisos pré-existentes (import order, dep de `useEffect`, var não usada) |
| ESLint — 26 arquivos `functions/src` alterados | ✅ 0 erros, 36 avisos de estilo (`import/first`, `import/no-duplicates`) |
| Vitest app — 10 suítes (`snapshot`, `nutritionDiaryProtocol`, `nutritionDiaryPresentation`, `nutritionShellRegression`, `registerMealScreen`, `rank`, `binding`, `nutritionCatalogMeal`, `firebaseAppCheck`, `nativeEnvironmentPreflight`) | ✅ 101/101 |
| Firestore Rules completas (emulador, JDK 21) — 25 arquivos | ✅ 576/576, incluindo `nutrition.rules.test.ts` e `workoutLastPerformedLocalDate.rules.test.ts` |
| Functions nutrição + `accountDeletion/firestoreCleanup/resources.test.ts` (emulador) | ✅ 260/261 — 1 pulado é o smoke real de IA, intencional, nenhuma chamada paga feita |

Nenhuma chamada real de IA, nenhum deploy, nenhuma escrita em produção. Ambiente
isolado por emulador Firestore em projeto `demo-`-prefixado.

## 8. Diferenças relevantes entre workspace e Firebase publicado

Não foi possível (nem autorizado) consultar o estado remoto nesta auditoria — os
documentos históricos (`plan-snapshot-pilot-publication.md`) registram que, na última
verificação remota conhecida (19/10/2026 UTC), a Function `mutateNutritionDiaryV1`
publicada ainda operava sob a política antiga de piloto por UID único
(`OkGay33revNItgUuEVHbK2pB32A2`), não a liberação global presente neste workspace.
**Antes de qualquer deploy**, será necessário revalidar o estado remoto atual (Rules,
revisão da Function, flags efetivas) com uma nova consulta somente leitura — não
assumir que nada mudou desde a última verificação histórica.

## 9. Correções obrigatórias antes da produção

**Nenhuma.** Não há P0/P1 no código de `plan_snapshot`.

## 10. Melhorias opcionais (não bloqueiam)

1. Migrar `replaceMealItemsOnMeal` (escritor manual legado) para ler os itens dentro da
   própria transação, eliminando o P2-01 também para contas não aderidas — ou,
   alternativamente, tratar isso como motivação adicional para incentivar/forçar a
   adesão ao protocolo novo.
2. Adicionar cabeçalhos "HISTÓRICO — NÃO EXECUTAR" acima dos blocos de comando em
   `plan-snapshot-pilot.md` e `plan-snapshot-pilot-publication.md`.
3. Reconciliar a contagem de "21 casos" vs 12 `it()` blocks em
   `food-matcher-rollback.md`.
4. Considerar um rate-limit explícito por UID em `mutateNutritionDiaryV1` como defesa
   adicional em profundidade, embora os limites de item já tornem o custo por chamada
   determinístico e baixo.
5. Decidir separadamente se a feature de geração vinculada ao catálogo
   (`catalogLinking/*`, flag OFF) entra no mesmo commit/PR do `plan_snapshot` ou é
   isolada — puramente uma decisão de processo de release, código já confirmado inerte.

## 11. Plano de limpeza e implementação recomendado

Não há limpeza de código obrigatória. Ordem sugerida, sem urgência:

1. Revisar e decidir o escopo do commit/PR (item 10.5).
2. Aplicar as duas melhorias de documentação (itens 10.2-10.3) junto do mesmo commit,
   já que são edições triviais nos mesmos arquivos de doc tocados por este trabalho.
3. Registrar o P2-01 como item de backlog técnico (não bloqueador), vinculado à meta de
   aumentar a taxa de adesão ao protocolo novo.
4. Antes do deploy, revalidar o estado remoto (seção 8) com uma nova consulta de
   leitura, nunca assumindo que o relatório de publicação anterior ainda reflete a
   realidade.

## 12. Checklist final de homologação e publicação

- [x] Arquitetura e transação revisadas linha a linha
- [x] Firestore Rules revisadas (protocolo, recibos, diário, simetria create/update/delete)
- [x] Idempotência (2 níveis) e concorrência analisadas e sem bug reproduzível no caminho novo
- [x] Limites (8/refeição, 48/dia, 5000/10000 de quantidade) confirmados atômicos e server-side
- [x] UI do diário não exibe "Estimativa da dieta"/preparo repetidamente na lista
- [x] Resíduos do Food Matcher e do piloto por UID: zero em código vivo
- [x] Inventário de exclusão de conta: aditivo, sem regressão
- [x] TypeScript, ESLint, testes unitários, Rules e Functions (emulador): todos verdes
- [x] Regressão em geração de IA, catálogo, favoritos, onboarding, treino, App Check/RevenueCat: nenhuma encontrada
- [ ] Revalidação do estado remoto (Rules/Function publicada) imediatamente antes do deploy — **pendente, fora do escopo desta auditoria estática**
- [ ] Homologação visual em dispositivo/simulador com Auth/App Check reais — **pendente, não realizada nesta auditoria**
- [ ] Decisão de escopo sobre `catalogLinking` entrar ou não neste commit — **pendente, decisão do usuário**

**Veredito final: APTO para produção do ponto de vista de código, segurança e
integridade transacional**, condicionado às três pendências não-técnicas da checklist
acima (revalidação remota, homologação visual real, decisão de escopo do commit).
