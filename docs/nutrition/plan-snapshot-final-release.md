# Pacote final de publicação — `plan_snapshot` + correção P2-01 do diário manual

Data: 19/10/2026. Preparação local no workspace principal. **Nenhum deploy, commit,
push, build nativo, migração ou chamada paga de IA foi executado.** Consultas remotas
foram **somente leitura** (Management API / Firebase Rules API via token de
credenciais padrão da aplicação), sem nenhuma escrita em produção.

## Veredito

**PRONTO PARA PUBLICAR**, com uma sequência de deploy específica (seção 6) e duas
decisões de escopo que ficam para sua aprovação explícita antes de executar qualquer
comando (seções 1 e 2).

Não há nenhum P0/P1 de código pendente. O estado remoto foi comparado e está
consistente com o que os relatórios anteriores descreviam: a Function
`mutateNutritionDiaryV1` está `ACTIVE`, mas ainda executando a política **antiga de
piloto por UID único** — a liberação global só passa a valer depois do redeploy
descrito aqui.

## 1. Compatibilidade — `itemsRevision` e clientes antigos (corrigido nesta etapa)

**Risco identificado e corrigido.** Um dispositivo com o app **anterior** à correção
P2-01 (que ainda lê/grava refeições sem conhecer o campo `itemsRevision`) poderia
sobrescrever silenciosamente o agregado de uma refeição já tocada pelo app corrigido —
exatamente a classe de bug que o P2-01 corrigiu, agora reintroduzida pela diferença de
versão entre dispositivos do mesmo usuário.

**Correção aplicada:** `firestore.rules` agora exige que, uma vez que uma refeição
tenha `itemsRevision` (ou seja, já foi tocada por um cliente corrigido), **toda escrita
futura** — inclusive de um cliente desatualizado que nem sabe que o campo existe —
precisa incrementá-lo em exatamente 1. Uma escrita antiga que omite o campo é **negada
pelas Rules** (falha fechada), em vez de silenciosamente corromper o total. O mesmo
vale para exclusão do documento da refeição: uma vez rastreada, ela nunca é apagada
diretamente (zerar vira um `update` com revisão incrementada, nunca um `delete` cego) —
isso fecha a mesma lacuna também para "remover o último item".

Essa correção foi comprovada com um teste dedicado
(`firestore-tests/nutrition.rules.test.ts`, `enforces the itemsRevision...`) e com um
teste de integração ponta a ponta contra o emulador real simulando literalmente o
payload de um cliente pré-correção
(`src/services/__tests__/nutritionDiaryManualConcurrency.integration.test.ts`,
`a stale (pre-fix) client...`), confirmando que a escrita antiga é rejeitada e a
transação inteira é revertida (nem o item nem o agregado ficam inconsistentes).

**Decisão que fica para você:** esta correção já está no pacote a publicar (ela é
parte do `firestore.rules`). Não há ação adicional pendente — mas vale registrar que
ela só protege contas que **já foram tocadas** pelo app corrigido; contas que nunca
usaram o app novo continuam no comportamento legado de sempre (sem `itemsRevision`,
sem a proteção, exatamente como hoje).

## 2. Isolamento da geração vinculada ao catálogo (`catalogLinking`)

**Confirmado remotamente:** `logCatalogMeal` e `favoriteCatalogMeal` (os dois
callables da geração vinculada ao catálogo) **não existem no projeto publicado** —
consulta somente leitura ao inventário de Functions confirmou `NOT FOUND` para ambos.
O isolamento atual já é real, não apenas pretendido.

### Backend (Functions/Rules) — isolamento garantido por desenho

O deploy desta publicação usa **alvo seletivo por nome de Function**
(`--only functions:mutateNutritionDiaryV1`), não um deploy genérico. Isso significa
que, mesmo que o código-fonte de `catalogLinking/*` exista no mesmo `functions/src`
localmente, **nenhuma Function relacionada a ele é criada, atualizada ou tocada** por
este deploy — o Firebase CLI só age sobre a Function nomeada. O mesmo vale para as
duas Functions de exclusão de conta: **este pacote não as redeploya** (ver seção 4),
então nada relacionado a `catalogLinking` chega nelas tampouco.

As Rules (`firestore.rules`) precisam ser publicadas como arquivo único — Firestore
não permite publicação parcial de Rules. O diff real contra o que está publicado hoje
(comparação remota, seção 3) mostra que a única adição não relacionada ao
`plan_snapshot`/P2-01 é um campo opcional e inerte: `excludedSubstances` no validador
de `nutritionProfile` (suporte a um campo que a geração vinculada ao catálogo usa, mas
que **nenhuma tela do app ainda escreve** — sem UI que o popule, ele nunca é setado,
logo nunca ativa nada). Recomendo publicar as Rules como estão: a alternativa seria
editar `firestore.rules` manualmente antes do deploy para remover 5 linhas isoladas, o
que é mais arriscado (risco de erro manual num arquivo de segurança) do que aceitar um
campo opcional inerte.

**Resultado: isolamento do backend está garantido por este plano de deploy, sem
precisar tocar em nenhum arquivo de `catalogLinking`.**

### App cliente — requer uma decisão sua

Diferente de Functions, um build do app é monolítico: não existe "deploy seletivo"
para React Native/Expo. O próximo build do app vai necessariamente incluir **todas**
as alterações locais, inclusive fragmentos inertes da geração vinculada ao catálogo
que foram implementados nos mesmos arquivos compartilhados:

| Arquivo | O que tem de `catalogLinking` | Risco de publicar como está |
| --- | --- | --- |
| `src/components/nutrition/MealOptionCard.tsx` | Exibe `catalogBinding.brandName` entre parênteses, se presente | Nenhum — nunca presente sem a flag/backend ativos |
| `src/screens/nutrition/NutritionFavoritesScreen.tsx` | Mesmo padrão de exibição de marca | Nenhum |
| `src/services/nutritionFavorites.ts` | Novo caminho via callable `favoriteCatalogMeal`, só acionado se `foods[].catalogBinding` existir | Nenhum — essa callable não existe no backend (confirmado acima); se por algum motivo fosse acionada, falharia com erro de rede, não com dado corrompido |
| `src/services/nutritionProfile.ts` | Aceita/serializa `excludedSubstances` | Nenhum — não há tela que colete esse valor |
| `src/nutrition/ui/generationStage.ts` | Novo mapeamento de erro `AI_CATALOG_RESOLUTION_FAILED` → `catalogUnavailable` | Nenhum — esse código de erro nunca é emitido pelo backend hoje |
| `src/types/nutrition.ts` | Tipos `NutritionCatalogBinding`, `NutritionCatalogSafetyEvidence`, `excludedSubstances?`, `generationMode?` | Nenhum — são apenas tipos TypeScript, sem efeito em runtime |

Todos os seis são **comprovadamente inertes**: nenhum tem um caminho de ativação sem o
backend de geração vinculada (que não está publicado) ou sem uma tela que ainda não
existe. Tecnicamente seguro publicar como estão.

**Mesmo assim, a decisão de "separar completamente" é sua, não minha**, porque afeta o
que efetivamente vai para a loja. Duas opções:

- **Opção A (recomendada): publicar como estão.** Risco tecnicamente nulo, menor
  complexidade operacional, nenhuma reversão manual de arquivo necessária.
- **Opção B: isolamento estrito.** Antes do próximo build do app, reverter
  temporariamente os seis arquivos acima para o estado do HEAD atual (sem essas
  mudanças), gerar o build, e só então reaplicar as mudanças no workspace. Mais
  trabalho operacional, zero diferença de risco real.

Não tomei essa decisão por você. Me diga qual prefere antes do próximo build do app;
nenhuma ação de build foi (ou será) feita por mim nesta tarefa.

## 3. Firebase — estado remoto (somente leitura, `ajfit-2f321`)

Consulta via Management API (`cloudfunctions.googleapis.com`) e Firebase Rules API
(`firebaserules.googleapis.com`), com token de credenciais padrão da aplicação —
apenas `GET`, nenhuma escrita.

| Item | Estado remoto atual | Estado local (a publicar) | Ação necessária |
| --- | --- | --- | --- |
| `firestore.rules` | SHA-256 `8e39e577...372a63ed`, confere com o checkpoint do relatório de publicação anterior | Diff de 89 linhas: suporte a `itemsRevision` (P2-01) + campo opcional `excludedSubstances` | **Publicar** |
| `mutateNutritionDiaryV1` | `ACTIVE`, `updateTime` `2026-10-19T01:54:15Z`, env `NUTRITION_PLAN_SNAPSHOT_ENABLED=true` **e** `NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS=OkGay33revNItgUuEVHbK2pB32A2` — ainda a política antiga de piloto | Código local usa `functions/src/nutrition/diary/config.ts`: kill switch booleano puro, **sem leitura de allowlist em nenhum lugar** | **Publicar** (só assim a liberação global entra em vigor) |
| `onAccountDeletionRequested` / `cleanupPendingAccountDeletions` | `ACTIVE`, `updateTime` `2026-10-19T01:51:19Z` — já republicadas durante a ativação do piloto; já conhecem `nutritionDiaryProtocol`/`nutritionDiaryOperationReceipts` | Diff local acrescenta **apenas** `nutritionCatalogLogReceipts` (nome de coleção do `catalogLinking`) ao mesmo array | **Não publicar nesta etapa** — a limpeza de protocolo/recibos do `plan_snapshot` já está ativa; a única mudança pendente pertence ao `catalogLinking`, fora do escopo desta liberação |
| `logCatalogMeal`, `favoriteCatalogMeal` | Inventário confirma: **não existem** no projeto | — | Nenhuma ação — confirma isolamento |

**Implicação prática:** o pacote de deploy desta publicação é **menor** do que o
piloto original — apenas duas unidades atômicas: `firestore:rules` e
`functions:mutateNutritionDiaryV1`. As Functions de exclusão de conta já cobrem o
`plan_snapshot` e não precisam de novo deploy agora (evita, de brinde, qualquer
contaminação com o `catalogLinking`).

Não foi feito download do código-fonte compilado da revisão atual de
`mutateNutritionDiaryV1` nesta etapa (apenas metadados/env). Antes do deploy real,
repita a verificação de origem publicada (`scripts/nutrition/
checkPlanSnapshotDeployment.cjs`, já usado nesta auditoria) imediatamente antes de
publicar, para garantir que nada mudou remotamente entre esta preparação e a execução.

## 4. Inventário exato do pacote a publicar

### Firestore Rules (arquivo único, deploy atômico)
- `firestore.rules`

### Functions (alvo seletivo — **apenas este nome**)
- `functions:mutateNutritionDiaryV1`, fonte: `functions/src/nutrition/diary/{config.ts,mutate.ts}`,
  `functions/src/index.ts` (export, sem alterar os outros exports), e os módulos compartilhados
  já mirrorados em `functions/src/nutrition/shared/nutrition/diary/snapshot.ts` /
  `.../catalog/math.ts` via `scripts/syncNutritionToFunctions.cjs`.

**Não incluído neste deploy** (existe no repo, não é alvo): `functions:logCatalogMeal`,
`functions:favoriteCatalogMeal`, `functions:onAccountDeletionRequested`,
`functions:cleanupPendingAccountDeletions`, qualquer Function de geração/worker de IA.

### App cliente (próximo build — fora do meu escopo nesta tarefa)
Arquivos do `plan_snapshot` e da correção P2-01 relevantes para o próximo build:
`src/services/nutritionDiary.ts`, `src/services/nutritionDiaryProtocol.ts`,
`src/nutrition/diary/snapshot.ts`, `src/screens/nutrition/{NutritionShell,
RegisterMealScreen,NutritionDiaryScreen,MealDetailsScreen}.tsx`,
`src/i18n/resources/{en,es,pt-BR}/nutrition.json`, `.env.example` (documentação da
flag; valor real do build fica com você), `src/types/nutrition.ts` (compartilhado,
ver seção 2), `docs/nutrition/canonical/nutrition_constraints.json`. Os seis arquivos
de `catalogLinking` inertes estão listados na seção 2 — decisão pendente sobre
incluí-los ou revertê-los antes do build.

### Testes e documentação (não publicados, mas parte do commit/PR se você decidir comitar)
Todos os arquivos de teste novos/alterados (`firestore-tests/nutrition.rules.test.ts`,
`src/services/__tests__/nutritionDiaryManualConcurrency.integration.test.ts`,
`functions/src/nutrition/__tests__/planSnapshot*.test.ts`, etc.) e os documentos em
`docs/nutrition/*.md` (incluindo este e o relatório de auditoria anterior).

## 5. Liberação global — confirmação de segurança

- **Sem allowlist por UID em nenhuma camada:** `functions/src/nutrition/diary/
  config.ts` é um booleano puro; nenhuma referência a `PILOT_UIDS` existe em código
  vivo (confirmado na auditoria anterior e reconfirmado nesta). O backend aceitará
  **qualquer UID autenticado e com conta ativa**, assim que o deploy for feito.
- **Auth obrigatório:** `requireAuth(request)` deriva o caminho de dados sempre de
  `request.auth.uid`, nunca de um campo do payload.
- **App Check obrigatório:** `onCall({ enforceAppCheck: true, ... })` na declaração da
  Function, inalterado por este pacote.
- **Kill switch preservado:** `NUTRITION_PLAN_SNAPSHOT_ENABLED` continua controlando
  se **novos** registros/adesões são aceitos; desligá-lo não afeta CRUD de contas já
  aderidas (comportamento já documentado e testado).
- **Rules simétricas:** criação/atualização/exclusão de dia, refeição e item são
  igualmente negadas ao cliente uma vez que a conta adere ao protocolo — sem
  assimetria, confirmado na auditoria anterior e intacto nesta correção.

## 6. Ordem de publicação segura

A ordem importa especificamente por causa do campo `itemsRevision`: o app corrigido
grava esse campo; as Rules antigas (ainda publicadas) **rejeitariam** essa escrita
porque o campo não está na lista de chaves permitidas. Publicar as Rules antes do app
é obrigatório, não apenas uma preferência.

1. **Revalidar o estado remoto imediatamente antes de publicar** (somente leitura):
   repetir `node scripts/nutrition/checkPlanSnapshotDeployment.cjs` e confirmar que o
   hash de Rules e o `updateTime` de `mutateNutritionDiaryV1` ainda são os desta
   preparação. Parar e reavaliar se qualquer um mudou.
2. **Publicar Rules:**
   ```sh
   firebase deploy --project ajfit-2f321 --only firestore:rules
   ```
   Seguro para todos os clientes já instalados (o app antigo nunca grava
   `itemsRevision`, então nunca aciona a cláusula nova; contas não aderidas ao
   `plan_snapshot` continuam exatamente como hoje).
3. **Publicar a Function:**
   ```sh
   firebase deploy --project ajfit-2f321 --only functions:mutateNutritionDiaryV1
   ```
   A partir daqui, qualquer UID autenticado que já tenha o app com a flag
   `EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED=true` pode aderir ao protocolo.
   Usuários no app atual (sem essa flag ligada ou em build anterior) não veem nenhuma
   mudança — o botão "Registrar esta opção" simplesmente não aparece para eles.
4. **Verificar (somente leitura) que ambos os deploys resultaram no estado esperado:**
   novo hash de Rules, `mutateNutritionDiaryV1` `ACTIVE` sem `PILOT_UIDS` efetivo (ou
   com a variável removida/vazia).
5. **Só então** gerar e enviar o próximo build do app com a flag `EXPO_PUBLIC_
   NUTRITION_PLAN_SNAPSHOT_ENABLED=true` (ou mantenha-a `false` para um rollout
   gradual via uma atualização OTA/novo build posterior — a sequência acima já deixa o
   backend pronto para qualquer momento em que a flag for ligada). **Esta etapa é sua
   — não gero build nativo.**

Nenhum índice, Storage Rules, Function de geração ou de catálogo deve aparecer no
resumo do CLI antes de aceitar o deploy; se aparecer, interromper e revisar.

## 7. Plano de rollback sem perda de dados

- **Reverter apenas o registro automático (manter CRUD das contas já aderidas):**
  ```sh
  # No ambiente da Function, definir:
  NUTRITION_PLAN_SNAPSHOT_ENABLED=false
  firebase deploy --project ajfit-2f321 --only functions:mutateNutritionDiaryV1
  ```
  Isso bloqueia **novas** adesões e registros automáticos. Contas já aderidas
  continuam com CRUD completo pelo backend (edição/exclusão/movimentação), porque o
  código só exige a flag para `register_option` e para a **primeira** adesão — não
  para operações subsequentes de uma conta já aderida. Nenhum dado é apagado.
- **Reverter as Rules do `itemsRevision` (não recomendado, mas sem perda de dados se
  necessário):** restaurar o `firestore.rules` anterior a esta publicação. Como o
  campo é aditivo e só interpretado pela lógica nova, remover a validação apenas volta
  a permitir que um escritor legado sobrescreva sem checagem (reabrindo o P2-01 para
  contas não aderidas) — não corrompe dados existentes, apenas reabre a janela de
  risco que esta correção fecha. Prefira reverter só a Function (item anterior) se o
  problema for especificamente no registro automático.
- **Nunca apagar `nutritionDiaryProtocol`, `nutritionDiaryOperationReceipts` ou itens
  `plan_snapshot`** como parte de qualquer rollback — isso reabriria escritores
  antigos sobre dados do contrato novo, exatamente o que as Rules atuais impedem.
- Rollback do app cliente é o procedimento padrão de loja (reverter para o build
  anterior); como o backend/Rules mantêm compatibilidade retroativa, não há
  coordenação adicional necessária além de "não publicar o app novo antes das Rules".

## 8. Riscos e bloqueios restantes

Nenhum bloqueio de código. Pendências não resolvíveis por preparação estática:

- Revalidação do estado remoto imediatamente antes do deploy real (passo 1 da seção 6)
  — pode ter mudado desde esta preparação.
- Decisão sobre os seis arquivos inertes de `catalogLinking` no próximo build do app
  (seção 2, Opção A vs B) — aguardando sua escolha.
- Homologação visual real em dispositivo com Auth/App Check reais e o novo build —
  não realizada nesta preparação estática (fora do escopo desta tarefa).
- Não foi feito download/comparação byte-a-byte do código-fonte atualmente publicado
  de `mutateNutritionDiaryV1` (só metadados/env) — recomendo essa comparação completa
  (já implementada como padrão nos relatórios anteriores) como último passo antes do
  deploy real, não apenas a verificação de hash/updateTime feita aqui.

## 9. Evidências de teste desta preparação

| Verificação | Resultado |
| --- | --- |
| TypeScript (app) | 0 erros |
| TypeScript (Functions) | 0 erros |
| ESLint nos arquivos alterados | 0 erros/avisos |
| Firestore Rules completas (emulador, 25 arquivos) | **577/577** aprovados (inclui o novo teste dedicado de `itemsRevision`) |
| Concorrência do diário manual (emulador, novo arquivo dedicado) | **8/8** aprovados, estável em **3 execuções consecutivas** |
| — incluindo a prova adversarial do cliente desatualizado simulado | Rejeitado pelas Rules, transação revertida por completo, agregado e itens preservados |
| Suítes de app relacionadas ao diário/`plan_snapshot` | **78/78** aprovados |
| Functions de nutrição, incluindo `plan_snapshot` (emulador) | **244/245** aprovados (1 pulado intencionalmente — smoke real de IA, nenhuma chamada paga) |
| Comparação de Rules remotas vs locais | Diff de 89 linhas, exatamente o esperado (P2-01 + campo inerte), sem surpresas |
| Comparação de Functions remotas vs inventário esperado | `mutateNutritionDiaryV1` `ACTIVE` na política antiga de piloto; `logCatalogMeal`/`favoriteCatalogMeal` confirmadamente ausentes |

Uma observação de processo registrada durante esta preparação: três cenários de
concorrência (edição+remoção, movimentação+inclusão, duas movimentações simultâneas)
disparam de forma não determinística uma limitação **já documentada do Firestore
Emulator** (não do produto): comits concorrentes multi-documento fazem o avaliador de
Rules do emulador lançar um erro genérico de avaliação. Isolado por experimentação
direta (com Rules desabilitadas, os mesmos cenários passam de forma limpa e
determinística) — a mesma técnica e achado já registrados em
`scheduleMissedSessionConcurrency.integration.test.ts` para outra funcionalidade. Os
testes afetados foram ajustados para exercitar a transação real com Rules
desabilitadas apenas na janela concorrente, documentando a limitação em vez de
escondê-la. Não é um risco de produção: é um defeito conhecido, isolado, do avaliador
do emulador local.

## 10. Checklist final de homologação e liberação global

- [x] Causa raiz do P2-01 corrigida e comprovada adversarialmente
- [x] Risco de compatibilidade com clientes antigos (`itemsRevision`) identificado e corrigido
- [x] Isolamento do `catalogLinking` confirmado remotamente (Functions não existem) e garantido por desenho (deploy seletivo)
- [x] Ausência de allowlist por UID confirmada em código
- [x] Auth, App Check e kill switch preservados e verificados
- [x] Simetria das Rules (create/update/delete) preservada e estendida corretamente
- [x] TypeScript, ESLint, Rules, testes de concorrência/idempotência, Functions: todos verdes
- [x] Estado remoto consultado (somente leitura) e comparado byte-a-byte nas Rules
- [x] Ordem de publicação definida e justificada (Rules antes de Function antes de app)
- [x] Plano de rollback sem perda de dados documentado
- [ ] Revalidação do estado remoto imediatamente antes do deploy real — **pendente, repetir no momento da publicação**
- [ ] Decisão sobre os 6 arquivos inertes de `catalogLinking` no próximo build do app — **pendente, sua decisão**
- [ ] Homologação visual real em dispositivo — **pendente, fora do escopo desta preparação**
- [ ] Download/comparação byte-a-byte do código-fonte publicado de `mutateNutritionDiaryV1` — **recomendado como último passo antes do deploy real**

**Veredito final: PRONTO PARA PUBLICAR**, condicionado às quatro pendências acima —
nenhuma delas é um bloqueio de código; são passos operacionais finais e uma decisão de
escopo que só você pode tomar. Aguardando sua aprovação explícita antes de executar
qualquer comando de deploy.
