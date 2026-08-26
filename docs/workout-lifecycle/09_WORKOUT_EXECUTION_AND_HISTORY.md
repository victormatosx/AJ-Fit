# Workout Execution & History

## Escopo

Status geral do motor: `IMPLEMENTED_V1`.

Três conceitos que nunca se confundem:

- **Template (Txxx)** — o programa-base.
- **Program Snapshot** — o que foi prescrito para este usuário (imutável).
- **Execution** — o que o usuário realmente fez numa sessão específica.

O Schedule Engine (`03_SCHEDULE_ENGINE.md`) decide QUAL sessão e QUANDO.
Workout Execution registra O QUE aconteceu quando o usuário efetivamente
treinou aquela sessão. Nenhum dos dois altera o Program Snapshot ou o
template — ver §Program Snapshot.

```text
Program (prescrito)
  → Schedule (qual sessão agora)
    → Execution (o que foi realmente feito)
      → History (consulta das executions)
        → [futuro] Progression Engine
```

## Modelo de dados

Coleção de topo por usuário — não aninhada em `workoutPrograms/{programId}`,
para que consultas de histórico ("últimos N treinos") nunca precisem varrer
programas individualmente, e para que a limpeza de conta apague tudo com uma
única passada de nível único, igual a `workoutPrograms`
(`functions/src/accountDeletion/firestoreCleanup/resources.ts`,
`deleteUserWorkoutExecutions`):

```text
users/{uid}/workoutExecutions/{executionId}
  {
    programId, templateId, sessionIndex, sessionName, scheduledLocalDate,
    status: IN_PROGRESS | COMPLETED | PARTIALLY_COMPLETED | ABANDONED,
    startedAt, finishedAt,
    exercises: [
      {
        exerciseIndex, exerciseId,
        prescribedSets, prescribedReps, prescribedDuration, prescribedCycles,
        sets: [{ setIndex, status: PENDING|COMPLETED|SKIPPED, actualReps, weightKg, actualDurationSeconds }]
      }
    ],
    executionSchemaVersion, createdAt, updatedAt
  }
```

`executionId` é determinístico
(`` exec_${programId}_${sessionIndex}_${scheduledLocalDate} ``,
`src/workoutExecution/types.ts` `workoutExecutionId`) — double tap, retry de
rede e cold start convergem no mesmo documento (docs §Idempotência).

`exerciseIndex`/`setIndex` são a única identidade estável que o Prescription
Engine oferece hoje: a posição no array `session.exercises[]`/materialização
de sets (`FinalWorkoutSession` não tem slot id próprio — ver
`src/workoutPrescription/types.ts`). `prescribedSets/Reps/Duration/Cycles` são
um snapshot mínimo da prescrição — o suficiente para reconstruir "o que foi
pedido" sem precisar reconsultar (e sem depender de) um Program Snapshot que
pode ter sido superseded depois.

Cada `set` guarda fatos, não métricas derivadas (docs §59): `actualReps`,
`weightKg` (sempre kg — nunca uma unidade de exibição; ver
`src/units/workoutLoadConversions.ts` para a conversão de exibição),
`actualDurationSeconds`. Nenhum campo tipo "performanceScore" existe.

## Set model

Um `set` nunca colapsa em uma string tipo "3 séries / 35kg / 10 reps" — cada
série é um registro independente (docs §14), porque carga e reps podem
divergir por série (`10x30, 10x35, 8x35` é literal, não arredondado para uma
média). `status: SKIPPED` é semanticamente diferente de "0 reps completadas"
(docs §29/§83) — uma série pulada nunca é gravada como uma série concluída
com valor zero.

Exercícios sem sets/reps tradicionais (`duration`/`cycles`, presentes em
T001–T090 — ver `FinalWorkoutExercise` em
`src/workoutPrescription/types.ts`) materializam exatamente 1 set quando não
há `sets` prescrito (mesma convenção que `WorkoutScreen` já usava antes desta
fase: `prescribed.sets ?? 1`), e registram `actualDurationSeconds` em vez de
`actualReps`/`weightKg`. Nenhum interval-timer/engine de cycles foi construído
— fora de escopo (docs §20).

## Lifecycle

```text
Start        → IN_PROGRESS (cria ou resume o mesmo doc — nunca duplica)
Record set   → set individual: COMPLETED (actualReps/weightKg) ou SKIPPED
Skip exercise→ todo set ainda PENDING daquele exercício vira SKIPPED
Finish       → sweep de PENDING remanescentes para SKIPPED, depois:
                 todos COMPLETED → status COMPLETED
                 algum SKIPPED   → status PARTIALLY_COMPLETED
Abandon      → status ABANDONED (nunca via Finish)
```

`startOrResumeWorkoutExecution` (`src/services/workoutExecutions.ts`):
- doc não existe → cria `IN_PROGRESS` com o snapshot de exercícios/sets
  materializado a partir de `program.sessions[sessionIndex]`;
- doc `IN_PROGRESS` → retorna como está (resume — cold start funciona porque
  o Firestore, não o React state, é a fonte da verdade; docs §24/§25);
- doc `ABANDONED` → reinicia do zero (o snapshot da tentativa abandonada é
  descartado — nada daquela tentativa contou para nada);
- doc `COMPLETED`/`PARTIALLY_COMPLETED` → lança erro em vez de reabrir
  silenciosamente uma sessão já encerrada e imutável.

`finishWorkoutExecution` é idempotente: se já terminou, retorna o status
existente sem reescrever nada (double finish nunca reprocessa o sweep nem
rederiva o status duas vezes — docs §38/§39).

`abandonWorkoutExecution` só transiciona a partir de `IN_PROGRESS`; chamar de
novo num doc já terminal é no-op.

## Integração com o Schedule Engine

Este motor **nunca** implementa sua própria lógica de avanço de rotação.
`finishWorkoutExecution` apenas resolve o status da Execution; quem avança a
sequência é sempre `completeScheduledSession`
(`src/services/workoutSchedule.ts`, já existente, já idempotente por
`eventId` determinístico) — chamado pelo caller (hoje, `AppShell.tsx`) logo
depois:

```text
execution.finish()               // COMPLETED ou PARTIALLY_COMPLETED
  → schedule.completeSession(sessionIndex)   // avança nextSessionIndex exatamente 1
```

`COMPLETED` e `PARTIALLY_COMPLETED` contam igualmente como sessão concluída
para o Schedule (docs §35) — o usuário encerrou explicitamente aquela sessão,
mesmo que algo tenha sido pulado. `ABANDONED` nunca chama
`completeScheduledSession` — a rotação não avança (docs §36).

Um double finish seguido de um double `completeSession` avança a sequência
uma única vez — cada metade da composição já é idempotente isoladamente
(prova em `src/services/__tests__/workoutExecutions.integration.test.ts`
§88, contra o Firestore Emulator real).

`AppShell.tsx` só chama `execution.start(sessionIndex)` quando
`schedule.resolution.status === 'SESSION_READY'` — `REST_DAY`,
`SCHEDULE_SETUP_REQUIRED`, `PROGRAM_NOT_AVAILABLE` e uma decisão de falta
pendente nunca criam uma Execution (docs §71-74).

## Program Snapshot e Template — imutabilidade

Nenhuma função deste motor escreve em `workoutPrograms/{programId}` ou
`workoutTemplates/{templateId}`. Prescrito ≠ realizado sempre: alterar
`actualReps`/`weightKg` nunca reescreve `prescribedReps`/`prescribedSets` no
mesmo documento — são campos irmãos, um é a cópia congelada da prescrição, o
outro é o fato registrado. Provado por integração (§90/§91: o doc do
programa é lido antes/depois de um ciclo completo de start→record→finish e
comparado byte a byte).

## History

Histórico é derivado inteiramente de `workoutExecutions` — não existe uma
coleção `workoutHistory` paralela (docs §41). `listRecentWorkoutExecutions`
(`src/services/workoutExecutions.ts`) consulta apenas execuções terminais
(`COMPLETED`/`PARTIALLY_COMPLETED`/`ABANDONED`), ordenadas por
`scheduledLocalDate` desc. Execuções de um programa já superseded continuam
aparecendo — nada filtra por `workoutProgramState/active` (docs §45).

## Firestore Rules

`workoutExecutionCommonValid` (`firestore.rules`) segue a mesma convenção de
`workoutProgramCommonValid`: `hasAll`/`hasOnly` exato, tipos e faixas
validados, e cross-check de ownership do programa via
`get(.../workoutPrograms/$(data.programId))` — um `programId` que não existe
sob este mesmo `userId` falha a leitura e a escrita é negada (docs §52). Não
há validação profunda de cada `set` dentro de `exercises` (mesmo precedente
que `sessions` em `workoutProgramCommonValid` já estabelece — validação
nesse nível de detalhe pertence à camada de app, não às Rules).

`create` exige `status == 'IN_PROGRESS'`, `finishedAt == null`,
`startedAt/createdAt/updatedAt == request.time`. `update` só é permitido
enquanto `resource.data.status in ['IN_PROGRESS', 'ABANDONED']` (um
`ABANDONED` pode ser reiniciado); uma vez `COMPLETED`/`PARTIALLY_COMPLETED`,
o documento é imutável — nenhuma outra escrita é aceita (docs §53).
`programId`/`sessionIndex`/`scheduledLocalDate`/`startedAt`/`createdAt` nunca
podem mudar depois de criados. `delete` é sempre negado.

Ownership é exclusivamente o path (`isOwner(userId)`), nunca um campo de
payload — mesma convenção do resto do arquivo. 15 casos cobertos em
`firestore-tests/workoutExecutions.rules.test.ts` (cross-user, campos
extras/faltantes, timestamps forjados, transições de status, imutabilidade
pós-finish, delete sempre negado).

## Idempotência e transações

- **Start**: `runTransaction` — lê o doc, decide create/resume/restart/erro
  antes de escrever; nunca cria dois documentos para a mesma chave
  determinística.
- **Record/skip set, skip exercise**: `runTransaction` — recusa qualquer
  mutação se o status não for `IN_PROGRESS` (`EXECUTION_NOT_IN_PROGRESS`).
- **Finish**: `runTransaction` — idempotente (ver acima).
- **Abandon**: `runTransaction` — idempotente, só transiciona a partir de
  `IN_PROGRESS`.

Nenhuma dessas transações inclui a escrita do Schedule Engine no mesmo
`runTransaction` — cada metade é independentemente idempotente
(`eventId`/`executionId` determinísticos), o que compõe corretamente sob
retry sem precisar de uma transação cross-collection única (docs §38).

## Cleanup de conta

`deleteUserWorkoutExecutions`
(`functions/src/accountDeletion/firestoreCleanup/resources.ts`) apaga
`users/{uid}/workoutExecutions` inteira numa única passada — não precisa
enumerar programas primeiro porque a coleção é de topo. Registrada em
`engine.ts` entre `workoutProgramState` e `deleteUserProfileDocument`
(sempre por último).

## UI mínima

`AppShell.tsx` chama `execution.start`/`recordSet`/`finish`/`abandon`
(`src/workoutExecution/useWorkoutExecution.ts`) — `WorkoutScreen` continua
presentation-only, sem falar com o Firestore diretamente. O botão de fechar
(X) do cabeçalho passou a chamar `onAbandon` antes de `onDone` (alcançável
apenas quando a sessão não terminou — `WorkoutDone` já é outro componente).
Cada série concluída (`advanceAfterRest`/`completeSet`) chama `onSetLogged`
com o peso realmente registrado.

**Deixado para uma UI futura** (infraestrutura já pronta e coberta por
testes; docs §70 permite isso explicitamente):

- input de reps realizadas por série (`WorkoutScreen` hoje só coleta peso —
  `actualReps` é persistido como `null` até essa UI existir, uma
  representação honesta de "não coletado", nunca um valor inventado);
- um botão explícito de "pular série"/"pular exercício" permanente na UI (o
  `skipExercise` existente hoje é um reordenamento/postergação, não um skip
  definitivo — `skipSetExecution`/`skipExerciseExecution` já existem no
  serviço, prontos para essa UI);
- um botão de "finalizar mesmo incompleto" com a confirmação do §37 (hoje só
  existe o caminho de completar 100% das séries);
- uma tela de histórico dedicada — `ProgressScreen`'s `LoadsEmptyState`
  (`src/screens/ProgressScreen.tsx`) já documenta, no próprio código, que se
  torna um painel real assim que o log de treino for persistido — é o ponto
  de entrada natural para consumir `listRecentWorkoutExecutions`.

## Versionamento

`executionSchemaVersion: 1` (`WORKOUT_EXECUTION_SCHEMA_VERSION`,
`src/workoutExecution/types.ts`) — independente de `scheduleVersion`/
`templateVersion`/`questionnaireVersion`; nenhum deles teve bump por esta
fase.

## Fora de escopo desta fase

O Limitation Resolver, hoje `IMPLEMENTED_V1` no Prescription Engine, permaneceu
fora do escopo desta fase. Progression Engine, transição automática de
Beginner, progressão de carga, PR detection, deload, rotação trimestral,
analytics avançado, streak/XP/gamificação, timer avançado de descanso,
HealthKit/Health Connect, edição administrativa de histórico — nenhum
tocado. Ver `04_PROGRESSION_ENGINE.md` e `07_OPEN_DECISIONS.md`.
