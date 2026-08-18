# 24. Funil de Onboarding/Aquisição — Arquitetura

## 1. Objetivo

Documenta a reconstrução do funil de aquisição (Splash → Onboarding → Quiz →
Analyzing → Plan Ready → Auth → Paywall) implementada em 2026-08-15. Ver
`docs/08_log_de_evolucao.md` para a entrada de changelog correspondente.

Princípio norteador: melhorar a narrativa de valor do onboarding sem tocar em
lógica sensível (Auth, RevenueCat, premium gate) além do estritamente
necessário para integração de contexto/copy.

## 2. Fluxo completo (26 etapas)

| # | Step id | Tipo | Tela/componente |
|---|---|---|---|
| 1 | `presentation` | apresentação | `OnboardingScreen` (existente, reaproveitada) |
| 2 | `name` | pergunta | `NameStepScreen` (novo) |
| 3 | `welcome` | interstitial | `WelcomeInterstitialScreen` (novo) |
| 4 | `motivation` | pergunta | `QuestionStepScreen` + `questionDefs.ts` |
| 5 | `goal` | pergunta | idem (campo `Quiz.goal`, preservado) |
| 6 | `level` | pergunta | idem (campo `Quiz.level`, preservado) |
| 7 | `interstitial_evolution` | interstitial | `EvolutionInterstitialScreen` (novo) |
| 8 | `sex` | pergunta | idem (preservado) |
| 9 | `birthDate` | pergunta | idem (preservado) |
| 10 | `height` | pergunta | idem (preservado) |
| 11 | `weight` | pergunta | idem (preservado) |
| 12 | `interstitial_methodology` | interstitial | `MethodologyInterstitialScreen` (novo) |
| 13 | `days` | pergunta | idem (preservado) |
| 14 | `duration` | pergunta | idem (preservado) |
| 15 | `place` | pergunta | idem (preservado) |
| 16 | `equipment` | pergunta | `EquipmentPicker` (existente, reaproveitado) |
| 17 | `interstitial_guidedWorkout` | interstitial | `GuidedWorkoutInterstitialScreen` (novo) |
| 18 | `limits` | pergunta | idem (preservado) |
| 19 | `muscleFocus` | pergunta | `QuestionStepScreen`, novo campo |
| 20 | `interstitial_ajFitProgress` | interstitial | `AjFitProgressInterstitialScreen` (novo) |
| 21 | `socialProof` | prova social | `SocialProofScreen` (**já existia**, reaproveitada como está) |
| 22 | `commitment` | pergunta | `QuestionStepScreen`, novo campo |
| 23 | `analyzing` | processamento | `AnalyzingScreen` (existente, narrativa ajustada) |
| 24 | `plan` | resultado | `PlanReadyScreen` (existente, hardcodes removidos) |
| 25 | `auth` | autenticação | `AuthScreen` (existente, só copy/contexto) |
| 26 | `paywall` | monetização | `PaywallScreen` (existente, só copy/contexto) |

A ordem/definição central vive em `src/onboarding/steps.ts`
(`ONBOARDING_STEPS`). `auth`/`paywall` existem nesse array só para
bookkeeping do Dev Navigator e do cálculo de progresso — nunca são
renderizados por `OnboardingFunnelScreen` (são estados irmãos no roteador
raiz, ver §4).

## 3. Tipos de etapa

`OnboardingStepKind`: `presentation | question | interstitial | socialProof |
processing | result | auth | monetization`. Cada `OnboardingStepDef` marca:

- `countsTowardProgress`: só perguntas contam para a `SegBar`.
- `persistsToDraft`: se o valor é gravado no draft anônimo local.
- `devJumpable`: `false` apenas para `auth`/`paywall`.

## 4. Navegação — como se pluga no roteador raiz

`RootScreenId` (`src/lib/premiumGate.ts`) foi colapsado: os antigos
`'onboarding' | 'quiz' | 'socialProof' | 'analyzing' | 'plan'` viraram um
único `'onboardingFunnel'`. `resolvePremiumGate()` não teve nenhuma mudança
de prioridade — só uma renomeação. Isso foi possível porque o gate já tratava
esses cinco estados de forma homogênea para usuário não autenticado.

`App.tsx` monta `<OnboardingFunnelScreen mode={user ? 'forcedQuestionnaire' :
'anonymous'} .../>` quando `resolvedScreen === 'onboardingFunnel'`.
`OnboardingFunnelScreen` (`src/screens/OnboardingFunnelScreen.tsx`) é o único
lugar que faz o switch sobre as 26 etapas, delegado a `useOnboardingFunnel`
(`src/onboarding/useOnboardingFunnel.ts`) para o estado (etapa atual,
next/prev/jump, persistência do draft).

### Dois modos

- **`anonymous`**: sequência completa das 26 etapas, começando em
  `presentation` (ou na etapa restaurada do draft).
- **`forcedQuestionnaire`**: usuário já autenticado sem questionário (ex.:
  login social). Pula `presentation/name/welcome/motivation` (não fazem
  sentido pós-conta) e `socialProof/commitment` (redundante pós-conversão),
  mas mantém os interstitials de valor. Começa em `goal`, termina em `plan`
  chamando `onForcedQuestionnaireDone` diretamente (sem passar por `auth`).
  Ver `FORCED_QUESTIONNAIRE_STEP_IDS` em `steps.ts`.

Quando o funil termina (`plan` → continuar), `OnboardingFunnelScreen` chama
`onAuthRequested({ origin, name })` (modo anônimo) ou
`onForcedQuestionnaireDone()` (modo forçado) — nunca navega para
`auth`/`paywall` internamente. `App.tsx` é quem de fato troca `screen`.

## 5. Dados novos

| Campo | Tipo | Etapa | Persistência |
|---|---|---|---|
| `name` | `string \| null` | 2 | **Só no draft local** pré-auth; após signup vira `profile.name` via `provisionNewUser`/`ensureUserProvisioned`. Nunca duplicado no `Quiz`. |
| `motivation` | `string \| null` | 4 | `Quiz.motivation` → Firestore `questionnaires/{id}.answers.motivation` |
| `muscleFocus` | `string[]` (máx. 2) | 19 | `Quiz.muscleFocus` → idem |
| `commitment` | `string \| null` | 22 | `Quiz.commitment` → idem |

Decisão de limite do `muscleFocus`: **2**, não 3. Motivo: o produto ainda vai
derivar o "split" de treino a partir de `goal`+`days`+`level`; um foco
secundário opcional já dá sinal suficiente sem diluir a prioridade (se a
maioria marcasse 3 de 9 grupos, o campo pararia de discriminar nada).

`motivation`/`commitment` são hoje só onboarding — não influenciam nenhum
algoritmo. `muscleFocus` é modelado para o futuro motor de treino, mas **não**
implementa nenhuma lógica clínica/seleção nesta tarefa.

## 6. Persistência do progresso anônimo

`src/onboarding/draftStorage.ts`, chave AsyncStorage `ajfit-onboarding-draft`,
schema versionado (`ONBOARDING_DRAFT_SCHEMA_VERSION = 1`). Formato:

```ts
{ version: 1, currentStepId, updatedAt, name, answers: DraftQuizAnswers }
```

- Escrito a cada mudança de etapa/resposta (fire-and-forget) só em modo
  `anonymous`.
- Lido uma vez no mount do funil anônimo; se existir, restaura `AppState.quiz`
  e `currentStepId` e emite `onboarding_resumed`.
- Um draft corrompido/de versão desconhecida nunca lança — `migrateDraft`
  retorna `null` e o funil simplesmente recomeça do zero.
- Limpo (`clearOnboardingDraft`) em `App.tsx` via `useEffect` assim que
  `user && questionnaire` ficam ambos verdadeiros — ou seja, só depois que os
  dados já foram gravados com sucesso no Firestore sob o UID real. Idempotente.

## 7. Dev Funnel Navigator

`src/components/onboarding/DevFunnelNavigator.tsx`, substitui o antigo
`DevQuizNav` (que **não tinha guard `__DEV__`** — vazava para produção;
achado da auditoria inicial). Guard duplo: dentro do componente
(`if (!__DEV__) return null`) e no ponto de montagem
(`{__DEV__ && <DevFunnelNavigator .../>}` em `OnboardingFunnelScreen`).

- Lista as 26 etapas com jump direto.
- `auth`/`paywall` aparecem desabilitados (`devJumpable: false`) — tocar
  neles não fabrica sessão/CustomerInfo/Premium; o único caminho é terminar
  o funil normalmente.
- Para adicionar uma nova etapa: adicionar em `ONBOARDING_STEPS`
  (`steps.ts`), criar a tela, adicionar o `case` em `OnboardingFunnelScreen`.

## 8. Auth e Paywall — o que mudou e o que não mudou

Ambos receberam **apenas** um prop `entryContext?: OnboardingAuthContext |
null` (`src/onboarding/authContext.ts`, `{ origin: 'planCompleted' |
'directLogin'; name?: string | null }`), usado só para copy:

- `AuthScreen`: `entryContext.origin === 'directLogin'` inicia em modo
  `login` (em vez do `signup` padrão) e evita mostrar copy de "salvar seu
  plano" para quem nunca fez o funil. `entryContext.name` pré-preenche o
  campo nome no signup.
- `PaywallScreen`: `entryContext.origin === 'planCompleted'` troca só o
  parágrafo de subtítulo por uma frase contextual ("Seu plano está pronto...").

Nada em `signUp`/`signIn`/`signInWithProvider`/linking/reset/RevenueCat/
purchase/restore/promo code foi tocado. Testes de regressão:
`src/screens/__tests__/authOnboardingContext.test.ts` e
`paywallOnboardingContext.test.ts` travam essa fronteira.

### Botão X do Paywall

Preservado exatamente como estava: `onClose` chama `logout()`. Confirmado por
que: `resolvePremiumGate` é não-navegável-para-trás — uma vez autenticado com
questionário, a tela é 100% função de `isPremium` (`app` ou `paywall`,
ignorando `requestedScreen`). Não existe destino alternativo sem introduzir um
novo estado no gate. Fica como débito de produto documentado, não resolvido
nesta tarefa — decisão explícita do escopo, não uma omissão.

## 9. Plan Ready — o que foi removido

Removidos (nunca substituídos por outros números arbitrários):

- Split semanal fixo (`PUSH/PULL/LEGS/OFF/UPPER/LOWER/OFF`) — ignorava `days`
  real do usuário. Substituído por `deriveTrainingDaySlots(days)`
  (`src/lib/planDerivation.ts`), que só marca *quais* dias são treino/descanso
  (distribuição determinística via algoritmo de Bresenham), sem inventar
  nomes de grupo muscular por dia.
- "+6,2kg massa magra" / `ProjectionChart` com curva sempre igual — projeção
  corporal fake. Substituído por uma mensagem qualitativa sem número
  inventado (`plan:journey.*`).
- "12 SEMANAS" / "48 TREINOS" hardcoded — não havia conceito real de "semana
  do programa" no produto. Removidos sem substituto numérico.
- Toda a tela também não usava i18n (pt-BR hardcoded no JSX) — migrada para o
  namespace `plan` (`src/i18n/resources/*/plan.json`).

O que ficou: `goal`, `level`, `days`, `duration` — todos valores reais das
respostas do usuário.

## 10. Analytics

`src/onboarding/onboardingAnalytics.ts` define a união de eventos
(`onboarding_started`, `onboarding_step_viewed/completed`,
`onboarding_resumed`, `plan_ready_cta_pressed` etc.) e uma interface
`OnboardingAnalyticsLogger`. Não existe provider real de produto — o logger
padrão só espelha no `logInfo` estruturado já usado pelo resto do app
(`src/lib/logger.ts`). Nenhum evento carrega nome, email, senha, data de
nascimento completa ou dado de saúde.

## 11. i18n

Namespaces afetados: `onboarding` (novas seções `name`, `welcome`,
`interstitials.*`, `analyzing.titleWithNameLine1/2`), `quiz` (`motivation`,
`muscleFocus`, `commitment`), `plan` (namespace novo, `src/i18n/resources/*/plan.json`).
Todos com pt-BR/en/es. `PaywallScreen` continua com hardcodes pt-BR
pré-existentes (débito de i18n anterior a esta tarefa, fora de escopo — a
única string nova adicionada ali segue a mesma convenção do arquivo).

## 12. Testes

- `src/onboarding/__tests__/steps.test.ts` — ordem, sequência
  anonymous/forcedQuestionnaire, `computeOnboardingProgress`.
- `src/onboarding/__tests__/draftStorage.test.ts` — round-trip, draft ausente/
  corrompido/versão futura, limpeza idempotente.
- `src/onboarding/__tests__/onboardingFunnelWiring.test.ts` — App.tsx nunca
  fabrica auth/paywall, `RootScreenId` colapsado, guard duplo do Dev Navigator.
- `src/lib/__tests__/planDerivation.test.ts` — `deriveTrainingDaySlots`.
- `src/screens/__tests__/authOnboardingContext.test.ts` /
  `paywallOnboardingContext.test.ts` — fronteira copy-only.
- `src/lib/__tests__/premiumGate.test.ts` — atualizado (`'quiz'` →
  `'onboardingFunnel'`), mesma ordem de prioridade testada antes.

## 13. Pendências / fora de escopo

- Motor real de geração de split/periodização (o produto ainda não tem —
  `muscleFocus`/`limits` estão modelados para alimentá-lo no futuro).
- i18n completo do `PaywallScreen` (débito pré-existente).
- Botão X do Paywall continuar fazendo logout (ver §8).
- Teste automatizado end-to-end do `RootNavigator` renderizado (o projeto não
  tem harness de render de componente — toda a suíte é função pura/estrutural;
  os novos testes seguem essa mesma convenção).
