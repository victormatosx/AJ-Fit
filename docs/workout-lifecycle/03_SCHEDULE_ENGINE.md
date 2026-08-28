# Schedule Engine

## Escopo

Status geral do motor: `IMPLEMENTED_V1`. Dias habituais, identidade
independente de weekday, rotação por conclusão e escolha explícita após falta
estão implementados. DR-012/DR-017/DR-018 estão `RESOLVED_V1` — ver
§Implementação e `07_OPEN_DECISIONS.md`.

O Schedule Engine transforma uma sequência de sessões prescritas em agenda.
Ele não seleciona Txxx, não cria exercícios, não altera sets/reps/exerciseId e
não decide progressão (Beginner auto-transition, ciclos, deload continuam
fora de escopo — `04_PROGRESSION_ENGINE.md`).

## Coleta (questionário)

`Quiz.trainingDays: Weekday[] | null` (`src/state/AppState.tsx`), pergunta
`trainingDays` logo após `days` (`src/onboarding/questionDefs.ts`,
`src/onboarding/steps.ts`):

- 2–6 dias: exatamente a quantidade escolhida, seleção `multi-exact`
  (`src/components/onboarding/QuestionRenderer.tsx`), sem duplicatas;
- 7 dias: a pergunta é pulada — `cleanApplicableAnswers` preenche os sete IDs
  automaticamente (`src/lib/questionnaireSchema.ts`);
- valores persistidos são os IDs estáveis `MON`..`SUN` (`WEEKDAY_ORDER`),
  sempre normalizados para ordem cronológica canônica, nunca a ordem de
  clique nem texto localizado;
- questionários legados sem `trainingDays` carregam `null` — nunca uma
  preferência inventada; o resolver trata isso como `SCHEDULE_SETUP_REQUIRED`.

`trainingDaysValid(quiz)` é o gate próprio do Schedule Engine — deliberadamente
fora de `questionnaireValidationErrors`, o gate do Prescription Engine. Um
usuário sem `trainingDays` continua gerando prescrição normalmente; apenas o
Schedule Engine fica pendente de configuração (docs §7 — não confundir os
dois motores).

## Modelo de dados

Config (preferência do usuário, sobrevive à regeneração de programa):

```text
users/{uid}/workoutProgramState/scheduleConfig
  { trainingDays: Weekday[], timezone: string, scheduleVersion: number, updatedAt }
```

State (cursor de runtime, escopado ao programId — nunca contamina um novo
programa, docs §Troca de programa):

```text
users/{uid}/workoutPrograms/{programId}/scheduleState/current
  { programId, nextSessionIndex, cursorDate, lastCompletedAt, pendingMissDecision, updatedAt }
```

Ledger imutável (nunca reescrito/apagado):

```text
users/{uid}/workoutPrograms/{programId}/scheduleEvents/{eventId}
  { type: COMPLETED|SKIPPED|MISS_RESOLVED, sessionIndex, scheduledDate, occurredAt, reasonCode?, decision? }
```

`eventId` é determinístico (`${type}_${sessionIndex}_${scheduledDate}`), o que
torna retry/double-tap idempotente por construção (docs §36).

## Resolver

`resolveWorkoutSchedule` (`src/scheduleEngine/resolver.ts`) é puro e
determinístico — sem I/O, sem `Date.now()` implícito; recebe `todayLocalDate`
já resolvida no fuso do usuário (`localDateInTimezone`, `Intl.DateTimeFormat`
com `timeZone`). Estados possíveis:

`PROGRAM_NOT_AVAILABLE` · `SCHEDULE_SETUP_REQUIRED` · `REST_DAY` ·
`SESSION_READY(sessionIndex)` · `MISSED_SESSION_DECISION_REQUIRED
(missedSessionIndex, calendarSessionIndex)`.

O algoritmo caminha os `trainingDays` estritamente após `cursorDate` até
`todayLocalDate` (inclusive). Zero ocorrências → `REST_DAY`; exatamente uma →
`SESSION_READY`; mais de uma → todas as ocorrências intermediárias viraram uma
falta, colapsada em uma única decisão (`missedCount = ocorrências - 1`,
`calendarSessionIndex = (nextSessionIndex + missedCount) % sessionCount`) —
nunca um popup por dia perdido (docs §Múltiplos dias perdidos).

`cursorDate` só avança em `COMPLETED`/`MISS_RESOLVED` — nunca por uma leitura.
Abrir o app roda o resolver, mas não recalcula nem muta o programa; a única
escrita possível numa leitura é registrar uma falta recém-detectada, e apenas
se ainda não houver `pendingMissDecision` (`src/services/workoutSchedule.ts`
`resolveTodaysSchedule` — transação com re-check, idempotente sob retry).

## Identidade e rotação

Sessões `A/B/C/...` mantêm sua identidade independentemente de segunda,
terça ou qualquer outro dia. A conclusão avança a rotação prescrita:

```text
A concluída → próxima sessão B
B concluída → próxima sessão C
```

O calendário diz quando oferecer a sessão; o histórico de conclusão diz qual é
a próxima sessão. Um rótulo como “treino de segunda” não deve substituir essa
identidade. Fim de semana ISO não reseta a sequência — `cursorDate`/
`nextSessionIndex` são do programa, não da semana (testado em
`src/scheduleEngine/__tests__/resolver.test.ts`).

## Sessão perdida

Ao perder uma sessão, o produto pergunta explicitamente
(`MissedSessionDecisionModal`, `src/components/schedule/`):

1. **`CONTINUE_SEQUENCE`** — mantém `nextSessionIndex` na sessão perdida; ao
   concluí-la hoje, o cursor salta direto para a data de hoje;
2. **`FOLLOW_SCHEDULE`** — toda sessão entre a perdida e `calendarSessionIndex`
   recebe um evento `SKIPPED` (`reasonCode: FOLLOWED_SCHEDULE_AFTER_MISS`), e
   `nextSessionIndex` salta para `calendarSessionIndex`.

Ambas as escolhas são eventos persistidos (`MISS_RESOLVED` no ledger,
`src/services/workoutSchedule.ts` `resolveMissedSession`), nunca uma decisão
silenciosa. Reexecutar a resolução sem uma decisão pendente é no-op — idempotente
sob duplo toque/retry de rede. `missed`/`skipped` nunca contam como conclusão,
volume executado, aderência positiva ou avanço de progressão.

## Safety

Conclusão, preferência semanal ou recuperação de falta nunca neutralizam um
gate de segurança. Se a situação do usuário mudou, agenda pausa e encaminha
para reavaliação conforme contrato futuro — o Schedule Engine não lê nem
resolve nenhum estado de Safety hoje; ele só é alcançado quando a prescrição
já retornou `SUCCESS`.

## UI mínima

`AppShell.tsx` resolve o schedule via `useWorkoutSchedule(activeProgram)`
(`src/scheduleEngine/useWorkoutSchedule.ts`) e decide `sessionIndex` antes de
abrir `WorkoutScreen` — nunca `sessions[0]` fixo. `WorkoutScreen` finaliza a
sessão via `onSessionCompleted` (distinto de `onDone`, que também dispara num
X/saída antecipada) → `completeScheduledSession`. `HomeScreen` mostra os
textos de `REST_DAY`/`SCHEDULE_SETUP_REQUIRED` (`home:schedule.*`) sem
linguagem punitiva; nenhum detalhe técnico (índice, cursor, ledger) é exposto.

## Fora de escopo desta fase

O Limitation Resolver, hoje `IMPLEMENTED_V1` no Prescription Engine, permaneceu
fora do escopo desta fase. Progression Engine, transição automática de
Beginner, histórico completo de sets/cargas, notificações e redesign amplo do
calendário continuam fora — ver `07_OPEN_DECISIONS.md` e
`04_PROGRESSION_ENGINE.md`.
