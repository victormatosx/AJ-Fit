# Bootstrap e Navegação Raiz

## 1. Escopo deste documento

Fonte de verdade para o **gate de navegação raiz** — a decisão de qual tela
de topo (`RootScreenId`) o app mostra durante e depois do bootstrap de uma
identidade (login, cold start autenticado, troca de conta, logout).

Cobre:

* `App.tsx` (`RootNavigator`) — orquestração e render guard raiz;
* `src/state/AuthContext.tsx` — identidade Firebase + carga de
  profile/questionnaire;
* `src/state/SubscriptionContext.tsx` — sincronização de identidade
  RevenueCat;
* `src/lib/premiumGate.ts` — decisão pura de rota (`resolvePremiumGate`) e o
  diagnóstico correspondente (`explainPremiumGateBlockers`);
* `src/lib/profileLoadState.ts` — máquina de estados de carga de
  profile/questionnaire;
* `src/lib/preferencesReconciliation.ts` — reconciliação de idioma/unidades
  por identidade.

**Não cobre** a navegação *dentro* do `AppShell` (tabs, overlays,
persistência de tela) — isso é `docs/23_navegacao_e_lifecycle.md`, uma
camada abaixo desta: aquele documento só entra em jogo depois que este gate
já liberou `resolvedScreen === 'app'`.

## 2. Problema histórico (resumo — não repetir a investigação completa)

Já existiu uma regressão real de produção onde a sequência de
`resolvedScreen` era:

```text
unresolved → app → unresolved → app
```

produzindo um "double loading" visível (tela final aparece, some, reaparece)
— confirmado por log real (`navigation_gate_evaluated`) após login e depois
de editar o perfil já dentro do app. Duas causas concretas, ambas na mesma
classe de bug:

* **Causa A.** `preferencesReconciling` (`App.tsx`) era um
  `useState(false)` só promovido a `true` dentro de um `useEffect` que
  observava a transição `profileLoading: true → false`. Um `useEffect` roda
  **depois** do commit/paint do render que já fechou aquela transição — logo
  havia um render inteiro em que `profileLoading` já era `false` mas
  `preferencesReconciling` ainda era `false` (valor antigo), suficiente para
  `resolvePremiumGate` abrir o gate para `'app'` antes da reconciliação
  sequer começar.
* **Causa B.** `reduceProfileLoad` (`src/lib/profileLoadState.ts`) tratava
  **qualquer** `load-started` — inclusive um `refreshProfile()` disparado
  de dentro do `AppShell` já bootstrapado (`EditProfileScreen` salvando) —
  como se fosse a carga inicial: `loading: true` e
  `questionnaireResolution: 'loading'`, ambos lidos por
  `resolvePremiumGate` como bloqueantes. Um refresh em segundo plano
  desmontava o `AppShell` inteiro.

Corrigido eliminando a defasagem de um render (Causa A, via derivação
síncrona) e distinguindo bootstrap de refresh em segundo plano por
identidade (Causa B, via `bootstrappedUid`) — ver seções 4 e 5.

## 3. Invariante principal

> Para uma mesma geração/identidade de bootstrap, um processo obrigatório e
> previsível não pode começar como "não bloqueante" e só se tornar
> "bloqueante" depois que a navegação final já foi liberada.

Formalmente:

* `UNRESOLVED → FINAL_SCREEN` — permitido (é o bootstrap normal).
* `FINAL_SCREEN → UNRESOLVED → FINAL_SCREEN`, **dentro da mesma
  geração/identidade**, causado por um blocker que só começou a bloquear
  depois do primeiro paint — **proibido**. Isso é sempre um bug de
  inicialização tardia de estado, nunca um comportamento aceitável a
  esconder com UI.

Um blocker cujo início já era previsível no momento em que o gate avaliou
`FINAL_SCREEN` deveria ter sido computado (ou pelo menos sinalizado como
"vou bloquear") **antes** dessa avaliação, não depois.

## 4. Bootstrap-blocking vs. background

| Categoria | Definição | Pode fechar o gate raiz? |
|---|---|---|
| **Bootstrap blocking** | Necessário para decidir com segurança a PRIMEIRA tela daquela identidade. | Sim — é o próprio propósito do gate. |
| **Background refresh** | Roda depois que aquela identidade já foi bootstrapada. | **Não.** |
| **Action loading** | Loading local de uma ação de tela/botão (não participa do gate raiz). | Não — nem deveria ler o gate. |

Confirmado no código atual (`resolvePremiumGate`, `src/lib/premiumGate.ts`):

* **Bootstrap blocking:** `authInitializing`, `profileLoading` (só na
  primeira carga por uid — seção 5), `emailVerificationRequired`,
  `preferencesReconciling` (só na primeira vez por uid — seção 5),
  `questionnaireResolution !== 'found'`, `subscriptionLoading` /
  `!subscriptionConfigured` (sincronização de identidade do
  `SubscriptionContext`), `!commercialGateResolved && !isPremium` (só para
  conta nova).
* **Background refresh:** `refreshProfile()` chamado de
  `EditProfileScreen.tsx` depois de salvar (único chamador externo hoje —
  ver `grep -rn "refreshProfile()" src` antes de assumir que isso mudou);
  reconciliação de idioma/unidades para um uid já reconciliado nesta sessão.
* **Action loading** (já corretos — local, nunca leem `resolvePremiumGate`):
  spinner de "Entrar" em `AuthScreen`, `savingQuestionnaire` em
  `RootNavigator` (overlay local, não parte do gate), reautenticação de
  operações sensíveis e Paywall/Offerings loading.

**Regra:** background refresh nunca reabre o gate raiz. Se um dado precisa
de indicação visual de "atualizando", isso é responsabilidade da tela local
(ex.: `saving` em `EditProfileScreen`), não do `RootNavigator`.

## 5. Identity scoping

Todo estado de bootstrap deve estar amarrado à identidade
(uid)/geração correspondente — nunca global e independente de qual
identidade está ativa.

* **`profileLoadState.ts` → `bootstrappedUid`.** Guarda o uid cuja PRIMEIRA
  carga já resolveu (sucesso ou falha). `load-started` só reabre
  `loading`/`questionnaireResolution` quando `event.uid !== bootstrappedUid`
  — ou seja, quando é de fato uma identidade nova ou a primeira carga
  daquela identidade. Um `load-started` para o MESMO uid já bootstrapado
  (refresh) preserva `loading: false` e o `questionnaireResolution`
  existente. Uma troca real de identidade (uid diferente) sempre bloqueia
  normalmente — nunca herda o estado "pronto" da identidade anterior.
* **`preferencesReconciliation.ts` + `App.tsx` → `reconciledUidRef`.**
  `needsPreferencesReconciliation` só retorna `true` quando
  `reconciledUid !== uid` — reconciliação roda uma vez por identidade, não
  uma vez por transição de `profileLoading`. `reconciledUidRef.current` é
  limpo no logout (`App.tsx`, efeito `if (!user) reconciledUidRef.current =
  null`) para nunca vazar entre contas, mas mesmo sem essa limpeza explícita
  a comparação por uid já impediria uma conta B de herdar a reconciliação de
  A.
* **`SubscriptionContext.tsx` → `identityGeneration` / `syncedUid` /
  `currentUid`.** Mecanismo pré-existente, não alterado nesta correção:
  todo resultado assíncrono (login/logout/refresh RevenueCat) carrega a
  geração e o uid capturados no início — um resultado de uma geração/uid
  antigo nunca sobrescreve o estado de uma identidade mais nova. Serve de
  precedente arquitetural para os dois mecanismos acima.

Em resumo: **A → logout → B exige bootstrap completo de B** (nenhum dos três
mecanismos acima permite pular isso); **refresh de A depois que A já está
READY não é um novo bootstrap** (os três mecanismos reconhecem isso e não
reabrem o gate).

## 6. Anti-pattern proibido — o padrão exato que causou a Causa A

**Nunca** faça isto quando o estado participa do gate de navegação raiz:

```tsx
const [blocking, setBlocking] = useState(false);

useEffect(() => {
  if (newIdentityNeedsWork) {
    setBlocking(true);
    doWork().finally(() => setBlocking(false));
  }
}, [...]);
```

Isso abre uma janela real:

```text
novo estado chegou → `blocking` ainda `false` (valor do render anterior)
→ gate avalia com `blocking=false` → tela final liberada/pintada
→ useEffect roda (depois do commit) → setBlocking(true)
→ gate reavalia → fecha de novo
```

**Regra:** para um blocker previsível (uma nova identidade que
definitivamente vai precisar de um processo bloqueante), o valor booleano
que o gate lê precisa ser **derivado sincronamente durante o render** — a
partir de algo que já é conhecido nesse render (ex.: "este uid já foi
reconciliado?", comparando com uma ref), não de um `useState` que só um
efeito assíncrono promove depois. Ver `needsPreferencesReconciliation`
(`src/lib/preferencesReconciliation.ts`) como o padrão correto: o efeito
ainda dispara o trabalho assíncrono real, mas o booleano que o gate
consome já está certo no mesmo render em que o gatilho apareceu.

## 7. Outros anti-patterns — nunca mascarar flicker na UI

Não corrigir um flicker de navegação com:

* `setTimeout` / delay artificial;
* duração mínima de splash ("manter Splash por X ms");
* debounce visual;
* spinner extra sobreposto para esconder a transição;
* esconder a tela em vez de corrigir a transição de estado.

Essas técnicas escondem sintoma, não corrigem a state machine — e tendem a
mascarar exatamente o tipo de bug que a seção 3 proíbe, adiando a próxima
regressão em vez de eliminá-la.

## 8. Profile refresh — regra específica

* **Primeira carga de profile/questionnaire de uma identidade** →
  bootstrap-blocking (`loading: true`, `questionnaireResolution: 'loading'`
  até resolver).
* **`refreshProfile()` para um uid já bootstrapado** (ex.:
  `EditProfileScreen` depois de salvar) → background refresh. Não pode
  transformar `questionnaireResolution: 'found'` temporariamente em
  `'loading'` se isso for fechar o gate raiz — dados já conhecidos
  (`profile`/`questionnaire` antigos) continuam disponíveis/visíveis
  enquanto o refresh corre.
* Falha de um refresh em segundo plano **não** deve virar
  `questionnaireResolution: 'not_found'` — um erro de rede não é "usuário
  sem questionário". Esse invariante já existia antes desta correção
  (`load-failed` nunca produz `'not_found'`, só `'error'`) e continua
  intacto; não foi alterado nesta rodada.

## 9. Diagnóstico — `explainPremiumGateBlockers` / `blockingReasons`

`src/lib/premiumGate.ts` expõe `explainPremiumGateBlockers(state)` — função
pura, diagnóstico-only, **nunca** consultada por `resolvePremiumGate` (não
pode influenciar rota). Lista, na mesma ordem de prioridade que o gate
avalia, todo pré-requisito ainda não resolvido.

`App.tsx` inclui o resultado como `blockingReasons: string[]` no evento
`navigation_gate_evaluated` já existente (`logInfo('subscription', ...)`).
Nenhum PII/token — só nomes de flags booleanas e o
`questionnaireResolution` (enum, não dado do usuário).

**Ao investigar qualquer problema de navegação/loading raiz, este deve ser
o PRIMEIRO instrumento consultado** — antes de cogitar delay artificial ou
loader novo: filtre os logs por `navigation_gate_evaluated`, encontre a
transição suspeita e leia `blockingReasons` no momento exato em que
`resolvedScreen` virou `'unresolved'`. Um `blockingReasons: []` junto de
`resolvedScreen: 'unresolved'` é uma contradição — sinal de um blocker que o
gate está aplicando mas que este diagnóstico ainda não nomeia (atualizar
`explainPremiumGateBlockers` antes de investigar mais).

## 10. Checklist para qualquer mudança em bootstrap/navegação raiz

Aplica-se a mudanças em `App.tsx`, `AuthContext`, `SubscriptionContext`,
`profileLoadState`, `premiumGate`, `preferencesReconciliation`,
onboarding/commercial gate:

* [ ] Este novo estado participa do root gate (`resolvePremiumGate`)?
* [ ] Ele pode começar `false`/pronto e só virar `loading` depois do
      primeiro paint (via `useEffect`)? Se sim, precisa de derivação
      síncrona (seção 6).
* [ ] Ele é bootstrap-blocking ou background (seção 4)?
* [ ] Está associado ao uid/geração correto (seção 5)?
* [ ] Um refresh do mesmo uid pode desmontar o `AppShell`?
* [ ] Uma troca A→B pode reutilizar/herdar estado de A?
* [ ] Existe um caminho `FINAL_SCREEN → unresolved` dentro da mesma
      geração/identidade?
* [ ] O loading deveria ser local à tela em vez de root?
* [ ] `explainPremiumGateBlockers` continua nomeando corretamente este
      estado, se ele for bloqueante?

## 11. Testes que protegem cada invariante

Nenhum teste novo foi necessário além dos já adicionados na correção — a
lista abaixo mapeia invariante → teste, para não duplicar cobertura no
futuro:

| Invariante | Teste |
|---|---|
| Reconciliação bloqueia no primeiro render necessário, não um render depois | `src/lib/__tests__/preferencesReconciliation.test.ts` — *"is TRUE on the very first render where profileLoading becomes false for a never-reconciled uid — no one-render lag"* |
| Refresh de uid já bootstrapado não reabre `loading`/`questionnaireResolution` | `src/lib/__tests__/profileLoadState.test.ts` — *"load-started for the SAME uid AFTER it already bootstrapped is a BACKGROUND refresh"* |
| Uid novo continua fazendo bootstrap normal, mesmo com outro uid já bootstrapado antes | `src/lib/__tests__/profileLoadState.test.ts` — *"load-started for a NEW uid is always a bootstrap load, even if a different uid was previously bootstrapped"* |
| Troca A→B não herda reconciliação de A | `src/lib/__tests__/preferencesReconciliation.test.ts` — *"is true again for a DIFFERENT uid, even if the previous uid was already reconciled"* |
| Refresh em segundo plano do mesmo uid não re-dispara reconciliação | `src/lib/__tests__/preferencesReconciliation.test.ts` — *"a background profile refresh for the SAME already-reconciled uid never re-triggers reconciliation"* |
| `blockingReasons` nomeia corretamente cada prerequisito, na ordem do gate, sem influenciar a rota | `src/lib/__tests__/premiumGate.test.ts`, describe `explainPremiumGateBlockers` |
| Estrutura de `App.tsx` continua usando a derivação síncrona (não volta a `setPreferencesReconciling` num `useEffect`) | `src/lib/__tests__/preferenceReconciliationStructure.test.ts` |
| Isolamento de identidade em `SubscriptionContext` (uid/geração, não alterado nesta correção) | `src/state/__tests__/SubscriptionContext*.test.ts` / `src/lib/__tests__/subscriptionLifecycle.test.ts` — pré-existentes |

Nenhum teste automatizado neste repositório renderiza `RootNavigator`/React
Native de verdade (`vitest.config.mts` é Node-only) — mesma limitação já
registrada em `docs/23_navegacao_e_lifecycle.md` §17. A prova final da
ausência de flicker é sempre o teste manual em dispositivo/simulador real
(cold start, login, editar perfil, logout→outra conta — os quatro cenários
já validados no E2E desta correção).

## 12. Mapa de arquivos

```text
App.tsx                                  — RootNavigator: render guard raiz, deriva
                                            preferencesReconciling sincronamente
src/state/AuthContext.tsx                — identidade Firebase + loadUserState/refreshProfile
src/state/SubscriptionContext.tsx        — identityGeneration/syncedUid/currentUid (RevenueCat)
src/lib/premiumGate.ts                   — resolvePremiumGate (puro) + explainPremiumGateBlockers
src/lib/profileLoadState.ts              — reduceProfileLoad (puro), bootstrappedUid
src/lib/preferencesReconciliation.ts     — needsPreferencesReconciliation (puro)
```

## 13. Documentos relacionados

* `docs/23_navegacao_e_lifecycle.md` — navegação/lifecycle DENTRO do
  `AppShell`, depois que este gate já liberou `'app'`. Camada diferente,
  mesma disciplina de "não confundir React mounted com pronto para o
  usuário".
* `docs/24_funil_onboarding_arquitetura.md` — como o funil de onboarding usa
  `RootScreenId`/`resolvePremiumGate` (o `'onboardingFunnel'` colapsado).
* `docs/13_assinaturas_e_billing.md` — bootstrap do RevenueCat e como
  `SubscriptionContext` alimenta `subscriptionLoading`/`subscriptionConfigured`
  consumidos por este gate.
