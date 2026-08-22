# Navegação e Lifecycle de Telas

## 1. Arquitetura de navegação

O AJ Fit **não usa React Navigation nem Expo Router**. A navegação principal
é um roteador customizado implementado em `src/screens/AppShell.tsx`, baseado
em renderização condicional dentro de um único componente React:

* as 4 tabs principais (`home`, `workout`, `progress`, `profile`) são
  controladas por `tab: TabId` em `src/state/AppState.tsx`;
* as telas secundárias (Configurações, Segurança, Editar Perfil, Central de
  Assinatura, Suporte etc.) são controladas por flags booleanas
  (`showSettings`, `showSecurity`, ...) ou por uma união discriminada
  (`supportRoute`) locais ao `AppShell`, renderizadas como `View`
  `position: 'absolute'` empilhadas com `zIndex` sobre a tab ativa.

Não existe `Stack.Navigator`, `cardStyle`, `animation`, `detachPreviousScreen`
ou qualquer configuração de navigator — porque não há navigator. Qualquer
raciocínio sobre esta navegação deve partir do React puro, não de conceitos
do React Navigation.

**Cobertura atual: 14 de 17 rotas de primeiro nível estão protegidas contra
o artefato de navegação (seção 6).** Isso não é "global" — 3 rotas continuam
com o padrão antigo por bloqueio real (decisão de produto pendente,
segurança, ou estado transacional amplo), mais 2 sub-modais internos de
Assessment não migrados. Ver seção 17 para a lista exata.

## 2. Problema histórico (causa raiz comprovada, em duas partes)

Até a investigação que originou este documento, toda troca de tab era um
`{tab === 'x' && <Screen />}`: trocar de tab desmontava completamente a tela
anterior e montava a nova do zero, toda vez. Instrumentação confirmou
sequências como `NAVIGATION_REQUEST home → progress` seguidas de
`PROGRESS_MOUNT` a cada entrada — mounts que custavam dezenas de
milissegundos de commit/paint, e que produziam um artefato visual
intermitente quando esse custo atravessava o orçamento de um frame.

Um experimento controlado provou, em duas etapas, que existiam **duas causas
relacionadas mas distintas**:

* **Causa A — remount recorrente.** Manter uma tela sempre montada
  (`display:'none'` quando inativa, em vez de desmontar) eliminou o
  artefato nas entradas 2ª em diante. A primeira entrada continuava
  falhando.
* **Causa B — "React mounted" ≠ "nativamente materializado".**
  `display:'none'` exclui a subárvore do layout nativo (Yoga) por completo:
  nunca dispara `onLayout`, nunca é medida, nunca é composta pelo
  compositor nativo. Prewarming uma tela (montando-a antes do toque do
  usuário) enquanto ela ficava `display:'none'` não resolvia nada — a
  função do componente já tinha rodado, mas a apresentação nativa real só
  acontecia no primeiro `active=true`, exatamente no toque. Substituir
  `display:'none'` por uma geometria que mantém a subárvore em layout
  normal (mesma posição/bounds de quando ativa, só com `opacity:0`) fez a
  primeira entrada real ficar tão limpa quanto as seguintes — confirmado em
  dispositivo físico (Settings foi a prova controlada).

**Regra crítica resultante, válida para todo o projeto:**

> React montado não significa nativamente materializado (medido, layoutado,
> pintado). Uma tela só está pronta para uma primeira apresentação sem
> artefato quando passou por layout nativo real — não quando sua função de
> componente apenas foi executada.

## 3. Os 4 estados de uma tela

```text
1. not mounted                        — nunca foi visitada nem prewarmed; não existe na árvore.
2. prewarming                         — mount agendado (requestIdleCallback), ainda não executou.
3. mounted + materialized + inactive  — existe, foi medida/layoutada/pintada, opacity:0,
                                         sem toque, fora da árvore de acessibilidade.
4. mounted + active                   — visível, interativa, alcançável por acessibilidade.
```

Existe ainda a variante legada `mounted + detached + inactive`
(`display:'none'` — nunca passou por layout) usada pela tab Home, que é
segura *depois* da primeira apresentação mas não antes dela — Home nunca
precisa de prewarm porque já está `active` desde o primeiro render, então o
problema que `detached` tem (nunca ser prewarmed corretamente) não se aplica
a ela.

**Uma tela persistente não pode assumir `mounted === visible`, nem
`mounted === materialized`.** As duas equivalências são falsas nesta
arquitetura.

## 4. A abstração central: `PersistentScreen`

`src/components/navigation/PersistentScreen.tsx` centraliza os 4 estados
acima. Uma tela nunca implementa isso manualmente:

```tsx
<PersistentScreen
  active={tab === 'progress'}
  prewarm={prewarmed.PROGRESS}
  activeStyle={FULL_BLEED.tab}
  inactiveMode="materialized"
>
  <ProgressScreen />
</PersistentScreen>
```

* **`active`** — a única fonte de verdade para visibilidade, toque e
  acessibilidade (`pointerEvents`, `accessibilityElementsHidden`,
  `importantForAccessibility`). Nunca `prewarm`, nunca `inactiveMode`.
* **`prewarm`** (opcional, default `false`) — dispara o mount antes do
  usuário navegar (ver `usePrewarmQueue`, seção 8). Só afeta a decisão de
  mount; nunca ativa a tela.
* **`activeStyle`** (opcional, default `{flex:1}`) — a geometria exata da
  tela quando `active`.
* **`inactiveMode`** — `'detached'` (default, `display:'none'`) ou
  `'materialized'`. Quando `'materialized'`, `PersistentScreen` **deriva
  automaticamente** a geometria inativa a partir de `activeStyle` (mesma
  `position`/bounds/`zIndex`, só acrescentando `opacity:0`) — o chamador
  nunca redigita a geometria manualmente, o que torna impossível por
  construção o bug "prewarm com layout A, depois layout B diferente ao
  ativar".

A decisão de mount em si (`computeShouldMount`, `src/lib/tabLifecycle.ts`) é
uma função pura, testada isoladamente:
`previouslyMounted || active || prewarm`. Uma vez `true`, nunca volta a
`false` — garante idempotência mesmo sob concorrência (seção 9).

## 5. Regra de lifecycle — `useEffect(fn, [])` mudou de sentido

> `useEffect(fn, [])` significa "este componente foi criado pela primeira
> vez", **não** "o usuário acabou de entrar nesta tela".

Para uma tela persistente, esse efeito roda uma única vez durante toda a
sessão do app. Se uma ação precisa acontecer **toda vez que a tela fica
ativa** (recarregar dados, reiniciar uma animação decorativa, focar um
input), use o mecanismo de activity em `src/state/ScreenActivity.tsx`:

```tsx
import { useIsScreenActive, useScreenFocusEffect } from '../state/ScreenActivity';

const isActive = useIsScreenActive();

useScreenFocusEffect(() => {
  const sub = startSomething();
  return () => sub.stop(); // roda quando a tela deixa de estar ativa
});
```

`useIsScreenActive()` retorna `true` por padrão fora de um
`PersistentScreen` (overlays ephemeral, telas em teste) — o comportamento
antigo, sempre-ativo, continua sendo o default seguro. Isso não é uma cópia
da API do React Navigation — é o equivalente mínimo necessário (focus/blur)
para este roteador customizado.

**Nenhuma tela persistente pode depender implicitamente de unmount para
simular blur/reset.** Se hoje algo depende disso, migre para
`useScreenFocusEffect` antes de tornar a tela persistente — nunca depois.

### Quando `useScreenFocusEffect` sozinho não basta

Duas telas migradas nesta rodada precisaram de um segundo mecanismo,
documentado aqui porque é uma armadilha real:

* **HelpArticleScreen** pode ir de um artigo para outro (`article` muda de
  valor) sem que a tela alguma vez fique `inactive` — as duas rotas mapeiam
  para o mesmo `supportRoute.name === 'article'`, então `active` nunca
  transiciona `false → true` nessa troca. `useScreenFocusEffect` sozinho
  **não** dispara aqui. A correção é um `useEffect` normal, chaveado na
  identidade do dado que muda (`[article.id]`), não na ativação da tela.
* **SupportFormScreen** tem o mesmo risco (`type`/`initialSubject` podem
  mudar sem uma transição de ativação real) — usa os dois mecanismos juntos:
  reset em `useScreenFocusEffect` (reabrir depois de uma desativação real) **e**
  reset em `useEffect([type, initialSubject])` (nova identidade de ticket
  sem desativação real pelo meio).

**Regra prática:** se uma tela persistente recebe *props* que identificam
"qual conteúdo estou mostrando agora" (um artigo, um registro, um id), o
reset correto é por **identidade do dado**, não só por ativação — ative-o
como reforço, não substituto.

## 6. Matriz completa de rotas

Toda rota real controlada pelo `AppShell`, classificada com a estratégia
final desta rodada:

| Tela | Tipo | Persiste? | Prewarm? | Reset explícito | Sensível? | Estratégia final |
|---|---|---|---|---|---|---|
| HomeScreen | tab | sim | não (já ativa no 1º render) | — | não | `materialized`, sem prewarm |
| ProgressScreen | tab | sim | sim | — | não | `materialized` + prewarm |
| ProfileScreen | tab | sim | sim | — | não | `materialized` + prewarm |
| WorkoutScreen | tab | **não** | não | — | não (mas transacional de treino) | ephemeral — exceção deliberada, seção 7 |
| SettingsScreen | overlay | sim | sim | — (nada precisava) | não | `materialized` + prewarm |
| SecurityScreen | overlay | sim | sim | — (nada precisava) | não | `materialized` + prewarm |
| ConsistencyScreen | overlay | sim | sim | — (sem estado nenhum) | não | `materialized` + prewarm |
| AssessmentScreen | overlay | sim | sim | `useAssessments().refresh()` via `useScreenFocusEffect` | não | `materialized` + prewarm |
| EditProfileScreen | overlay | sim | sim | todos os campos/draft via `useScreenFocusEffect` | não (edita dados de conta) | `materialized` + prewarm |
| SubscriptionCenterScreen | overlay | sim | sim | `loadOfferings()`+`notice` via `useScreenFocusEffect` | não (mas é dado de billing) | `materialized` + prewarm |
| HelpCenterScreen | overlay (`supportRoute`) | sim | sim | busca+filtros via `useScreenFocusEffect` | não | `materialized` + prewarm |
| HelpArticleScreen | overlay (`supportRoute`) | sim | **não** (precisa de `article` real) | `resolved` via `useEffect([article.id])` | não | `materialized`, sem prewarm — ver seção 8 |
| SupportFormScreen | overlay (`supportRoute`) | sim | **não** (precisa de `type` real) | draft via `useEffect([type, initialSubject])` + `useScreenFocusEffect` | não | `materialized`, sem prewarm — ver seção 8 |
| SupportSuccessScreen | overlay (`supportRoute`) | sim | sim | — (sem estado nenhum) | não | `materialized` + prewarm |
| ProgressPhotosScreen | sub-view de Progress | **não** | não | — | **sim (cofre de fotos)** | ephemeral — bloqueio de segurança real, seção 6.1 |
| ChangePasswordScreen | overlay | sim | sim | 3 campos de senha via cleanup do `useScreenFocusEffect` (não na ativação) | **sim** | `materialized` + prewarm — shell/segredo separados, seção 10 |
| PaywallScreen | overlay | não | não | — | **sim (pagamento)** | ephemeral — nunca deve persistir, seção 10 |

**14 telas migradas, 3 permanecem ephemeral** (Workout, ProgressPhotos,
Paywall), mais os 2 sub-modais internos de Assessment.

### 6.1 — Correção de rota: ProgressPhotosScreen tem bloqueio real de segurança

Uma auditoria anterior classificou `ProgressPhotosScreen` (a aba "Fotos"
dentro de Progress) como "sem impedimento técnico". **Isso estava errado.**
Leitura completa do arquivo nesta rodada encontrou:

```ts
useEffect(() => () => lock(), [lock]);
```

Esse efeito **tranca o cofre de fotos criptografado** (`PhotoVaultContext`)
no unmount — revoga a sessão de descriptografia e libera a proteção contra
captura de tela. Isso é infraestrutura de segurança deliberada (ver
`docs/20_backend_functions_photo_vault.md`/`docs/21_photo_vault_pre_launch.md`
e o teste estrutural `src/state/__tests__/photoVaultContextStructure.test.ts`,
que já trava a regra "nunca destrava automaticamente"). Tornar essa tela
persistente exigiria mover esse `lock()` para `onInactive` — uma mudança de
lifecycle de segurança real, não uma migração de UI, e por isso **não foi
feita nesta rodada**. Fica marcada como bloqueio concreto, não como
pendência de auditoria — precisa de uma revisão de segurança dedicada antes
de qualquer tentativa futura.

### Auditoria — telas migradas nesta rodada

* **Settings/Security/Consistency**: zero `useEffect` relevante (Consistency
  não tem nenhum estado ou efeito — é só constantes), toda a informação vem
  de contexto global ou é hardcoded. Nenhuma mudança de comportamento além
  do wrapper.
* **AssessmentScreen**: `useAssessments(uid)` já tinha um `useEffect`
  interno que carrega no mount — preservado sem alteração (continua
  funcionando para qualquer consumidor futuro não-persistente). O que foi
  adicionado é uma chamada extra a `refresh()` via `useScreenFocusEffect`
  na própria tela, para refletir dados salvos em outra sessão/dispositivo a
  cada reativação. `refresh()` já tinha um token monotônico
  (`fetchSeq`) contra respostas fora de ordem, então chamar duas vezes
  (mount + primeira ativação, que coincidem na primeira visita) não duplica
  listener nem gera race — só uma leitura extra e barata na primeira vez.
  Os dois modais internos (`GuidedAssessmentModal`/`ImportAssessmentModal`)
  continuam ephemeral por decisão explícita (formulários com muitos campos,
  dependem de unmount para reset) — não migrados nesta rodada.
* **EditProfileScreen**: todos os campos de draft (`name`, data de
  nascimento, altura nos dois sistemas de unidade, `pendingPhoto`, flags de
  "touched", `submitError`) resetam explicitamente a cada ativação, lendo o
  `profile`/`questionnaire` atual — nunca do valor congelado no primeiro
  mount. Deliberadamente **não resetados**: `saving`, `processingPhoto`,
  `uploadProgress`, `saveLock`, `photoSelectionLock` — todos já se
  autolimpam em blocos `finally` quando a operação assíncrona realmente
  termina; forçá-los a `false` no lugar errado esconderia um save/upload
  genuinamente ainda em andamento (ex.: usuário saiu no meio de um upload) e
  poderia permitir um segundo save concorrente.
* **SubscriptionCenterScreen**: `useEffect(loadOfferings, [])` virou
  `useScreenFocusEffect` — ofertas (não `customerInfo`, que é global) agora
  recarregam a cada abertura real, não só na primeira. `action` (estado de
  operação em andamento) não é resetado pelo mesmo motivo do EditProfile —
  esta tela não usa try/finally em `handleManage`/`handleRestore`, então
  forçar reset esconderia um estado preso em vez de expor o bug real (fora
  de escopo desta rodada).
* **Fluxo de Suporte**: ver seção 8 — HelpCenter/Success são prewarmed;
  HelpArticle/SupportForm são persistentes mas não prewarmed, por
  dependerem de dados que só existem após a primeira navegação real.

## 7. Exceção: Workout

`WorkoutScreen` **não** usa `PersistentScreen` — continua sendo montada e
desmontada a cada troca de tab. Motivo: é uma tela de sessão ativa, com
temporizadores reais (`setInterval` do cronômetro decorrido, `setTimeout` do
descanso entre séries) e estado de execução extenso (ordem de exercícios,
séries completadas, substituições, PRs).

Persistir a árvore visual de Workout é tecnicamente possível com a mesma
infraestrutura — mas **separar "árvore visual persistente" de "estado
funcional da sessão de treino"** exigiria decidir uma regra de produto que
não existe hoje: o que deve acontecer quando o usuário sai de um treino em
andamento e volta — retomar exatamente de onde parou, ou começar um treino
novo? Essa decisão não foi tomada como parte desta investigação de artefato
visual, e implementá-la sem definição explícita arriscaria alterar
silenciosamente a semântica de uma sessão de treino real. Nenhum artefato
de entrada foi relatado para Workout. **Bloqueio explícito, não escondido.**

## 8. Prewarm — eliminando o first mount do caminho crítico

`PersistentScreen` com `inactiveMode="materialized"` só elimina o artefato
se a tela **já estiver montada e materializada antes do toque**. Isso é o
que `prewarm` faz — mas só funciona para telas que não precisam de dados
específicos do usuário para renderizar algo sensato (seção abaixo, "Suporte").

### Mecanismo de scheduling

`src/lib/prewarmScheduler.ts` usa `requestIdleCallback`/`cancelIdleCallback`
— **não** `InteractionManager.runAfterInteractions`. Verificado diretamente
em `node_modules/react-native/index.js` (versão real deste projeto, RN
0.85.3): `InteractionManager` está marcado `@deprecated`, com aviso de
depreciação apontando explicitamente para `requestIdleCallback` como
substituto. `requestIdleCallback`/`cancelIdleCallback` são globals reais,
com módulo nativo próprio (TurboModule —
`react-native/src/private/webapis/idlecallbacks`), não um polyfill/shim de
DOM; o TypeScript resolve os tipos ambientes via `lib: ["DOM", ...]` já
presente em `expo/tsconfig.base` (confirmado com `npx tsc --noEmit`).

### Fonte única de verdade: `PREWARM_ROUTE_IDS`

`src/lib/prewarmRoutes.ts` declara a ordem/composição da fila inteira num
único array:

```ts
export const PREWARM_ROUTE_IDS = [
  'PROGRESS', 'PROFILE', 'SETTINGS', 'SECURITY',
  'ASSESSMENT', 'EDIT_PROFILE', 'CONSISTENCY', 'SUPPORT',
  'SUBSCRIPTION_CENTER', 'CHANGE_PASSWORD',
] as const;
```

`CHANGE_PASSWORD` é a última rota porque fica um nível mais profundo (via
Segurança) e seu prewarm só é seguro porque nenhuma senha existe no shell até
o usuário interagir (seção 10).

`usePrewarmQueue()` (`src/components/navigation/usePrewarmQueue.ts`) é uma
**única chamada de hook** em `AppShell` que consome essa lista e devolve
`{ PROGRESS: boolean, PROFILE: boolean, ... }` — nada mais chama
`requestIdleCallback` manualmente por tela. A sequência real (`nextPrewarmRoute`/
`withCompletedRoute`, `src/lib/prewarmQueue.ts`) é pura e testada
isoladamente: cada rota só é agendada depois que a anterior efetivamente
rodou, então há um yield real (`requestIdleCallback` novo) entre cada uma —
sem risco de picos de mount.

Adicionar uma rota nova à fila = adicionar um id em `PREWARM_ROUTE_IDS` — sem
tocar em `AppShell` além de usar `prewarmed.NOVA_ROTA` no
`PersistentScreen` correspondente. Ver seção 15 para o checklist de quando
isso é seguro.

### Suporte — por que HelpArticle/SupportForm não são prewarmed

`HelpCenterScreen`/`SupportSuccessScreen` não recebem nenhum dado do
chamador (`onBack`/callbacks só) — prewarm normal. `HelpArticleScreen`
exige `article: HelpArticle` e `SupportFormScreen` exige `type:
SupportTicketType`, nenhum dos dois com valor sensato antes da primeira
navegação real do usuário para lá. Prewarmá-los cedo demais significaria
renderizar com dado inventado/vazio — pior que não prewarmar. Por isso os
dois são **persistentes (lazy-mount + keep-alive) mas não prewarmed**: a
primeira abertura real de um artigo ou formulário ainda paga o custo de
primeira materialização (mesma classe de artefato que qualquer tela nunca
migrada) — mas a partir daí, alternar entre help/article/form/success é uma
troca de atividade pura. `AppShell` mantém `lastArticle`/`lastFormRoute`
(estado local, "latch" do último valor real) para que essas duas telas
sempre tenham props válidas, mesmo enquanto `materialized+inactive`.

### Lifecycle esperado (tela prewarmed)

```text
not mounted                                        — antes do prewarm
↓ requestIdleCallback dispara (fora do critical path)
mounted + materialized + inactive                  — mount, escondida mas em layout normal
↓ usuário toca
mounted + active                                   — só opacity/zIndex mudam, SEM novo mount
↓ usuário sai
mounted + materialized + inactive                  — sem unmount, continua materializada
```

### Prewarm nunca é ativação

`PersistentScreen` usa `prewarm` **somente** para a decisão de mount; `active`
continua a única fonte de verdade para visibilidade/toque/acessibilidade
(garantido por teste estrutural). Durante o prewarm, `useIsScreenActive()`
retorna `false` — nenhum `useScreenFocusEffect` de negócio dispara, nenhum
analytics de "screen view" dispara, nenhum timer/animação inicia.

## 9. Race conditions e idempotência

Se o usuário navegar para uma tela antes do seu prewarm agendado disparar:
`computeShouldMount` já retorna `true` pelo caminho `active`; quando o
prewarm tardio eventualmente disparar, `mounted` já é `true` e nada muda —
sem mount duplicado, sem efeitos duplicados, sem árvore duplicada. Testado
explicitamente em `src/lib/__tests__/tabLifecycle.test.ts` e
`src/lib/__tests__/prewarmQueue.test.ts`. A mesma garantia pura cobre a fila
inteira: mesmo que a ordem de conclusão real varie, cada `PersistentScreen`
só reage ao seu próprio par `(active, prewarm)` — não há estado
compartilhado entre telas que possa corromper.

## 10. Formulários e telas sensíveis

* **Formulários** (Assessment, EditProfile, SupportForm — migrados; os dois
  modais internos de Assessment — não migrados): a regra aplicada nesta
  rodada é **estrutura visual persistente, sessão de formulário resetada
  explicitamente**. Nunca depender de unmount para "começar limpo" — ver a
  seção 5 (`useScreenFocusEffect` + reset por identidade de prop quando
  aplicável).
* **Tela sensível migrada — ChangePassword:** usa a estratégia **shell visual
  persistente (`prewarm`+`materialized`), dado sensível descartado na
  desativação da tela**, por meio do cleanup de `useScreenFocusEffect`
  (`return () => { ... }`, disparado a cada transição `active → inactive`):
  * `ChangePasswordScreen`: `change.setCurrentPassword('')`,
    `setNewPassword('')`, `setConfirmation('')` — os três já limpam
    `issue`/`succeeded` internamente (`resetFeedback`).
  * `saveLock`/`operationLock`/flags "em andamento" não são forçados — mesma
    regra do EditProfile/SubscriptionCenter
    (seção 6): eles já se autolimpam quando a operação assíncrona real
    termina.
* **Paywall e ProgressPhotosScreen continuam ephemeral** — a primeira por
  estado transacional de compra amplo (múltiplos `useEffect`, não uma senha
  isolada); a segunda por um `lock()` de segurança real no unmount (seção
  6.1). Nenhuma das duas foi migrada.

## 11. Performance e trabalho em background

Toda tela `materialized` foi auditada para timers, `Animated.loop`,
listeners, polling, vídeo, câmera, sensores:

* o *ticker* (marquee animado) da Home usava `Animated.loop` infinito —
  pausa via `useIsScreenActive()`, reinicia do zero quando a Home volta a
  ficar ativa.
* Nenhuma das outras 11 telas migradas tem timer, listener ou animação
  contínua — nada mais precisou pausar.
* Nenhum listener do Firebase/RevenueCat/AsyncStorage está amarrado ao
  lifecycle de tab — todos vivem em providers acima do `AppShell`
  (`AuthProvider`, `SubscriptionProvider`, `UnitsProvider`,
  `PhotoVaultProvider`) e continuam funcionando exatamente como antes.

Manter 12 telas montadas+materializadas simultaneamente (no máximo 1 ativa
por vez, as demais opacas a 0%) tem custo real de memória (árvores de
`ScrollView`/imagens/gráficos SVG do Assessment) e um custo pequeno de
composição (camadas transparentes ainda ocupam uma camada no compositor).
Nenhuma otimização especulativa foi feita além do necessário para tornar
prewarm+materialized seguro — não há evidência concreta de que seja
necessário.

## 12. Acessibilidade e stacking

Toda tela `inactive` (`detached` ou `materialized`, tanto faz) é removida da
árvore de acessibilidade e do toque via `PersistentScreen`, centralizado —
nenhuma tela implementa isso manualmente: `accessibilityElementsHidden`
(iOS/VoiceOver), `importantForAccessibility="no-hide-descendants"`
(Android/TalkBack), `pointerEvents="none"` (ambas). O mesmo padrão é usado
para a tab bar quando um overlay está aberto (seção 14).

**Stacking de telas `materialized`:** uma tela `opacity:0` nunca pode
aparecer por cima da tela ativa porque um layer com alpha 0 não contribui
nenhum pixel visível ao compositor, **independentemente da ordem de
z-stacking**. O `zIndex` de `activeStyle` é preservado enquanto
`materialized` (reaproveitado, não removido), mas como o resultado é
transparente isso nunca produz um frame onde a tela errada aparece por
cima. Combinado com `pointerEvents="none"`, uma tela `inactive` nunca
intercepta toque nem aparece, mesmo durante transições concorrentes — vale
inclusive para os 4 slots do fluxo de Suporte empilhados no mesmo `zIndex`.

## 13. Instrumentação

Toda a instrumentação temporária de diagnóstico (`[transitionDiagnostic]`,
`usePrewarmReadyLog`, os `console.log` de agendamento em `usePrewarm`) foi
**removida** nesta rodada — a hipótese já foi validada em dispositivo real
para Settings, e a arquitetura generalizada não carrega mais nenhum logging
de investigação. Não há infraestrutura diagnóstica temporária pendente de
remoção neste momento.

## 14. Overlays: estabilidade de geometria da tab bar

**Causa raiz encontrada:** a tab bar era desmontada condicionalmente
(`{tab !== 'workout' && !overlayOpen && <TabBar/>}`) sempre que um overlay
abria. `TabBar` e o container `flex: 1` das tabs são irmãos dentro do mesmo
container flex; ao desmontar a tab bar, o espaço que ela ocupava era
liberado, e o container irmão (a tela por baixo do overlay) crescia para
preenchê-lo (`758.67 → 874` ao abrir, `874 → 792.67 → 758.67` ao fechar).

**Correção (preservada, não regrediu):** a tab bar permanece sempre montada
quando a tab atual não é `workout`, preservando seu espaço no layout.
Enquanto um overlay está aberto, ela só fica `pointerEvents="none"` e oculta
de acessibilidade — nunca visível, porque todo overlay é um `ScreenBg`
opaco cobrindo `top/right/bottom/left: 0` por cima dela. `overlayOpen`
continua controlando só `pointerEvents`/acessibilidade, nunca `display`/mount.

## 15. Criando uma nova tela sem artefato de navegação

Checklist prático — siga isso para qualquer tela nova navegável no
`AppShell`, sem precisar reler toda a investigação acima.

### 15.1 Não usar render condicional cru para telas navegáveis

**Proibido** como padrão para uma tela que representa navegação real:

```tsx
showScreen && <Screen />
route === 'screen' ? <Screen /> : null
```

Isso coloca `React mount + native layout + paint` no caminho crítico do
toque do usuário — exatamente o que produz o artefato investigado neste
documento (seção 2).

### 15.2 Classificar a tela

Toda tela nova declara, antes de escrever o roteamento:

* **visual lifecycle** — pode ficar `materialized` (persistente) ou precisa
  ser `ephemeral` (mount/unmount)?
* **functional lifecycle** — que dado/estado precisa ser fresco a cada
  ativação, e por qual mecanismo (`useScreenFocusEffect` e/ou reset por
  identidade de prop — seção 5)?
* **sensitive-state lifecycle** — existe segredo, token, estado
  transacional ou sessão de segurança que não pode sobreviver além do uso
  imediato? Se sim, vá para 15.10 antes de qualquer outra decisão.

### 15.3 Tela comum

Para uma tela navegável comum, sem os bloqueios de 15.10, o padrão é:

```tsx
<PersistentScreen
  active={/* sua condição de visibilidade */}
  prewarm={prewarmed.SUA_ROTA}
  activeStyle={/* FULL_BLEED.tab ou um FULL_BLEED.overlayZ* de AppShell.tsx */}
  inactiveMode="materialized"
>
  <SuaTela />
</PersistentScreen>
```

quando não houver impedimento (seção 15.10) e a tela não depender de dados
que só existem depois da primeira navegação real (seção 15.4).

### 15.4 Prewarm

Prewarm acontece pelo scheduler compartilhado — **não** crie
`requestIdleCallback` artesanal dentro de uma tela. Para incluir uma tela
nova na fila: adicione o id em `PREWARM_ROUTE_IDS`
(`src/lib/prewarmRoutes.ts`) e leia `prewarmed.SUA_ROTA` de
`usePrewarmQueue()` em `AppShell`. Não monte tudo no startup — a fila já
agenda progressivamente, uma rota por `requestIdleCallback`.

Se a tela exige uma prop de dado real que não existe antes da primeira
navegação (como `HelpArticleScreen` precisa de `article` — seção 8), **não**
prewarme: use só `active` (lazy-mount + keep-alive, sem `prewarm`), e mantenha
o último valor real em estado "latch" no `AppShell` para as reativações
seguintes terem props válidas mesmo enquanto `inactive`.

### 15.5 Mounted != ready

> React mounted NÃO significa nativamente materialized.

`display:'none'` (`inactiveMode="detached"`) não serve para garantir
primeira apresentação limpa, porque remove a árvore do layout/materialização
nativa — só use `"detached"` para uma tela cujas entradas 2ª em diante já
seriam suficientes (ex.: Home, que nunca precisa de prewarm).

### 15.6 Formulários

Formulário NÃO significa automaticamente ephemeral. Padrão:

```text
estrutura visual → persistente/materialized
sessão de formulário → reset explícito em activation (useScreenFocusEffect)
                        e/ou em mudança de identidade de prop (useEffect([id]))
```

Nunca depender de unmount para limpar draft — ver EditProfileScreen/
SupportFormScreen (seção 6) como exemplo real. **Não** force-resete flags de
operação em andamento (`saving`, `uploading`, locks) que já se autolimpam em
`finally` — fazer isso esconde um estado genuinamente em andamento.

### 15.7 Dados

Se a tela precisa atualizar dados ao entrar, **não** use mount como sinal de
navegação. Use `useScreenFocusEffect(...)` (seção 5). Se o dado exibido é
identificado por uma prop que pode mudar sem uma transição de ativação real
(um artigo, um registro específico), use também `useEffect([identidade])` —
seção 5, "Quando `useScreenFocusEffect` sozinho não basta".

### 15.8 Trabalho contínuo

Se a tela possui timer, `Animated.loop`, polling, listener específico da
tela, vídeo ou sensor: avalie `useIsScreenActive()` e pause quando
`false`. Uma tela `materialized` continua montada mesmo invisível — trabalho
contínuo sem essa checagem roda para sempre em segundo plano.

### 15.9 Acessibilidade

Inactive obrigatoriamente: não recebe toque, não recebe foco, não aparece
para VoiceOver/TalkBack. Isso vem de `PersistentScreen`, nunca implementado
manualmente por tela.

### 15.10 Telas sensíveis

Para senha, pagamento, autenticação, ou qualquer sessão de
segurança (ex.: descriptografia de um cofre — ver ProgressPhotosScreen,
seção 6.1): **não** aplicar persistência cegamente. Se a tela tem um
`useEffect` de cleanup no unmount que revoga algo sensível (sessão, chave,
proteção contra captura de tela), esse é um sinal forte de bloqueio real —
leia o efeito por completo antes de decidir. Separar shell visual de estado
sensível é teoricamente possível (seção 10) mas exige decisão e revisão de
segurança explícitas, nunca decisão só de performance/UX.

### 15.11 Sub-rotas

A regra também vale **dentro** das telas. Procure por
`view === 'x' && <SubScreen/>` ou equivalente dentro de um componente já
migrado — isso reintroduz o mesmo problema um nível abaixo do `AppShell`.
`ProgressPhotosScreen` (dentro de `ProgressScreen`) é o exemplo histórico —
e, agora, também o exemplo de por que "existe uma sub-rota" não significa
automaticamente "pode ser migrada sem revisão" (seção 6.1).

### 15.12 Definition of Done

Uma nova tela navegável só está concluída quando:

* **Cold start, primeira entrada:** zero artefato.
* **Reentrada (2ª em diante):** zero artefato.
* **Lifecycle:** dados corretos, formulário correto, nenhuma informação
  stale, nenhuma tela invisível intercepta toque, acessibilidade correta,
  nenhum trabalho contínuo desnecessário.

## 16. Arquitetura final — mapa de arquivos

```text
src/state/ScreenActivity.tsx                     — active/inactive (focus/blur equivalente)
src/lib/tabLifecycle.ts                          — computeShouldMount (mount puro) + política de tabs
src/lib/prewarmScheduler.ts                      — schedulePrewarm via requestIdleCallback
src/lib/prewarmRoutes.ts                         — PREWARM_ROUTE_IDS (fonte única de verdade da fila)
src/lib/prewarmQueue.ts                          — nextPrewarmRoute/withCompletedRoute (sequenciamento puro)
src/components/navigation/PersistentScreen.tsx   — mount + materialized/detached + acessibilidade
src/components/navigation/usePrewarmQueue.ts     — hook único que drena PREWARM_ROUTE_IDS
src/screens/AppShell.tsx                         — fiação real: quais telas usam o quê
```

## 17. Cobertura e pendências

**14 de 17 rotas de primeiro nível protegidas, mais 2 sub-modais internos de
Assessment ainda pendentes.** Não usar "global" enquanto esta lista não
estiver vazia:

| Tela | Motivo de ficar fora |
|---|---|
| `WorkoutScreen` | Decisão de produto pendente (retomar vs. recomeçar sessão) — seção 7 |
| `ProgressPhotosScreen` | Bloqueio real de segurança: `lock()` do cofre de fotos no unmount — seção 6.1 |
| `PaywallScreen` | Estado transacional amplo (múltiplos `useEffect`, fluxo de compra/restore) — seção 10 |
| Dois modais internos de `AssessmentScreen` (`GuidedAssessmentModal`/`ImportAssessmentModal`) | Formulários extensos, não auditados para reset explícito nesta rodada |

`ChangePasswordScreen` usa shell persistente e limpa as senhas no cleanup de
`useScreenFocusEffect` (seção 10).

Migrar qualquer uma das restantes exige repetir o processo desta rodada
(auditoria completa, uma tela por vez, validação em dispositivo real antes
da próxima) — nunca em bloco, e Paywall em particular exige decisão de
segurança explícita antes de qualquer código, dado seu escopo transacional.

A prova final desta arquitetura é sempre o teste manual em dispositivo real
— nenhum teste automatizado neste repositório renderiza React Native de
verdade (`vitest.config.mts` é Node-only), então os testes aqui só travam a
*decisão* estrutural (o quê está montado/prewarmed/materialized, quando, e
que padrão de reset cada tela usa), não o resultado visual em si.
