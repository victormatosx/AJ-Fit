# Relatório final — Migração visual da aba TREINO (Opção B · Clean)

Branch: `feature/treino-clean-redesign` · Base: `0662c80` · Topo: `273e4bb` · 15 commits

---

## 1. Arquivos alterados e criados

| Arquivo | O quê |
|---|---|
| `src/components/fitness/BodyMuscleMap.tsx` | **Alterado.** Adicionada a prop opcional `frontOffsetX?: number` (padrão `0`), aplicada como `translateX` apenas na silhueta frontal. Os outros 4 pontos de uso não passam a prop e renderizam idênticos. |
| `src/home/treinoWeekStrip.ts` | **Criado.** `buildTreinoWeekStrip` — projeção pura que rotula cada dia da semana com a letra da sessão ou com o glifo de conclusão. Reusa `buildUpcomingWorkouts` (`limit: 7`); não reimplementa agendamento. |
| `src/home/__tests__/treinoWeekStrip.test.ts` | **Criado.** 3 casos: hoje com sessão pendente, dias passados com glifo, dia de descanso com cursor futuro. |
| `src/components/treino/TreinoWeekStrip.tsx` | **Criado.** Faixa de 7 colunas; um único `Pressable` que abre a agenda. |
| `src/components/treino/TreinoTodayBlock.tsx` | **Criado.** Bloco central: kicker, nome da sessão, lista de músculos com escala de intensidade, body map, faixa de 3 métricas, CTA. |
| `src/components/treino/TreinoExerciseList.tsx` | **Criado.** Lista numerada com expandir/recolher (fade + subida de 14px em 250ms). |
| `src/components/treino/TreinoUpcomingList.tsx` | **Criado.** Até 3 linhas sem card, hairline entre elas, abre o sheet de detalhe. |
| `src/screens/TreinoScreen.tsx` | **Reescrito** (354 → 300 linhas). Virou composição pura: todas as derivações preservadas, todo o estilo saiu para os 4 componentes. |
| `src/i18n/resources/{pt-BR,en,es}/treino.json` | **Alterados.** Novos blocos `todayBlock.*` e `exercises.*`; `currentWorkout.continue` → "Retomar treino"; removidas 2 chaves órfãs. |
| `src/theme/__tests__/lightTheme.test.ts` | **Alterado.** Novo teste de regressão que proíbe literais de branco nos 4 componentes, e o CTA do `TreinoTodayBlock` inscrito no teste de contraste já existente. |
| `docs/superpowers/plans/2026-10-16-treino-screen-clean-redesign.md` | **Criado.** Plano + 4 blocos de ERRATA registrando as correções feitas durante a execução. |

**Não tocados, como exigido:** `AppShell.tsx` (diff = 0 linhas), `TreinoWorkoutDetailSheet.tsx`, `TreinoAgendaSheet.tsx`, `WorkoutScreen.tsx`, `HomeScreen.tsx`, Schedule Engine, modelos, persistência, sincronização e navegação.

---

## 2. Elemento do design → fonte real

| Elemento | Fonte real | Divergência vs. §4 do spec |
|---|---|---|
| Data do header | `headerDateLabel` (inalterado) | — |
| Selo "AJ" | `ProfileAvatar` real (foto/iniciais) | Mantido o invariante: nunca o "AJ" fixo do protótipo |
| Faixa da semana · dias/hoje/concluído | `weekOverview.days[]` (`localDate`, `isToday`, `status`) | — |
| Letra da sessão por dia | `buildTreinoWeekStrip` → `buildUpcomingWorkouts` | — |
| `MISSED` / `FULFILLED_EARLY` | Glifos `x` / `arrow-right`, mesmas cores de tema | — |
| Toque na faixa | `onOpenAgendaEditor`; `opacity 0.4` + desabilitado com treino em andamento | — |
| "Treino de hoje" / "Próximo · DIA" | `resolution.status` + `nextWorkoutDate` | — |
| Nome da sessão | `resolveSessionDisplayName(...)` | **Linha de foco omitida** (ver §4) |
| Estados sem sessão | Título de `home:schedule.{statusCopyKey}.title` | **Corpo (`.body`) não é exibido** (ver §3) |
| Lista de músculos | `deriveSessionMuscles(...)`, máx. 5 itens | Escala de cor agora derivada do tema (ver §5) |
| Duração | `estimateSessionMinutes(...)`; "—" quando 0 | — |
| Exercícios / Séries | `exerciseCount` / `setCount` | — |
| Barra "Em andamento" | — | **Omitida** (ver §4) |
| CTA | `canStartNow` → `onStart`; `startPending` → desabilitado | — |
| Lista de exercícios | `workoutExercisesFromPlan(plan, lang, displayedSessionIndex)` | — |
| Próximos treinos | `buildUpcomingWorkouts({ limit: 3 })` → `TreinoWorkoutDetailSheet` | — |

---

## 3. Funcionalidades que mudaram de lugar

- **"Editar agenda"** — era um botão ao lado do título "Agenda"; agora **a faixa da semana inteira** é o alvo de toque, com `accessibilityLabel` montado a partir de `treino:agenda.edit`.
- **Resumo "N de M treinos"** — era visível no cabeçalho do `WeeklyOverview`; o layout clean não tem espaço visual para ele, então foi preservado **dentro do `accessibilityLabel`** da faixa, não descartado.
- **Corpo das mensagens de status** (ex.: "Hoje não é um dos seus dias de treino") — não aparece mais na aba Treino. A informação passou a ser estrutural: sem CTA + kicker "PRÓXIMO · QUI" + nome e exercícios do próximo treino. **A frase continua aparecendo na Home** (`HomeScreen.tsx`), então não se perdeu do produto. *Confirmado com o usuário durante a execução.*
- **`dateLabel`** (linha longa de data no pôster) — removida; a data é comunicada pelo kicker e pelos números da faixa da semana.

---

## 4. Itens do design omitidos por falta de dado real

Nenhum dado fictício foi inventado. Omitidos por não existirem no app:

1. **Linha de foco da sessão** ("Peito & Ombro"). `FinalWorkoutSession` não tem campo de foco/descrição. A linha foi removida do componente — não há placeholder.
2. **Barra "Em andamento" (séries feitas / total).** Esse dado não chega ao `TreinoScreen` por nenhuma das suas props, e as props são congeladas por contrato. Só o CTA "Retomar treino" comunica o estado.
3. **"SEMANA 07" no header.** Não existe número de semana real no app; mantido o rótulo de data atual.
4. **Sufixo "· Foco" nas linhas de próximos treinos.** Mesma causa do item 1.

---

## 5. Literais de cor usados sem token

O plano original autorizava literais `rgba(255,255,255,0.xx)` alegando ausência de token exato. **Essa decisão foi revertida durante a execução**: como a tela é theme-aware por decisão sua, branco semitransparente ficava ilegível sobre o fundo claro (`#E7E7E7`). Medições de contraste reais motivaram a troca:

| Literal original | Token adotado | Escuro | Claro | Contraste no claro |
|---|---|---|---|---|
| `rgba(255,255,255,0.35)` / `0.4` | `theme.colors.textFaint` | `0.32` | `#5D6676` | 4.68:1 ✅ |
| `rgba(255,255,255,0.45)` | `theme.colors.textMuted` | `0.55` | `#5B6475` | 4.82:1 ✅ |
| `rgba(255,255,255,0.55)` | `theme.colors.textMuted` | `0.55` (exato) | `#5B6475` | 4.82:1 ✅ |
| `rgba(255,255,255,0.85)` (contorno) | `theme.colors.iconStrong` | `0.80` | `#344054` | 8.46:1 ✅ |

> Nota: `textInactive` foi usado numa primeira passada e depois substituído por `textMuted` — media 3.91:1 no claro, abaixo do mínimo de 4.5:1 que o próprio `lightTheme.test.ts` exige.

**Literais remanescentes, intencionais e justificados:**
- `MUSCLE_DOT_FROM/TO` — **substituídos** por `theme.colors.primaryEmphasis` → `theme.colors.primary`, porque `#4da3ff` media 2.12:1 no claro e a hierarquia da escala se invertia (o músculo principal virava o ponto mais fraco). Agora a direção "principal lê mais forte" vale nos dois temas.
- `baseColor="transparent"` no body map — correto nos dois temas (corpo vazado).

Um teste novo em `lightTheme.test.ts` impede a volta de qualquer literal de branco (`rgba(255,255,255`, `#fff`, `#ffffff`, `'white'`) nos 4 componentes.

---

## 6. Resultados de `tsc`, `lint` e testes

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit -p .` | **0 erros em `src/`.** (Os 277 erros restantes são pré-existentes e ficam todos em `functions/`, por dependências do Firebase ausentes neste worktree.) |
| `npx eslint` nos 9 arquivos tocados | **Limpo, exit 0.** |
| `npx vitest run` (suíte completa) | **22 falhas / 7689 passando / 95 puladas (7806).** |

**Comparação com a linha de base** (mesmo comando, no commit da base, antes de qualquer trabalho deste plano):

| | Base | Agora | Delta |
|---|---|---|---|
| Arquivos falhando | 15 | 15 | **0** |
| Testes falhando | 22 | 22 | **0** |
| Testes passando | 7685 | 7689 | **+4** |

**Zero regressões.** Os +4 são os 3 testes novos de `buildTreinoWeekStrip` e 1 novo em `lightTheme.test.ts`. Nenhum dos 15 arquivos que falham menciona Treino — são asserções de texto-fonte pré-existentes sobre EditProfile, HealthIntegration, Paywall, SubscriptionCenter, RestOverlay, etc.

Testes dirigidos relevantes, todos passando:
- `bodyMuscleMapArchitecture.test.ts` — 9/9 (confirma que continuam **exatamente 5** pontos de uso do `BodyMuscleMap`)
- `lightTheme.test.ts` — 12/12
- `treinoWeekStrip.test.ts` — 3/3
- `src/i18n/__tests__` — 725/725 (paridade das 3 locales mantida)

---

## 7. Capturas da tela implementada

**Não entregues — e preciso ser explícito sobre isso em vez de deixar o item em aberto.**

Não consigo produzir as capturas nos 4 estados (pronto, em andamento, descanso, concluído hoje) neste ambiente: exigem o app rodando num simulador iOS/Android com uma conta real em cada um desses estados do Schedule Engine, e não há simulador inicializado nem dispositivo conectado aqui.

O que foi feito no lugar, e que **não substitui** a conferência visual:
- Validação estática dos 6 estados de `resolution.status` + `workoutInProgress` + `weekOverview === null`, rastreando o JSX de cada caminho para confirmar que nenhum renderiza em branco nem quebra.
- Contraste medido numericamente nos dois temas para cada cor de texto.

**Pendente de conferência em aparelho, por você:** os 4 estados acima, nos temas claro e escuro, com sexo masculino e feminino, e em tela com largura < 360px (body map cai para 84px).
