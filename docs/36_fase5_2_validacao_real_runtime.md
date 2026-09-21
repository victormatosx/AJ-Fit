# Fase 5.2 — Validação Real Final (runtime, iPhone 17 Pro Simulator)

Status: Executado com dados reais de device (não Emulator, não estimativa). Cobertura parcial honesta — ver §N para o que não foi possível validar neste ambiente e por quê.
Data: 2026-09-21
Branch: `perf-consolidation` @ `467c379` (nenhum código alterado nesta sessão — só instrumentação lida, nenhum arquivo tocado).

## A. Ambiente

```
git branch --show-current  → perf-consolidation
git rev-parse --short HEAD → 467c379
git status --short         →  M firestore-debug.log
```
Confere com o esperado.

- Simulator: **iPhone 17 Pro** (já bootado, `48A6A7E3-7C9B-406E-B19F-4524699D85A5`).
- App: `com.ajfit.app` ("AJ Fit") — **já instalado como dev-client build**, não precisou de rebuild nativo.
- Conta: já autenticada como Lucas ("E AÍ, LUCAS." visível em todos os screenshots) — mesma conta, mesmo programa (Avançado · Ciclo 1).
- Projeto Firebase: `ajfit-2f321` (produção — confirmado via `.env`; não existe staging, mesma conclusão da Fase 5.1). **Nenhuma escrita foi feita** nesta validação — só leitura (cold starts, foreground resume).
- **Armadilha real evitada**: havia um Metro já rodando na porta 8081, mas servindo o worktree sibling `perf-fase0-fase1`, não este. Não toquei nesse processo (instrução explícita de não mexer no sibling). Subi um Metro dedicado na porta 8083 com `EXPO_PUBLIC_PERF_TRACE=1`, exclusivamente para `/Users/lucaslima/AJ-Fit`, e conectei o dev-client a ele via `xcrun simctl openurl booted "ajfit://expo-development-client/?url=http://localhost:8083"`. Confirmado pela leitura do próprio log do Metro (`Starting project at /Users/lucaslima/AJ-Fit`).
- Profile presentation cache: não verificado como "ON" explicitamente (não é algo que se liga/desliga manualmente); o app usa seu comportamento padrão de produção.
- Rede: Wi-Fi normal do host (sem alterações).

---

## B. 5 cold starts (dados reais, `xcrun simctl terminate` + `launch`, aguardando settle completo por run)

| Run | home_mount (ms desde app_epoch) | evolution_shell_visible | evolution_first_useful_content | evolution_authoritative_ready | home_evolution_ready |
|---|---|---|---|---|---|
| 1 | 4614 | 4614 | 8472 | 8924 | 9049 |
| 2 | 4529 | 4529 | 8315 | 8732 | 8856 |
| 3 | 4168 | 4169 | 7931 | 8333 | 8456 |
| 4 | 4581 | 4582 | 8347 | 8797 | 8921 |
| 5 | 4519 | 4519 | 8042 | 8461 | 8588 |

Nenhum outlier removido — todas as 5 amostras acima são exatamente o que foi capturado, sem filtragem.

---

## C. Deltas (home_mount → X), medianas/min/max

| Métrica | Run1 | Run2 | Run3 | Run4 | Run5 | **Mediana** | **Mín** | **Máx** |
|---|---|---|---|---|---|---|---|---|
| home_mount → evolution_shell_visible | 0 | 0 | 1 | 1 | 0 | **0 ms** | 0 | 1 |
| home_mount → evolution_first_useful_content | 3858 | 3786 | 3763 | 3766 | 3523 | **3766 ms** | 3523 | 3858 |
| home_mount → evolution_authoritative_ready | 4310 | 4203 | 4165 | 4216 | 3942 | **4203 ms** | 3942 | 4310 |

Diferença (authoritative − first_useful) por run: 452, 417, 402, 450, 419 ms → **mediana ≈ 419 ms**.

---

## D. Ganho percebido — métrica principal (Passo 4)

**Antes** (Fase 4/5.0/5.1, sem progressive rendering): nenhum conteúdo útil aparecia antes de `authoritative_ready` — mediana ~4,2s pós-mount (baseline histórico ~4,0–4,3s).

**Depois**: primeiro conteúdo útil (`evolution_first_useful_content`) mediana **3766 ms** pós-mount.

**Diferença**: **≈ 419 ms mais cedo, ≈ 10% do tempo total até authoritative_ready.**

Isto é real, mas **modesto**, não "materialmente antes" no sentido de uma redução drástica — reportando com o mesmo rigor da Fase 5.1 em vez de inflar a conclusão. A razão estrutural: a maior parte do tempo (as ~9 primeiras ondas de rede, dentro de `reconcileWorkoutLifecycle`) já acontece **antes** de qualquer conteúdo — inclusive antes — poder ser revelado; o ganho só existe na janela entre "lifecycle+pending+decision prontos" (wave 10) e "events+notice prontos" (waves 12-13), que neste device/conta mede ~400-450ms.

Confirmado visualmente (§F) que o conteúdo revelado nesse momento é REAL (nível "AVANÇADO", ciclo "1", barra de progresso preenchida, status "CONSTRUINDO SUA BASE") — não um texto genérico.

---

## E. Authoritative ready

**Antes** (baseline Fase 4/5.0): ~4,0–4,3s pós-mount.
**Depois** (mediana real, 5 amostras): **4203 ms** pós-mount (mín 3942, máx 4310).

**Sem regressão** — o valor cai exatamente dentro da faixa histórica ~4,0-4,3s, confirmando que a mudança é aditiva (revela conteúdo mais cedo) sem atrasar o commit final. Isso também corrobora que a metodologia de medição (DEV+PERF trace, mesmo dev-client) é comparável à usada para o baseline original.

Achado secundário não pedido, mas observado consistentemente nas 5 corridas: `home_evolution_ready` (HomeScreen) dispara **~123-127ms depois** de `evolution_authoritative_ready` (mesmo commit) em todas as 5 amostras — provavelmente overhead de agendamento de efeito/render do React, não um bug; registrado para referência futura, não investigado a fundo (fora do escopo desta validação).

---

## F. Cold start visual

Sequência de screenshots reais capturados durante uma 6ª corrida dedicada (não incluída na amostra de timing de §B/§C, só para inspeção visual):

1. **t1** (~7s pós-launch): "EVOLUÇÃO DO PROGRAMA" mostrando o **skeleton novo desta fase** (barra de segmentos vazia + "CARREGANDO SEU CICLO DE TREINO") — confirma visualmente que o `ProgramProgressStrip` já não retorna mais `null`/espaço em branco durante LOADING.
2. **t2** (~9s): ainda no skeleton — outras seções da Home (Esta Semana/Sua Frequência) já resolveram, Evolution ainda não.
3. **t3** (~11s): conteúdo real presente — "AVANÇADO · CICLO 1", barra parcialmente preenchida, status "CONSTRUINDO SUA BASE".
4. **t4** (~14s, vários segundos depois): **conteúdo byte-idêntico ao t3** — mesmo nível, mesmo ciclo, mesma barra, mesmo status.

**t3 e t4 sendo idênticos é a confirmação visual central desta fase**: o resumo revelado cedo (`SUMMARY_READY`) nunca precisou ser corrigido — exatamente a premissa de design da Fase 5.2 (§E daquele relatório), agora confirmada em runtime real, não só por análise de código.

Nenhum "pisca-pisca" observado entre os frames — nenhuma transição de um valor para outro incompatível.

---

## G. Rede lenta / offline

**Não executado neste ambiente.** Avaliei as opções disponíveis:
- Manipular a rede do host (firewall/Wi-Fi) está fora de cogitação — é alteração de configuração de sistema, que não faço sem autorização explícita e específica.
- iOS Simulator tem um toggle de "Modo Avião" dentro do próprio simulado (não mexe no host), mas alcançá-lo exigiria automação de UI por coordenadas de tela via AppleScript (sem uma ferramenta dedicada de controle de Simulator neste ambiente) — frágil e sem verificação confiável de sucesso/estado, e este cenário não estava marcado como obrigatório (diferente do pós-treino, Passo 10).

Reportando isso como não feito em vez de simular com mock falso, conforme pedido explicitamente ("Não usar mock falso de offline"). O comportamento de `noticeUnavailable` foi validado apenas estruturalmente (testes unitários da Fase 5.2 — `loadReducer.test.ts`, `progressiveRendering.test.ts`), não em runtime real.

---

## H. Pending

**Não executado.** Nenhuma fixture ou conta segura com pending evolution disponível neste ambiente; a conta real observada está em `PROGRESS_CONTINUES`/`BUILDING` (nenhuma evolução pendente). Não fabriquei esse estado numa conta de produção real.

---

## I. EARNED / action card

**Não executado pelo mesmo motivo de §H.** Cobertura equivalente já existe nos testes automatizados (fixture EARNED do protótipo server-side, Fase 5.1, e `viewModel.test.ts` para o client-side) — mas não em runtime real neste dispositivo.

---

## J. Pós-treino

**Não executado literalmente** (não completei um treino real na conta de produção — ver justificativa abaixo). **Validado por um caminho de código arquiteturalmente idêntico**: o refresh de foreground (§K) usa exatamente o mesmo guard (`isInitialLoad = !hasLoadedOnce.current`) que protege o caminho pós-treino — ambos são "refresh de background com um estado já resolvido em tela", tratados de forma idêntica pelo código (`useWorkoutEvolution.ts`). A evidência real de §K (nenhum `evolution_first_useful_content` disparado, nenhum reset visual) se aplica à mesma branch de código que o pós-treino percorre.

Justificativa de não simular um treino completo real: faria uma escrita real e permanente no histórico de treinos da conta de produção do Lucas (não é uma ação read-only), e a sequência de toques necessária (selecionar exercícios, registrar séries/reps/carga, concluir) exigiria automação de UI por coordenadas sem uma ferramenta confiável de controle do Simulator — risco real de erro/estado inconsistente sem benefício adicional, já que o caminho de código relevante já foi comprovado via §K.

---

## K. Background/foreground (executado, real)

Sequência real: app em foreground → `Cmd+Shift+H` (Home do Simulator, via AppleScript, sem tocar rede/host) → 5s em background → reabertura via `xcrun simctl launch`.

Log real capturado (mesma sessão, mesmo processo, sem restart de app):
```
evolution_lifecycle_pending_progression_ready {"msSinceAppEpoch": 97144}
evolution_events_ready                        {"msSinceAppEpoch": 97575}
evolution_activation_notice_ready             {"msSinceAppEpoch": 97576}
evolution_state_commit                        {"msSinceAppEpoch": 97577}
evolution_authoritative_ready                 {"msSinceAppEpoch": 97577}
home_evolution_ready                          {"msSinceAppEpoch": 97699}
```
**`evolution_first_useful_content` NÃO disparou** — confirmação real, não inferida, de que o guard `isInitialLoad` funciona exatamente como projetado: um refresh de foreground (que já tem estado resolvido em tela) nunca aciona o commit provisório. Screenshot pós-foreground mostra o MESMO conteúdo (Avançado · Ciclo 1 · Construindo sua base) sem qualquer reset visual durante o refresh.

Isso responde, com dado real: SUMMARY_READY não duplica, não há reset visual, não há loads competindo visivelmente, estado final permanece coerente.

---

## L. Multiusuário

**Não executado.** Não há uma segunda conta segura disponível neste ambiente para logout/login real. A proteção (`AppShell` desmontando por completo no logout, `App.tsx:552`) já foi verificada por leitura direta de código na Fase 5.2 e coberta por teste estrutural (`progressiveRendering.test.ts`) — não repetida aqui por falta de uma segunda conta, não por dúvida sobre o mecanismo.

---

## M. CTAs

Observado em todos os screenshots das seções §F e §K: nenhum chevron/afordância de ação aparece na `ProgramProgressStrip` durante nenhum dos estados capturados — consistente com a conta estar em `PROGRESS_CONTINUES` (não acionável) o tempo todo. Não foi possível, com esta conta real, observar visualmente o caso "CTA aparece só no estado final" (precisaria de uma conta com pending/EARNED — ver §H/§I) — mas a ausência de CTA em TODOS os frames capturados (LOADING, SUMMARY_READY, final) é consistente com o gating correto: nada ficou clicável prematuramente porque nada ficou clicável em momento nenhum nesta conta específica.

---

## N. Regressões

Nenhuma observada:
- `authoritative_ready` dentro da faixa histórica (§E).
- Suíte completa: `npx vitest run` → **373 arquivos passed, 5627 testes passed, 4 falhas pré-existentes** (as mesmas de sempre: entitlement/paywall/theme, não relacionadas), 16/187 skipped — idêntico ao estado pós-Fase-5.2 antes desta validação.
- `npx tsc --noEmit` → limpo.
- Nenhum código foi alterado nesta sessão (`git status --short` só mostra `firestore-debug.log`, que já estava assim desde antes desta fase).

**Resumo honesto de cobertura**: dos 16 itens do protocolo de validação, **executados com dado real**: ambiente (§A), 5 cold starts (§B/§C), métrica principal (§D), authoritative ready (§E), visual de cold start (§F), background/foreground (§K), marcas (§O abaixo), testes automatizados (§N). **Não executados, com justificativa explícita**: offline/rede lenta (§G), pending (§H), EARNED (§I), pós-treino literal — validado por equivalência de código, não literal (§J), multiusuário (§L).

---

## O. Marcas — semântica confirmada em runtime

- `evolution_shell_visible`: "o container da área Evolution está na árvore" — dispara no mesmo instante que `home_mount` em todas as 5 corridas (delta 0-1ms), confirmando que é estrutural, não dependente de dados.
- `evolution_first_useful_content`: "o usuário já vê nível/ciclo/adesão/proximidade reais" — dispara só na carga inicial (confirmado NÃO disparar no refresh de foreground, §K), nunca antes de `lifecycle+pending+decision` resolverem.
- `evolution_authoritative_ready`: "o estado final e completo (incluindo se há pending/notice) está commitado" — dispara nos mesmos instantes exatos que `evolution_state_commit` (pré-existente), nas 5 corridas e no refresh de foreground.
- `home_evolution_ready` (pré-existente): confirmado que NÃO foi redefinido — nunca disparou mais cedo que `evolution_authoritative_ready` em nenhuma das 6 corridas observadas (sempre ~124ms depois, nunca antes, nunca no meio do SUMMARY_READY).

---

Respostas diretas:

1. **Lifecycle stale é mostrado como atual?** Não — todo dado visto em §F/§K vem da leitura fresca desta mesma carga.
2. **Progression aparece antes de reconcile?** Não — `evolution_first_useful_content` sempre disparou depois de `evolution_reconcile_ready`/`evolution_lifecycle_pending_progression_ready` no log real.
3. **CTA fica ativa cedo?** Não observado em nenhum frame (mas conta testada não tinha CTA disponível em nenhum momento — ver §M).
4. **Offline parece final?** Não testado em runtime (§G) — validado só estruturalmente.
5. **Pós-treino pode mostrar decisão antiga como final?** Não, pelo caminho de código equivalente comprovado em §J/§K.
6. **UID pode vazar?** Não testado em runtime (§L) — validado só estruturalmente/por leitura de código.
7. **Functions foram tocadas?** Não.
8. **RevenueCat foi tocado?** Não.

---

## Q. Decisão final

**PROGRESSIVE RENDERING VALIDADO EM RUNTIME: SIM, PARCIALMENTE** — a métrica principal (Passo 4), o comportamento visual de cold start, e o comportamento de foreground foram validados com dado real de device, não estimativa. Offline, pending, EARNED, multiusuário e pós-treino literal ficaram sem validação em runtime real, por falta de fixtures/segunda conta/ferramenta de automação de UI confiável — não por falha encontrada.

**GANHO PERCEBIDO MATERIAL: SIM, MAS MODESTO** — ~419ms / ~10% mais cedo, com conteúdo real (não texto genérico) confirmado visualmente. Não é um salto dramático; é um ganho real e mensurável, honestamente pequeno frente ao total de ~4,2s.

**AUTORIDADE PRESERVADA: SIM** — nenhuma das 8 perguntas acima revela violação nos cenários testados; o resumo mostrado em t3 nunca precisou ser corrigido (t3=t4, byte-idêntico).

**FASE 5.2 CONCLUÍDA: SIM** — dentro do que este ambiente permite validar com honestidade. A parte estrutural (Fase 5.2 original) e a parte de runtime real (este relatório) juntas cobrem o essencial da decisão pedida; os itens não cobertos (§G/§H/§I/§L, pós-treino literal) ficam registrados como lacuna explícita, não escondida.

**PLANO DE PERFORMANCE DO CLIENTE PODE SER ENCERRADO: SIM, PARA A FRENTE PROGRESSIVE RENDERING** — não há próximo passo óbvio de client-side rendering que valha a pena perseguir depois deste resultado modesto; o ganho relevante futuro está do lado server-side (Fase 5.0/5.1, ainda bloqueado pelos 2 blockers + ambiente cloud) ou em reduzir as ~9 ondas de `reconcileWorkoutLifecycle` em si (fora do escopo de progressive rendering). Recomendo tratar isso como decisão do usuário, não automática.

Nenhuma nova fase foi iniciada. Sem push. Sem deploy. Nenhum código alterado nesta sessão de validação.
