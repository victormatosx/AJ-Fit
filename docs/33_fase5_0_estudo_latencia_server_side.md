# Fase 5.0 — Estudo Arquitetural / Prova de Latência (Server-Side Evolution)

Status: Estudo concluído — SEM implementação de migração, SEM deploy, SEM push.
Data: 2026-09-21
Branch: `perf-consolidation` @ `24a97e0` (único arquivo modificado no worktree: `firestore-debug.log`, não tocado por este estudo).

Este documento fecha a **Fase 4** (consolidação de latência client-side de Today/Evolution) como concluída e registra o estudo da **Fase 5.0**: se uma fronteira server-side reduziria os round-trips cliente↔Firestore do cold start de Evolution sem enfraquecer consistência.

---

## A. Estado inicial

```
git branch --show-current  → perf-consolidation
git rev-parse --short HEAD → 24a97e0
git status --short         →  M firestore-debug.log
```

Confere com o esperado. Fase 4 encerrada com os resultados já aprovados (Today ~5615ms→~2,0–2,5s; Evolution ~6108ms→~4,0–4,3s pós-mount, sem quebra de barreiras de concorrência).

---

## B. Cadeia atual (cold start de Evolution, caminho dominante NO_ACTION)

Entry point: `src/workoutEvolution/useWorkoutEvolution.ts:120` (`load()`), disparado no mount (`:246-248`), no foreground resume (`:260-294`) e por listeners Firestore de `lifecycleRef`/`pendingEvolutionRef` (`:311-320`).

| # | Etapa | Arquivo:linha | Operação | Onda |
|---|---|---|---|---|
|1|`recoverWorkoutLifecyclePartialState`|`services/workoutLifecycle.ts:211-219`|read `getDoc`+2×`getDocs` (`Promise.all`)|1|
|2|`loadPendingEvolution` (dentro de `reconcileWorkoutLifecycle`)|`services/workoutLifecycleApplication.ts:1117`|read `getDoc`|2|
|3|`loadPendingEvolution` (2ª vez, dentro de `prepareEvolutionAttempt`)|`workoutLifecycleApplication.ts:345-348`|read `getDoc` (duplicata de #2)|3|
|4|`loadOutstandingEarnedFact` → lifecycle pointer|`workoutLifecycleApplication.ts:122-125`→`workoutLifecycle.ts:162`|read `getDoc` (3ª leitura do mesmo doc)|4|
|5|…→ cycle+instance referentes|`workoutLifecycle.ts:166-169`|read `Promise.all`|5|
|6|`listWorkoutLifecycleEventsForProgramInstance`|`workoutLifecycleApplication.ts:128-132`|read `getDocs` (`where programInstanceId==`)|6|
|7|`evaluateProgressionV2ForUserFull` → lifecycle pointer|`services/workoutProgressionV2.ts:171,199-218`|read `getDoc` (4ª leitura)|7|
|8|…→ cycle+instance referentes|`workoutLifecycle.ts:166-169`|read `Promise.all`|8|
|9|batch 7-way: schedule_config, executions, relevant_cycles, schedule_events, prescription_inputs, prescribed_program, policy|`workoutProgressionV2.ts:223-306`|read `Promise.all` (7 itens)|9|
| |*`reconcileWorkoutLifecycle` retorna aqui*| | | |
|10|pointer lifecycle próprio de `useWorkoutEvolution.load()` (+ 3ª leitura de `loadPendingEvolution`, em paralelo)|`useWorkoutEvolution.ts:141-147`|read `getDoc` ×2|10|
|11|…→ cycle+instance referentes|`workoutLifecycle.ts:166-169`|read `Promise.all`|11|
|12|`listWorkoutLifecycleEventsForProgramInstance` (2ª vez, duplicata de #6)|`useWorkoutEvolution.ts:162-165`|read `getDocs`|12|

**Total: 12 ondas sequenciais de rede** no caminho dominante (nada mudou, sem writes). Render é local/derivado (`commitViewModel`, `:97-100,180-189`).

Achados de redundância (não é objeto de micro-otimização adicional nesta fase, mas é o que dimensiona o potencial de Fase 5.0):
- O bundle `workoutLifecycleState/current` + `trainingCycles/{id}` + `programInstances/{id}` é buscado **4 vezes** sequencialmente (ondas 1, 4-5, 7-8, 10-11) sem nenhuma escrita entre elas.
- `pendingEvolution` é buscado **2 vezes** (ondas 2 e 3) sem escrita entre elas.
- `listWorkoutLifecycleEventsForProgramInstance` roda **2 vezes** (ondas 6 e 12).
- `inFlightDedupe` (`src/lib/inFlightDedupe.ts`) só colapsa leituras *concorrentes*; no branch NO_ACTION dominante ele nunca dispara, porque as leituras redundantes acontecem em sequência, não em paralelo.
- `recoverWorkoutLifecyclePartialState` roda incondicionalmente em todo reconcile (cold start, foreground, pós-treino) fazendo 2 varreduras completas de coleção só para provar que nada está parcialmente quebrado.

---

## C. Opções arquiteturais A/B/C

| Opção | RTTs cliente eliminados | Reads que continuam existindo | Writes envolvidos | Atomicidade | Idempotência | Concorrência | Payload risco segurança | Duplicação de domínio |
|---|---|---|---|---|---|---|---|---|
| **A. `evaluateProgression` só** | 2 (ondas 7,8,9 → 1 callable) | Sim — as mesmas 7+ leituras, agora no servidor (Admin SDK) | Nenhum (read-only) | N/A | Trivial (sem write) | Nenhuma — leitura pura, sem corrida com writes | Baixo — só devolve uma decisão derivada, sem dados sensíveis extras | **Nenhuma** — reusa `evaluateProgressionV2` já sincronizado via ADR-016 |
| **B. `prepareEvolutionAttempt`** | ~7 (ondas 2–9 → 1 callable) | Sim, mesmas leituras, server-side | Sim — `prepareEvolution` pode escrever fato "earned" | Precisa transação (write condicional) | Precisa chave de idempotência (padrão já existe em `installActiveWorkoutProgram`/`authorizeMutation`) | Precisa recheck em transação (mesmo padrão do grant de `authorityProvider.ts`) | Médio — write server-side exige o mesmo trust boundary de `authorizeWorkoutLifecycleMutation` | Baixa — orquestração de write já teria que se apoiar no grant existente, mas a decisão em si já é compartilhada |
| **C. `reconcile` + snapshot final** | ~9-11 (ondas 1–9, possivelmente 10-12 se hydration também consumir a resposta) | Sim | Sim — todo o reconcile, incluindo `activatePendingEvolution`/`adaptWorkoutProgram` | Requer transação full-scope, replicando `reconcileWorkoutLifecycle` inteiro no servidor | Requer o mesmo padrão de dois estágios (pré-check + recheck em transação) já usado em `installActiveWorkoutProgram` | Alta complexidade — precisa replicar todos os guards de `workoutLifecycleApplication.ts` (staleness checks, grants) | Alto — função concentra toda a superfície de escrita crítica de lifecycle | Alta — arrisca uma segunda cópia de orquestração de write, não só de decisão pura |

Maior potencial bruto: Opção C. Menor risco/complexidade: Opção A. Opção B fica no meio — ainda write-bearing, então herda a complexidade de transação/idempotência de C sem eliminar tantas ondas quanto C.

---

## D. Reuso de domínio

**Já resolvido, não é um refactor pendente.** `evaluateProgressionV2` (`src/progressionEngineV2/resolver.ts:21`) e módulos irmãos (`prescriptionEvolution`, `workoutPrescription`, `scheduleEngine/{calendar,resolver,localDate}`) são funções puras — sem `firebase/firestore`, sem React Native/Expo, sem alias de path — e já são espelhadas byte-idênticas (exceto header gerado) para `functions/src/workoutLifecycle/prescriptionEngine/` e `functions/src/workoutLifecycle/scheduleEngine/` via `scripts/syncPrescriptionEngineToFunctions.cjs` e `syncScheduleEngineToFunctions.cjs`, rodando como `prebuild`/`pretypecheck`/`pretest` (`functions/package.json`). Isso é o mecanismo formalizado em **ADR-016** (Phase 10B) e já está em uso em produção: `functions/src/workoutLifecycle/authorizeMutation.ts:17-20,293` chama `resolveProgressionV2Config`/`evolveCycle` e `resolveWorkoutSchedule` server-side hoje.

O que falta para Opção A: **nada em termos de lógica**. Só falta um handler read-only novo que:
1. faz as leituras via Admin SDK (mirror do que `evaluateProgressionV2ForUserFull` faz via client SDK);
2. monta o mesmo `ProgressionSnapshotV2`;
3. chama a `evaluateProgressionV2` já sincronizada;
4. devolve o payload mínimo.

Não é necessário criar uma segunda versão das regras — só um orquestrador de leitura novo, análogo ao que `authorizeMutation.ts` já faz para o caso write.

---

## E. Protótipo criado?

**Sim, construído e testado via TDD estrito (red→green a cada teste, confirmado rodando o runner a cada passo).**

Arquivos (verificados no worktree, não apenas reportados):
- `functions/src/workoutLifecycle/prototypes/serverEvaluateProgression.ts` (225 linhas) — exporta `buildProgressionSnapshotV2FromFirestore(uid, firestore, now)` (fetch/orquestração via Admin SDK, espelhando `evaluateProgressionV2ForUserFull`) e `serverEvaluateProgressionHandler(request, firestore?, now?)` (auth + validação de payload + payload mínimo de saída). **Não exportado em `functions/src/index.ts`** — confirmado via `git diff --stat -- functions/src/index.ts` vazio.
- `functions/src/workoutLifecycle/prototypes/__tests__/serverEvaluateProgression.integration.test.ts` (284 linhas, 11 testes) — contra Firestore Emulator real (local), gated por `SERVER_EVALUATE_PROGRESSION_INTEGRATION=1`, mesmo padrão de `installActiveWorkoutProgram.integration.test.ts`.

Evidência de execução real (não apenas alegação):
- Antes do handler existir: `Cannot find module '../serverEvaluateProgression'` → RED confirmado.
- 1ª implementação: `6 failed | 4 passed (10)` — as 6 falhas eram testes escritos errado (esperavam `NO_ACTION` onde a decisão real correta é `PROGRESS_CONTINUES`; `NO_ACTION` só ocorre com execução em andamento) — corrigidas as asserções, não o handler.
- Após correção: `10 passed (10)`.
- Após teste de equivalência adicional: `11 passed (11)`.
- `npx tsc --noEmit`: 1 erro real de tipo (`sets[].status` alargado para `string`), corrigido para o union `'COMPLETED'|'SKIPPED'|'PENDING'`; recompilação limpa.

Emulador rodado e **parado** ao final; nenhum `firebase deploy`/`firebase functions:deploy`/`git push` foi executado em nenhum momento.

### Lacunas documentadas (não escondidas)

O protótipo é deliberadamente incompleto em três pontos, cada um com `throw unimplemented` testado explicitamente em vez de falhar silenciosamente:
1. `ProgramInstance` com schedule flexível — não suportado.
2. Fallback legado de questionário por conta (só o caminho `ProgramInstance.prescriptionInputSnapshot` embutido é suportado).
3. **Nenhuma fixture de decisão EARNED** (`LEVEL_PROMOTION_ELIGIBLE`/`EVOLUTION_ELIGIBLE`/`MOTIVATIONAL_RENEWAL_AVAILABLE`) — alcançar esses branches exigiria replicar à mão o calendário MON/WED/FRI (`trainingDayOccurrences`) na fixture, considerado não valer o esforço para um protótipo estrutural. Em vez disso, cada nível (BEGINNER/INTERMEDIATE/ADVANCED) é provado via o branch `PROGRESS_CONTINUES`, que já valida que a query de nível/earned-cycle está corretamente montada — o branch EARNED em si já é coberto pelos testes unitários client-side de `evaluateProgressionV2`, que este protótipo reusa sem modificação (não reimplementa).

Isso significa que a cobertura de fixtures da seção 13 do pedido original foi atendida **parcialmente**: lifecycle inexistente, pending existente, outstanding existente, erro de auth, e UID-do-payload-não-pode-trocar-identidade estão cobertos; BEGINNER/INTERMEDIATE/ADVANCED estão cobertos apenas no branch PROGRESS_CONTINUES, não em toda combinação de decisão. App Check em si é reforçado no wrapper `onCall({enforceAppCheck:true})`, fora do escopo de um teste de handler — mesma fronteira que o teste de referência de `installActiveWorkoutProgram` também não cobre.

---

## F. Equivalência

Objetivo: mesma decisão que o cliente produz, para as mesmas fixtures, usando a mesma `evaluateProgressionV2` (não uma reimplementação).

**Abordagem real usada: snapshot esperado calculado à mão, não deep-equal cross-SDK.** Ligar o client SDK (`firebase/firestore`) ao ambiente vitest/Node de `functions/` contra o mesmo emulador foi avaliado como complexidade de harness desproporcional para um protótipo estrutural — decisão documentada inline no arquivo de teste, não omitida. Em vez disso, o handler foi refatorado para expor `buildProgressionSnapshotV2FromFirestore` (o `ProgressionSnapshotV2` completo, não só o payload mínimo de saída), e o teste de equivalência compara esse snapshot contra um objeto esperado derivado à mão, usando uma fixture deliberadamente independente de calendário (`activatedDaysAgo: 1`, dias MON/WED/FRI, zero execuções → `activeDays` e `adherence` são deterministicamente `2` e `{ratio:0, quality:'BELOW_TARGET'}` independentemente do dia da semana em que a suíte roda).

Como ambos os lados chamam a **mesma** função pura `evaluateProgressionV2` (importada da árvore sincronizada, não reimplementada), a equivalência de *decisão* já é garantida por construção via ADR-016. O que o teste de equivalência valida de fato é a fidelidade da *tradução* Admin SDK → `ProgressionSnapshotV2`, que é a parte nova escrita neste protótipo — não a lógica de decisão em si.

---

## G. Benchmark estrutural

Sem depender de nenhuma medição de rede — só contagem de requests/ondas/payload a partir do código:

- Cliente hoje (cold start NO_ACTION): **12 ondas sequenciais**, ~15+ documentos lidos no total (com redundância de 4× no bundle lifecycle/cycle/instance e 2× em pendingEvolution e em events).
- Opção A isolada: as ondas 7-9 (3 ondas, 9 reads) colapsam em **1 callable RTT** (que internamente faz as mesmas leituras, mas sem pagar RTT cliente↔Firestore por leitura — o Admin SDK dentro da função paga latência servidor↔Firestore, tipicamente bem menor e sem TLS handshake por request do dispositivo móvel).
- Isso não reduz as ondas 1-6 e 10-12 (que continuam client-side) — logo Opção A sozinha ataca só uma fração do total de 12 ondas.

---

## H. Benchmark local (com ressalva)

O protótipo roda contra Firestore Emulator (correctness apenas). **Firestore Emulator local NÃO representa latência real de cloud** — não há TLS real, não há distância geográfica cliente↔servidor↔Firestore, não há cold start real de container.

O que o benchmark local pode concluir (evidenciado por 11 testes reais contra emulador, não estimativa):
- Correção: o handler monta o `ProgressionSnapshotV2` corretamente a partir de dados via Admin SDK e produz a mesma decisão que a `evaluateProgressionV2` já validada client-side, para as fixtures cobertas em §E.
- O padrão de auth/validação (uid só de `request.auth.uid`, payload forjado rejeitado) funciona como o de `installActiveWorkoutProgram`.

Não medimos overhead de latência do callable/emulador em si — só correctness. Nenhum número de tempo foi coletado, propositalmente (ver ressalva abaixo).

O que o benchmark local **não pode** concluir:
- Se a soma (latência real device→GCP + cold start de container + Admin SDK reads) é de fato menor que as 3 ondas client→Firestore diretas que substitui.
- Isso só é respondível com um teste cloud controlado (§N, pergunta 5).

---

## I. Cold start / regiões

- Região das Functions: nenhum `setGlobalOptions` no projeto; nenhuma configuração de região em `firebase.json`. Único função com região explícita é `cleanupPhotoVaultOrphans` → `us-central1` (co-localizada com KMS, comentário em `kmsClient.ts:21-23`). Todas as demais usam o default 2nd-gen (`us-central1`).
- Região do Firestore: **não está em nenhum arquivo do repo** (`firebase.json`, `.firebaserc`, `firestore.indexes.json`) — é configuração de provisionamento do projeto GCP, fora do controle de versão. Não determinável sem acesso ao console/`gcloud`.
- Runtime: Node 22 (`functions/package.json:8`).
- `minInstances`: **não está setado em nenhuma função do projeto** — todas escalam a zero. Isso significa que **qualquer nova função, incluindo um eventual `serverEvaluateProgression` real, pagaria cold start de container em requests não recorrentes** — o que pode facilmente anular o ganho de RTT em uma parcela relevante das invocações (usuário abrindo o app depois de horas/dias sem uso é exatamente o caso mais comum de cold start de Evolution).
- Nenhuma alteração de `minInstances` foi feita — conforme instruído.

Isso é um risco real e não hipotético para a decisão: **uma função fria pode sim anular o benefício** de colapsar 3 RTTs em 1, se o cold start do container Node 22 + inicialização do Admin SDK ultrapassar o tempo das ~1,4–1,6s que a etapa de progression já consome hoje.

---

## J. Payload proposto (Opção A)

Entrada mínima:
```
{ }  // uid vem de request.auth.uid; nenhum parâmetro identifica o usuário
```
(o protótipo não aceita `programInstanceId`/`uid` do payload — deriva tudo do `request.auth.uid`, seguindo o padrão de `installActiveWorkoutProgram`).

Saída mínima (não documentos Firestore inteiros):
```
{
  progressionDecision: 'NO_ACTION' | 'LEVEL_PROMOTION_ELIGIBLE' | 'EVOLUTION_ELIGIBLE' | 'MOTIVATIONAL_RENEWAL_AVAILABLE' | 'PROGRESS_CONTINUES',
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED',
  computedAtEpochMs: number,
}
```
Sem lifecycle summary, pending summary completo, ou eventos — esses continuam sendo responsabilidade das ondas 1-6/10-12 que a Opção A não cobre. Uma Opção B/C real precisaria de um payload maior e estruturado por bloco (lifecycle summary / pending summary / progression decision / events), como pedido na seção 10 — não projetado em detalhe aqui porque nem B nem C foram prototipados.

---

## K. Progressive rendering (estratégia paralela, sem mudar autoridade)

Classificação dos elementos da área Evolution na Home:

- **A. Puramente informativo, pode aparecer antes do reconcile completo:** nível atual conhecido (`programInstanceId`/`level` já em cache local de sessão anterior), textos estáticos, ícones de estado "carregando avaliação".
- **B. Depende de lifecycle autoritativo (não pode aparecer antes do reconcile, mas pode aparecer antes de `progression`):** existência de `pendingEvolution`, existência de `outstandingEarnedFact` — resultado das ondas 1-6, que terminam bem antes das ondas 7-12.
- **C. Acionável, precisa esperar reconcile completo:** botões de "ativar evolução"/"adaptar programa" — qualquer CTA que dispare uma mutação real precisa do `progressionDecision` final e do grant de autoridade (`authorityProvider.ts`).

Isso sugere que a Home já poderia, em tese, mostrar um estado B (pending/outstanding) ~6 ondas antes do que mostra hoje, sem exibir nada incorreto — desde que o estado B nunca seja tratado como acionável até C resolver. **Não implementado** — é só o mapeamento pedido na seção 11.

---

## L. Segurança

O protótipo segue à risca o padrão de `installActiveWorkoutProgram.ts` (referência, não modificado):
- `request.auth.uid` como única fonte de identidade — nenhum uid do payload é aceito ou usado.
- `enforceAppCheck: true` assumido no wrapper `onCall` (o protótipo em si testa a estrutura do handler, que é chamada diretamente nos testes de integração, replicando o padrão dos testes de `installActiveWorkoutProgram`).
- Dados autoritativos lidos no servidor via Admin SDK — nenhum snapshot crítico fornecido pelo cliente é usado na decisão.
- Validação estrita de argumentos (payload vazio esperado; qualquer campo extra rejeitado).
- Idempotência trivial — é leitura pura, sem write, então não há problema de replay.
- Sem trust em nenhum dado do cliente para a decisão.

---

## M. Custos operacionais

- Sem `minInstances`, o custo incremental de uma eventual Opção A real seria por-invocação (Cloud Functions Gen2 + Firestore reads, que já são pagos hoje independentemente de onde rodam). O custo adicional líquido é pequeno — mas o **cold start** é o risco real, não o custo monetário (§I).
- Opção C teria custo operacional bem maior: mais lógica dentro da função, mais superfície de teste, e duplicaria (ainda que via mesmo código sincronizado) toda a orquestração de transação que hoje só existe client-side.

---

## N. Recomendação

1. **Vale continuar com server-side Evolution?** Sim, mas só a fronteira read-only (Opção A) tem uma relação risco/potencial favorável agora. Opções B e C não têm justificativa suficiente sem um teste cloud controlado primeiro.
2. **Qual fronteira é a menor e mais segura?** Opção A — `evaluateProgression` isolado, read-only, sem writes, reusando domínio já sincronizado (ADR-016).
3. **Existe potencial real de reduzir os ~4s?** Parcial. Opção A ataca 3 das 12 ondas (as que hoje somam ~1,4-1,6s de progression). As ondas 1-6 e 10-12 (recovery, pending duplicado, outstanding, hydration/events) não são tocadas por essa fronteira — reduzi-las exigiria Opção B/C ou, mais simples e mais seguro, eliminar as duplicações client-side identificadas em §B (4× lifecycle/cycle/instance, 2× pendingEvolution, 2× events) — isso é um alvo de otimização client-side pura, não arquitetural, e não foi tocado aqui por estar fora do escopo desta fase.
4. **Cold start pode anular o ganho?** Sim, potencialmente sim — nenhuma função do projeto tem `minInstances`, e não alteramos isso. Isso é a maior incerteza da recomendação.
5. **Precisamos de um teste cloud controlado antes de decidir?** Sim — obrigatório antes de qualquer migração real. O benchmark local (Emulator) só valida correção, não latência.
6. **Progressive rendering pode dar ganho percebido sem risco?** Sim — provavelmente o maior ganho de "percepção" com o menor risco de todo este estudo, porque não muda autoridade nenhuma, só a ordem de exibição de dados já lidos (bloco B do §K pode aparecer ~6 ondas antes do estado atual).

---

## O. Decisão

**FASE 5.0 CONCLUÍDA: SIM**

**PROTÓTIPO SERVER-SIDE JUSTIFICADO: SIM** (Opção A, read-only, já construído localmente — ver §E)

**PRONTO PARA IMPLEMENTAÇÃO ARQUITETURAL: NÃO** — falta o teste cloud controlado (pergunta 5) antes de qualquer decisão de migrar a Opção A (ou qualquer opção) para produção. Este relatório não autoriza deploy nem substituição da implementação atual.
