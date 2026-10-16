# Vídeos de demonstração silenciosos — auditoria e validação

## Causa raiz

O AJ Fit usa `expo-video` 57.0.4 (Expo 57.0.24), não `expo-av` nem
`expo-audio`. A documentação do SDK 56 exigida por `AGENTS.md` foi consultada:
https://docs.expo.dev/versions/v56.0.0/sdk/video/.

`ExerciseGif` configurava apenas `loop = true` e `muted = true`, mantendo
o modo de áudio nativo implícito. Na versão **instalada**, o arquivo
`node_modules/expo-video/ios/VideoPlayer.swift` inicializa `audioMixingMode`
com `.doNotMix`, apesar do default `auto` descrito na documentação. Em
`ios/VideoManager.swift`, `doNotMix` remove `mixWithOthers` e executa
`AVAudioSession.setActive(true)` mesmo com o vídeo silenciado. Isso explica
a interrupção da música e a disputa pela sessão quando o player externo retoma.

No Android, `VideoPlayer.kt` usa `AUTO`. `AudioFocusManager.kt` solicita
foco para players audíveis ou `DO_NOT_MIX`; portanto, o mute existente já
evita essa solicitação no fluxo normal dessa versão. A auditoria não
reproduziu uma falha Android em dispositivo. A política explícita elimina a
dependência de defaults: `MIX_WITH_OTHERS` sai da função de solicitação de foco,
e o tratamento de perda de foco não pausa players com `muted = true`.

Não foram encontradas chamadas do app para `setAudioMode`, `AVAudioSession`
ou `requestAudioFocus`, nem outra biblioteca de reprodução. O plugin
`expo-video` em `app.json` não habilita background playback nem PiP.

## Cobertura e correção

- Todas as demonstrações de exercício usam `ExerciseGif`: banner, modal
  vertical e miniaturas de substituição em `WorkoutScreen`. URLs do cadastro
  web e vídeos locais passam pelo mesmo setup a cada nova fonte.
- `configureSilentDemoVideo` configura `mixWithOthers` **antes** de mute e
  play, desabilita Now Playing, background e reprodução externa, e mantém loop.
  Não usa volume zero, não depende da existência/detecção de faixa de áudio
  e não modifica configurações globais ou arquivos nativos.
- iOS: o gerenciador mantém a opção `mixWithOthers`; mute e ausência de
  `doNotMix` evitam sua chamada de ativação da sessão. O AVPlayer permanece
  silencioso mesmo quando o arquivo tem áudio embutido.
- Android: o caminho `mixWithOthers` não pede audio focus. Mute protege
  também contra pausa em callbacks de perda de foco. A faixa embutida fica
  inaudível sem depender de seleção de faixa após carregamento.
- Os outros players do app são os vídeos visuais silenciosos do onboarding.
  Eles usam a mesma configuração, pois o `expo-video` agrega a política dos
  players ativos por prioridade; um onboarding com `doNotMix` poderia
  dominar a política da demonstração. Seu controle de play/pause permanece
  nos componentes existentes.
- Exercícios: a observação de `AppState` pausa em inactive/background e
  retoma autoplay em active. Não há listener de áudio externo ou tentativa
  de retomar em resposta a perda de foco. A troca de fonte remove o listener
  antigo e ignora eventos enfileirados, sem chamar o objeto nativo liberado.
- Prioridade das fontes, fallback após erro, orientação, renderização,
  autoplay e loop permanecem preservados.

## Validação automatizada

`src/lib/__tests__/silentDemoVideo.test.ts` verifica configuração antes de
autoplay, independência de metadados de áudio, aplicação em cada novo player,
isolamento de outro player, background/foreground, montagem em background,
estado inicial desconhecido e descarte de callbacks de players antigos.
São testes de configuração/lifecycle com doubles; não simulam Spotify nem
comprovam comportamento do sistema operacional.

Também foram executados os testes existentes de prioridade/fallback e
carregamento de mídias, typecheck, ESLint dos arquivos alterados e a suíte
unitária completa:

- Testes direcionados: 4 arquivos, 24 testes aprovados.
- `npm run typecheck`: aprovado.
- ESLint dos 4 arquivos TypeScript alterados/criados: aprovado sem warnings.
- `git diff --check`: aprovado.
- `npm test`: 466 arquivos aprovados, 14 com falhas e 18 ignorados;
  6.820 testes aprovados, 20 com falhas e 209 ignorados.
- Os 14 arquivos com falhas foram reexecutados numa cópia temporária,
  substituindo apenas `ExerciseGif` e `onboardingVideoPreload` por suas versões
  originais de HEAD. Os mesmos 20 testes falharam (420 passaram nesse recorte).
  Portanto, as falhas já existem sem a correção dos vídeos. O workspace e
  as alterações anteriores do usuário foram preservados.

## Validação nativa pendente

Não havia simulador iOS inicializado na consulta `xcrun simctl list devices
booted`, nem dispositivo Android conectado em `adb devices -l`.
A validação com Spotify/Apple Music em aparelhos iOS e Android não
foi executada neste ambiente. Antes de release, executar cada linha nos dois
sistemas, tanto com um MP4 sem áudio quanto com um MP4 com áudio embutido:

| Cenário | Resultado esperado | Estado |
| --- | --- | --- |
| Spotify tocando → abrir treino/iniciar vídeo | Música sem pausa/ducking; vídeo silencioso em loop | Pendente em dispositivo |
| Vídeo + Spotify simultâneos | Ambos continuam; só a música é audível | Pendente em dispositivo |
| Pausar/retomar Spotify via controles externos | Vídeo continua enquanto AJ Fit está ativo | Pendente em dispositivo |
| Trocar exercício, abrir/fechar modal e substituição | Música continua em todas as fontes/orientações | Pendente em dispositivo |
| Background → foreground, inclusive troca de exercício | Música continua; demo pausa fora do app e retoma ao voltar | Pendente em dispositivo |
| Repetir com Apple Music/outro player | Mesmo comportamento | Pendente em dispositivo |

Ao abrir outro app ou o centro de controle, o AJ Fit pode ficar inactive ou
background: a pausa visual nesse período é intencional e a retomada acontece
ao voltar. Isso é separado de uma pausa por disputa de foco de áudio.

## Riscos e limites

A API é por player, mas a sessão/foco dentro do `expo-video` é agregada.
Um futuro player intencionalmente audível com maior prioridade pode mudar a
política compartilhada: ele não deve usar esta função de demos silenciosas.
Não há patch em `node_modules`, alteração de dependência ou configuração
nativa. Os checks automatizados não substituem o teste de concorrência de
áudio em aparelhos reais, especialmente durante controles externos e
transições de lifecycle.
