# Push Notifications — Fase 6 (progresso)

## Escopo implementado

- `PHOTO_REMINDER`
- `ASSESSMENT_REMINDER`
- `COMPARE_PROGRESS`

`GOAL_PROXIMITY` permanece `BLOCKED_BY_DOMAIN`. `WEEK_COMPLETED` e
`WEEK_STREAK` continuam fora do escopo.

## Auditoria das fontes de verdade

### Fotos

A fonte canônica é `users/{uid}/progressPhotos/{photoId}`. Uma foto só entra
na avaliação quando o documento corresponde integralmente a uma das formas
aceitas pelas Firestore Rules (legacy, thumbnail ou posed), possui timestamps
válidos e aponta para o namespace criptografado do próprio usuário. O binário
e qualquer dado da imagem nunca são lidos pelo scheduler.

`takenAt` é a data real da foto. Para a forma posed, `dateKey` é o dia civil
local congelado na criação e tem precedência. Uploads incompletos não possuem
metadado canônico e documentos parciais/corrompidos fazem a avaliação falhar
fechada.

As leituras são limitadas aos 200 registros físicos mais recentes, ordenados
por `takenAt`/`measuredAt`. Isso mantém o scheduler bounded. Dados fora dessa
janela não são usados para inventar uma comparação antiga; a âncora mais
recente de cada lembrete continua necessariamente dentro da janela.

### Avaliações

A fonte canônica é `users/{uid}/assessments/{assessmentId}`. São aceitos os
dois snapshots completos e imutáveis já definidos pelo produto: `guided` e
`imported`. `measuredAt`, e não `createdAt`, ancora o ciclo, pois uma avaliação
importada pode ser retroativa. Uma avaliação importada sem percentual de
gordura continua completa conforme o contrato existente.

### Comparação

O comparador atual exige fotos persistidas, enquadramento compatível e momentos
distintos. A automação usa a versão mais conservadora desse contrato: dois dias
posed distintos que compartilham pelo menos uma pose. Fotos legacy continuam
comparáveis manualmente no aparelho, mas não entram na notificação, pois não
guardam o dia/fuso original necessário a uma identidade backend estável.

### Objetivo

O questionário guarda apenas um objetivo qualitativo (`gain_muscle`,
`lose_fat`, `strength`, `conditioning` ou `health`, além dos valores antigos
`body_composition`/`return_to_training` e aliases legacy). Não há target quantitativo,
baseline compatível, threshold de ruído ou função canônica `distanceToGoal`.
Peso, aderência ou progressão de treino não são proxies válidos para todos
esses objetivos. Por isso `GOAL_PROXIMITY` não foi registrado no schema, no
builder ou no QA.

## Regras de produto

### PHOTO_REMINDER

- exige ao menos uma foto válida já registrada; idade da conta nunca habilita;
- vence 30 dias civis locais após a foto válida mais recente;
- identidade: ciclo formado pelo dia da última foto e seu dia de vencimento;
- uma nova foto válida muda a âncora e resolve o ciclo anterior;
- 30 dias é uma decisão explícita desta fase: cadência mensal, conservadora,
  pois o produto não possuía frequência normativa para fotos.

### ASSESSMENT_REMINDER

- exige ao menos uma avaliação válida já registrada;
- vence 90 dias civis locais após `measuredAt` da avaliação mais recente;
- identidade: ciclo formado pelo dia medido e seu dia de vencimento;
- uma nova avaliação válida muda a âncora e resolve o ciclo anterior;
- 90 dias é uma decisão explícita desta fase: avaliação física é uma ação de
  maior atrito e a UX existente já apresenta horizontes comparativos de
  30/60/90 dias.

### COMPARE_PROGRESS

- exige dois snapshots posed em dias distintos com pelo menos uma pose comum;
- identidade: `oldDate + newDate`, independentemente de quantas poses foram
  registradas nesses mesmos dias;
- o mesmo par é one-shot; um snapshot comparável posterior cria nova identidade;
- abrir a tela não é tratado como fato de progresso nem é necessário para a
  idempotência do lembrete.

## Scheduler, prioridade e colisões

A Function publicada continua sendo `evaluateDailyWorkoutNotifications`, com
execução hourly. Ela agora também avalia progresso, mantendo timezone IANA e a
janela local `08:00 <= hora < 10:00`. Timezone ausente/inválido falha fechado.

Ordem:

1. `RE_ENGAGEMENT_LATE` / `RE_ENGAGEMENT_EARLY`;
2. `WORKOUT_DAY` / `MISSED_WORKOUT` / `RECOVERY_DAY` e
   `EVOLUTION_APPROACHING` conforme a suíte existente;
3. `COMPARE_PROGRESS`;
4. `ASSESSMENT_REMINDER`;
5. `PHOTO_REMINDER`.

Notificações operacionais (`BILLING_ISSUE`, `PREMIUM_ENDED`) e fatos
event-driven (`EVOLUTION_UNLOCKED`, `PROGRAM_UPDATED`) não foram alterados.
O slot diário existente em `notificationProductWindows` é compartilhado entre
workout e progress, impedindo dois envios planejados no mesmo dia. O hash do
documento mantém o namespace histórico por compatibilidade; o campo `category`
passa a registrar a categoria real do candidato.

## Preferência, idempotência e preflight

Os três tipos usam a categoria `PROGRESS` e, no caminho de produto, respeitam
`preferences.notificationPreferences.progress`. O dispatcher central continua
sendo o único sender.

`notificationAchievementMilestones` fornece one-shot e fencing por tipo +
identidade semântica. Não há coleção nova. Concorrência e replay são barrados
antes do dispatcher; falhas antes do dispatch liberam a claim para retry.

Antes de cada tentativa do dispatcher (inclusive retry), o backend relê as
fontes canônicas sem exigir a janela horária. Foto/avaliação nova, remoção ou
substituição de um snapshot e histórico inválido cancelam o envio como stale.

## Privacidade e QA

Título e body são genéricos em PT-BR, EN e ES, com fallback PT-BR. O payload
continua estruturado apenas com `type` e `notificationId`; `data` canônico é
vazio, sem peso, medidas, percentual, foto, IDs de domínio ou diagnóstico.

O QA Preview inclui somente os três tipos implementados. Ele usa os mesmos
builders/cópias, continua self-targeted, passa pelo dispatcher e não cria fatos,
milestones ou product windows. `GOAL_PROXIMITY` não aparece no painel.

## Persistência e exclusão

Não há nova coleção, índice, Rule ou TTL. O fluxo de account deletion já remove
`progressPhotos`, `assessments`, `notificationAchievementMilestones` e
`notificationProductWindows`, que são todas as estruturas envolvidas.
