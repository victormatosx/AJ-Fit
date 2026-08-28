# Progression Engine

## Escopo

Status geral do motor: `IMPLEMENTED_V1`.

Decide QUANDO um Program Snapshot deve evoluir: transições de estágio do
Beginner (1→2→3) e, uma vez em treino completo, uma renovação normal por
ciclo de ~90 dias. Nunca escolhe Txxx, nunca altera load/reps/sets — quem
gera a prescrição continua sendo o Prescription Engine; este motor apenas
decide QUANDO pedir para ele rodar de novo, e com qual `adaptationStage`.

```text
Program (prescrito)
  → Schedule (qual sessão agora)
    → Execution (o que foi realmente feito)
      → History (consulta das executions)
        → Progression (quando o programa deve evoluir)
          → novo Program (superscede o anterior)
```

## Separação obrigatória

- intermediário e avançado começam no template-base;
- avançado não recebe automaticamente mais séries, intensidade ou técnicas;
- iniciante deixa o modificador temporário após completar Stage 2;
- beginner reduz apenas exercícios em Stage 1/2 e volta à sessão-base em
  Stage 3;
- o fim dessa redução não é promoção de nível — é uma transição de
  `adaptationStage`, orquestrada por este motor, nunca implícita;
- nenhum ciclo progride apenas porque o calendário atingiu certa data —
  tempo sozinho nunca é suficiente (ver §Eligibility);
- safety e constraints atuais prevalecem sobre qualquer progressão (este motor
  não substitui nem contorna o Limitation Resolver V1).

## Beginner — Stage 1 → 2 → 3

Reaproveita exatamente a regra já implementada
(`docs/workout-lifecycle/02_BEGINNER_ADAPTATION.md`,
`src/workoutPrescription/personalization.ts`): `isBeginnerExperience` (níveis
`never_or_starting`/`beginner`; `return_to_training` — um valor de `goal`, não
de `level` — nunca ativa isso, DR-022) e `beginnerKeepFactor` (Stage 1 ≈ 50%
dos exercícios, Stage 2 ≈ 70%, Stage 3 = base completa).

Cada estágio é um **Program Snapshot próprio, com `programId` determinístico
diferente** — `adaptationStage` já fazia parte do hash de identidade do
programa antes desta fase (`src/services/workoutPrograms.ts`
`programIdentity`), então gerar Stage 2 nunca sobrescreve Stage 1; sempre
cria um novo documento e supersede o anterior via
`saveAndActivateWorkoutProgram` (infraestrutura já existente, reaproveitada
sem alteração de contrato).

## Eligibility (Beginner)

Ambos os gates precisam ser satisfeitos — tempo sozinho, ou sessões sozinhas,
nunca bastam:

- **tempo**: `BEGINNER_STAGE_MIN_DAYS = 7` dias corridos desde a ativação do
  estágio atual (data local, mesmo utilitário de data do Schedule Engine);
- **sessões**: `COMPLETED + PARTIALLY_COMPLETED` executions **do programId
  atual** (nunca de um estágio anterior — cada estágio tem seu próprio
  `programId`, então isso é automático) `>= trainingDays` (a frequência
  semanal configurada no Schedule Engine).

`ABANDONED` nunca conta. Um `SKIPPED` do Schedule (falta sem execução) também
nunca conta — só uma Execution real registrada conta como sessão.

Stage 3 **não** reentra nesse gate semanal — uma vez em treino completo, a
única evolução possível é a renovação normal (abaixo).

## Renovação normal (pós-Beginner)

Uma vez em Stage 3 (ou para quem nunca foi Beginner — intermediário/avançado
desde o início), o programa não troca a cada semana. `NORMAL_PROGRAM_CYCLE_DAYS
= 90` é a referência de ciclo, centralizada em
`src/progressionEngine/types.ts` — nunca espalhada como `90` solto pelo
código.

Eligibility exige AMBOS:

- `elapsedDays >= 90` desde a ativação do programa atual;
- **aderência** `>= NORMAL_ADHERENCE_THRESHOLD (60%)`: `completedOrPartial /
  expectedSessions`, onde `expectedSessions = trainingDaysPerWeek *
  elapsedDays / 7` e o mínimo exigido é `ceil(expectedSessions * 0.6)`.
  Exemplo do produto: 4 dias/semana × 90 dias ≈ 51,4 sessões esperadas → mínimo
  31. Regra de produto deliberadamente aproximada, não uma modelagem
  estatística precisa.

90 dias sem aderência nunca é `ROTATION_AVAILABLE` — evita o caso "usuário
sumiu 3 meses e volta para achar um programa completamente novo criado
silenciosamente" quando o programa antigo provavelmente ainda faz sentido.

## Rotação de template — o que foi realmente implementado

A biblioteca T001–T090 mapeia **1:1** cada combinação de
(sexo, família de objetivo, ambiente, dias/semana) para exatamente um
template (`docs/32_workout_prescription_engine.md`) — não existem
alternativas reais hoje. Por isso, a V1 da rotação normal **reutiliza
deliberadamente o mesmo template e a mesma prescrição-base**, gerando apenas
uma nova ativação: como a identidade do programa não muda (mesmo
questionário, mesmo template/versão, mesmo `adaptationStage`), o
`programId` resultante é o **mesmo**, e `saveAndActivateWorkoutProgram`
apenas re-ativa esse mesmo documento (`activatedAt` avança, reiniciando o
relógio dos 90 dias). Isso não é um bug de idempotência — é a única
representação honesta de "não fingir variedade que não existe" (docs
§40/41). Se no futuro a biblioteca ganhar alternativas reais e explicitamente
compatíveis para a mesma combinação, uma rotação para um `programId`
realmente diferente passa a ser possível sem qualquer mudança neste motor —
apenas a seleção de template mudaria. DR-014 permanece parcialmente aberto
para esse caso (DR-027).

Mudança de perfil (dias, objetivo, ambiente, equipamento, limitações) nunca é
"progression" — é reassessment/regeneração, tratada em outro fluxo; este
motor nunca lê nem infere isso.

## Resolver puro

`evaluateWorkoutProgression` (`src/progressionEngine/resolver.ts`) — sem
I/O, determinístico:

```text
INVALID_PROGRAM_STATE
BLOCKED_ACTIVE_EXECUTION
NOT_ELIGIBLE { reasonCodes: MINIMUM_TIME_NOT_REACHED | MINIMUM_SESSIONS_NOT_REACHED | PROGRAM_AGE_NOT_REACHED | ADHERENCE_TOO_LOW }
BEGINNER_STAGE_PROGRESSION_AVAILABLE { fromStage, toStage }
NORMAL_ROTATION_AVAILABLE
```

`BLOCKED_ACTIVE_EXECUTION` tem prioridade sobre qualquer eligibility — uma
Execution `IN_PROGRESS` do programa atual bloqueia a transição
incondicionalmente (docs §23/§36/§72/§93: nunca trocar o programa no meio de
uma sessão).

## Evaluate vs Apply

Estritamente separados (docs §50):

- `evaluateActiveProgression(uid)` (`src/services/workoutProgression.ts`) —
  só lê: programa ativo, `scheduleConfig.trainingDays`, executions do
  programa (`listExecutionsForProgram`, filtro único por `programId`, sem
  índice composto). Nunca escreve nada.
- `applyProgression({ uid, expectedProgramId })` — **revalida tudo do zero**
  antes de agir (nunca confia numa `resolution` que o caller possa estar
  segurando há um tempo): recarrega o programa ativo; se ele já não é mais
  `expectedProgramId`, retorna `ALREADY_APPLIED` sem erro (cobre reabrir o
  app depois de uma transição já aplicada por outro device — docs §99);
  reavalia eligibility; se `BLOCKED_ACTIVE_EXECUTION`/`NOT_ELIGIBLE`, não faz
  nada. Só então chama `generateAndPersistWorkoutProgram` (Prescription
  Engine, sem alteração) com `adaptationWeek` explícito:
  - transição de Beginner → `resolution.toStage` (2 ou 3);
  - renovação normal → **sempre `3`**, mesmo para quem nunca foi Beginner
    (inofensivo nesse caso) — omitir isso regrediria um usuário já graduado
    de volta a Stage 1, porque `adaptationStage(week)` assume Stage 1 quando
    `week` está ausente. Bug real encontrado e corrigido durante esta fase
    (ver §Bugs encontrados).

Reutiliza o questionário **imutável já associado ao programa**
(`program.questionnaireId`/`questionnaireVersion`, via o novo
`getQuestionnaireById` em `src/services/userProfile.ts`) — nunca o "mais
recente" (que pode ter mudado desde então) e nunca reabre o onboarding (docs
§27).

## Progression Events

Ledger imutável de auditoria — não substitui Workout History (docs §58),
registra apenas a TRANSIÇÃO de programa:

```text
users/{uid}/workoutPrograms/{fromProgramId}/progressionEvents/{eventId}
  { type: BEGINNER_STAGE_TRANSITION|NORMAL_ROTATION, toProgramId,
    fromStage, toStage, reason, occurredAt, progressionEngineVersion }
```

Nested sob o programa **de origem** (sobrevive a ele ser superseded).
`toProgramId` pode ser igual ao próprio `programId` do path, no caso de
renovação normal em-lugar (docs §40/41 acima). `eventId` é determinístico
(`` ${type}_${occurredOnLocalDate} ``) — mesmo dia colide/deduplica
(double-tap/retry, docs §36/§77/§91); um dia diferente (ex.: a próxima
renovação 90 dias depois do mesmo programa) gera um evento novo
legitimamente, o mesmo princípio de `scheduleEvents`.

## Idempotência e concorrência

Nenhuma "trava" dedicada foi necessária além do próprio design: o
`programId` do alvo é **determinístico** (mesmo hash de identidade que já
protege o Prescription Engine), então duas chamadas concorrentes de
`applyProgression` — mesmo sem qualquer coordenação — convergem para o
MESMO `programId` alvo, e a transação já-idempotente de
`saveAndActivateWorkoutProgram` (get-then-set-or-update) garante que nunca
existam dois documentos para a mesma transição. `applyProgression` em si
sempre recarrega e reavalia do zero (§Evaluate vs Apply), então uma segunda
chamada após a primeira ter sucedido naturalmente encontra
`program.programId !== expectedProgramId` e retorna `ALREADY_APPLIED` sem
tocar em nada. Provado com chamadas concorrentes reais contra o Firestore
Emulator (`src/services/__tests__/workoutProgression.integration.test.ts`
§92).

## Integração com Schedule/Execution

- **Execution** fornece os fatos (`listExecutionsForProgram`, filtro só por
  `programId`); nunca é modificado por este motor.
- **Schedule**: o novo `programId` recebe automaticamente um
  `scheduleState` próprio e vazio (a coleção é escopada por `programId`,
  nunca migrada — mesmo princípio de "troca de programa" que já existia no
  Schedule Engine, docs `03_SCHEDULE_ENGINE.md` §Troca de programa).
  `scheduleConfig` (`trainingDays`/`timezone`) é preferência do usuário, não
  do programa — sobrevive automaticamente, sem qualquer código extra.
- Quando chamar: só depois que uma sessão termina
  (`execution.finish()` + `schedule.completeSession()` já resolvidos),
  nunca enquanto uma está `IN_PROGRESS` — ver `src/screens/AppShell.tsx`.

## Program Snapshot e Template — imutabilidade

Idêntico ao que já valia para o Prescription/Execution Engines: nenhuma
escrita deste motor toca `workoutTemplates/{id}` nem reescreve um
`workoutPrograms/{programId}` já existente além de `status`/`activatedAt`/
`updatedAt` (mesmas regras de `workoutProgramCommonValid`, já em vigor).

## Firestore Rules

`progressionEvents` segue a mesma convenção de `scheduleEvents`:
`create`-only, `hasAll`/`hasOnly` exato, `occurredAt == request.time`,
`update`/`delete` sempre `false`. `WorkoutProgramSource` ganhou um terceiro
valor, `automatic_progression`, refletido em
`workoutProgramCommonValid`'s `source in [...]`. 7 novos casos em
`firestore-tests/workoutProgression.rules.test.ts` (302 no total do
projeto).

## Cleanup de conta

`deleteUserWorkoutProgressionEvents`
(`functions/src/accountDeletion/firestoreCleanup/resources.ts`) enumera os
`workoutPrograms` do usuário e apaga a subcoleção `progressionEvents` de cada
um, executado **antes** de `deleteUserWorkoutPrograms` no pipeline
(`engine.ts`) — do contrário, a política de delete de um nível só deixaria
essas subcoleções órfãs.

## UI mínima

`useWorkoutProgression` (`src/progressionEngine/useWorkoutProgression.ts`),
chamado por `AppShell.tsx` logo após `execution.finish()` +
`schedule.completeSession()` — nunca durante uma sessão em andamento. Se uma
transição foi de fato aplicada, `prescription.reload()` recarrega o programa
ativo e um `ProgressionFeedbackModal`
(`src/components/progression/ProgressionFeedbackModal.tsx`) mostra uma
mensagem simples e não-clínica ("Seu treino evoluiu" / "Seu programa foi
renovado") — sem menção a dias, percentuais ou thresholds. Se a biblioteca
não oferecer alternativa real de template, a linguagem permanece neutra —
nunca promete "um treino totalmente novo" quando é a mesma prescrição
reativada.

## Versionamento

`PROGRESSION_ENGINE_VERSION = 1`
(`src/progressionEngine/types.ts`) — independente de `scheduleVersion`/
`executionSchemaVersion`/`templateVersion`/`questionnaireVersion`; nenhum
deles teve bump por esta fase.

## Bugs pré-existentes encontrados e corrigidos nesta fase

Ambos bloqueavam qualquer chamada real (não apenas de teste) a
`generateAndPersistWorkoutProgram`/`saveAndActivateWorkoutProgram` contra
Firestore Rules genuinamente aplicadas — nunca detectados antes porque
nenhum teste anterior exercitava esse caminho fim a fim contra o Emulator com
Rules ativas (só fixtures manuais ou funções mockadas):

1. **`withoutUndefined` desmontava sentinels `serverTimestamp()`.** A função
   recursava em QUALQUER `typeof value === 'object'`, incluindo instâncias de
   `FieldValue` — `Object.entries()`/`Object.fromEntries()` destruíam o
   sentinel, persistindo um mapa literal `{_methodName: "serverTimestamp"}`
   em vez de um timestamp real. Isso fazia `createdAt == request.time`
   falhar sempre nas Rules. Corrigido restringindo a recursão a objetos
   plain (`Object.getPrototypeOf(value) === Object.prototype`).
2. **`workoutProgramCommonValid` não permitia o campo `planId`.**
   `WorkoutProgramSnapshot extends FinalWorkoutPlan`, então todo documento
   real inclui `planId` (de `FinalWorkoutPlan`) E `prescriptionId` (definido
   como o mesmo valor) — mas a lista `hasOnly()` das Rules só conhecia
   `prescriptionId`, rejeitando toda escrita real. Corrigido adicionando
   `planId` a `hasAll`/`hasOnly` e uma checagem de consistência
   `data.prescriptionId == data.planId`.

Ambos confirmados e cobertos por
`src/services/__tests__/workoutProgression.integration.test.ts`, que roda o
caminho real (Prescription Engine → Rules aplicadas) contra o Firestore
Emulator.

## Fora de escopo desta fase

O Limitation Resolver, hoje `IMPLEMENTED_V1` no Prescription Engine, permaneceu
fora do escopo desta fase. Load progression, deload, PR detection,
recomendações automáticas de carga, rotação real entre templates alternativos
(DR-027 — não existe biblioteca de alternativas hoje), regressão de
programa, IA generativa e T091+ continuam não implementados.
