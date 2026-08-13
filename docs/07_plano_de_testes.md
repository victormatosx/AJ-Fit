# Plano de Testes

## 1. Objetivo deste documento

Definir a estratégia de testes do sistema.

Definir prioridades.

Definir critérios mínimos para publicação de novas versões.

Definir riscos que devem ser mitigados antes de liberar funcionalidades para usuários.

---

# 2. Objetivos dos testes

Os testes existem para garantir:

* estabilidade
* consistência
* integridade dos dados
* funcionamento offline
* funcionamento da assinatura
* experiência adequada ao usuário

---

# 3. Estratégia de testes

A primeira versão utiliza principalmente:

* testes manuais
* testes exploratórios
* testes internos

Participantes:

* equipe de desenvolvimento
* equipe do projeto
* grupo fechado de alunos

---

# 4. Ambientes

Ambientes previstos:

```txt
DEV
PROD
```

---

## DEV

Utilizado para:

* desenvolvimento
* validação inicial
* correções

---

## PROD

Utilizado por usuários finais.

---

# 5. Classificação de severidade

## Crítico

Problemas que impedem uso do sistema.

Exemplos:

* perda de dados
* falha de assinatura
* impossibilidade de login
* sincronização incorreta
* crash durante treino

---

## Alto

Problemas que prejudicam funcionalidades importantes.

Exemplos:

* treino incorreto
* falha de notificações
* erro de cálculo corporal

---

## Médio

Problemas que possuem solução alternativa.

---

## Baixo

Problemas visuais ou pequenos ajustes.

---

# 6. Prioridades de teste

Ordem de prioridade:

1. assinatura
2. funcionamento offline
3. sincronização
4. questionário
5. treino
6. evolução física

---

# 7. Testes de autenticação

Validar:

* cadastro
* login
* recuperação de senha
* login Google
* login Apple
* enrollment e unenrollment TOTP com password-only
* enrollment e unenrollment TOTP com Google-only
* enrollment e unenrollment TOTP com Apple-only
* escolha explícita em password + Google, password + Apple, Google + Apple e
  password + Google + Apple
* cancelamento federado sem alteração do status MFA
* conta federada divergente sem alteração do usuário ou do MFA
* novo nonce Apple e novo id token Google em cada tentativa de reautenticação
* login com TOTP após e-mail/senha, Google e Apple
* código TOTP incorreto com retry na mesma tentativa
* cancelamento e expiração do challenge TOTP
* múltiplos fatores TOTP e hints não suportados
* retorno ao Dashboard (nunca Quiz) para usuário existente com questionário
* persistência de sessão
* troca de dispositivo

Roteiro manual obrigatório em development build:

1. com uma conta Google-only, ativar TOTP após confirmar com Google, sair,
   entrar com Google + TOTP e depois desativar após nova confirmação Google;
2. repetir o ciclo com uma conta Apple-only em dispositivo iOS real,
   confirmando que nome/e-mail não são necessários na reautenticação;
3. cancelar separadamente as folhas Google e Apple e confirmar status intacto;
4. quando o seletor permitir, escolher uma conta federada diferente da sessão
   atual e confirmar bloqueio por mismatch, sem troca de usuário;
5. repetir enrollment/unenrollment password para garantir compatibilidade;
6. confirmar que linking, verificação de e-mail e decisão Quiz/Dashboard não
   mudaram.

---

# 8. Testes de assinatura

Validar:

* início do teste gratuito
* cobrança após 7 dias
* cancelamento
* restauração de compra
* renovação automática
* perda de acesso
* recuperação de acesso

---

## Critério obrigatório

Nenhum usuário pode:

* perder acesso indevidamente
* receber acesso sem autorização válida

Para persistência e revalidação client-side da assinatura, executar também a
matriz automatizada A–AA em
`src/lib/__tests__/subscriptionLifecycle.test.ts` e o roteiro nativo/sandbox
de `docs/17_checklist_fase3_assinatura.md` em iOS e Android.

---

# 9. Testes do questionário

Validar:

* preenchimento completo
* salvamento local
* retomada após fechamento do aplicativo
* alteração de respostas
* seleção correta de treino

---

# 10. Testes de treino

Validar:

* exibição do treino
* exibição dos exercícios
* substituições disponíveis
* troca de treino
* atualização automática

---

# 11. Testes de execução

Validar:

* início do treino
* conclusão do treino
* registro de séries
* registro de cargas
* cronômetro de descanso
* finalização correta

---

# 12. Testes offline

Validar:

* abertura do treino sem internet
* execução sem internet
* registro de cargas sem internet
* histórico sem internet

---

## Cenários obrigatórios

* modo avião
* internet instável
* perda de conexão durante treino

---

# 13. Testes de sincronização

Validar:

* sincronização após retorno da internet
* sincronização após vários dias offline
* ausência de duplicação
* ausência de perda de dados

---

## Cenário crítico

O sistema deve sincronizar corretamente mesmo após:

```txt
30 dias offline
```

---

# 14. Testes de troca de dispositivo

Validar:

* Android para Android
* iPhone para iPhone
* Android para iPhone
* iPhone para Android

---

## Resultado esperado

Todos os dados devem permanecer consistentes.

---

# 15. Testes de evolução física

Validar:

* cadastro de peso
* cadastro de medidas
* cálculo de percentual de gordura
* fotos de progresso

---

# 16. Testes da calculadora de BF

Validar:

* Jackson & Pollock 3 dobras
* Jackson & Pollock 7 dobras

---

## Resultado esperado

O cálculo deve permanecer consistente para entradas iguais.

---

# 17. Testes de fotos

Validar:

* upload
* armazenamento
* recuperação
* comparação visual

---

## Limite

Validar:

```txt
4 fotos por semana
```

---

# 18. Testes de vídeos

Validar:

* carregamento
* reprodução
* funcionamento offline quando aplicável

---

## Regra

Falha no vídeo não deve impedir treino.

---

# 19. Testes de notificações

Validar:

* lembretes
* notificações de retorno
* notificações de evolução

---

# 20. Testes de atualização automática de treino

Validar:

* geração da nova versão
* manutenção do histórico
* ativação correta
* preservação da lógica do treino

---

# 21. Testes de desempenho

Validar:

* tempo de abertura
* tempo de carregamento do treino
* tempo de sincronização

---

# 22. Testes de interface

Validar:

* estados de carregamento
* estados vazios
* mensagens de erro
* responsividade

---

# 23. Critérios mínimos para publicação

Uma versão só pode ser publicada quando:

* não existirem bugs críticos conhecidos
* não existirem perdas de dados
* assinatura estiver funcionando corretamente
* sincronização estiver validada
* funcionamento offline estiver validado

---

# 24. Métricas recomendadas

Monitorar:

* taxa de crash
* retenção
* conversão de assinatura
* uso do aplicativo
* falhas de sincronização

---

# 25. Pedido para o Agente QA

Definir:

* casos de teste detalhados
* cenários de regressão
* matriz de dispositivos
* checklists de publicação
* plano de testes exploratórios

Respeitando todas as regras deste documento.

---

# 26. Matriz automatizada iOS Promo SKU — Fase 10

Esta matriz é exclusivamente **AUTOMATED / EMULATED**. Ela não representa
compra Apple Sandbox, StoreKit real, webhook RevenueCat real nem validação de
configuração remota.

## Auditoria da cobertura anterior

| Área | Estado anterior | Lacuna da Fase 10 | Ação |
|---|---|---|---|
| `validatePromoCode` | Existente e suficiente | Integração com Firestore real | Atravessado no Emulator |
| `PromoCodeContext` | Existente e suficiente | Nenhuma | Preservado |
| `subscriptionOffer` | Existente e suficiente | Identificadores atuais explícitos | Matriz reforçada |
| Paywall/compra iOS | Existente, parcialmente estrutural | Ordem intent → compra e SKUs atuais | Asserções comportamentais reforçadas |
| Intro Eligibility | Existente e suficiente | `NO_INTRO_OFFER_EXISTS` e duração explícitos | Regressões adicionadas |
| `authorizePromoPurchase` | Existente e suficiente | Conexão com validação e webhook | Atravessado no Emulator |
| `promoPurchaseIntent` | Existente, Emulator parcial | Reuso, intent expirada e ciclo completo | Emulator ampliado |
| Webhook/attribution | Existente e suficiente | Produto normal com intent e mismatch inverso explícitos | Regressões adicionadas |
| Subscription/Premium | Existente e suficiente | Estados de marketing explicitamente não autoritativos | Matriz do Premium Gate adicionada |
| Firestore Rules | Existente, prova agregada | Campos sensíveis individualizados | Cinco writes diretos negados |
| Android | Existente e suficiente na Fase 9 | Nenhuma | Suíte completa preservada |

## Fluxos E2E-like no Emulator

Para mensal e anual, a suíte executa:

```txt
promoCodes/ARNALDO
→ validatePromoCodeHandler autenticado
→ couponRedemptions/{uid}.iosPromotion snapshot
→ authorizePromoPurchaseHandler({ plan })
→ purchaseIntent purchase_pending
→ INITIAL_PURCHASE sintético APP_STORE
→ correlateApplePromoPurchaseIntent
→ purchase_confirmed + lockedAt + trialStartedAt
```

O mesmo ambiente prova: mismatch mensal/anual sem consumo; retry do mesmo
plano sem extensão do TTL; intent expirada substituível; intent ativa
conflitante; dois dispositivos pelo mesmo UID; dois códigos concorrentes sem
estado híbrido; catálogo vivo alterado sem modificar snapshot; revalidação do
mesmo ou de outro cupom recusada após `lockedAt`; e consumo concorrente de um
único intent por exatamente um evento.

## Matriz geral

| Cenário | validate | route | intent | purchase | webhook | attribution | Premium |
|---|---|---|---|---|---|---|---|
| iOS normal monthly | N/A | PASS | N/A | PASS | N/A | N/A | CustomerInfo |
| iOS normal annual | N/A | PASS | N/A | PASS | N/A | N/A | CustomerInfo |
| iOS promo monthly | PASS | PASS | PASS | PASS | PASS | PASS | CustomerInfo |
| iOS promo annual | PASS | PASS | PASS | PASS | PASS | PASS | CustomerInfo |
| cupom inválido | PASS | bloqueada | N/A | bloqueada | N/A | N/A | NÃO |
| cupom consumido | bloqueada | N/A | bloqueada | bloqueada | N/A | preservada | CustomerInfo |
| promo sem intent | N/A | N/A | ausente | N/A | PASS | `no_intent` | CustomerInfo |
| monthly/annual mismatch | PASS | PASS | PASS | bloqueada/incorreta | PASS | `product_mismatch` | CustomerInfo |
| normal com intent promo | N/A | standard | PASS | standard | PASS | `product_mismatch` | CustomerInfo |
| intent expirada | N/A | promo | substituível | bloqueada no cliente | N/A | N/A | NÃO |
| webhook duplicado | N/A | N/A | confirmada | N/A | PASS | `already_processed` | CustomerInfo |
| CustomerInfo sem premium | N/A | qualquer | qualquer | processada | qualquer | qualquer | NÃO |
| CustomerInfo com premium | N/A | qualquer | qualquer | processada | qualquer | qualquer | SIM |
| Android promo monthly | PASS | PASS | N/A | `purchaseSubscriptionOption` | PASS | PASS | CustomerInfo |
| Android promo annual | PASS | PASS | N/A | `purchaseSubscriptionOption` | PASS | PASS | CustomerInfo |

Cupom, `iosPromotion`, `purchaseIntent`, `lockedAt`, `trialStartedAt` e
attribution nunca entram como parâmetro de autoridade do Premium Gate. O
único valor que chega como `isPremium` é derivado do entitlement ativo em
CustomerInfo. `subscriptionSync.ts` permanece independente e inalterado.

---

# 27. Deploy controlado do backend promocional — Fase 11

Esta fase publicou seletivamente `validatePromoCode`,
`authorizePromoPurchase` e `revenueCatWebhook` no projeto `ajfit-2f321`. Ela
não é um E2E StoreKit/RevenueCat e não distribui cliente novo.

## Resultado dos gates

| Gate executado após o deploy | Resultado |
|---|---|
| App typecheck | PASS |
| App tests | 59 arquivos / 1.038 testes PASS |
| Functions typecheck/build | PASS |
| Functions tests | 22 arquivos / 474 testes PASS |
| Firestore Rules | 3 arquivos / 63 testes PASS (Java 21) |
| i18n check | 22 arquivos / 544 testes PASS |
| i18n audit | 839 chaves; 14 suspeitas; 0 bloqueios |
| iOS backend focalizado | 7 arquivos / 197 testes PASS |
| Android backend focalizado | 3 arquivos / 93 testes PASS |
| `git diff --check` | PASS |

Os gates de App, i18n e `git diff --check` não foram repetidos nesta Fase 11
antes do primeiro comando de deploy. O verde posterior confirma a regressão
do estado publicado, mas não satisfaz retroativamente o gate operacional
pré-deploy. Por isso a fase é classificada como **NÃO APROVADA**.

## Smokes remotos seguros

| Cenário | Resultado |
|---|---|
| `validatePromoCode` sem auth | HTTP 401 `UNAUTHENTICATED` |
| `authorizePromoPurchase` sem auth | HTTP 401 `UNAUTHENTICATED` |
| webhook sem assinatura | HTTP 401 `invalid_signature` |
| webhook assinado, tipo não suportado e sem efeito | HTTP 200 `ignored` |
| `validatePromoCode` autenticado com identidade descartável | `ARNALDO` válido; snapshot/espelho gravados |
| `authorizePromoPurchase` autenticado | fail-closed `ios_promotion_unavailable` |
| purchase intent remota | NÃO CRIADA |
| webhook RevenueCat/StoreKit real | NÃO EXECUTADO |

O catálogo remoto retornou `iosPromotion: null` para `ARNALDO`; portanto o
smoke positivo de `purchase_pending` não pode ser executado sem uma alteração
comercial remota fora do escopo. A identidade Auth e os documentos criados
exclusivamente para o teste foram removidos, sem tocar dados históricos.

## Infraestrutura preservada

As Rules remotas não são byte a byte iguais às locais, mas o estado publicado
nega escrita client-side em `couponRedemptions`, `purchaseIntent`, `lockedAt`,
`trialStartedAt` e `convertedAt`. Como as diferenças não pertencem apenas à
migração, não houve deploy de Rules. Índices locais/remotos são equivalentes e
não foram publicados. Storage Rules, Hosting, Remote Config, RevenueCat,
App Store Connect e Google Play também não foram alterados.

Para liberar a Fase 12, é necessário cadastrar `iosPromotion` no catálogo por
um canal administrativo explicitamente autorizado, repetir todos os gates na
ordem correta caso um novo deploy seja necessário e validar o purchase intent
backend-only antes do primeiro E2E iOS Sandbox real.

---

# 28. Liberação backend-only do catálogo iOS — Fase 11B

A Fase 11B removeu o bloqueio encontrado na Fase 11 sem executar StoreKit,
compra Sandbox ou webhook artificial. O catálogo do RevenueCat foi consultado
pela API oficial, no contexto do app iOS, e confirmou sem ambiguidade:

| Offering/package | Product ID remoto |
|---|---|
| `promo_7d` / `$rc_monthly` | `ajfit_premium_monthly_promo` |
| `promo_7d` / `$rc_annual` | `ajfit_premium_annual_promo` |

O App Store Connect e a oferta introdutória de sete dias não puderam ser
inspecionados diretamente porque não havia sessão ou credencial segura não
interativa disponível. Essa limitação permanece para o E2E da Fase 12; nenhum
valor foi inferido ou criado no App Store Connect.

Após todos os gates pré-deploy, somente `adminUpdatePromoCode` foi publicada.
A callable administrativa oficial aplicou a configuração completa em
`promoCodes/ARNALDO`, preservando os pares Android, status, campanha,
influenciador, metadados de criação e campos históricos tolerados:

```txt
iosPromotion.offeringIdentifier = promo_7d
iosPromotion.monthlyProductId = ajfit_premium_monthly_promo
iosPromotion.annualProductId = ajfit_premium_annual_promo
```

Não houve escrita manual do documento. O read-back confirmou os três valores
e a preservação de Android. Uma identidade QA descartável executou a cadeia
remota real de backend:

```txt
validatePromoCode(platform=IOS)
→ redemption com snapshot iosPromotion e sem appleOffer/appleOfferCorrelation
→ authorizePromoPurchase(plan=monthly)
→ purchase_pending por 600 segundos
→ um retry idempotente sem renovar createdAt, updatedAt ou expiresAt
```

Um smoke `platform=ANDROID` confirmou os mesmos pares mensais/anuais já
configurados e `iosPromotion: null` na resposta Android. A intent não criou
`lockedAt`, `trialStartedAt` ou `convertedAt`, não concedeu Premium e não
acionou StoreKit. A conta Auth e os documentos QA foram removidos e sua
ausência foi confirmada. O webhook permaneceu `ACTIVE`, com HMAC vinculado,
sem novo deploy e sem `INITIAL_PURCHASE` artificial.

| Gate final | Resultado |
|---|---|
| App typecheck | PASS |
| App tests | 59 arquivos / 1.038 testes PASS |
| Functions typecheck/build | PASS |
| Functions tests | 22 arquivos / 474 testes PASS |
| Firestore Rules (Java 21) | 3 arquivos / 63 testes PASS |
| i18n check | 22 arquivos / 544 testes PASS |
| i18n audit | 839 chaves; 14 suspeitas conhecidas; 0 bloqueios |
| `git diff --check` | PASS |

Este resultado libera somente a entrada na Fase 12. A validação ainda pendente
é o circuito real App + RevenueCat SDK + StoreKit Sandbox + Apple ID Sandbox +
Intro Eligibility + compra + CustomerInfo + webhook real.

---

# 29. Pré-flight final do E2E iOS Sandbox — Fase 12A.2

O build Debug para dispositivo iOS genérico foi concluído sem erros. Os
roteiros abaixo estão preparados, mas nenhuma compra foi executada. Cada rota
deve usar uma conta AJ Fit nova e uma identidade Apple Sandbox independente;
senhas, UID integral, receipt e tokens não pertencem às evidências.

## Checklist humana do App Store Connect

Antes do primeiro teste, Victor deve confirmar no App Store Connect:

1. `ajfit_premium_monthly` existe;
2. `ajfit_premium_annual` existe;
3. `ajfit_premium_monthly_promo` existe;
4. `ajfit_premium_annual_promo` existe;
5. os quatro produtos pertencem ao Subscription Group esperado;
6. `ajfit_premium_monthly_promo` possui Introductory Offer;
7. `ajfit_premium_annual_promo` possui Introductory Offer;
8. a modalidade das duas ofertas promocionais é Free Trial;
9. a duração é de sete dias;
10. os quatro produtos estão disponíveis para Sandbox;
11. territórios e configuração comercial são compatíveis com o teste;
12. a capability In-App Purchase está habilitada para `com.ajfit.app`;
13. `ajfit_premium_monthly` e `ajfit_premium_annual` não possuem
    Introductory Offer, caso o cenário standard deva ser definitivamente
    “sem trial”.

O item 13 não pode ser inferido pelo código. Até essa confirmação, a
expectativa do cenário A é exibir os termos standard reais retornados pelo
StoreKit, que podem ou não conter uma oferta introdutória.

## Independência das contas Sandbox

| Alias | Uso exclusivo | Estado necessário |
|---|---|---|
| A | Standard Monthly | identidade separada; não usar nos cenários promo |
| B | Promo Monthly | elegível no Subscription Group antes da compra |
| C | Promo Annual | elegível e nunca reutilizada de B |
| D | Promo inelegível | inelegibilidade comprovada no mesmo Subscription Group |

B e C devem permanecer novas até seus respectivos testes, pois consumir uma
oferta introdutória em qualquer produto do grupo pode afetar a eligibility dos
demais. Para preparar D, use uma conta dedicada que tenha consumido a
eligibilidade do mesmo Subscription Group por uma operação Sandbox controlada;
somente classifique D como inelegível quando a API da Apple retornar
`INELIGIBLE` e a folha StoreKit não apresentar Introductory Offer.

## Roteiro A — Standard Monthly

Pré-condições: checklist Apple concluída; conta AJ Fit nova; Sandbox A; nenhum
cupom aplicado. Selecionar mensal e confirmar nos diagnostics `route=standard`
e `plan=monthly`. A compra deve usar `ajfit_premium_monthly`, sem chamar
`authorizePromoPurchase` e sem criar purchase intent. Comparar o texto do
Paywall com os termos reais da folha StoreKit e concluir ou cancelar somente
na execução E2E autorizada. Se concluída, registrar `premiumActive` derivado do
CustomerInfo e confirmar billing/webhook sem attribution promocional.

PASS: rota, plano, produto e termos concordam; não existe intent/redemption
promo; o resultado da compra coincide com CustomerInfo. FAIL: acesso a
`promo_7d`, SKU `_promo`, criação de intent, promessa divergente da StoreKit ou
Premium sem entitlement. Evidências: logs sanitizados de rota/início/resultado,
capturas do Paywall e StoreKit e estado Firestore antes/depois.

## Roteiro B — Promo Monthly elegível

Pré-condições: conta AJ Fit nova; Sandbox B ainda elegível; cupom `ARNALDO`.
Confirmar `route=promo`, `plan=monthly`, Offering `promo_7d`, produto
`ajfit_premium_monthly_promo`, eligibility `ELIGIBLE` e trial derivado válido.
Antes da chamada de compra deve existir autorização mensal e intent
`purchase_pending`; Paywall e StoreKit devem mostrar os mesmos sete dias. Após
uma compra concluída, CustomerInfo deve ativar Premium e o webhook real deve
confirmar a intent e atribuir `ARNALDO`.

PASS: sequência route → eligibility → intent → purchase → CustomerInfo →
webhook/attribution concordante. FAIL: fallback standard, produto ou plano
divergente, trial prometido sem StoreKit, Premium paralelo ou attribution sem
match. Evidências: diagnostics sanitizados, telas, snapshot/estado da intent,
redemption e evento real do webhook, sem payload sensível.

## Roteiro C — Promo Annual elegível

Pré-condições: conta AJ Fit nova; Sandbox C nunca reutilizada de B; cupom
`ARNALDO`. Confirmar `route=promo`, `plan=annual`, `promo_7d`, produto
`ajfit_premium_annual_promo`, eligibility `ELIGIBLE` e sete dias somente quando
StoreKit confirmar. A autorização e a purchase intent devem ser anuais; a
compra concluída deve produzir Premium via CustomerInfo e match anual no
webhook com attribution `ARNALDO`.

PASS: todos os marcos e termos são anuais e concordantes. FAIL: consumo prévio
de eligibility, intent mensal, SKU mensal/standard, termos divergentes ou
attribution sem match. Coletar as mesmas evidências de B com alias C.

## Roteiro D — Promo inelegível

Pré-condições: conta AJ Fit nova; Sandbox D com consumo anterior do benefício
no mesmo Subscription Group comprovado; cupom `ARNALDO`. Confirmar
`route=promo`, o plano escolhido e eligibility `INELIGIBLE`. O Paywall não deve
prometer trial, deve mostrar o preço regular do Promo SKU e a compra continua
permitida pela arquitetura atual. A folha StoreKit não pode apresentar
Introductory Offer. A autorização/intent permanece exigida e Premium, se a
compra for concluída, continua vindo somente do CustomerInfo.

PASS: API Apple e StoreKit provam inelegibilidade, UI fica neutra e a compra
regular segue a rota promo autorizada. FAIL: conta presumida inelegível sem
prova, qualquer promessa de trial, Introductory Offer na StoreKit, bypass de
intent ou Premium paralelo.

## Ficha de evidência por cenário

Registrar: data/hora, identificador do build, cenário, alias A/B/C/D, route,
plan, eligibility, texto do Paywall, termos da StoreKit, resultado da compra,
`premiumActive`, estado da redemption, recebimento do webhook, attribution e
divergências. Nunca registrar senha Sandbox, UID integral, receipt ou token.
