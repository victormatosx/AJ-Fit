# Fase 5.2 — Progressive Rendering (área Evolution da Home)

Status: Implementado, testado (unitário/estrutural, convenção existente do projeto), **sem verificação visual em Simulator** (ambiente sem device/simulator anexado — ver §M e §L). SEM tocar em backend/Functions/queries. SEM alterar Today/pending#2/#3/outstanding/progressionDecision/RevenueCat/billing/paywall/entitlement/AuthContext/profilePresentationCache/PhotoVault/chat.
Data: 2026-09-21
Branch: `perf-consolidation` @ `7bfc8c6` → HEAD local após este trabalho.

## A. Estado inicial

```
git branch --show-current  → perf-consolidation
git rev-parse --short HEAD → 7bfc8c6
git status --short         →  M firestore-debug.log
```

Confere com o esperado. Fase 5.1 encerrada, decisão "MIGRAÇÃO SERVER-SIDE: AINDA NÃO" mantida — **nada dos 3 blockers foi tocado nesta rodada**, conforme instruído.

---

## B. Mapeamento dos elementos Evolution (real, lido do código — não da Fase 5.1)

| Elemento | Fonte | Disponível em | Depende de reconcile? | Pode renderizar cedo? |
|---|---|---|---|---|
| `EvolutionTicker` — texto "carregando"/"erro" | `tickerItems.ts:45-46` | mount | Não | Já aparece cedo (texto genérico) |
| `EvolutionTicker` MARQUEE — nível ativo, nível ganho, dias ativos, sessões, adesão, proximidade | `viewModel.summary`, via `buildProgressingSummary` | só após `Promise.all` (lifecycle+pending+decision) — **wave 10 da Fase 5.0**, não wave 13 | Parcialmente — `summary` em si NÃO muda com `autoActivationNotice` (ver §E) | **Sim, a partir de agora** (era: só no commit final) |
| `EvolutionTicker` ACTION (headline pending/auto-ativação, CTA "ver evolução") | `viewModel.kind` (qual card mostrar) | só após `autoActivationNotice` resolver — wave 13 | Sim — a ESCOLHA de mostrar isso em vez do marquee depende do notice | Não |
| `ProgramProgressStrip` — título/nível/ciclo/barra de segmentos | `viewModel.summary` | wave 10 | Não (mesma razão do marquee) | **Sim, a partir de agora** |
| `ProgramProgressStrip` — label de status (pronto/adiado/auto-ativado) | `viewModel.kind` | wave 13 | Sim | Não |
| `ProgramProgressStrip` — chevron/tap → abre `EvolutionUnlockScreen` | `isActionable` (kind whitelist) | wave 13 | Sim | Não |
| `EvolutionUnlockScreen` inteira | `viewModel.kind` ∈ {EVOLUTION_READY, EVOLUTION_DEFERRED, AUTO_ACTIVATION_NOTICE} | wave 13 | Sim | Não |
| CTAs "Iniciar"/"Adiar"/"Ver mudanças" | idem + `start()`/`defer()` | wave 13 | Sim (+ grant de autoridade) | Não |

---

## C. Classificação A/B/C/D

- **A. SEGURO IMEDIATO**: nada de domínio — apenas o shell/skeleton do `ProgramProgressStrip` (novo, ver §E) e o texto estático já existente do ticker.
- **B. SEGURO QUANDO SUBETAPA TERMINAR**: `summary` completo (nível ativo, nível ganho, ciclo, dias ativos, sessões, adesão, proximidade) — seguro assim que `lifecycle`+`pendingAfter`+`decision` resolvem (wave 10), **antes** de `instanceEvents`/`autoActivationNotice` (wave 12-13). Achado central desta fase: **`summary` é computado de forma IDÊNTICA dentro de TODOS os kinds terminais possíveis** (`PROGRESSING`, `EVOLUTION_READY`, `EVOLUTION_DEFERRED`, `AUTO_ACTIVATION_NOTICE`) — nunca precisa ser corrigido depois, só complementado por um wrapper.
- **C. SOMENTE APÓS RECONCILE COMPLETO**: qual "wrapper" mostrar (marquee simples vs. card de ação vs. auto-ativação) — isso SIM pode mudar de significado conforme `autoActivationNotice`/`pending` resolvem, então fica gated.
- **D. AÇÕES**: CTAs "Iniciar"/"Adiar"/chevron/tap para abrir a tela de detalhe — inalterados, só liberados no estado terminal, exatamente como hoje.

---

## D. Estado anterior da UI

Único `commitViewModel` por `load()` bem-sucedido, no fim da cadeia inteira (depois de `instanceEvents`+`autoActivationNotice`). Antes disso: `EvolutionTicker` mostra texto estático "carregando"; `ProgramProgressStrip` retorna `null` (nem skeleton — espaço em branco). **Nenhum dado real aparece antes de tudo resolver**, mesmo quando `summary` já é conhecido bem antes.

---

## E. Mudança de state/ViewModel

Menor mudança possível: **um novo kind**, `SUMMARY_READY`:
```ts
| { kind: 'SUMMARY_READY'; summary: ProgressingSummary; noticeUnavailable?: boolean }
```
Commitado uma vez, logo após `lifecycle`+`pendingAfter`+`decision` resolverem — **só na primeira carga** (`isInitialLoad = !hasLoadedOnce.current`, capturado no início de `load()`), nunca em um refresh de background (foreground resume, pós-treino, listener) que já tem um estado resolvido em tela — isso preserva a decisão de design pré-existente ("docs §76": refresh nunca pisca `LOADING`) sem contradizê-la (ver §J).

`buildSummary(decision, lifecycle)` foi extraído (antes inline em `buildEvolutionViewModel`) e é reusado por `buildProvisionalEvolutionViewModel` — zero duplicação de lógica, mesma função pura em ambos os pontos.

`nextViewModelAfterLoad` (reducer puro, `loadReducer.ts`) ganhou um caso: uma falha enquanto `SUMMARY_READY` já está em tela vira `{...previous, noticeUnavailable: true}` em vez de `ERROR` — preserva o conteúdo seguro, sinaliza explicitamente que a parte dependente falhou (Passo 7).

---

## F. Elementos que aparecem cedo

`EvolutionTicker` (marquee) e `ProgramProgressStrip` (nível/ciclo/barra de segmentos) — **automaticamente**, sem nenhuma mudança de código nesses dois arquivos além do necessário para lidar com `noticeUnavailable`, porque ambos já faziam fallback estrutural para "qualquer kind com `.summary`" (a marquee do ticker nunca teve um branch explícito de `PROGRESSING`, só o implícito "else"). Isso é uma confirmação, não uma suposição — os testes da Fase 5.1 (`uxStructure.test.ts`) continuam passando inalterados.

---

## G. Elementos que continuam gated

Headline/CTA de card de ação (ticker ACTION mode), label de status "pronto/adiado/auto-ativado" do strip, chevron/tap, `EvolutionUnlockScreen` inteira, e todas as CTAs de mutação — nenhum desses aparece antes do commit terminal (wave 13), exatamente como antes.

---

## H. CTAs

Auditados todos os pontos de `isActionable`/`canOpen` (`ProgramProgressStrip.tsx`, `EvolutionCard.tsx`, `EvolutionTicker.tsx` MARQUEE-vs-ACTION split, `AppShell.tsx` modal gate) — nenhuma whitelist de kinds acionáveis foi tocada; `SUMMARY_READY` não pertence a nenhuma delas. Teste dedicado prova isso via inspeção de fonte (`progressiveRendering.test.ts`: "never marks SUMMARY_READY as actionable").

---

## I. Erro/retry

Se o commit provisório (`SUMMARY_READY`) já apareceu e a subetapa restante (`instanceEvents`/`autoActivationNotice`) falha: o resumo seguro **permanece em tela** (nunca é apagado), e o `ProgramProgressStrip` mostra a mesma cópia já usada para erro genérico (`evolution:state.error`) no lugar do status de proximidade — nunca finge que está "pronto". Testado em `loadReducer.test.ts` (transição pura) e `progressiveRendering.test.ts` (fiação real no componente).

---

## J. Pós-treino

**Comportamento inalterado**, por design: `isInitialLoad` é `false` em qualquer refresh pós-`hasLoadedOnce` (que inclui o refresh pós-treino), então o commit provisório nunca dispara nesse caminho — a tela mantém o estado anterior visível até o commit terminal da nova carga substituí-lo atomicamente, exatamente como hoje. Isso evita o risco descrito no Passo 9 (mostrar uma parte alterada pelo treino como se já fosse final) da forma mais simples possível: **não introduzindo nenhum estado intermediário nesse caminho**, em vez de tentar gatear campo a campo.

---

## K. Multiusuário/races

Dois mecanismos, nenhum novo:
1. `isCurrent()` (contador de geração já existente) agora também guarda o commit provisório — testado estruturalmente.
2. **`AppShell` é renderizado condicionalmente em `App.tsx:552` (`resolvedScreen === 'app' && <AppShell />`)** — confirmado por leitura direta do código, não suposição. Isso significa que a instância inteira do hook `useWorkoutEvolution` (e seu `viewModel`, que sempre parte de `{kind:'LOADING'}` via `useState`) é desmontada no logout e remontada do zero para o próximo usuário — nenhum fragmento de `SUMMARY_READY` (ou qualquer outro estado) de A pode sobreviver para B, porque não há instância de hook para sobreviver.

---

## L. Performance percebida

**Não foi possível medir em device/Simulator real nesta sessão — não há Simulator/emulador anexado a este ambiente, nem conta Firebase autenticada disponível para rodar os 5 cold starts pedidos (Passo 2) antes e depois.** Reportar isso explicitamente, em vez de fabricar uma tabela de ms, segue o mesmo padrão de honestidade da Fase 5.1 (§D-H daquele relatório).

O que É verificável sem device — a posição estrutural do primeiro conteúdo útil mudou de "depois de TODAS as 13 ondas" para "depois da wave 10" (ver Fase 5.0 §B): isso é o commit provisório acontecendo ANTES de `listWorkoutLifecycleEventsForProgramInstance` (wave 12) e `loadUnacknowledgedAutoActivationNotice` (wave 13) — comprovado pelos testes de ordenação em `progressiveRendering.test.ts` (mesma técnica de `useWorkoutEvolutionParallelFetch.test.ts`, já usada neste projeto para garantir contratos de sequência sem harness de render).

Não é possível, com honestidade, estimar quantos ms isso representa sem medir localmente quanto tempo as waves 12-13 (`evolution_events_ready`→`evolution_activation_notice_ready`) efetivamente consomem — a Fase 5.0 estimou esse bloco (hydration/events) em ~0,8s do total de ~4s, mas essa era uma cifra qualitativa, não uma medição desta implementação específica.

**Recomendação explícita**: rodar os 5 cold starts do Passo 2/12 manualmente em um device/Simulator real com `EXPO_PUBLIC_PERF_TRACE=1`, comparando `evolution_first_useful_content` (novo) contra `evolution_authoritative_ready` (novo, mesmo instante que `evolution_state_commit` já tinha) — os marks já existem e estão prontos para essa medição; só falta o ambiente para rodá-la.

Tabela pedida (Passo 12) — **não preenchida com números reais, propositalmente, pela razão acima**:

| Métrica | Antes | Depois | Diferença | % |
|---|---|---|---|---|
| home_mount → evolution_first_useful_content | (não existia) | não medido | — | — |
| home_mount → evolution_authoritative_ready | ~4,0-4,3s (Fase 4, qualitativo) | não medido (deveria ser ≈ igual, mark é aditivo) | — | — |

---

## M. Testes

Criados/estendidos (TDD real — RED confirmado antes de cada implementação, comandos rodados e colados, não alegados):
- `viewModel.test.ts`: +3 casos (`buildProvisionalEvolutionViewModel` — equivalência com o terminal, decision nula, resolved-status).
- `loadReducer.test.ts`: +3 casos (`SUMMARY_READY` → `noticeUnavailable`, idempotência, substituição por sucesso).
- `progressiveRendering.test.ts` (novo, 17 testes): ordenação do commit provisório, guarda `isCurrent()+isInitialLoad`, perf marks (contagem exata, incluindo o 3º ponto de commit que eu mesmo só descobri rodando o teste — ver nota abaixo), `home_evolution_ready` preservado, skeleton do strip, gating de ações, `EvolutionCard`/Profile inalterado, isolamento multiusuário via `App.tsx`.

Nota de rigor: minha primeira suposição sobre `evolution_state_commit` ter só 2 pontos de disparo estava errada — havia um terceiro (branch de catch/resilience) que eu tinha esquecido. O teste RED pegou isso antes de eu seguir em frente; corrigi a contagem no teste E adicionei `evolution_authoritative_ready` lá também, para manter os dois marks emparelhados em TODOS os pontos reais, não só nos que eu tinha lembrado de cabeça.

Execução real:
```
npx vitest run                    → 373 passed | 4 failed | 16 skipped files
                                     5625 passed | 4 failed | 187 skipped tests
npx tsc --noEmit                  → limpo
npx eslint <arquivos tocados>     → limpo
```
As 4 falhas são exatamente as pré-existentes e não relacionadas (entitlement/paywall/theme — `premiumEntitlementPrecedence`, `paywallRedesignStructure`, `premiumCommercialContextFase6`, `sharedComponentsTheme`), confirmadas por não estarem em nenhum arquivo tocado por esta fase.

**Não executado nesta sessão**: os 9 cenários visuais/funcionais do Passo 13 em Simulator real (cold start, rede lenta, offline, retorno online, NO_ACTION, pending, pós-treino, background/foreground, logout A→login B). Sem Simulator/device anexado a este ambiente. Os itens verificáveis por análise estática (gating de ação, isolamento multiusuário, preservação pós-treino) foram cobertos via os testes estruturais acima; os itens que dependem de observação visual real (jank, timing percebido, comportamento de rede) não foram.

---

## N. Segurança

Nenhuma superfície nova: `summary` já era dado 100% autoritativo (vem do mesmo `lifecycle`+`decision` que sempre alimentou o estado final, só exposto mais cedo dentro do mesmo `load()`), nenhum novo write, nenhuma nova leitura, nenhum novo dado do cliente sendo confiado. Zero mudança em Functions/App Check/Firestore Rules/backend.

---

Respostas diretas:

1. **Algum lifecycle stale passou a aparecer como atual?** Não — `summary` nunca é reescrito com um valor mais antigo; é sempre o dado fresco desta mesma carga.
2. **Alguma decisão de progression aparece antes de reconcile?** Não — `summary` só é revelado DEPOIS de `reconcileWorkoutLifecycle()` resolver (wave 9) e do `Promise.all` (wave 10); nada aparece durante o reconcile em si.
3. **Algum CTA foi liberado antes?** Não — testado explicitamente (§H).
4. **Offline mostra estado como final?** Não — `noticeUnavailable` sinaliza explicitamente que a parte dependente não pôde ser verificada; o resumo seguro nunca é apresentado como se fosse a palavra final sobre pending/notice.
5. **Pós-treino pode mostrar Evolution anterior como final?** Comportamento inalterado (§J) — o estado anterior já era mostrado como "ainda válido, atualizando" (não como novo/final) até o commit atômico final, e isso continua idêntico.
6. **UID A pode vazar para B?** Não — `AppShell` desmonta por completo no logout (§K), confirmado por leitura direta de `App.tsx`.
7. **Functions foram tocadas?** Não.
8. **RevenueCat foi tocado?** Não.

---

## O. Git

Alterações locais, não commitadas ainda nesta mensagem — arquivos tocados: `src/workoutEvolution/{types,viewModel,loadReducer,useWorkoutEvolution}.ts`, `src/lib/perf.ts`, `src/screens/HomeScreen.tsx`, `src/components/home/ProgramProgressStrip.tsx`, `src/components/evolution/EvolutionCard.tsx`, mais os testes (`viewModel.test.ts`, `loadReducer.test.ts`, novo `progressiveRendering.test.ts`) e este relatório. `firestore-debug.log` excluído de qualquer commit. Sem push, sem deploy.

---

## P. Decisão

**PROGRESSIVE RENDERING VALIDADO: SIM** (estrutural/unitariamente — 96+17 testes novos/estendidos passando, suíte completa sem regressão) **— visualmente NÃO validado nesta sessão** (sem Simulator disponível).

**GANHO PERCEBIDO MATERIAL: NÃO DETERMINÁVEL SEM MEDIÇÃO REAL** — a mudança estrutural é real e comprovada (conteúdo útil passa a poder aparecer ~3 ondas de rede mais cedo, waves 10 vs. 13), mas o valor em ms/percepção depende de quanto as waves 12-13 custam de fato, que não foi medido neste ambiente.

**AUTORIDADE/CONSISTÊNCIA PRESERVADAS: SIM** — nenhuma das 8 perguntas acima revela violação; `summary` é matematicamente idêntico entre o commit provisório e todo commit terminal possível, por construção (mesma função pura `buildSummary`), não por convenção.

**MANTER MUDANÇAS: SIM**, condicionado a rodar a medição real de device/Simulator (§L) antes de declarar ganho — o código em si não tem motivo para reverter (zero regressão, escopo respeitado, testes verdes).

**PRONTO PARA ENCERRAR PLANO DE PERFORMANCE DO CLIENTE: NÃO** — falta, no mínimo: (1) a medição real de device/Simulator desta própria fase, (2) os 9 cenários visuais do Passo 13, antes de considerar o plano de performance do cliente encerrado.

Nenhuma outra fase foi iniciada automaticamente, conforme instruído.
