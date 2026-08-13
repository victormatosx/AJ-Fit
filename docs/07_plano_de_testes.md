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
* persistência de sessão
* troca de dispositivo

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
