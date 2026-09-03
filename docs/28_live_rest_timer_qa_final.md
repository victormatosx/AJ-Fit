# Live Rest Timer — QA final da Fase 7

## Escopo e fonte de verdade

O React Native é o único dono do treino. `RestSessionContext` cria um
`startedAt` e um `endsAt` absolutos, persiste o mesmo descanso e envia o mesmo
deadline à facade. ActivityKit, WidgetKit e SystemUI apenas representam esse
estado temporal. Nenhum código nativo avança série, registra carga, cria
contador próprio ou chama a bridge por segundo.

Fluxo auditado:

```text
completeSet
  -> startRest
  -> persistRestSession
  -> restLiveActivity.start/update
  -> superfície do sistema
  -> reconcileRestExpiration
  -> consumeExpiration(restId)
  -> advanceAfterRest (somente para o consumidor vencedor)
  -> restLiveActivity.end
```

Não existe restore completo da workout engine. No cold start, um descanso
persistido sem workout restaurável é descartado e superfícies nativas órfãs são
encerradas. Isso prefere consistência segura a fabricar uma sessão.

## Evidência automatizada desta rodada

- Branch: `feature/rest-timer-phase-1-deep-link`.
- HEAD base: `7cb34ac87c8f6b2b995653abc3cd562514688099`.
- Testes focados: 102 aprovados em nove arquivos.
- Suíte Vitest: 3194 aprovados e quatro skips preexistentes.
- TypeScript: `tsc --noEmit` aprovado.
- i18n: pt-BR/en/es, 12 namespaces, zero bloqueios. Onze hardcodes já
  existentes fora do Live Rest Timer foram apenas reportados pelo auditor.
- Android: `:app:assembleDebug` aprovado com JDK 17, minSdk 24, compileSdk 36,
  targetSdk 36 e `ajfit-rest-activity` autolinkado.
- iOS: prebuild limpo e `pod install` aprovados; target
  `AJFitRestActivityExtension`, embed phase, dependência explícita, bundle ID
  `com.ajfit.app.RestActivity` e `Localizable.xcstrings` regenerados.
- Build Xcode, signing e execução iOS: não executados por solicitação do
  responsável, que fará builds no próprio dispositivo.

## Garantias protegidas por código e testes

- Um único `endsAt`; `+15` altera esse mesmo deadline.
- Um `restId` é consumido no máximo uma vez.
- Três `+15` preservam `restId`, `workoutSessionId` e `startedAt`, somando 45s.
- A fila preserva start/update/end/cleanup em corridas rápidas.
- Uma sessão lógica por workout; Android sempre usa notification ID `41704`.
- iOS reutiliza a Activity da mesma sessão e encerra órfãs no cleanup.
- Logout, exclusão de conta, troca de usuário, cold start inválido e unmount raiz
  limpam storage e apresentação nativa de forma fail-open.
- Permission/capability revogada não impede `end` ou `cleanup`.
- Módulo ausente ou binário anterior sem `cleanup` não quebra o treino.
- Sem update nativo/AsyncStorage por segundo, FGS, AlarmManager, overlay, bubble,
  accessibility service, PiP falso, private API ou background loop.
- Payload nativo contém apenas sessão, timestamps, exercício e série/total; não
  contém uid, email, premium, perfil, questionário, carga ou reps.

## Comportamento esperado em process death e force quit

iOS pode manter uma Live Activity segundo as políticas do ActivityKit; Android
pode manter a ongoing notification publicada pelo SystemUI. O AJ Fit não
restaura a workout engine após process death e não promete transição de domínio
com JavaScript morto. No próximo bootstrap coerente, o cleanup nativo remove a
superfície órfã. Force quit e duração visual exata continuam sujeitos às regras
de cada sistema operacional.

## Checklist manual pendente — iPhone com Dynamic Island

- [ ] Iniciar descanso e ir para Home.
- [ ] Verificar compact: ícone, countdown e ausência de clipping.
- [ ] Verificar minimal.
- [ ] Abrir expanded: exercício longo, Série N/M, countdown e tap.
- [ ] Verificar Lock Screen em light/dark.
- [ ] Aplicar `+15` três vezes sem criar outra Activity.
- [ ] Skip no início, após `+15` e próximo de zero; avançar uma vez.
- [ ] Tocar em app fechado, aberto, background e já na Workout.
- [ ] Concluir/cancelar workout e confirmar remoção.
- [ ] Desativar Live Activities e confirmar workout fail-open.
- [ ] Repetir após background prolongado, process death e force quit.

## Checklist manual pendente — iPhone sem Dynamic Island

- [ ] Em Home desbloqueada, confirmar ausência esperada de superfície flutuante.
- [ ] Na Lock Screen, confirmar countdown, nome longo e contraste light/dark.
- [ ] Verificar `+15`, tap, skip e workout end.
- [ ] Repetir após suspensão e force quit.

## Checklist manual pendente — Android API 36+

- [ ] Com promoção permitida, confirmar `android-live-update` no runtime.
- [ ] Verificar promoted surface, shade, status bar e Lock Screen.
- [ ] Com promoção desligada, confirmar fallback `android-notification`.
- [ ] Revogar POST_NOTIFICATIONS e confirmar ausência de crash/prompt repetido.
- [ ] Verificar mesmo ID `41704`, chronometer e ProgressStyle via dumpsys.
- [ ] Aplicar `+15` três vezes e confirmar somente uma notification.
- [ ] Skip próximo de zero e confirmar uma transição/remoção.
- [ ] Testar tap nos quatro estados do app e deep link protegido.
- [ ] Repetir em light/dark, background, process death e force quit.

## Checklist manual pendente — Android API 24–35

- [ ] Confirmar ongoing notification e chronometer regressivo.
- [ ] Verificar shade/Lock Screen quando permitido.
- [ ] Confirmar `+15`, skip, tap e cleanup com o mesmo ID `41704`.
- [ ] Confirmar permission denied fail-open onde aplicável.
- [ ] Repetir em background prolongado e force quit.

## Critério de liberação

Nenhum bloqueio estrutural ou automatizado permanece conhecido. A liberação
final deve ser assinada somente após o checklist visual acima, especialmente
Dynamic Island em hardware real e promoted ongoing em Android 16 elegível.
Até isso ocorrer, o veredito é **READY WITH KNOWN LIMITATIONS**.
