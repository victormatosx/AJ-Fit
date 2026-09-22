# Home initial visual readiness — auditoria e validação

Data: 2026-09-22

Dispositivo: iPhone 17 Pro Simulator

Runtime consultado antes da implementação: Expo SDK 56 (`https://docs.expo.dev/versions/v56.0.0/`), incluindo Expo Image e SplashScreen da mesma versão.

## A. Causa do salto

O culpado direto comprovado foi `FrequencyHeatmap`: a largura começava em `0`, a grade inteira era omitida por `cellSize > 0`, e um `onLayout` interno disparava um segundo commit que acrescentava cabeçalho e cinco linhas. Na captura anterior, `WeeklyOverview` e a própria seção de frequência também terminavam depois que a Home já estava exposta.

## B. Por que o gate anterior liberava cedo

Os sinais de dados não representavam a árvore visual completa e não havia confirmação de commit/layout posterior ao estado final. Em especial, um request de frequência podia estar resolvido sem que a geometria da grade tivesse sido criada. Também faltavam o primeiro snapshot do botão de suporte e o estado terminal autoritativo de Evolution. No checkout auditado, a composição descrita no documento anterior não estava conectada a um overlay de bootstrap no `AppShell`.

## C. Mapa completo da árvore visual inicial

| Elemento visual | Componente | Dado/hook de origem | Estado inicial | Estado final | Render condicional? | Muda altura/layout? | Quando estabiliza | Participa do gate? |
|---|---|---|---|---|---|---|---|---|
| Fundo, safe area e scroll | `ScreenBg` / `SafeAreaView` / `ScrollView` | tema + safe area | Montado | Igual | Não | Não após layout raiz | Primeiro commit | Confirmado pelo commit raiz |
| Data e saudação | `MonoLabel` / `Display` | relógio, i18n, `AuthContext.profile` | Profile já resolvido pelo gate raiz | Texto final | Não | Pode variar largura; uma linha fixa | Antes de `AppShell` montar | Pré-requisito raiz |
| Status de treino/descanso | `WorkoutRestHeaderStatus` | execução e `RestSessionProvider` | `null` quando não há treino | Botão/contador quando há treino ativo | Sim | Largura do header; altura fixa em 42 | Estado persistido já restaurado; atualizações posteriores pertencem ao treino ativo | Não; não é bootstrap da Home |
| Inbox de suporte | `SupportInboxButton` | `useUnreadSupportCasesCount` / listener Firestore | Contagem 0, snapshot pendente | Ausente ou botão 42×42 + badge | Sim | Desloca o header horizontalmente | Primeiro snapshot SUCCESS/ERROR | Sim, primeiro snapshot |
| Avatar | `ProfileAvatar` | profile + `expo-image` | Gradiente/iniciais 40×40 | Foto ou fallback 40×40 | Imagem condicional | Não; dimensões e posição absoluta são fixas | Geometria no primeiro commit; bitmap pode trocar sem reflow | Não bloqueia imagem decorativa |
| Ticker Evolution | `EvolutionTicker` | `useWorkoutEvolution` | Shell/texto LOADING | Hidden/static/marquee/action/error | Sim | Pode entrar/sair e mudar altura | Estado terminal autoritativo | Sim, Evolution |
| Marquee do ticker | `TickerMarquee` | conteúdo Evolution + medição da linha | Linha já renderizada | `translateX` animado | Sim por modo | Não; apenas transform | Geometria no commit terminal | Coberto por Evolution; animação não bloqueia |
| Card Today | JSX em `HomeScreen` | `useWorkoutPrescription`, `useWorkoutSchedule`, geração, execução | Loading/generating/estado transitório | Sessão, descanso, concluído, setup ou erro | Conteúdo interno condicional | Sim; título, CTA, meta e mapa variam | Prescription + Schedule em estado terminal | Sim, Today |
| Aviso de sessão perdida | JSX absoluto no Today | Schedule resolution | Ausente | Badge absoluto quando aplicável | Sim | Não altera fluxo, mas precisa estar correto | Mesmo estado terminal de Today | Coberto por Today |
| Mapa muscular | `BodyMuscleMap` | sessão final + catálogo local | Ausente se sessão ainda não existe | SVG síncrono de tamanho 46/58 | Sim | Pode alterar a linha do CTA se entrar tarde | Mesmo commit da sessão final | Coberto por Today |
| Progresso do programa | `ProgramProgressStrip` | mesmo `EvolutionViewModel` | Shell LOADING | Strip final ou `null` em ERROR/UNAVAILABLE | Sim | Sim | Estado terminal de Evolution | Sim, Evolution |
| Visão semanal | `WeeklyOverview` | `useWorkoutActivitySnapshot` | `null` | Card completo, inclusive fallback de erro | Sim | Sim, seção inteira | Primeiro read SUCCESS/ERROR + view-model renderizável | Sim, activity snapshot |
| Frequência | `FrequencyHeatmap` | `useFrequencyWindow` | `null` | Header + grade final/fallback | Sim | Sim, seção inteira | Primeiro read SUCCESS/ERROR, janela promovida e `loading=false` | Sim, frequency |
| Geometria da grade | `FrequencyHeatmap` | `useWindowDimensions` | Agora já calculada sincronicamente | Mesma grade | Conteúdo depende da janela, não de `onLayout` | Não há mais commit `width=0 → grade` | Commit dos dados finais | Coberto por frequency |
| Fade da frequência | `Animated.View` | troca de janela | Opacidade 1 no bootstrap | Fade de 160 ms apenas em navegação posterior | Sim por atualização | Não muda geometria; só opacidade | Primeiro window não anima | Não bloqueia |
| Próximos treinos | `UpcomingWorkouts` | derivação síncrona de prescription + schedule config/resolution | `[]` | Lista ou `null` final | Sim | Sim, várias linhas | Mesmo commit terminal de Today/Schedule | Coberto por Today |
| Modal de próximo treino | `UpcomingWorkoutDetailModal` | seleção do usuário | `visible=false` | Só após toque | Sim | Fora do layout da Home | Não aplicável ao bootstrap | Não |
| Popover de sessão perdida | `Modal` | seleção do usuário | `visible=false` | Só após toque | Sim | Fora do layout da Home | Não aplicável ao bootstrap | Não |
| Modal de recovery | `WorkoutSessionRecoveryModal` no `AppShell` | recovery persistido | Pode resolver durante bootstrap | Modal final | Sim | Overlay nativo, não fluxo | Só é montado depois de `visualReady` | Indiretamente, para não cobrir loading |
| TabBar | `TabBar` | aba atual | Montada | Igual | Home exclui apenas na aba workout | Altura fixa | Primeiro commit do shell | Coberta pelo overlay e bloqueada |
| Overlay | `FullScreenLoading` | bootstrap visual state | Visível, opaco, captura toques | Removido uma vez | Sim | Sobreposição absoluta; não relayout | Somente em `visualReady` | É o consumidor final |

Componentes bloqueantes explícitos: Today (prescription + generation + schedule), Evolution terminal, activity snapshot + `WeeklyOverview`, frequency snapshot + janela promovida + loading concluído, e primeiro snapshot do inbox de suporte. `BodyMuscleMap`, `ProgramProgressStrip` e `UpcomingWorkouts` são bloqueados transitivamente pelos dados que os formam.

## D–E. Contrato implementado

- `dataSettled`: todos os componentes obrigatórios estão em `SUCCESS`, `ERROR` ou `NOT_APPLICABLE`, e as seções que precisam de view-model já o produziram.
- `layoutCommitted`: depois de `dataSettled`, um marcador novo é montado no root da Home e seu `onLayout` dispara. Um `onLayout` anterior não pode satisfazer o estado.
- `visualReady`: somente depois de `layoutCommitted`, no próximo `requestAnimationFrame`. Só então o overlay é removido.

O reducer é monotônico: depois de `visualReady`, refresh, foreground, troca de aba e atualizações de Evolution/Frequency não reabrem o overlay. Um novo UID remonta o `AppShell` pelo provider keyado e cria um bootstrap novo.

Não foi usado timeout artificial.

## F. Timeline anterior

Na gravação anterior, o loading permaneceu até aproximadamente `20,5 s` do vídeo. O primeiro frame exposto tinha header/ticker/Today/progresso, mas ainda não a árvore final. Nos commits seguintes entraram `WeeklyOverview`, a seção de frequência sem grade e, depois do `onLayout` interno, a grade completa. A evidência quadro a quadro está em [before-timeline.png](./before-timeline.png).

Não existiam marks de `layout_committed`, `visual_ready` ou `overlay_hidden` nessa implementação; portanto, os tempos anteriores são do vídeo e não foram inventados como telemetria de app.

## G. Timeline posterior

Tempos em milissegundos desde o epoch de performance da aplicação:

| Cold start | home_mount | home_today_ready | home_evolution_ready | data_settled | layout_committed | visual_ready | overlay_hidden |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4061 | 6560 | 8956 | 8969 | 9079 | 9168 | 9242 |
| 2 | 5659 | 9931 | 11937 | 11950 | 12063 | 12150 | 12225 |
| 3 | 4479 | 6900 | 9511 | 9522 | 9652 | 9723 | 9794 |
| 4 | 4815 | 7279 | 9361 | 9379 | 9528 | 9620 | 9713 |
| 5 | 4448 | 6934 | 8876 | 8887 | 9009 | 9078 | 9150 |

Em todos os cinco casos: `data_settled < layout_committed < visual_ready < overlay_hidden`.

## H. Screenshots T2/T3/T4/T5

Cada imagem abaixo tem quatro colunas, nesta ordem: T2, T3 (`+500 ms`), T4 (`+1 s`) e T5 (`+3 s`). Os instantes são relativos ao início da gravação.

| Cold start | T2 | T3 | T4 | T5 | Evidência |
|---:|---:|---:|---:|---:|---|
| 1 | 13,45 s | 13,95 s | 14,45 s | 16,45 s | [run-1-T2-T5.png](./run-1-T2-T5.png) |
| 2 | 14,51 s | 15,01 s | 15,51 s | 17,51 s | [run-2-T2-T5.png](./run-2-T2-T5.png) |
| 3 | 12,40 s | 12,90 s | 13,40 s | 15,40 s | [run-3-T2-T5.png](./run-3-T2-T5.png) |
| 4 | 15,26 s | 15,76 s | 16,26 s | 18,26 s | [run-4-T2-T5.png](./run-4-T2-T5.png) |
| 5 | 13,07 s | 13,57 s | 14,07 s | 16,07 s | [run-5-T2-T5.png](./run-5-T2-T5.png) |

O texto do marquee se move horizontalmente entre quadros por design; ele usa transform e não altera a geometria. O botão cinza `Tools` sobre o avatar pertence ao menu do development client do simulador, não à árvore do app.

## I–K. Resultado visual

- PRIMEIRO FRAME VISÍVEL DA HOME JÁ ESTÁ COMPLETO: **SIM**
- ALGUM CARD ENTRA DEPOIS DO OVERLAY: **NÃO**
- EXISTE LAYOUT SHIFT APÓS REVELAÇÃO: **NÃO**

## L. Testes

Cobertura adicionada:

- data settled não produz `visualReady` sem layout + frame;
- componente obrigatório pendente bloqueia o gate;
- ERROR e NOT_APPLICABLE são terminais e têm conteúdo final antes da revelação;
- layout/frame prematuros são rejeitados;
- latch não reabre e um novo AppShell começa armado;
- TabBar fica sem toque e fora da acessibilidade durante bootstrap;
- frequency não depende mais de um `onLayout` com largura inicial zero e não anima o primeiro window.

Validações executadas:

- `npm run typecheck`: passou;
- testes focados da mudança: 46 passaram;
- `npm test`: 5.661 passaram, 187 ficaram pendentes/skipped e quatro falharam; as mudanças de Home passaram e a suíte global permanece vermelha apenas nos quatro testes preexistentes fora do escopo (Paywall/RevenueCat/tema);
- `npm run lint`: permanece vermelho por erros preexistentes em Photo Vault/tema; os arquivos alterados foram validados separadamente sem erros (uma warning antiga no teste estrutural de navegação);
- `git diff --check`: passou.

## M. Git

Commit local somente; nenhum push e nenhum deploy. `firestore-debug.log` permanece fora do commit.
