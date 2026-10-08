# Redesign visual da Home — mapeamento de dados e escopo

Data: 2026-10-07

## Objetivo

Aplicar o novo visual (poster-atlético/HUD: Anton + Archivo + JetBrains Mono,
fundo `#020010`, anéis SVG, heatmap estilo GitHub, sheet de prévia de evolução,
animação de "evolução atingida", tela de novo treino) à Home e ao fluxo de
evolução já existente — **sem alterar nenhuma regra, cálculo, hook, store,
serviço ou navegação**. O design completo (cores, medidas, textos, protótipo
de referência em `6.*`) já foi definido na conversa que originou este
documento; este spec não o repete — ele registra **de onde cada dado vem** e
**o que precisa ser exposto/reaproveitado** para chegar lá.

## O que NÃO muda (confirmado por leitura do código)

- `progressionEngineV2/*` (`resolver.ts`, `activeTime.ts`, `adherence.ts`),
  `prescriptionEvolution/*` (`cycleEvolution.ts`, `levelPromotion.ts`), e o
  ciclo `processWorkoutLifecycleAfterSession → persistEarnedFact →
  evolvePrescription → activatePendingEvolution / deferPendingEvolution`.
- `src/lib/homePresentationSnapshot.ts` e `src/home/homePresentationPolicy.ts`
  (bootstrap/snapshot gating) — só o consumidor visual muda, não a política.
- A tela Treino e os componentes que ela usa (regra 8). `WeekdayGlowCircle`
  (`src/components/treino/`) não é tocado por este trabalho.
- `scheduleEngine/*`, tipos de domínio, Firestore/Cloud Functions, regras de
  segurança.
- Seções 3–5 do design (prévia, celebração, novo treino) já têm uma tela real
  por trás — `src/screens/EvolutionUnlockScreen.tsx` — que já lê
  `EvolutionViewModel.pending` + `PrescriptionDiffSummary`
  (`src/workoutEvolution/diff.ts`) e já chama
  `activatePendingEvolution`/`deferPendingEvolution` via `AppShell.tsx`
  (`onOpenEvolution` em ~linhas 1916/2096, tela montada em ~2207). **Isto é um
  reskin dessa tela existente, não uma tela nova.**

## Mapeamento por bloco do design

### 2.1 Cabeçalho
- Primeiro nome: `src/lib/userName.ts:getDisplayFirstName` (já usado em
  `HomeScreen.tsx:184`).
- Iniciais/quadrado gradiente: `src/components/ui/ProfileAvatar.tsx`
  (`initialsFor`, já gradiente 135°) — reaproveitar como está, só restyle de
  tamanho/raio se necessário.
- Data de hoje: já calculada em `HomeScreen.tsx:314-324` (`todayLine`,
  `Intl.DateTimeFormat`).
- **"SEMANA 07" — omitido.** Não existe (confirmado por grep) nenhuma data de
  início de ciclo nem conceito de número de semana de programa em nenhum
  lugar do código. O próprio design já previa esse fallback ("'semana' só se
  o app já tiver esse dado"). O rótulo mono do cabeçalho fica
  `SEG · 05 OUT` (sem a parte de semana).

### 2.2 Ticker / 2.3 Bloco do anel (sequência, aderência, rumo ao avançado)
Hoje: `EvolutionTicker.tsx` + `workoutEvolution/tickerItems.ts` consomem
`ProgressingSummary` (dentro de `EvolutionViewModel`), que já tem
`activeLevel`, `activeDays`, `sessionsCompleted`, `adherenceQuality`
(categórico), `proximity`.

Para o novo visual, os seguintes campos **já são calculados internamente pelo
motor mas não chegam até `ProgressingSummary`** — expô-los é repasse (regra
4: "expor um campo que o motor já calcula"), não lógica nova:

| Dado do design | Onde já existe | Ação |
|---|---|---|
| Sequência (dias consecutivos) | `src/home/streak.ts:computeStreak` (já usado por widgets) | Reaproveitar a função pura, calcular também para Home e anexar ao view model da Home |
| Aderência em % (não só categórica) | `ProgressionDecision.adherence.ratio` (`progressionEngineV2/types.ts`), descartado em `buildProgressingSummary` (`workoutEvolution/viewModel.ts:20-35`) | Adicionar `adherenceRatio` em `ProgressingSummary` repassando o valor já calculado |
| Dias necessários do ciclo (denominador do anel) | Constante que o próprio motor usa: `minimumActiveDaysForLevel` (`progressionEngineV2/resolver.ts:4-8`, via `PROGRESSION_V2_CONFIG`) | Expor como campo derivado (mesmo valor, não recalculado) |
| "Progresso pausado" (3 faltas seguidas) | `ActiveTime.pausedAt` (`activeTime.ts`) | Anexar ao view model |
| "Rumo ao Avançado X/4" | Contagem de ciclos intermediários ganhos, hoje calculada e consumida só internamente em `evaluateProgressionV2` (`resolver.ts`); teto real = `PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion` (4) | Expor a contagem através de `ProgressionDecision` → `ProgressingSummary` |
| "Treinos X em N semanas" (ticker) | Não existe um agregado assim — `FrequencyWindowViewModel.completedCount` só cobre 30 dias | **Decisão abaixo**: ticker usa a mesma janela de 30 dias do heatmap (texto adaptado, ex. "X treinos nos últimos 30 dias") em vez de um total de N semanas inexistente |

### 2.4 Evolução pendente
Já totalmente coberto por `EvolutionViewModel` (`EVOLUTION_READY` /
`EVOLUTION_DEFERRED` / `AUTO_ACTIVATION_NOTICE`) e `PendingEvolutionSummary`
(`type`, `fromLevel`, `toLevel`, `deferralCount`). Título/contagem de
exercícios trocados vem do mesmo `PrescriptionDiffSummary` usado na seção 3.
Só restyle (banner sem borda de card, cor `rgba(11,112,249,0.1)` etc.).

### 2.5 Iniciar/retomar treino
Nenhuma mudança de dado — reaproveita exatamente `workoutInProgress`,
`onStart`, `scheduleResolution`, `firstSession` já existentes em
`HomeScreen.tsx`. Só restyle.

### 2.6 Frequência (heatmap)
Decisões confirmadas com o usuário:
- **Intensidade: 2 níveis** (treinou / não treinou) — não existe fonte real
  de intensidade (volume/séries) em `FrequencyWindowViewModel`
  (`src/home/frequencyHeatmap.ts`, documentado como "sem semântica de
  aderência/intensidade"). A paleta de 5 cores do design é reduzida a 2
  (vazio `rgba(255,255,255,0.05)` / treinou `#4da3ff`), mantendo o visual de
  grade GitHub.
- **Janela: mantém os 30 dias atuais** (reskin, sem nova busca de dados). A
  grade GitHub (colunas = semanas, linhas = dias) é recalculada para caber em
  ~30 dias (4-5 colunas) em vez de 18. `FrequencyHeatmap.tsx` e
  `home/frequencyHeatmap.ts` continuam exatamente como estão — só o
  componente visual que os consome muda.
- Legenda "MENOS/MAIS" vira 2 quadrados em vez de 5.

### Seção 3 — Prévia da evolução
Tela existente `EvolutionUnlockScreen.tsx` já lê `PrescriptionDiffSummary`
(`exerciseReplacements`, com `exerciseId` antigo/novo + índice de
sessão/slot). Nomes de exibição dos exercícios (antigo riscado / novo) vêm de
`workoutExercisesFromPlan(plan, locale, sessionIndex)`
(`src/screens/WorkoutScreen.tsx:310`, mesma função que a tela de treino já usa
para resolver `exerciseId → nome`) — nenhuma lógica nova, reaproveita o
resolvedor existente. Promoção de nível e renovação já têm os campos
necessários (`fromLevel`/`toLevel`, motivo de renovação) no mesmo view model.

### Seção 4 — Animação de evolução atingida
Dispara depois que `activatePendingEvolution` (já chamado por
`EvolutionUnlockScreen`) retorna sucesso — nenhum dado novo, é só a
apresentação (Reanimated/SVG) de um evento que já existe. Vai respeitar
"reduzir movimento" do sistema pulando direto para a tela de novo treino.

### Seção 5 — Tela do novo treino
Mesmo `PrescriptionDiffSummary` + plano já ativado (disponível em
`AppShell.tsx` logo após `activatePendingEvolution` suceder) + o mesmo
resolvedor de nomes de exercício da seção 3. Sem dados novos.

## Fundação visual já disponível

Checado em `package.json`/`src/theme/tokens.ts` — nada precisa ser instalado:
- `react-native-svg`, `expo-linear-gradient`, `react-native-reanimated` já são
  dependências do projeto.
- Fontes Anton/Archivo/JetBrains Mono já carregadas e nomeadas em
  `theme/tokens.ts` (`fonts.display`, `fonts.ui*`, `fonts.mono*`).
- Paleta já tem `ink950 #020010`, `blue700 #0b70f9`, `blue600 #1f82ff`,
  `blue500 #4da3ff` como primitivos (`palette.*`), e os níveis de alpha-white
  usados nas linhas finas (`alpha.white07` etc.).
- Faltam apenas: cor de sheet `#09071f`, azul claro `#9fd6ff`, amber de
  alerta/pausado `#f2c063` (próximo do `yellow500` existente mas não igual), e
  a dependência `expo-haptics` — confirmado que não existe nenhum uso de
  haptics nem `expo-haptics` no projeto hoje (grep em `src/` e
  `package.json`). Será adicionada como nova dependência — permitido pela
  regra 9 (lib só-visual).

## Resumo do que será exposto (repasse, não lógica nova)

Para a Home, o view model de evolução passa a incluir (além do que já tem):
`streakDays`, `adherenceRatio`, `cycleRequiredActiveDays`, `paused`,
`intermediateCyclesEarned`. Todos repassados de funções/campos que o motor já
calcula (`computeStreak`, `ProgressionDecision.adherence.ratio`,
`minimumActiveDaysForLevel`, `ActiveTime.pausedAt`, contagem interna de
`evaluateProgressionV2`) — nenhum deles é recalculado na UI.

## Fora de escopo deste spec

- Qualquer alteração em `TreinoScreen.tsx`, `TreinoAgendaSheet.tsx`,
  `TreinoWorkoutDetailSheet.tsx`, `src/components/treino/*` (trabalho em
  andamento não relacionado, já no working tree).
- Qualquer nova fonte de intensidade de frequência ou janela de heatmap maior
  que 30 dias (pode ser retomado em um spec futuro se o usuário quiser).
- Número de semana do programa (sem dado de início de ciclo disponível).
