# Push Notifications — Fase 3: motor diário

## Fontes de verdade

O motor não mantém uma segunda prescrição. Para cada avaliação ele lê o
`workoutLifecycleState/current`, o `ProgramInstance` e o `WorkoutProgram`
ativos. Os dias vêm exclusivamente de `WorkoutProgram.weeklySchedule`:

- `TRAINING` é um dia de treino;
- `ACTIVE_RECOVERY` é um dia de recuperação notificável;
- `REST` é neutro e nunca vira `RECOVERY_DAY`.

Para snapshots legados válidos cuja `weeklySchedule` esteja ausente/vazia, o
motor reutiliza o mesmo fallback do app: `scheduleConfig.trainingDays` define
somente `TRAINING` e os demais dias ficam neutros. O fallback nunca inventa
`ACTIVE_RECOVERY`; portanto um programa legado sem essa prescrição explícita
não recebe `RECOVERY_DAY`.

A rotação, conclusão e gap continuam sendo resolvidos pela mesma função pura
`resolveWorkoutSchedule` usada pelo app. O estado fica em
`workoutPrograms/{contentIdentity}/scheduleState/{programInstanceId}` e as
decisões de miss no ledger `scheduleEvents`. Uma execução finalizada também é
confirmada pelo ID determinístico de `workoutExecutions` antes de emitir
`WORKOUT_DAY`, cobrindo o pequeno intervalo entre finalizar a execução e
avançar o cursor do schedule.

## Timezone

O timezone canônico do usuário permanece em
`users/{uid}/workoutProgramState/scheduleConfig.timezone`. Ele é uma zona IANA,
não um offset. O runtime de registro já autenticado obtém `timeZone` pelo
`expo-localization` e o envia no `syncPushDevice`; o backend valida/canonicaliza
com `Intl` e atualiza apenas o schedule do próprio `request.auth.uid`.

O mesmo sync mantém a projeção privada `notificationDailyUsers/{uid}` com
`timezone`, `nextEvaluationAt`, `lastTimezoneSyncAt` e expiração. Isso não é
uma segunda fonte do calendário: é somente um índice de trabalho. A avaliação
reabre os documentos canônicos e usa o timezone do `scheduleConfig`.

Em multi-device, a atividade autenticada mais recente vence para o usuário.
Uma instalação não cria um candidate próprio; o dispatcher faz o fan-out do
único candidate aos devices elegíveis. Uma resposta atrasada de outro usuário
é barrada pelo mesmo ownership/version fence do device sync. Um device antigo
em outro fuso só volta a vencer se ficar ativo e sincronizar autenticado.

Timezone ausente, inválido ou em formato de offset suprime a notificação. UTC
não é usado silenciosamente. A projeção recebe apenas uma data segura de nova
checagem até um sync válido corrigi-la.

## Cadência, janela e escala

`evaluateDailyWorkoutNotifications` roda uma vez por hora em UTC. Uma cadência
horária cobre inclusive zonas IANA com offsets de 30 ou 45 minutos dentro da
janela local semiaberta `08:00 <= hora < 10:00`, sem um cron por usuário.

O scheduler consulta somente `notificationDailyUsers` cujo
`nextEvaluationAt <= now`, em páginas de 100, com concorrência 10 e limite de
2.000 usuários por execução. A consulta usa um único campo, portanto não exige
índice composto. Ao atingir o limite, o motor registra
`scheduler_capacity_exhausted`; a próxima execução continua vendo os itens
ainda vencidos. Em produção, o limite comporta aproximadamente 48 mil usuários
ativos uniformemente distribuídos por timezone por dia (2.000 por hora). A
distribuição real deve ser observada antes de aumentar o limite/concurrency.

Cada usuário elegível custa uma leitura da projeção e, em uma avaliação de
domínio completa, aproximadamente 7–9 leituras de documentos. Fora da janela,
o motor lê o contexto para privilegiar segurança do timezone atual; futuras
otimizações podem separar uma versão/fence do timezone sem alterar o domínio.

A projeção expira depois de 45 dias sem foreground sync e é removida pelo
próprio scheduler. `notificationProductWindows.expireAt` tem retenção de 14
dias e está preparado para TTL do Firestore.

## Definições formais

### WORKOUT_DAY

É elegível somente quando o resolver do schedule ativo devolve
`SESSION_READY`, o weekday atual continua marcado como `TRAINING`, a execução
determinística daquela instância/sessão/data não está `COMPLETED` nem
`PARTIALLY_COMPLETED`, a conta está ativa e `workoutsAndReminders` está ligada.
Programa ou schedule alterado antes da avaliação é lido novamente e vence.

Identidade: `uid + WORKOUT_DAY + localDate` (a data é hasheada no contrato
persistido).

### RECOVERY_DAY

É elegível somente para `ACTIVE_RECOVERY_DAY`, derivado de um weekday
explicitamente `ACTIVE_RECOVERY` no programa ativo. `REST`, ausência de
schedule e programa incompleto são suprimidos. Essa regra é também o
anti-spam: não há push em cada dia vazio.

Identidade: `uid + RECOVERY_DAY + localDate`.

### MISSED_WORKOUT

Não significa meia-noite nem ausência de abertura do app. É elegível somente
quando o resolver canônico devolve `MISSED_SESSION_DECISION_REQUIRED`. Nesse
domínio, um treino pulado isolado continua pendente sem ser declarado miss; o
gap surge quando um novo training day torna duas ou mais ocorrências não
consumidas visíveis. Um `MISS_RESOLVED` determinístico impede reabrir um gap já
decidido.

Identidade: `uid + MISSED_WORKOUT + programInstanceId + missedScheduledDate +
missedSessionIndex`. Isso separa sessões sem expor esses valores no payload;
somente o hash entra no request do dispatcher.

## Concorrência, idempotência e colisões

Há três níveis:

1. claim com lease na projeção impede duas instâncias de fazerem trabalho
   simultâneo para o mesmo registro;
2. `notificationProductWindows` permite no máximo um candidate da categoria
   `WORKOUTS_AND_REMINDERS` por usuário/data local e possui claim token com
   fencing de worker stale;
3. o dispatcher central usa a identidade semântica do tipo/fonte e garante
   que replay, retry e cold start não enviem novamente.

`WORKOUT_DAY` e `RECOVERY_DAY` são mutuamente exclusivos pelo estado do
resolver. `MISSED_WORKOUT` tem prioridade sobre `WORKOUT_DAY`: quando existe
gap pendente, o resolver retorna a decisão de miss em vez de `SESSION_READY`.
A janela de produto impede que uma mudança concorrente de estado gere o outro
tipo no mesmo dia. Esse limite não se aplica a `OPERATIONAL`, portanto nunca
suprime billing.

Falha de push não escreve no workout domain. Um crash depois de dispatch é
seguro porque o dispatcher deduplica o replay. Falha antes do dispatch deixa a
claim stale e a projeção é liberada para retry limitado.

## Payload e navegação

Os três builders têm copy fixa e allowlist vazia para `data`; não carregam UID,
program ID, session ID, detalhes de treino ou dados sensíveis. Nenhum deep link
de produto foi criado nesta fase.

## Requisitos de publicação (não executados)

- publicar a nova Function `evaluateDailyWorkoutNotifications` e as mudanças
  de `syncPushDevice`/dispatcher no deploy de Functions aprovado;
- publicar o backend antes de distribuir um app com o novo campo `timezone`:
  a versão anterior de `syncPushDevice` possui allowlist estrita e rejeitaria
  esse campo ainda desconhecido;
- a Function agendada materializa o job do Cloud Scheduler automaticamente no
  deploy de Functions v2; nenhum job deve ser criado manualmente em separado;
- ativar o TTL de `notificationProductWindows.expireAt` pela alteração já
  preparada em `firestore.indexes.json`;
- não há nova Firestore Rule: as duas coleções são backend-only e continuam
  negadas ao cliente pelo default deny;
- não há índice composto novo. A query é `nextEvaluationAt <= now` ordenada
  pelo mesmo campo;
- `notificationDailyUsers` e `notificationProductWindows` são os novos schemas
  privados; `scheduleConfig.timezone` já existia.

Nenhum deploy, alteração de produção, push real ou trigger fora dos três tipos
da Fase 3 faz parte desta implementação local.
