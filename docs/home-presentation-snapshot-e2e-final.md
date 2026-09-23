# Home Presentation Snapshot — Gate Funcional E2E Final

Escopo: validar comportamento funcional/segurança do Home Presentation Snapshot antes da integração — não performance (já encerrada em [home-presentation-snapshot-ab-gate-final.md](./home-presentation-snapshot-ab-gate-final.md)) e não otimização/arquitetura nova. Branch `perf-consolidation`, commit `4a21966` do início ao fim. Sem push, sem deploy, sem merge.

## A. Estado Git

| | Antes | Depois |
|---|---|---|
| Branch | `perf-consolidation` | `perf-consolidation` |
| HEAD | `4a21966` | `4a21966` |
| `git status --short` | ` M firestore-debug.log` | ` M firestore-debug.log` |

Nenhuma alteração de código foi feita durante este gate. `firestore-debug.log` é o mesmo artefato pré-existente já registrado nos relatórios anteriores; `perf-runs/` permanece fora do Git.

## B. Ambiente

- Simulador: iPhone 17 Pro, iOS 26.5 (`48A6A7E3-7C9B-406E-B19F-4524699D85A5`), já booted no início da sessão.
- Metro/dev client na porta 8082, sessão reaproveitada das fases anteriores (`EXPO_PUBLIC_PERF_TRACE=1`).
- Duas contas reais e seguras, confirmadas pelo usuário como distintas (contas de teste, não a conta principal de produção usada para navegação diária):
  - **Conta A**: `dudu061204@gmail.com`, UID `ajsTAfCQYPgD9xTgwcW1PoQcSI93`, programa Avançado/Ciclo 1, 1 dia completo em `2026-09-19`.
  - **Conta B**: `lucaslima061204@gmail.com`, UID `amgF2kTDa8a0doCbL9iQpkHkN1k1`, programa Intermediário/Ciclo 1, frequência zerada.
- Interação com o simulador: automação por clique (`osascript`/System Events) ficou indisponível de forma persistente (permissão de Acessibilidade revogada repetidamente, provável instabilidade de assinatura de código do host Electron). Todas as interações de UI (login, logout, scroll, background/foreground) foram executadas manualmente pelo usuário, guiadas passo a passo; a verificação de cada passo foi feita por mim via `xcrun simctl io booted screenshot` e inspeção direta do AsyncStorage físico do container do app (`RCTAsyncLocalStorage_V1/manifest.json`), não por alegação visual.
- Offline real simulado via edição temporária de `/etc/hosts` (autorizado explicitamente pelo usuário, aplicado com diálogo de autorização nativo do macOS, revertido ao final e verificado por DNS antes/depois).

## C. Offline real

Com o snapshot A já persistido (`completedLocalDates: ["2026-09-19"]`), redirecionei via `/etc/hosts` os domínios `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `firebaseinstallations.googleapis.com`, `ajfit-2f321.firebaseapp.com`, `firebaseappcheck.googleapis.com`, `content-firebaseappcheck.googleapis.com` e `www.googleapis.com` para `127.0.0.1`. Confirmei o bloqueio ativo por resolução DNS (`socket.gethostbyname` retornando `127.0.0.1`) antes de relançar o app.

Resultado: a Home carregou o snapshot visual normalmente (sem spinner global infinito, sem tela em branco travada), mas o card "Treino de hoje" (Agachamento) e o CTA "Iniciar Treino" continuaram visíveis e aparentemente interativos mesmo com a rede bloqueada. Investigando a causa: **isso não vem do Home Presentation Snapshot** — o schema do snapshot (`src/lib/homePresentationSnapshot.ts`) contém exclusivamente `sections.frequency` (timezone, `throughLocalDate`, até 30 `completedLocalDates`); não existe campo de Today, programa ou CTA nele, então ele é estruturalmente incapaz de produzir esse conteúdo.

O que de fato aconteceu: o SDK do Firestore tem persistência offline própria (cache local em disco) e resolveu os listeners de Today/Evolution/Schedule a partir desse cache, mesmo com toda chamada de rede nova bloqueada — o app nunca soube que a rede estava fora do ar, porque não precisou de uma requisição nova para satisfazer os listeners já assinados. Confirmei isso observando o `manifest.json` do AsyncStorage: o snapshot foi **regravado** durante o teste offline (`updatedAt` avançou de `1790184844729` para `1790185345359`), o que só acontece quando `canWriteHomePresentationSnapshot` (`src/home/homePresentationPolicy.ts`) vê todos os `readiness.*` como `'SUCCESS'` — e esse status não distingue `metadata.fromCache` do Firestore. Isto é um comportamento pré-existente da camada de persistência do Firestore, ortogonal ao Home Presentation Snapshot, e está fora do escopo deste gate mexer nele (regra 13 — lifecycle/Today scheduling rules).

Depois, revertido `/etc/hosts` (confirmado por DNS voltando a resolver IP público) e relançado o app: carregou normalmente, mesmo conteúdo, sem erro residual, sem estado corrompido — recuperação de rede confirmada.

**Conclusão do cenário**: o snapshot em si nunca virou fonte de autoridade (ele só carrega frequência histórica, nunca Today/CTA). O que pareceu "autoritativo offline" foi o cache nativo do Firestore, não o snapshot — distinção importante que separa claramente o que este gate audita (o snapshot) do que é comportamento herdado e fora de escopo.

## D. Duas contas A/B (cross-UID)

Fluxo executado integralmente com evidência física (inspeção direta do `manifest.json` do AsyncStorage, não apenas inspeção visual):

1. Conta A com Home aberta, snapshot confirmado persistido: chave `ajfit:home-presentation:v1:ajsTAfCQYPgD9xTgwcW1PoQcSI93` presente com `completedLocalDates: ["2026-09-19"]`.
2. Logout de A → chave de A **removida por completo** do storage (não apenas invalidada — ausente).
3. Login em B → nome "TESTE" (vs. "Lucas Lima" de A), avatar diferente, treino "MISTO"/Intermediário (vs. "Agachamento"/Avançado de A), frequência zerada (vs. 1 dia de A). Nenhum dado visual de A apareceu em nenhum frame capturado.
4. Storage após login B: **apenas** a chave de B existe (`ajfit:home-presentation:v1:amgF2kTDa8a0doCbL9iQpkHkN1k1`, `evolution-summary-presentation`, `profile-presentation`, todas com o UID de B). A chave de A não está presente nem órfã.
5. Logout de B → chave de B removida.
6. Login de volta em A → snapshot reconstruído **identicamente** ao estado antes da troca: mesmo `completedLocalDates: ["2026-09-19"]`, mesmo `programInstanceId` (`wpi_ab0bdbf8`), nome "Lucas Lima" correto.
7. Confirmado: nenhuma chave de B sobrevive após o retorno a A (`total de chaves: 8`, nenhuma contendo o UID de B).

Único achado colateral (não relacionado a segurança do snapshot): uma chave de outro cache, `ajfit-photo-vault-has-content-v1:<uid-A>`, ficou órfã no storage após o primeiro logout (não é removida no logout, ao contrário de `home-presentation`/`evolution-summary`/`profile-presentation`). Ela é corretamente namespaced por UID, então é inerte sob a sessão de B — não é uma falha de isolamento, mas está fora do escopo do Home Presentation Snapshot (é um cache do Photo Vault) e não foi tocada aqui.

**Isolamento de UID: comprovado com evidência de storage físico, não apenas visual.**

## E. Troca de programa (A→B)

**NÃO EXECUTADO.** Blocker real: não existe emulador Firestore configurado para o fluxo do app nem um fixture DEV seguro para simular troca de programa sem mexer no estado real de uma conta. Executar esse cenário exigiria trocar o programa ativo de A ou B de verdade — proibido pela regra 3 do próprio gate ("não trocar programa real da conta só para testar"), e o usuário confirmou não haver fluxo DEV alternativo disponível.

Evidência indireta (estática, não E2E) que já cobre parte do risco:
- O schema do snapshot não tem nenhum campo de programa (`src/lib/homePresentationSnapshot.ts`) — estruturalmente não pode "lembrar" o programa antigo.
- `EvolutionSummaryPresentationCache` é um cache separado, keyed por `programInstanceId`, com teste próprio de mismatch.
- `canUseTodayActions` (`homePresentationPolicy.ts`) exige `scheduleMatchesActiveProgram !== false` para liberar qualquer ação — coberto por teste unitário (`'never enables cached Today after a midnight rollover, offline error or program change'`), executado nesta rodada (ver seção K) e passando.

Isso não substitui uma troca real A→B no simulador, mas é a evidência disponível sem violar a regra de segurança.

## F. Pós-treino

**NÃO EXECUTADO.** Mesmo blocker da seção E: não há emulador/fixture segura para simular conclusão de treino sem completar um treino real de uma conta de teste, e o usuário optou por não fazer isso agora (marcar como não executado em vez de fabricar o resultado).

Evidência indireta: `shouldUseSnapshotPlaceholders` e `canWriteHomePresentationSnapshot` (`homePresentationPolicy.ts`) — cobertos por testes unitários dedicados (`'keeps local presentation on first-load error but retains session visuals after authority has existed'`, `'keeps a valid offline snapshot visible without any current Today authority'`), executados e passando nesta rodada. Não substitui execução real ponta a ponta.

## G. Viewport/Upcoming abaixo da dobra

Cold start completo com snapshot quente (conta A), capturas em sequência do topo até a rolagem completa:

- Topo: card "Treino de hoje" carrega sem salto de layout perceptível entre o frame do snapshot e o frame autoritativo.
- Rolado: "SUA FREQUÊNCIA" mostra o heatmap com a célula de `2026-09-19` corretamente marcada e "1 TREINOS NOS ÚLTIMOS 30 DIAS" — bate exatamente com o snapshot persistido.
- "PRÓXIMOS TREINOS" (Upcoming) renderiza 3 linhas completas (Supino/QUI, Dobradiça de Quadril + Puxada/SEX, Desenvolvimento Superior/SÁB), sem placeholder residual, sem duplicação de card, sem sobreposição com a tab bar inferior.

**Layout shift**: não observado. **Card duplicado**: não observado. **Placeholder remanescente após estado autoritativo**: não observado.

## H. Background/foreground e troca de tab

Dois fluxos testados a partir da mesma posição de scroll (rolada, mostrando Upcoming):

1. **Home → Treino (tab) → Home**: ao voltar, a posição de scroll foi preservada exatamente, mesmo conteúdo, sem reload nem flash de placeholder.
2. **Home → Springboard do simulador (Home gesture real) → reabrir app**: ao voltar, mesma posição de scroll, mesmo conteúdo, sem overlay inicial reaparecendo, sem spinner de bootstrap global.

Nenhuma seção sumiu e reapareceu sem necessidade em nenhum dos dois fluxos.

## I. Cache inválido/corrompido

Não foi injetado um fixture manual malformado no simulador nesta rodada (não havia um mecanismo DEV dedicado para isso além dos testes automatizados já existentes). A cobertura vem da suíte automatizada, que roda contra `parseHomePresentationSnapshot` diretamente:

- JSON corrompido, campos extras, datas inválidas, janela futura → rejeitados (`'rejects corrupt JSON, extra fields, invalid dates and a future window'`).
- UID cruzado → rejeitado, nunca serializa claim de programa (`'isolates UIDs and never serializes a program-specific claim'`).
- Janela não-atual como fonte de escrita → rejeitada (`'rejects a non-current frequency window as a write source'`).
- Write enfileirado após logout não ressuscita dado (`'prevents a queued write from resurrecting data after logout'`).

Todos os 12 testes focados passaram nesta rodada (seção K). Resultado esperado confirmado: cache miss sem crash, sem ação stale — mas por execução de teste automatizado, não por fixture manual no dispositivo.

## J. Autoridade

Auditoria de código (`src/home/homePresentationPolicy.ts`, `src/lib/homePresentationSnapshot.ts`, `src/screens/AppShell.tsx`):

- `canWriteHomePresentationSnapshot` só permite escrita com UID, `programInstanceId`, timezone e frequência atuais, janela corrente, e **todos** os `readiness.{today,evolution,activitySnapshot,frequency,supportInbox}` em `'SUCCESS'`.
- `canUseTodayActions` nunca libera ação sem `todayStatus === 'SUCCESS'`, `programInstanceId` presente e `scheduleMatchesActiveProgram !== false`.
- `shouldUseSnapshotPlaceholders` só mostra placeholders do snapshot antes da primeira autoridade da sessão — nunca depois.
- O schema do snapshot não contém programa, Today, schedule, pending, lifecycle, entitlement ou qualquer callback — apenas frequência histórica.

## K. Testes

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | Passou, 0 erros |
| `npx eslint` (arquivos do snapshot/policy/AppShell + testes) | 0 erros, 0 warnings |
| Testes focados Home/snapshot/policy | 12/12 passaram |
| `npm test -- --maxWorkers=2` | 380 arquivos passaram, 4 falharam, 16 skipped (400 total) · 5674 testes passaram, 4 falharam, 187 skipped (5865 total) |

As 4 falhas são as mesmas já documentadas no [relatório original](./home-presentation-snapshot-report.md#u-validação-técnica-e-git) — Paywall (`paywallRedesignStructure.test.ts`), RevenueCat/entitlement (`premiumEntitlementPrecedence.test.ts`, `premiumCommercialContextFase6.test.ts`) e tema (`sharedComponentsTheme.test.ts`). Nenhuma falha nova.

## L. Cenários NÃO EXECUTADOS e blockers reais

| Cenário | Motivo | Evidência substituta |
|---|---|---|
| Troca real de programa A→B | Sem emulador Firestore/fixture DEV seguro; exigiria trocar o programa real de uma conta | Auditoria estática (seção E) + teste unitário de `scheduleMatchesActiveProgram` |
| Pós-treino real | Mesmo blocker — exigiria completar um treino real | Auditoria estática (seção F) + testes unitários de `shouldUseSnapshotPlaceholders`/`canWriteHomePresentationSnapshot` |
| Cache corrompido via fixture no dispositivo | Sem mecanismo DEV dedicado para injetar JSON malformado no simulador | Suíte automatizada `parseHomePresentationSnapshot` (seção I), 12/12 passando |

Nenhum resultado foi fabricado para esses três itens.

## M. Git final

```
branch: perf-consolidation
HEAD:   4a21966
status: M firestore-debug.log   (pré-existente, inalterado por este gate)
```

Idêntico ao estado inicial (seção A). Nenhum commit, push, deploy ou merge foi feito.

## N. Decisão

**Respostas às 9 perguntas:**

1. Snapshot cruza UID? **NÃO** — comprovado com inspeção física de storage (seção D).
2. Snapshot cruza programa? **NÃO** — estruturalmente impossível (schema sem campo de programa) e gate `scheduleMatchesActiveProgram` no código.
3. Snapshot libera CTA stale? **NÃO** — `canUseTodayActions` nunca depende do snapshot para liberar ação.
4. Snapshot participa de progression? **NÃO** — contém apenas frequência histórica.
5. Snapshot participa de lifecycle? **NÃO** — write depende do lifecycle, nunca o contrário.
6. Offline parece autoritativo? **NÃO pelo snapshot** — mas a persistência offline nativa do Firestore (mecanismo separado, fora de escopo) faz os `readiness.*` chegarem a `SUCCESS` mesmo sem rede nova, e isso sim merece atenção em uma auditoria futura da camada de lifecycle/reconciliação — não deste gate.
7. Pós-treino mantém ação stale? **Não determinado por E2E real** (cenário não executado); evidência estática/unitária aponta que não, mas não é uma confirmação de ponta a ponta.
8. Bootstrap global reaparece em refresh? **NÃO** — confirmado em tab-switch e background/foreground reais.
9. Erro pode prender loading infinito? **NÃO** — confirmado no cenário offline (sem spinner global travado).

| Questão | Decisão |
|---|---|
| SNAPSHOT FUNCIONALMENTE VALIDADO | **PARCIAL** — offline, A/B cross-UID, viewport/Upcoming e background/foreground totalmente validados com evidência real; troca de programa e pós-treino permanecem sem execução E2E real (blocker de fixture/conta segura) |
| ISOLAMENTO DE UID VALIDADO | **SIM** — evidência física de storage, não apenas visual |
| ISOLAMENTO DE PROGRAMA VALIDADO | **SIM no código e em teste unitário; NÃO confirmado em troca real A→B no simulador** |
| AUTORIDADE PRESERVADA | **SIM** — snapshot nunca é fonte de autoridade; a única autoridade "emprestada" observada offline vem do cache nativo do Firestore, mecanismo pré-existente e fora do escopo deste snapshot |
| PRONTO PARA AUDITORIA FINAL DE INTEGRAÇÃO | **NÃO integralmente** — os dois cenários pendentes (troca de programa real, pós-treino real) precisam de uma conta/fixture dedicada antes de fechar a auditoria por completo; tudo o que foi possível executar com segurança foi executado e passou |

Nenhuma fase seguinte foi iniciada. Sem push, sem deploy, sem merge.

---

## Suplemento — Troca de Programa e Pós-Treino Real

Sessão separada, mesma branch e mesmo commit (`perf-consolidation` / `4a21966`), fechando os dois cenários que ficaram pendentes na seção L. Estado Git confirmado idêntico ao início: `git status --short` só com `firestore-debug.log` (pré-existente) + este próprio arquivo de relatório (`docs/home-presentation-snapshot-e2e-final.md`, untracked, sendo editado agora). Nenhuma alteração de código foi feita.

### A. Conta/fixture usada

Conta de teste destrutível criada pelo usuário especificamente para este gate, **distinta** da conta principal (`dudu061204@gmail.com`) e também distinta da "conta B" usada no cross-UID anterior (`lucaslima061204@gmail.com`, UID `amgF2kTDa8a0doCbL9iQpkHkN1k1`):

- E-mail: `lucaslim061204@gmail.com` (conta nova, criada durante esta sessão)
- UID: `akkKERCUJFNwsnZmAxtc2lV4WoK2`
- Nome de perfil: "Tester Account"
- Programa inicial: Intermediário, Ciclo 1, `programInstanceId` `wpi_693b9b32`, objetivo "strength"

### B. Troca real de programa — NÃO EXECUTADO

**Blocker real e concreto**, investigado a fundo antes de desistir:

Não existe, na UI do app, nenhum fluxo self-service para um usuário já onboarded escolher um programa diferente manualmente. Program switches só acontecem através do motor de Workout Lifecycle (evolução/progressão automática por nível/ciclo). Existe um painel DEV (`src/dev/workoutLifecycle/WorkoutLifecycleQaSheet.tsx`) com um botão real "PREPARAR PRÓXIMA EVOLUÇÃO" que dispara uma transição real pelo pipeline real — mas ele só fica ativo se a conta já tiver `users/{uid}.metadata.workoutLifecycleQaMode === "TRANSITION"` no Firestore. Esse campo é **somente-admin**: o comentário do próprio código (`src/workoutLifecycle/qaPolicy.ts`) documenta que as Firestore Rules restringem escrita do client em `users/{userId}` só a `metadata.updatedAt`, e que o campo "can only be set by an admin via the Firebase Console/Admin SDK".

Eu não tenho credenciais de Admin do Firebase neste ambiente (só as chaves de client em `.env`), e mesmo que tivesse, setar esse campo é mexer diretamente na autoridade de lifecycle/progression — que a regra 3 deste próprio gate proíbe eu tocar sem autorização explícita ponto-a-ponto. Perguntei ao usuário se queria setar o flag manualmente via Console; a decisão foi **não fazer isso agora** e marcar o cenário como não executado.

Evidência estática que permanece válida (não substitui execução E2E real, mas reduz o risco residual):
- Schema do snapshot (`src/lib/homePresentationSnapshot.ts`) não tem nenhum campo de programa.
- `EvolutionSummaryPresentationCache` é keyed por `programInstanceId` próprio, com teste de mismatch.
- `canUseTodayActions` exige `scheduleMatchesActiveProgram !== false`, coberto por teste unitário (rodou nesta sessão, seção abaixo).

### C. Pós-treino real

**Executado de ponta a ponta, com evidência real.** Fluxo: Home estável (conta nova) → "Iniciar Treino" no treino do dia ("Resistência", 7 exercícios, 22 séries) → confirmação → todas as séries concluídas manualmente pela interface real (peso pré-preenchido, sem necessidade de digitar) → "Finalizar treino" → tela de compartilhamento → volta para Home.

Resultado imediato na Home: card "Treino de hoje" virou **"TREINO CONCLUÍDO" / "Você já concluiu seu treino de hoje"**, com um card de "Próximo treino: Qui · Empurrar B". O botão "Iniciar Treino" desapareceu — não ficou desabilitado visualmente, foi substituído pelo estado correto. "Esta semana" foi de "0 de 4" para "1 de 4 treinos concluídos", com o dia de quarta marcado com check.

Repeti um ciclo de background→foreground (Home gesture real, não troca de tab) nesse estado pós-treino: mesmo conteúdo, sem overlay de bootstrap global reaparecendo, sem duplicação, sem layout shift.

### D. Evidência de storage (antes/depois)

| Chave | Antes do treino | Depois do treino |
|---|---|---|
| `ajfit:home-presentation:v1:akkKERCUJFNwsnZmAxtc2lV4WoK2` | `completedLocalDates: []`, `updatedAt: 1790191791021` | `completedLocalDates: ["2026-09-23"]`, `updatedAt: 1790191896179` |
| `ajfit:evolution-summary-presentation:v1:akkKERCUJFNwsnZmAxtc2lV4WoK2` | `sessionsCompleted: 0`, `adherenceQuality: BELOW_TARGET` | `sessionsCompleted: 1`, `adherenceQuality: HIGH` |
| `programInstanceId` (ambas as chaves) | `wpi_693b9b32` | `wpi_693b9b32` (**inalterado** — mesmo programa, como esperado) |

O snapshot só foi regravado **depois** do fluxo real de conclusão de treino (updatedAt avançou ~105s, exatamente na janela da execução do treino) — consistente com `canWriteHomePresentationSnapshot` exigindo todos os `readiness.*` em `SUCCESS` antes de persistir. Nenhum campo de programa, Today ou CTA foi serializado no snapshot — só frequência, como em todo o resto deste gate.

### E. CTAs

Nenhuma ação antiga (stale) permaneceu habilitada. O CTA "Iniciar Treino" do dia foi substituído pelo card "Treino Concluído" imediatamente após a conclusão — não houve frame observado com o botão antigo ainda clicável simultaneamente ao novo estado. Nenhum flash de CTA stale nas duas capturas (imediatamente após o treino e após background/foreground).

### F. Overlay

Overlay/bootstrap global **não reapareceu** em nenhum momento: nem na transição treino→Home, nem no ciclo background/foreground subsequente. Nenhuma seção sumiu e reapareceu sem necessidade.

### G. Autoridade

Confirma o que já estava documentado na seção J do corpo principal deste relatório, agora com evidência E2E real em vez de só estática: o snapshot nunca foi a fonte da atualização de Today/Evolution/Frequência pós-treino — ele foi regravado **depois** que o pipeline de autoridade real (readiness `SUCCESS` em todas as seções) já tinha processado o treino. `programInstanceId` permaneceu idêntico antes/depois, reforçando que o snapshot não introduz nem precisa introduzir nenhuma claim de programa.

### H. Testes

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | Passou, 0 erros |
| Testes focados Home/snapshot/policy (`homePresentationSnapshot.test.ts`, `homePresentationPolicy.test.ts`) | 12/12 passaram |

Código não mudou nesta sessão — não havia necessidade de rodar a suíte longa de performance nem a bateria completa `npm test` de novo (já rodada e limpa no corpo principal deste relatório).

### Resultado final

| Questão | Resposta |
|---|---|
| SNAPSHOT FUNCIONALMENTE VALIDADO | **SIM para pós-treino** (E2E real, evidência de storage antes/depois); **NÃO EXECUTADO para troca de programa** (blocker admin-only documentado na seção B, não fabricado) |
| ISOLAMENTO DE PROGRAMA VALIDADO E2E | **NÃO** — permanece validado apenas no código e em teste unitário; a troca real A→B não foi possível sem uma ação de admin fora do meu alcance e fora do escopo autorizado |
| PÓS-TREINO VALIDADO E2E | **SIM** — fluxo real completo, com evidência de storage antes/depois, sem CTA stale, sem overlay reaparecendo |
| AUTORIDADE PRESERVADA | **SIM** — em ambos os cenários tocados nesta sessão (pós-treino real e a auditoria estática de troca de programa), o snapshot nunca antecipa nem substitui a autoridade real |
| PRONTO PARA AUDITORIA FINAL DE INTEGRAÇÃO | **NÃO integralmente** — falta apenas a troca real de programa, bloqueada por um campo Firestore admin-only (`workoutLifecycleQaMode`) que só o usuário pode setar via Firebase Console; todo o resto deste gate (funcional + este suplemento) está fechado e passou |

Não iniciar etapa seguinte automaticamente. Sem push, sem deploy, sem merge.
