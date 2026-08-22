# Assinaturas e Billing

## 1. Objetivo deste documento

Definir as regras de monetização do sistema.

Definir:

* planos
* assinaturas
* período de teste
* renovação
* cancelamento
* reembolso
* restauração de compra
* modelo de acesso (entitlement)
* sincronização com Firestore

Este documento é a referência oficial para toda lógica de billing do projeto.

---

# 2. Plataforma de billing

O gerenciamento de assinaturas utiliza:

* RevenueCat
* Apple App Store
* Google Play Store
* Firebase Authentication (identidade do usuário / UID)

---

## Fonte oficial de verdade

A fonte oficial para liberar ou bloquear acesso Premium é:

```txt
RevenueCat CustomerInfo
```

Mais especificamente, o estado do:

```txt
entitlement premium
```

---

## Regra obrigatória

Em caso de divergência:

```txt
RevenueCat vence.
```

---

# 3. Produto

Produto único da V1:

```txt
AJ Fit Premium
```

---

## Objetivo

Liberar acesso completo ao aplicativo.

---

# 4. Planos disponíveis

Os únicos planos da V1 são:

* Mensal
* Anual

---

## Observação

Referências a planos trimestral, semestral ou semanal estão descontinuadas e não fazem parte da V1.

Novos planos exigem atualização deste documento.

---

# 5. Identificadores oficiais

## Google Play

Produto:

```txt
ajfit_premium
```

Planos básicos:

```txt
monthly
annual
```

## App Store

```txt
ajfit_premium_monthly
ajfit_premium_annual
```

## RevenueCat

Entitlement:

```txt
premium
```

Offering:

```txt
default
```

Packages:

```txt
$rc_monthly
$rc_annual
```

---

# 6. Teste gratuito

Todos os planos possuem:

```txt
7 dias de teste gratuito
```

---

## Regras

O usuário deve confirmar uma assinatura e ter uma forma de pagamento válida cadastrada na loja antes de iniciar o teste.

Nenhuma cobrança ocorre no momento do início do teste.

A cobrança acontece automaticamente ao final dos 7 dias, caso o usuário não cancele antes.

A elegibilidade final para o trial é controlada pela Apple App Store ou pela Google Play Store, não pelo aplicativo.

O aplicativo não deve prometer trial quando a loja informar que o usuário não é elegível.

O trial pode ser utilizado apenas conforme as regras da conta e do produto definidas pela loja.

---

# 7. Limite do teste gratuito

O teste gratuito pode ser utilizado:

```txt
apenas uma vez por conta
```

conforme a elegibilidade retornada pela loja.

---

## Objetivo

Evitar abuso do período gratuito.

---

# 8. Cupons de influenciadores e promocionais

Na V1, cupons servem para:

* rastrear origem do usuário
* identificar influenciador
* analytics
* campanhas promocionais futuras
* aplicar desconto quando configurado na loja/RevenueCat

---

## Regras

O cupom não concede Premium diretamente.

O cupom não substitui a validação da loja.

O cupom não é tratado como fonte oficial de elegibilidade do trial.

O cupom deve ser registrado por UID do Firebase, não apenas por email.

---

## Visibilidade

O cupom é utilizado apenas internamente.

Não precisa permanecer visível ao usuário após o cadastro.

---

# 9. Fluxo oficial de ativação

Fluxo esperado da V1:

1. usuário conclui questionário
2. usuário recebe recomendação de treino
3. usuário cria conta ou faz login
4. Firebase Authentication retorna o UID
5. aplicativo identifica o usuário no RevenueCat usando o UID
6. usuário visualiza o paywall
7. usuário escolhe o plano mensal ou anual
8. a loja informa o preço e a elegibilidade real do trial
9. usuário confirma a assinatura
10. RevenueCat retorna o CustomerInfo
11. o entitlement premium ativo libera acesso completo
12. o webhook sincroniza o espelho no Firestore

---

# 10. Regra de acesso

O acesso Premium deve ser liberado sempre que:

```txt
entitlement premium estiver ativo
```

Não usar apenas o status textual para definir acesso.

---

## Exemplo válido

```txt
status = CANCELED
entitlementActive = true
expiresAt = data futura
```

Nesse caso, o usuário continua com acesso até o fim do período já pago.

---

## Separação obrigatória

Separar claramente:

* status comercial
* direito de acesso atual (entitlement)

---

# 11. Regra obrigatória de autorização

Esta seção existe para eliminar qualquer ambiguidade sobre o que autoriza acesso Premium no aplicativo.

---

## Status x Entitlement

`status` é uma informação de negócio. Ele descreve o momento comercial da assinatura (em teste, ativa, cancelada, com problema de cobrança, expirada).

`entitlement` é uma informação de autorização. Ele descreve se o usuário tem, agora, o direito de usar os recursos Premium.

O aplicativo nunca deve liberar recursos Premium utilizando apenas o `status`.

---

## Critério único

```txt
O único critério utilizado pelo aplicativo para liberar ou bloquear
funcionalidades Premium é o entitlement premium retornado pelo RevenueCat.
```

---

## Exemplo correto

```txt
status = CANCELED
entitlementActive = true
```

Resultado:

```txt
Premium continua liberado.
```

---

## Exemplo de bloqueio

```txt
status = ACTIVE
entitlementActive = false
```

Resultado:

```txt
Premium bloqueado.
```

---

## Regra de divergência

Em qualquer caso de divergência entre `status` e `entitlement`, ou entre qualquer outra fonte de dado e o RevenueCat:

```txt
O CustomerInfo do RevenueCat sempre vence.
```

---

# 12. Status oficiais do sistema

Status permitidos:

```txt
TRIAL
ACTIVE
CANCELED
BILLING_ISSUE
EXPIRED
```

---

## Relação com o entitlement

* `TRIAL` pode ter entitlement ativo
* `ACTIVE` tem entitlement ativo
* `CANCELED` pode continuar com entitlement ativo até `expiresAt`
* `BILLING_ISSUE` depende do período de carência configurado pela loja
* `EXPIRED` não possui entitlement ativo

---

# 13. Acesso durante o teste gratuito

Status:

```txt
TRIAL
```

---

## Permissões

Enquanto o entitlement premium estiver ativo, o usuário possui acesso completo ao aplicativo.

---

# 14. Assinatura ativa

Status:

```txt
ACTIVE
```

---

## Permissões

O usuário possui acesso completo ao aplicativo enquanto o entitlement premium estiver ativo.

---

# 15. Cancelamento durante o teste gratuito

Se o usuário cancelar durante o período de teste:

O acesso permanece ativo até o final dos 7 dias, enquanto o entitlement permanecer ativo.

Não há cobrança se o cancelamento ocorrer antes do término.

---

## Após o término

O acesso é removido quando o entitlement deixa de estar ativo.

---

# 16. Cancelamento de assinatura paga

Se o usuário cancelar uma assinatura ativa:

* a renovação automática é interrompida
* o acesso continua até o fim do período já pago
* o status pode ser `CANCELED` com entitlement ainda ativo

---

# 17. Falha de cobrança

Exemplo:

* cartão recusado
* pagamento não processado

---

## Status

```txt
BILLING_ISSUE
```

---

## Período de carência

O Google Play está configurado com período de carência de:

```txt
7 dias
```

Durante o período de carência, o usuário pode continuar com acesso, conforme o status retornado pela loja e pelo RevenueCat.

Depois da carência, o acesso deve seguir estritamente o entitlement retornado pelo RevenueCat.

---

## Regra obrigatória

Não implementar uma contagem paralela independente no cliente.

Apple e Google podem ter comportamentos diferentes de billing retry, grace period e account hold.

O RevenueCat deve normalizar esses estados.

---

# 18. Expiração

Status:

```txt
EXPIRED
```

---

## Permissões

O entitlement premium não está mais ativo. O acesso premium é removido.

---

## Acesso permitido

O usuário pode visualizar:

* histórico resumido

---

## Acesso bloqueado

* treino ativo
* execução de treino
* evolução física
* fotos de evolução
* medidas corporais
* percentual de gordura

---

# 19. Conteúdo bloqueado

Dados bloqueados não devem ser removidos.

Devem permanecer armazenados.

---

## Fotos de evolução

Devem permanecer armazenadas, apresentadas de forma censurada ou bloqueada.

---

## Medidas corporais

Devem permanecer armazenadas, apresentadas de forma censurada ou bloqueada.

---

## Percentual de gordura

Deve permanecer armazenado, apresentado de forma censurada ou bloqueada.

---

## Objetivo

Demonstrar valor acumulado e incentivar reativação.

---

# 20. Restauração de compras

O aplicativo deve oferecer:

```txt
Restore Purchases
```

---

## Fluxo

1. usuário solicita a restauração
2. RevenueCat consulta as lojas
3. o CustomerInfo é atualizado
4. o entitlement premium é reavaliado
5. o acesso é restaurado quando aplicável
6. o Firestore é sincronizado posteriormente pelo backend/webhook

---

# 21. Troca de plano

Permitir:

* mensal → anual
* anual → mensal

---

## Regras

A execução deve respeitar as regras de:

* Apple
* Google
* RevenueCat

Não implementar prorrateio manualmente no aplicativo.

---

# 22. Reembolsos

O sistema não possui processo próprio de reembolso na versão inicial.

---

## Responsabilidade

Os reembolsos seguem os mecanismos oficiais:

* Apple
* Google

---

## Regra

Eventos de reembolso recebidos pelo RevenueCat devem atualizar automaticamente o status da assinatura.

---

# 23. Exclusão de conta

Excluir a conta AJ Fit não significa que a assinatura da loja será cancelada automaticamente.

---

## Regras obrigatórias

O aplicativo deve:

* avisar claramente que a exclusão da conta não necessariamente cancela cobranças futuras
* orientar o usuário a gerenciar ou cancelar a assinatura na App Store ou na Google Play
* remover o acesso ao conteúdo da conta conforme o processo de exclusão
* iniciar retenção de dados por 90 dias, se essa ainda for a política oficial do projeto

Eventos futuros de assinatura podem continuar chegando pelo RevenueCat enquanto a assinatura existir na loja.

Não afirmar que o aplicativo cancela automaticamente a assinatura sem suporte técnico comprovado.

---

## Prazo

Dados permanecem armazenados por:

```txt
90 dias
```

Após este período ocorre remoção definitiva.

---

# 24. Analytics de billing

O sistema deve armazenar:

* data da primeira assinatura
* data da última renovação
* produto contratado
* plano mensal ou anual
* status atual
* entitlement ativo
* cupom utilizado
* influenciador
* origem do usuário
* loja
* trial iniciado
* trial convertido
* cancelamento
* expiração
* reembolso
* mudança de plano

---

## Regra obrigatória

Não armazenar dados de cartão ou informações financeiras sensíveis.

---

## Objetivo

Relatórios internos e métricas de negócio.

---

# 25. Webhooks e sincronização com Firestore

Os eventos do RevenueCat devem ser processados por um backend seguro.

O cliente não deve escrever diretamente no bloco `subscription` do Firestore.

O backend deve utilizar o Firebase Admin SDK.

---

## Eventos mínimos

* INITIAL_PURCHASE
* RENEWAL
* CANCELLATION
* EXPIRATION
* BILLING_ISSUE
* PRODUCT_CHANGE
* UNCANCELLATION, se aplicável
* TRANSFER, se aplicável

---

## Correção de identidade por aliases (2026-08-10)

O Firebase UID continua sendo o App User ID identificado enviado pelo cliente
ao `Purchases.logIn(uid)`, mas o `app_user_id` de um webhook não é tratado como
prova suficiente de que esse mesmo UID ainda é o proprietário Firebase atual.
Restore, logout/login e transferências podem fazer o RevenueCat entregar um ID
histórico pertencente ao mesmo Customer.

O backend aplica a seguinte política:

1. **Fast path:** se `app_user_id` existe no Firebase Authentication **e** em
   `users/{uid}`, resolve diretamente e não chama a API V2.
2. **Fallback V2:** se o fast path falha, busca o customer pelo App User ID em
   `GET /v2/projects/{project_id}/customers?search=...` e lê seus aliases em
   `GET /v2/projects/{project_id}/customers/{customer_id}/aliases`.
3. Combina `app_user_id`, `original_app_user_id`, `aliases`, customer IDs e
   aliases V2 apenas como candidatos autenticados/consultados — nenhum deles
   recebe acesso automaticamente.
4. IDs técnicos `$RCAnonymousID` são excluídos da avaliação como Firebase UID.
5. Exatamente um candidato existente em Auth + Firestore é `resolved`; nenhum
   é `unresolved`; mais de um é `ambiguous`.

`unresolved` e `ambiguous` são fail-closed: HTTP 200 para evitar retry inútil de
uma condição estrutural, nenhuma escrita e nenhuma escolha arbitrária. Falha
temporária da API V2 (timeout, 423, 429, 5xx ou resposta inválida) retorna 503;
401/403 ou outra configuração 4xx retorna 500 operacional sanitizado. Nenhuma
falha da API é convertida silenciosamente em usuário inexistente.

A API key V2 fica exclusivamente no Firebase Secret Manager como
`REVENUECAT_API_SECRET_KEY` e é vinculada à Function junto do secret HMAC
`REVENUECAT_WEBHOOK_SECRET`. O Project ID é configuração pública centralizada
no backend, nunca credencial. O cliente server-side usa somente endpoints GET
com `customer_information:customers:read` e
`customer_information:subscriptions:read`.

### TRANSFER

`TRANSFER` é recebido sem exigir `app_user_id`. `transferred_to` resolve o
destino e `transferred_from` resolve separadamente a origem, sempre pela mesma
política fail-closed de unicidade. O payload continua não sendo usado como
estado comercial, pois não contém produto, status, expiração nem entitlement
suficientes. Para cada lado que resolve exatamente um Firebase UID vivo e
exatamente um RevenueCat Customer, o backend consulta o estado atual por:

`GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions`

A resposta é validada e paginada por completo, inclusive as páginas de
entitlements de cada subscription. A subscription do AJ Fit é localizada pela
relação cujo `entitlements.items[].lookup_key` seja `premium`; a ordem do array
nunca decide. `gives_access` é o sinal oficial usado para
`entitlementActive`. Se exatamente uma subscription Premium der acesso, ela é
normalizada. Se mais de uma der acesso, o resultado é ambíguo e nenhuma escrita
ocorre.

O destino é reconciliado primeiro. Uma origem inexistente, ambígua ou composta
somente por `$RCAnonymousID:*` não é escolhida nem escrita e não impede o
destino inequívoco de ser atualizado. A origem que resolve de forma única é
consultada na V2 como qualquer outro snapshot: ela pode permanecer ativa se a
RevenueCat ainda confirmar outra Premium, ou tornar-se inativa quando a
resposta completa confirmar ausência de Premium ativa. Portanto o handler não
revoga a origem por inferência a partir do evento.

Quando o TRANSFER informa `environment`, a consulta usa o filtro oficial
`sandbox`/`production` correspondente à transferência. Como esse campo é apenas
opcional em TRANSFER, sua ausência faz a consulta omitir o filtro e avaliar os
dois ambientes; duas Premium ativas nesse resultado continuam ambíguas.

Uma resposta completa sem nenhuma Premium com `gives_access: true` substitui o
mapa `subscription` por estado inativo, removendo campos ativos obsoletos. Se
houver exatamente uma subscription Premium inativa, seus campos confiáveis
podem ser espelhados; sem candidato único, grava-se somente `provider` e
`entitlementActive: false`, sem escolher histórico arbitrariamente. Falha de
schema/paginação não é confundida com ausência de assinatura.

O mapeamento usa somente dados disponíveis: `status` oficial é convertido para
os estados já existentes quando conhecido; App Store e Play Store são
convertidas para os stores do schema; `current_period_ends_at`, `starts_at` e
um início de período posterior confiável alimentam as datas correspondentes.
`productId` só é persistido quando o produto da subscription coincide
inequivocamente com um produto do entitlement e seu `store_identifier` está
disponível. Não se inventa `canceledAt`, pois V2 não fornece um timestamp de
cancelamento confiável nesse objeto.

Cada lado usa independentemente `applySubscriptionEventAtomically`, com o
mesmo `event.id` e `event_timestamp_ms` do TRANSFER. Assim, deduplicação,
stale/conflict e concorrência permanecem protegidos por documento. Se o
destino for gravado e a consulta de uma origem válida falhar temporariamente,
o handler retorna 503: no retry o destino já aplicado resulta em `duplicate` e
a origem pode ser tentada novamente sem reaplicar/corromper o destino. A
transação de cada lado revalida a existência de `users/{uid}` antes de
substituir somente o mapa aninhado, portanto nunca recria usuário excluído.

HTTP 404 durante a leitura de subscriptions, timeout, 429, 5xx, JSON ou schema
inválido retornam 503; 404 na própria busca de identidade permanece
`unresolved` sem escrita; 401/403 retornam erro operacional 500. Uma falha no
destino ocorre antes de qualquer escrita na origem; uma falha temporária na
origem pode ocorrer depois da atualização idempotente do destino. RevenueCat
continua sendo a fonte de verdade e o Gate Premium continua lendo apenas
CustomerInfo (§10/§11/§27).

---

## Correção (Sprint 4): não existe evento `REFUND`

Versões anteriores deste documento listavam `REFUND` como um evento próprio.
Confirmado contra a documentação oficial do RevenueCat
(revenuecat.com/docs/integrations/webhooks/event-types-and-fields) durante a
implementação do webhook: **não existe** um evento webhook chamado `REFUND`.

Reembolsos chegam como um evento `CANCELLATION`, com o campo `cancel_reason`
indicando o motivo (`UNSUBSCRIBE`, `BILLING_ERROR`, `DEVELOPER_INITIATED`,
`PRICE_INCREASE`, `CUSTOMER_SUPPORT`, `UNKNOWN`). O processamento de
reembolso é feito dentro do mesmo caso `CANCELLATION` — nunca um evento
separado. Qualquer necessidade futura de distinguir "cancelado" de
"reembolsado" deve derivar isso de `CANCELLATION` + `cancel_reason`.

Isso não altera a regra central de autorização (§10/§11):
`CANCELLATION` não revoga acesso imediatamente — o `entitlementActive`
continua sendo calculado a partir da data de expiração efetiva retornada
pelo RevenueCat (`expiration_at_ms`, ou o fim do período de carência quando
aplicável), nunca do tipo de evento isoladamente. Um reembolso imediato
tipicamente já vem com `expiration_at_ms` no passado/presente, o que resulta
em `entitlementActive = false` mesmo sendo o mesmo tipo de evento
(`CANCELLATION`) de um cancelamento voluntário comum.

---

## Regra obrigatória

O backend deve ser idempotente.

Registrar o `event id` para evitar processamento duplicado.

**Implementação original (Sprint 4) e por que foi substituída:** a primeira
versão comparava apenas o `event.id` recebido contra o `lastEventId`
armazenado, em duas operações separadas (ler, depois escrever). A auditoria
de robustez da Sprint 4 encontrou dois problemas reais nesse desenho:

1. **Condição de corrida (TOCTOU):** duas requisições concorrentes para o
   mesmo `uid` podiam ambas ler o mesmo `lastEventId` antigo antes de
   qualquer uma escrever, e ambas passar na checagem de duplicidade.
2. **Eventos fora de ordem:** a checagem só sabia responder "este `id`
   específico já foi aplicado?", nunca "este evento é mais antigo que o que
   já apliquei?". O RevenueCat garante entrega *at-least-once*, nunca em
   ordem — um evento atrasado (retry, latência de rede) podia chegar depois
   de um evento mais novo já ter sido processado e sobrescrever o estado
   mais recente com dados antigos.

**Implementação corrigida (Sprint 4.1):** ver §26 para o campo
`lastEventTimestampMs` (o mecanismo de ordenação) e a função
`applySubscriptionEventAtomically` (`functions/src/billing/subscriptionSync.ts`)
para os detalhes técnicos completos. Resumo:

* leitura, decisão e escrita acontecem dentro de **uma única transação do
  Firestore** — elimina a condição de corrida, porque o próprio Firestore
  serializa transações conflitantes sobre o mesmo documento;
* a decisão compara tanto o `event.id` quanto o `event_timestamp_ms` (o
  relógio do próprio RevenueCat) contra o que já está armazenado, antes de
  decidir se escreve.

### Política de resultado: `processed` / `duplicate` / `stale` / `conflict`

| Resultado | Quando ocorre | Escreve no Firestore? | Resposta HTTP |
|---|---|---|---|
| `processed` | Evento novo, mais recente que o último aplicado (ou o primeiro evento do documento) | Sim | 200 |
| `duplicate` | Mesmo `event.id` já aplicado | Não | 200 (reprocessar não mudaria nada) |
| `stale` | Evento diferente, porém com `event_timestamp_ms` **menor** que o já aplicado — entregue fora de ordem | Não | 200 (reprocessar não mudaria a decisão) |
| `conflict` | Evento diferente com `event_timestamp_ms` **igual** ao já aplicado — ambiguidade que a documentação do RevenueCat não resolve | Não | 200, com log de erro estruturado para investigação manual |

Em nenhum desses quatro casos uma exceção é lançada ao RevenueCat — todos
retornam sucesso (200), porque em nenhum deles um reenvio mudaria o
resultado. Apenas falhas genuinamente transitórias (ex.: indisponibilidade
momentânea do Firestore) retornam 5xx, para que o RevenueCat tente
novamente.

**Nada disso muda quem é a fonte de autorização.** Toda essa transação
existe para manter o *espelho* do Firestore correto e consistente — o
aplicativo continua, sempre, lendo `CustomerInfo` diretamente do SDK do
RevenueCat para decidir acesso Premium (§10/§11/§27), nunca este documento.

---

# 26. Modelo do Firestore

`users/{uid}.subscription` é um espelho assíncrono do RevenueCat.

---

## Schema oficial (consolidado na Sprint 3.5, atualizado na Sprint 4.1)

Este é o schema único e definitivo — a mesma lista de campos é usada por
`firestore.rules` (`subscriptionValid()`) e por
`functions/src/billing/{types.ts,constants.ts}`. Qualquer alteração futura de
campo deve ser aplicada nos três lugares na mesma mudança.

```txt
status
entitlementActive
provider
productId
store
startedAt
trialEndsAt
currentPeriodEndsAt
canceledAt
lastRenewedAt
lastEventId
lastEventTimestampMs
updatedAt
```

Não é exigido que todos os campos existam em todos os estados.

O campo `provider` deve usar:

```txt
REVENUECAT
```

### Adicionado na Sprint 4.1: `lastEventTimestampMs`

Tipo: **`number`** — inteiro, milissegundos Unix (`event_timestamp_ms` do
próprio RevenueCat). **Não** é um Firestore `timestamp`.

Guardado sempre junto com `lastEventId`, escrito exclusivamente por
`applySubscriptionEventAtomically`
(`functions/src/billing/subscriptionSync.ts`) — nunca fornecido pelo
chamador (excluído da lista de campos aceitos por `validateSubscriptionPayload`,
mesmo tratamento de `updatedAt`).

**Por que não usar apenas `updatedAt`:**

* `updatedAt` responde "quando o Firestore foi escrito" — o relógio do
  *nosso* backend, no momento em que processamos o evento.
* `lastEventTimestampMs` responde "quando o evento aconteceu no
  RevenueCat" — o relógio do RevenueCat, no momento em que o evento em si
  ocorreu (ex.: quando a renovação foi cobrada).

Esses dois momentos **não são equivalentes**. O RevenueCat garante entrega
*at-least-once*, nunca em ordem — um evento pode chegar atrasado (retry,
latência de rede, fila) e ser processado por nós *depois* de um evento
cronologicamente mais novo já ter sido aplicado. Se usássemos apenas
`updatedAt` para decidir "isso é mais novo?", a resposta seria sempre "sim,
porque agora é sempre depois de antes" — `updatedAt` não carrega nenhuma
informação sobre a ordem real dos eventos no RevenueCat, só sobre a ordem em
que *nós* os recebemos. `lastEventTimestampMs` é o único campo que permite
comparar corretamente "este evento é mais recente que o que já apliquei,
segundo o RevenueCat" — ver §25 para a política completa de
`processed`/`duplicate`/`stale`/`conflict` que depende dele.

Campo opcional, sem exigência de backfill: documentos gravados antes da
Sprint 4.1 simplesmente não o têm, e são tratados como "primeiro evento do
novo mecanismo" na primeira vez que um webhook for processado para aquele
usuário.

### Removido na Sprint 3.5, reintroduzido em espírito na Sprint 4.1: `lastEventAt`

O rascunho original desta seção incluía também `lastEventAt`. Foi removido do
schema oficial por redundância: no volume de eventos esperado para a V1, toda
escrita em `subscription` já é a própria escrita de processamento do evento —
`lastEventAt` e `updatedAt` seriam, na prática, sempre iguais. A garantia de
idempotência (§25) na época dependia apenas de `lastEventId`.

**Essa decisão se mostrou incompleta.** A auditoria de robustez da Sprint 4
identificou que, sem nenhum timestamp do RevenueCat armazenado, o backend não
tinha como detectar um evento entregue fora de ordem (§25) — só sabia
comparar `event.id`, nunca "isso é mais antigo que o que já tenho". A Sprint
4.1 resolveu isso com `lastEventTimestampMs` (acima) — tecnicamente um campo
novo, não um "desfazer" literal do que foi removido (tipo `number` em vez de
`timestamp`, semântica de comparação em vez de auditoria/log), mas cumprindo
exatamente o papel que `lastEventAt` deixou de existir para cumprir.

### Mantido apesar de ser um valor constante: `provider`

Em um sistema com um único provedor, `provider` carrega pouca informação por
si só. Foi mantido porque `firestore.rules` já depende dele em
`legacyMigrationValid()` (migração única de documentos no formato antigo) —
removê-lo exigiria alterar essa função de migração para um ganho mínimo, risco
não justificado nesta consolidação.

---

## Regra obrigatória

O Firestore funciona apenas como espelho assíncrono para:

* analytics
* suporte
* relatórios
* histórico
* uso administrativo

O Firestore não deve ser usado como fonte imediata de autorização para liberar recursos Premium.

---

# 27. Regra obrigatória do Firestore

Esta seção existe para eliminar qualquer ambiguidade sobre o papel do Firestore no billing.

---

## Papel do Firestore

```txt
users/{uid}.subscription é apenas um espelho do RevenueCat.
```

```txt
O Firestore nunca deve ser utilizado como fonte oficial para decidir
se um usuário possui acesso Premium.
```

O Firestore existe exclusivamente para:

* analytics
* histórico
* suporte
* consultas administrativas
* relatórios
* sincronização por backend

---

## Regra obrigatória para o aplicativo

```txt
O aplicativo não deve utilizar subscription do Firestore para
liberar ou bloquear funcionalidades Premium.
```

A única fonte utilizada pelo aplicativo para decidir acesso Premium é:

```txt
RevenueCat → CustomerInfo
```

---

# 28. Fluxo oficial de sincronização

Diagrama oficial:

```txt
Apple App Store / Google Play
            │
            ▼
       RevenueCat
            │
      ┌─────┴────────────┐
      │                  │
      ▼                  ▼
Aplicativo          Webhook
      │                  │
      ▼                  ▼
CustomerInfo      Cloud Function
                         │
                         ▼
                    Firestore
```

---

## Fluxo detalhado

1. Apple ou Google processam o pagamento.
2. RevenueCat recebe e normaliza os eventos.
3. O aplicativo consulta o CustomerInfo para decidir o acesso Premium.
4. RevenueCat envia o Webhook.
5. A Cloud Function processa o evento.
6. A Cloud Function atualiza o Firestore.
7. O Firestore torna-se um espelho atualizado para analytics e administração.

---

## Regra obrigatória

```txt
O aplicativo nunca deve aguardar a sincronização do Firestore para
conceder ou remover acesso Premium.
```

O acesso deve ocorrer imediatamente, utilizando o CustomerInfo retornado pelo RevenueCat.

---

# 29. Funcionamento offline

O aplicativo utiliza exclusivamente o cache oficial de `CustomerInfo` mantido
pelo RevenueCat SDK. Não existe cache paralelo de autorização em
`AsyncStorage`, `SecureStore` ou Firestore.

Um `CustomerInfo` já confirmado para o Firebase UID atual pode continuar sendo
usado quando uma revalidação falha por indisponibilidade temporária ou ausência
de conexão. O erro não transforma automaticamente esse snapshot em
`isPremium = false`.

Na troca de Firebase UID, logout ou cold start em que a identidade RevenueCat
ainda não foi confirmada, nenhum snapshot anterior é aceito. Sem
`CustomerInfo` confirmado para o UID atual, o Gate permanece neutro/fail-closed
e nunca monta o AppShell.

Os campos locais `lastVerifiedPremiumAt` e `lastKnownEntitlementActive`
previstos em uma versão anterior deste documento não são implementados. A Fase
3 proibiu uma segunda fonte de autorização e consolidou a política no cache
oficial do SDK. Se o produto exigir no futuro uma janela estrita própria de 24
horas, isso precisará de decisão e arquitetura separadas; o cliente atual não
promete nem calcula essa janela por conta própria.

O Firestore nunca é fallback de autorização offline.

---

# 30. Arquitetura oficial de responsabilidades

## Apple / Google

* pagamento
* renovação
* elegibilidade do trial
* cancelamento
* reembolso

## RevenueCat

* fonte oficial de assinatura
* CustomerInfo
* entitlement
* offerings
* normalização entre lojas
* webhooks

## Firebase Auth

* identidade do usuário
* UID usado como App User ID no RevenueCat

## Firestore

* espelho assíncrono
* analytics
* suporte
* histórico administrativo

## Aplicativo

* paywall
* compra
* restauração
* leitura do CustomerInfo
* gate de acesso
* uso identity-scoped do cache oficial de CustomerInfo do RevenueCat SDK

---

# 30.1 Lifecycle client-side da assinatura (Fase 3)

## Máquina de estados

Para um usuário autenticado, o fluxo é:

```txt
Firebase Auth inicializando
→ RevenueCat configurando
→ identidade RevenueCat sincronizando com Firebase UID
→ CustomerInfo confirmado para UID + geração atuais
→ Gate resolve AppShell ou Paywall
```

Os estados `waiting-auth`, `configuring`, `syncing-identity`, `ready` e
`error` são distintos. `refreshing` é um estado paralelo que só existe quando
já há um snapshot confirmado para o mesmo UID. `unknown` ou erro inicial nunca
é convertido em “sem Premium”.

## Orquestração do cold start

Para a arquitetura completa do gate raiz que consome `subscriptionLoading`/
`subscriptionConfigured` (`resolvePremiumGate`, `RootNavigator`, o
invariante contra reabrir o gate depois de READY), ver
`docs/26_bootstrap_e_navegacao_raiz.md`. Esta seção cobre só a parte
RevenueCat do bootstrap.

O bootstrap do RevenueCat é disparado na avaliação do módulo, antes do mount do
React. A hidratação de fontes, o observer do Firebase Auth e os providers
começam sem uma barreira sequencial entre si. Quando o observer fornece um
Firebase UID, as leituras paralelas de perfil/questionário no Firestore e o
`Purchases.logIn(uid)` também avançam em paralelo.

Essa concorrência reduz apenas espera artificial. O Gate continua aguardando
obrigatoriamente Auth, perfil/questionário e um `CustomerInfo` associado ao UID
e à geração atuais. A primeira dessas operações a terminar não autoriza nem
classifica o usuário sozinha.

Offerings comerciais não participam do Gate: são solicitados somente pelo
Paywall, depois que `CustomerInfo` já confirmou ausência de Premium. Durante
essa solicitação, o Paywall reutiliza a mesma superfície neutra de loading do
bootstrap para evitar uma troca visual `loading A → loading B`. Usuário Premium
nunca aguarda Offerings para entrar no AppShell.

## Identidade e concorrência

Cada mudança de Firebase UID incrementa uma geração monotônica e invalida
imediatamente `CustomerInfo`, Premium, Offerings, erros e operações da geração
anterior. Todo resultado assíncrono captura UID + geração. Resultado ou callback
antigo é descartado se qualquer um deles deixar de corresponder à identidade
atual.

Operações do SDK que dependem de identidade são serializadas. Assim, uma compra
em andamento seguida de logout e login B termina no SDK na ordem
`compra → logout → login B`, enquanto a autorização React já é removida
imediatamente no logout.

## CustomerInfo listener

Existe no máximo um listener ativo, registrado somente depois de
`Purchases.logIn(uid)` concluir. O listener captura UID + geração; é removido
antes da próxima sincronização e no unmount. Um callback já enfileirado da
geração antiga continua sendo descartado pelas guardas de identidade.

O listener reage apenas a informações que o SDK obteve localmente por suas
operações; ele não é push direto do backend RevenueCat. Por isso a aplicação
também revalida nos pontos explícitos abaixo.

## Pontos de revalidação

* cold start/login: o `CustomerInfo` retornado por `Purchases.logIn(uid)` é
  aplicado ao estado central, sem uma chamada duplicada imediata;
* compra: o `CustomerInfo` de `purchasePackage` é aplicado ao estado central;
* restore: o `CustomerInfo` de `restorePurchases` é aplicado ao estado central;
* foreground: uma transição React Native `background|inactive → active` chama
  `getCustomerInfo()` uma vez por UID + geração; chamadas concorrentes são
  coalescidas;
* listener: cada atualização válida substitui o snapshot do UID atual.

Não existe polling contínuo.

## Erros

Falha de configuração ou identidade sem snapshot confirmado deixa o Gate em
estado neutro de erro com ação de tentar novamente. Falha temporária/offline
durante refresh preserva o último `CustomerInfo` confirmado somente para o
mesmo UID e expõe erro sanitizado; nunca recupera dados de outro UID.

Compra cancelada, ausência de Offering, Offering indisponível, offline e
restore sem Premium continuam estados distintos. Compra ou restore concluído
sem `premium` ativo não libera AppShell.

## Gate e Firestore

`CustomerInfo.entitlements.active['premium']` permanece o único critério de
autorização. `users/{uid}.subscription` não é lido pelo lifecycle, pelo Gate,
pela compra nem pelo restore.

---

# 31. Evoluções futuras

Possíveis expansões:

* planos alimentares
* produtos complementares
* novos níveis de assinatura

Esses recursos não fazem parte da V1.

---

# 32. Pedido para o Agente Billing

Definir:

* produtos da App Store
* produtos da Google Play
* configuração do RevenueCat
* webhooks
* sincronização com Firestore
* estratégia de restauração

Respeitando todas as regras deste documento.

---

# 33. Arquitetura de Atribuição de Usuários

Seção adicionada na Sprint 3.6 (consolidação arquitetural). Define a
arquitetura de dados para cupons/atribuição.

> **Atualização (FASE iOS-1):** este texto originalmente dizia que "o sistema
> em si (captura de cupom, aplicação, telas) não está implementado" — isso
> ficou desatualizado a partir da Fase 4C (Android). Estado real atual:
>
> * **Android**: implementado e validado ponta a ponta (captura de código,
>   validação no backend, `couponRedemptions/{uid}`, seleção de
>   `SubscriptionOption` do Google Play, correlação via
>   `googlePlayOfferCorrelation.ts`, confirmação/lock via
>   `attributionSync.ts`) — testado em dispositivo real.
> * **iOS**: a UI de cupom permanece deliberadamente desligada no cliente
>   (`PROMO_CODE_SUPPORTED_PLATFORM`, `src/screens/PaywallScreen.tsx`) — fora
>   do escopo desta seção. A FASE iOS-1 (`functions/src/attribution/
>   appleOfferCorrelation.ts`, `types.ts`'s `PromoCodeAppleOfferSnapshot`)
>   preparou apenas a fundação de backend: modelo de dados para o snapshot
>   Apple, um caminho `APP_STORE` explícito em `attributionSync.ts`, e
>   fail-closed garantido — ver "Estado de implementação" ao final desta
>   seção para o detalhe completo.

---

## Billing e Marketing são responsabilidades diferentes

`users/{uid}.subscription` (§26) representa exclusivamente o estado da
assinatura, espelhado do RevenueCat.

```txt
subscription NUNCA deve armazenar couponCode, campaignId, influencerId,
source ou qualquer outro dado de marketing/atribuição.
```

Um cupom pode, no futuro, influenciar QUAL Offering é apresentado ao usuário
(§34), mas isso é uma decisão tomada a partir dos dados de atribuição — o
resultado dessa decisão (a assinatura em si) continua vivendo inteiramente em
`subscription`, sem nenhum campo de marketing misturado.

Esta separação existe porque billing e marketing têm:

* donos diferentes (financeiro/produto vs. growth/marketing);
* ciclos de vida diferentes (assinatura muda com eventos de loja; atribuição
  é praticamente estática após o cadastro);
* requisitos de auditoria diferentes (billing precisa refletir exatamente o
  RevenueCat; atribuição precisa de um histórico de eventos para
  detecção de fraude e performance de campanha).

---

## Opções avaliadas

**Opção A — `users/{uid}.attribution` (campo aninhado, só o snapshot atual)**

* Escalabilidade: boa (O(1) por usuário).
* Auditoria: fraca — sobrescrever o campo perde o histórico; sem trilha
  imutável.
* Prevenção de fraude: fraca — detectar abuso de um `couponCode` específico
  exigiria varrer toda a coleção `users` (coleção sensível, com PII).
* Consultas: ótimas para "qual a atribuição deste usuário", ruins para "quantos
  usuários usaram o cupom X".
* Analytics: ok para exports por usuário, ruim para funis por evento
  (§24 pede "trial iniciado", "trial convertido" — conceitos de evento, não
  de snapshot).
* Campanhas futuras: fraca — sem timestamp de evento, sem trilha por
  campanha.

**Opção B — `couponRedemptions/{id}` (coleção própria, um documento imutável por resgate)**

* Escalabilidade: boa — mesmo padrão já usado em `questionnaires` e
  `assessments` (docs/03), coleção append-only.
* Auditoria: forte — documento imutável por evento, nunca sobrescrito.
* Prevenção de fraude: forte — consulta direta por `couponCode` sem tocar na
  coleção `users`.
* Consultas: ótimas para "quem usou o cupom X"/"quantos resgates hoje";
  exige uma consulta extra (por `uid`) para saber a atribuição atual de um
  usuário específico.
* Analytics: forte — formato de evento, ideal para funis e exports.
* Campanhas futuras: forte — `campaignId` como chave natural de agregação.

**Opção C — combinação: `couponRedemptions/{id}` como fonte de verdade + `users/{uid}.attribution` como espelho de leitura**

Todas as forças da Opção B, mais uma leitura O(1) da atribuição atual de um
usuário (útil para painel administrativo/suporte) sem precisar de uma
consulta extra. Custo: dois lugares para manter sincronizados — mitigado por
seguir exatamente o mesmo padrão que este documento já define para billing
(`subscription` como espelho, RevenueCat como fonte de verdade — §26/§27).

---

## Arquitetura escolhida: Opção C

```txt
couponRedemptions/{id}   → fonte de verdade (log de eventos, imutável)
users/{uid}.attribution  → espelho de leitura (desnormalizado, só o
                            resgate mais recente)
```

### Justificativa técnica

1. Reaproveita um padrão arquitetural que este projeto já usa e já
   entende (mirror assíncrono + fonte de verdade separada) — menor custo
   cognitivo do que introduzir um padrão novo só para atribuição.
2. `couponRedemptions` segue exatamente a mesma forma de
   `questionnaires`/`assessments` (docs/03): coleção própria, documentos
   imutáveis, nunca sobrescritos — consistente com o resto do schema do
   projeto.
3. Mantém dados de marketing fisicamente fora da coleção `users` (que tem
   PII e é lida pelo próprio dono via regras de segurança) — reduz a
   superfície de dados expostos e facilita dar acesso de leitura a
   `couponRedemptions` para ferramentas de marketing/fraude sem tocar em
   dados de conta.
4. Escreve apenas pelo backend (Admin SDK) — mesma regra de "cliente nunca
   escreve" já aplicada a `subscription` (§25/§27).

### Regra obrigatória

```txt
O cupom nunca concede Premium diretamente (§8) — apenas registra atribuição.
A decisão de acesso continua sendo exclusivamente do entitlement do
RevenueCat (§10/§11), nunca de `couponRedemptions` nem de `attribution`.
```

---

## Preparação de código (Sprint 3.6)

Criados apenas tipos e constantes, sem nenhuma lógica de leitura/escrita:

```txt
functions/src/attribution/types.ts       — CouponRedemption, AttributionSnapshot
functions/src/attribution/constants.ts   — nomes de coleção/campo
```

Este módulo é deliberadamente independente de `functions/src/billing/*` (sem
imports cruzados) — reforça, também no código, que são responsabilidades
diferentes. Nenhuma função de leitura, escrita ou validação foi criada; isso
fica para a sprint em que o sistema de cupons for de fato implementado.

---

## Estado de implementação (atualizado na FASE iOS-2)

**Android — implementado e validado.** Fluxo completo: código digitado →
`validatePromoCode` → `couponRedemptions/{uid}` → seleção explícita de
`SubscriptionOption` (`basePlanId:offerId`) → compra → webhook RevenueCat →
`googlePlayOfferCorrelation.ts` prova que a compra usou a oferta autorizada
→ `attributionSync.ts` confirma/trava (`lockedAt`/`trialStartedAt`/
`convertedAt`). Testado em dispositivo Android real.

**iOS — fundação de backend (FASE iOS-1), UI ainda desligada.** Esta fase
adicionou, sem tocar no Android nem no cliente:

* `PromoCodeAppleOfferSnapshot` (`functions/src/attribution/types.ts`) — o
  equivalente Apple de `PromoCodeAndroidOfferSnapshot`, com forma própria
  (`offerCodeMonthly`/`offerCodeAnnual`, sem `basePlanId` — a App Store não
  tem esse conceito). `CouponRedemption.appleOffer` agora grava esse
  snapshot em TODA aplicação de código, incondicionalmente, exatamente como
  `androidOffer` já fazia.
* `functions/src/attribution/appleOfferCorrelation.ts` — caminho Apple
  explícito em `attributionSync.ts` para eventos `store === 'APP_STORE'`
  (antes, esses eventos apenas caíam no fallback genérico de "loja
  desconhecida"). **Esta correlação está deliberadamente incompleta**:
  `correlateAppleOffer` sempre retorna `unsupported`, nunca `matched` — ver o
  doc comment do arquivo para a auditoria completa de evidência (o payload
  de webhook do RevenueCat documentado publicamente não confirma, para
  eventos `APP_STORE`, que `offer_code` carregue o identificador do Apple
  Offer Code, ao contrário do que é documentado e confirmado para
  `PLAY_STORE`). Consequência prática: **attribution promocional para
  compras iOS não é confirmada/travada hoje, mesmo que a Apple aprove Offer
  Codes e o app venha a usá-los** — billing/entitlement de uma compra iOS
  continuam funcionando normalmente (responsabilidade de
  `subscriptionSync.ts`, inalterada), apenas o crédito ao
  influenciador/campanha não é.
* Isso é fail-closed por construção, não uma lacuna de segurança: nenhum
  caminho de código jamais confirma attribution Apple por heurística
  (timing, coincidência de string, etc.) — ver os testes de
  `appleOfferCorrelation.test.ts` e `revenueCatConfirmation.test.ts`.

**iOS — cliente preparado para distinguir ANDROID/IOS (FASE iOS-2), UI e
resgate Apple ainda desligados.** Esta fase adicionou, sem alterar o backend
nem o comportamento Android:

* `src/lib/promoCodePlatform.ts` — `resolvePromoCodePlatform` mapeia o
  `Platform.OS` real (`'android'`/`'ios'`) para o literal que o backend
  espera (`'ANDROID'`/`'IOS'`); qualquer outra plataforma lança erro em vez
  de assumir um valor por padrão (fail-closed). `promoCodeService.ts` não
  envia mais `platform: 'ANDROID'` fixo — usa esse resolver.
* `PromoCodeState`/`usePromoCode` agora transportam também
  `appleStoreConfig` (`offerCodeMonthly`/`offerCodeAnnual`, mesma forma do
  `storeConfig.ios` já retornado pelo backend desde a FASE iOS-1) ao lado de
  `androidStoreConfig` — dois campos independentes, nunca um interpretado
  como o outro. Essa configuração só é armazenada; nada neste código a usa
  para iniciar uma compra.
* `PROMO_CODE_SUPPORTED_PLATFORM` (`PaywallScreen.tsx`) continua
  `Platform.OS === 'android'`, inalterado — a UI do cupom continua
  invisível no iOS. Nenhum fluxo de resgate Apple (Offer Codes,
  Promotional Offers, StoreKit redemption) foi implementado.

**iOS — fluxo de resgate via Apple Offer Codes implementado (FASE iOS-3),
attribution e webhook ainda pendentes de evidência real.** Esta fase
habilitou a UI do cupom no iOS e implementou a compra promocional, sem
alterar Android nem o backend:

* **Mecanismo Apple escolhido: Offer Codes, via
  `Purchases.presentCodeRedemptionSheet()`** (react-native-purchases@10.6.0,
  a versão realmente instalada — confirmado nos typings reais em
  `node_modules/react-native-purchases/dist/purchases.d.ts`). Diferença dos
  três mecanismos Apple, para não confundir:
  * **Offer Codes** — um código (`AJFIT7DTRIAL`) que o usuário resgata na
    tela nativa da própria Apple. É o mecanismo correspondente aos campos já
    existentes (`appleOfferCodeMonthly`/`appleOfferCodeAnnual`). É o único
    dos três com suporte confirmado nesta versão do SDK.
  * **Promotional Offers** — requer uma assinatura criptográfica gerada no
    servidor por transação (`getPromotionalOffer`/`purchaseDiscountedPackage`
    no SDK) e é pensado para retenção de assinantes existentes/ex-assinantes,
    não para um código digitado por um novo usuário. Não implementado — não
    é o mecanismo certo para este requisito de produto.
  * **Introductory Offers** — automáticos, configurados no produto, sem
    código nenhum. Não aplicável (o requisito é um código por
    campanha/influenciador).
* **Limitação confirmada e respeitada, não contornada:**
  `presentCodeRedemptionSheet()` não recebe nenhum parâmetro — não existe,
  nesta versão do SDK, nenhuma API que aceite um Offer Code específico e o
  aplique programaticamente. A única forma oficial de resgatar é abrir a
  folha nativa da Apple e o usuário selecionar/digitar o código lá dentro. O
  app mostra o código (`offerCodeMonthly`/`offerCodeAnnual`) na tela antes de
  abrir a folha — nunca tenta "passar" esse código para `purchasePackage`.
* **Fluxo implementado:** usuário digita o código AJ Fit (ex.: `ARNALDO`) →
  `validatePromoCode` → `storeConfig.ios` → `resolveApplePurchaseRoute`
  (`src/lib/subscriptionOffer.ts`) prova que existe um Offer Code Apple para
  o plano selecionado → CTA muda para "Resgatar na App Store" → toque chama
  `presentCodeRedemptionSheet()`.
  > **Correção (auditoria pós-iOS-3):** este trecho afirmava que a Promise de
  > `presentCodeRedemptionSheet()` resolve "ao fechar" a folha — isso está
  > **incorreto** para react-native-purchases@10.6.0 (a versão instalada).
  > Leitura do JS/nativo instalado comprovou que essa chamada é
  > fire-and-forget de ponta a ponta: a Promise resolve assim que a chamada
  > nativa é *disparada*, não quando a folha aparece, fecha, ou um resgate se
  > completa — não existe, nesta versão, nenhum callback nativo→JS para
  > presented/dismissed/redeemed/cancelled. `redeemOfferCode()`
  > (`src/services/revenueCatService.ts`) não confia mais nessa Promise para
  > decidir quando reler `CustomerInfo`: agora aguarda um push real do
  > `CustomerInfoUpdateListener` via `awaitCustomerInfoUpdate`
  > (`src/lib/awaitCustomerInfoUpdate.ts`), com uma única revalidação final
  > explícita após timeout se nenhum push chegar. Em qualquer caminho,
  > **Premium continua fail-closed**: só
  > `CustomerInfo.entitlements.active['premium']` decide — nunca "o código
  > foi aceito", "a folha foi aberta", "o listener disparou" ou "o timeout
  > ocorreu". Cancelamento/fechamento sem resgatar e "resgatou mas o
  > entitlement ainda não propagou" continuam tratados da mesma forma
  > não-alarmante (aviso neutro, nunca erro), porque a SDK não permite
  > distinguir os dois casos.
* **`PROMO_CODE_SUPPORTED_PLATFORM`** (`isPromoCodeUiSupported`,
  `src/lib/promoCodePlatform.ts`) agora inclui iOS além de Android — Web e
  qualquer outra plataforma continuam bloqueadas, fail-closed.
* **Attribution Apple continua fail-closed, inalterada desde a FASE iOS-1.**
  `appleOfferCorrelation.ts` não foi tocado — `correlateAppleOffer` continua
  sempre `unsupported`. Ou seja: hoje, se um usuário iOS de fato resgatar um
  Offer Code real e assinar, **billing/entitlement funcionam normalmente
  (responsabilidade de `subscriptionSync.ts`, agnóstica de cupom), mas o
  crédito ao influenciador/campanha ainda não é confirmado/travado** — essa
  lacuna só pode ser fechada com evidência real de payload de webhook de uma
  transação App Store com Offer Code, que só existirá após um teste
  real em Sandbox/TestFlight ou produção (FASE iOS-4).
* **Não implementado nesta fase, propositalmente:** nenhuma alteração em
  `functions/**`, nenhuma geração de Sandbox Code, nenhuma alteração no App
  Store Connect/RevenueCat Dashboard. O fluxo acima nunca foi exercitado
  contra uma transação real — apenas contra os tipos/typings do SDK e testes
  unitários das funções puras de roteamento
  (`resolveAuthorizedAppleOfferCode`/`resolveApplePurchaseRoute`).

**Próxima fase (iOS-4, não iniciada):** gerar um Sandbox Code no App Store
Connect para `ajfit_premium_monthly`/`ajfit_premium_annual`, executar uma
transação real de resgate em um build de desenvolvimento/TestFlight, e
capturar o payload real do evento de webhook RevenueCat que essa transação
gera. Só com esse payload em mãos é seguro decidir se
`correlateAppleOffer` pode, de fato, sair do estado `unsupported` — nunca
antes dessa evidência existir.

---

# 34. Elegibilidade de Trial via Cupom de Campanha

Seção adicionada na Sprint 3.6, a pedido de negócio: usuários que utilizarem
um cupom de influenciador devem receber acesso a uma campanha promocional de
7 dias.

---

## Regra obrigatória — quem decide o quê

```txt
1. O cupom identifica a campanha.
2. O backend decide qual Offering do RevenueCat apresentar para essa campanha.
3. A loja (Apple App Store / Google Play), através do RevenueCat, continua
   sendo quem decide se o usuário PODE de fato usar a oferta/trial.
4. O aplicativo nunca promete o trial antes da loja confirmar a elegibilidade.
```

Esta regra não cria exceção às regras já definidas em §6/§7: o cupom só
influencia QUAL oferta é mostrada (roteamento de Offering); ele nunca
substitui, antecipa ou garante a elegibilidade real de trial, que continua
sendo — como em qualquer fluxo sem cupom — determinada pela loja e refletida
pelo RevenueCat.

---

## Fluxo esperado (arquitetura, não implementação)

1. Usuário chega ao app através de um link/código de um influenciador.
2. O cupom é registrado por UID (§8), associado a uma campanha
   (`campaignId`).
3. Ao exibir o paywall, o backend consulta a atribuição do usuário e decide
   qual Offering do RevenueCat corresponde a essa campanha.
4. O RevenueCat/SDK solicita a compra usando essa Offering.
5. A loja informa o preço real e se o usuário É elegível para o trial
   daquela oferta (mesma regra de §6: elegibilidade final é da loja).
6. Se a loja indicar que o usuário NÃO é elegível, o aplicativo não deve
   afirmar ou insinuar que o trial de 7 dias está garantido — deve refletir
   exatamente o que a loja retornar.
7. RevenueCat retorna o CustomerInfo real; o acesso segue as mesmas regras de
   sempre (§10/§11) — entitlement ativo, nunca a existência do cupom.

---

## Regra explícita de comunicação com o usuário

```txt
Nenhuma tela, texto ou notificação pode prometer "7 dias grátis garantidos"
por ter usado um cupom antes da confirmação real da elegibilidade pela loja.
```

O cupom pode, no máximo, comunicar "campanha com possibilidade de teste
gratuito estendido, sujeita à elegibilidade da loja" — a redação final do
Paywall é responsabilidade de uma sprint futura (fora do escopo desta
consolidação), mas deve respeitar esta regra.

---

## Fora do escopo desta seção

Qual Offering/pacote específico do RevenueCat corresponde a cada campanha,
como o backend resolve `campaignId → Offering`, e a implementação do próprio
Paywall — tudo isso é decisão de uma sprint de Offerings ainda não iniciada.

---

# 35. Migração Promo SKU + Introductory Offer — FASE 1 (contrato de backend)

Esta seção documenta a arquitetura EM TRANSIÇÃO, iniciada pela migração que
substitui Apple Offer Codes por SKUs promocionais com Introductory Offer
nativa da Apple. Documenta apenas o que está de fato implementado nesta
fase — não antecipa fases futuras.

## Estado por componente

```txt
Android:
fluxo atual preservado, byte a byte. Nenhuma alteração nesta fase.

iOS atual (Apple Offer Code):
ainda temporariamente suportado — presentCodeRedemptionSheet(),
redeemOfferCode(), appleOfferCorrelation.ts e os campos de catálogo
appleOfferCode*/appleProductId*/appleOfferReference* continuam existindo
e funcionando exatamente como antes. Nada foi removido.

iOS novo — contrato de backend (iosPromotion):
introduzido nesta fase. O backend agora entende e autoriza uma promoção
iOS baseada em Offering/SKU (nunca mais em Offer Code), mas nada além do
backend sabe disso ainda.

Cliente promo_7d:
AINDA NÃO IMPLEMENTADO. PaywallScreen.tsx, revenueCatService.ts e
subscriptionOffer.ts não foram tocados por esta fase e continuam
ignorando iosPromotion completamente — o campo existe na resposta de
validatePromoCode, mas nenhum consumidor cliente o lê ainda.

Webhook promo SKU:
IMPLEMENTADO NA FASE 3 — ver §37. APP_STORE INITIAL_PURCHASE usa a intent,
product_id e purchased_at_ms; o caminho Apple Offer Code continua disponível
somente quando o evento não pertence ao fluxo Promo SKU conhecido.

Purchase intent:
IMPLEMENTADO NA FASE 2 e consumido pelo webhook desde a FASE 3 (§37). O
cliente ainda não chama a operação.
```

## O novo contrato: `IOSPromotionConfig`

`functions/src/attribution/types.ts` define:

```ts
interface IOSPromotionConfig {
  offeringIdentifier: string; // RevenueCat Offering, nunca "default"/Current
  monthlyProductId: string;   // App Store Connect product ID, plano mensal
  annualProductId: string;    // App Store Connect product ID, plano anual
}
```

Vive em três lugares, sempre com a mesma forma:

```txt
promoCodes/{code}.iosPromotion        — cadastro confiável da campanha
                                         (null = campanha sem promoção iOS)

couponRedemptions/{uid}.iosPromotion  — snapshot imutável, capturado no
                                         momento em que o cupom foi
                                         aplicado (nunca re-derivado do
                                         catálogo depois)

validatePromoCode response.iosPromotion — o que o cliente recebe,
                                           gated pelo mesmo `platform`
                                           que já governa storeConfig.ios
```

Deliberadamente sem parentesco com os campos Apple Offer Code legados —
nenhum dos dois é derivado do outro, e ambos podem coexistir no mesmo
documento `promoCodes/{code}` durante toda a migração.

## Autoridade e responsabilidades

```txt
Servidor deriva iosPromotion do cadastro confiável da campanha
(promoCodes/{code}) — o cliente nunca envia offeringIdentifier nem
productId, apenas o código (ex.: "ARNALDO"). validatePromoCode nunca
confia em nenhum campo desse tipo vindo do payload da requisição.

Validação de iosPromotion é tudo-ou-nada: os três campos presentes e
válidos, ou o campo inteiro é null. Uma configuração parcial no catálogo
(um admin editou pela metade) reprova o documento inteiro na leitura —
nunca autoriza parcialmente.

Aplicar um cupom com iosPromotion configurado NÃO define lockedAt, NÃO
define trialStartedAt, NÃO define convertedAt, e NÃO concede Premium.
Esses três timestamps continuam exclusivos de
applyAttributionRevenueCatEvent (o webhook), que nesta fase ainda não
sabe correlacionar uma compra de SKU promocional — então, na prática,
uma redemption com iosPromotion permanece indefinidamente "pendente" até
uma fase futura implementar essa correlação.

Premium continua exclusivamente:
CustomerInfo.entitlements.active["premium"]
```

## Configuração administrativa

O escritor confiável é `adminUpdatePromoCodeHandler`/
`adminCreatePromoCodeHandler` (`functions/src/attribution/promoCodeAdmin.ts`),
já validado por `validateAdminPromoCodeWrite`. Nenhuma escrita manual/direta
no Firestore é necessária ou recomendada — o painel administrativo (quando
existir) ou uma chamada autenticada de admin a `adminUpdatePromoCode` com
`{ code: "ARNALDO", iosPromotion: { offeringIdentifier: "promo_7d",
monthlyProductId: "ajfit_premium_monthly_promo", annualProductId:
"ajfit_premium_annual_promo" } }` é o único caminho suportado. Esta fase
NÃO executou essa chamada contra nenhum ambiente — `promoCodes/ARNALDO`
permanece, até essa ação manual, sem `iosPromotion` configurado (campo
ausente, que o parser trata como `null`).

## Fora do escopo desta fase

Na Fase 1 ficaram fora de escopo: seleção de SKU promocional pelo Paywall,
criação da purchase intent, nova correlação de webhook, remoção do fluxo Apple
Offer Code e qualquer alteração ao comportamento Android. A purchase intent
foi implementada posteriormente na Fase 2 (§36); os demais itens continuam
pendentes.

---

# 36. Migração Promo SKU + Introductory Offer — FASE 2 (purchase intent pré-compra)

A Fase 2 adiciona somente a evidência backend criada imediatamente antes de
uma futura compra StoreKit. Não integra o Paywall, não chama StoreKit e não
altera o webhook.

## Operação autenticada

Callable:

```txt
authorizePromoPurchase
```

Implementação:

```txt
functions/src/attribution/authorizePromoPurchase.ts
functions/src/attribution/promoPurchaseIntent.ts
```

O request aceita exatamente um campo:

```ts
interface AuthorizePromoPurchaseRequestData {
  plan?: "monthly" | "annual";
}
```

O UID vem exclusivamente de `request.auth.uid`. Campos adicionais — inclusive
`uid`, `campaign`, `offeringIdentifier`, `expectedProductId`, `status` e
timestamps — são rejeitados antes da transação.

## Modelo persistido

```ts
interface PromoPurchaseIntent {
  campaignId: string;
  plan: "monthly" | "annual";
  expectedProductId: string;
  offeringIdentifier: string;
  status: "purchase_pending";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
}
```

A intent vive em `couponRedemptions/{uid}.purchaseIntent`; não existe coleção
paralela nem `intentId`. O documento por UID já fornece a unicidade necessária
nesta fase, e ainda não existe um consumidor externo que precise de um token
CAS opaco.

## Derivação e transação

Dentro de uma única transação Firestore, o backend:

```txt
request.auth.uid + plan
→ lê couponRedemptions/{uid}
→ valida uid/cupom/campaignId e estados de consumo
→ valida o snapshot iosPromotion completo
→ deriva offeringIdentifier e Product ID pelo plano
→ avalia a purchaseIntent existente
→ grava purchase_pending com timestamps do backend
```

`monthly` usa somente `iosPromotion.monthlyProductId`; `annual` usa somente
`iosPromotion.annualProductId`. A Offering sempre vem de
`iosPromotion.offeringIdentifier`. O catálogo `promoCodes/{code}` não é lido,
portanto uma edição administrativa posterior não altera a autorização já
capturada na redemption.

`lockedAt`, `trialStartedAt` ou `convertedAt` não nulos tornam a redemption
incompatível com uma nova intent. Ausência/má formação de `iosPromotion`, da
redemption ou de uma intent server-owned existente falha de forma segura.

## Expiração, idempotência e concorrência

Constante backend:

```txt
PROMO_PURCHASE_INTENT_TTL_MS = 10 * 60 * 1000
```

A janela de 10 minutos é deliberadamente curta para uma operação executada
imediatamente antes da loja, mas tolera autenticação e interação normal com a
folha de compra. Não se usam horas ou dias. A validade é sempre comparada em
código com `expiresAt`; Firestore TTL não é requisito nem defesa única.

Retry da mesma campanha/plano/Offering/Product ID reutiliza a intent ativa sem
escrita e sem prolongar `expiresAt`. Uma intent ativa diferente retorna
`promo_purchase_intent_conflict`. Uma intent expirada pode ser substituída na
mesma transação.

Como todas as chamadas leem e escrevem o mesmo `couponRedemptions/{uid}`, o
Firestore serializa conflitos e repete a transação perdedora sobre o estado
já confirmado. O fluxo de aplicação de cupom também verifica a intent: uma
intent ativa ou malformada impede a troca de campanha; uma expirada não
bloqueia permanentemente.

Essa garantia possui cobertura real no Firestore Emulator em
`firestore-tests/promoPurchaseIntent.concurrent.test.ts`: chamadas `monthly`
e `annual` são disparadas com `Promise.all` para o mesmo UID; exatamente uma
retorna `authorized`, a outra retorna `intent_conflict`, e somente a intent
vencedora permanece no documento.

## Limites desta fase

```txt
Fase 1: iosPromotion snapshot — implementada.
Fase 2: purchaseIntent pré-compra — implementada no backend.
Fase 3: webhook correlacionar product_id + intent — implementada (§37).

Cliente chama authorizePromoPurchase — NÃO.
Paywall usa promo_7d — NÃO.
StoreKit compra SKU _promo pela nova arquitetura — NÃO.
Offer Code legado/presentCodeRedemptionSheet — preservado.
Webhook usa purchaseIntent — SIM, somente APP_STORE INITIAL_PURCHASE.
```

Criar `purchase_pending` não altera `lockedAt`, `trialStartedAt` ou
`convertedAt`, não escreve em `users/{uid}.subscription` e não concede
Premium. A autoridade final continua exclusivamente
`CustomerInfo.entitlements.active["premium"]`.

---

# 37. Migração Promo SKU + Introductory Offer — FASE 3 (correlação no webhook)

A Fase 3 conecta a evidência pré-compra da Fase 2 ao consumidor de attribution
do webhook. Não altera `subscriptionSync.ts`, o Gate Premium ou o cliente.

## Roteamento Apple durante a migração

Para `APP_STORE` + `INITIAL_PURCHASE`,
`correlateApplePromoPurchaseIntent` (`functions/src/attribution/
applePromoPurchaseIntentCorrelation.ts`) recebe somente o evento real e o
snapshot lido dentro da transação de `applyAttributionRevenueCatEvent`:

```txt
purchaseIntent presente
  → sempre fluxo novo; qualquer conflito falha sem fallback legado

purchaseIntent ausente + product_id igual a um SKU de iosPromotion
  → fluxo novo responde no_intent; sem fallback legado

purchaseIntent ausente + produto não reconhecido por iosPromotion
  → not_promotional; somente então Apple Offer Code legado pode correlacionar
```

Não existe heurística por sufixo `_promo`, hardcode de campanha nem consulta ao
catálogo vivo. O Product ID prova somente o produto; a campanha vem da
redemption e precisa coincidir com a intent.

## Match e relógio

Um match exige, em conjunto: intent `purchase_pending` estritamente válida;
campanha igual à redemption; `iosPromotion` completo; Offering igual ao
snapshot; Product ID interno igual ao produto do plano no snapshot; Product
ID do webhook igual a `expectedProductId`; e compra dentro da janela.

O relógio da compra é exclusivamente `event.purchased_at_ms`, definido pela
RevenueCat como o momento da compra da transação, em milissegundos Unix. A
janela é inclusiva e sem tolerância artificial:

```txt
purchaseIntent.createdAt <= purchased_at_ms <= purchaseIntent.expiresAt
```

`event_timestamp_ms` continua com sua função anterior (ordenação do billing e
timestamps de confirmação), mas não substitui o horário da compra. Portanto um
webhook recebido depois da expiração ainda casa se `purchased_at_ms` estiver na
janela; compra posterior à expiração, anterior à intent ou timestamp ausente/
inválido não confirma attribution. Todos são resultados normais fail-closed e
não desfazem nem bloqueiam o billing já processado.

## Consumo atômico e idempotência

No match, a mesma transação que grava `lockedAt` e, conforme o `period_type`,
`trialStartedAt` ou `convertedAt`, preserva a intent como:

```ts
{
  ...purchaseIntent,
  status: "purchase_confirmed",
  updatedAt: Timestamp,       // event_timestamp_ms
  confirmedAt: Timestamp,     // event_timestamp_ms
  revenueCatEventId: string
}
```

Retry com o mesmo ID resulta em `already_processed` e não escreve novamente.
Outro evento contra a evidência consumida resulta em `already_consumed`. Uma
`RENEWAL` nunca avalia nem consome a intent; ela preserva a semântica anterior
de conversão somente quando `trialStartedAt` já prova a correlação inicial.
Concorrência entre dois eventos distintos é serializada pela transação do
mesmo documento e coberta no Firestore Emulator.

## Limites após a Fase 3

```txt
Cliente chama authorizePromoPurchase — NÃO.
Paywall usa promo_7d — NÃO.
StoreKit compra SKU _promo pela nova arquitetura — NÃO.
Apple Offer Code legado — preservado.
Android/Google Play correlation — preservados.
subscriptionSync.ts — inalterado.
Premium — exclusivamente CustomerInfo entitlement premium.
```

---

# 38. Migração Promo SKU + Introductory Offer — FASE 4 (resolução no app)

A Fase 4 adiciona ao cliente a infraestrutura de resolução explícita da
Offering/SKU promocional iOS, mas deliberadamente não executa a nova compra.
O retorno `iosPromotion` de `validatePromoCode` agora é validado no limite da
callable e preservado no estado aplicado como uma autorização indivisível:

```ts
interface IOSPromotionAuthorization {
  offeringIdentifier: string;
  monthlyProductId: string;
  annualProductId: string;
}
```

`null` significa que a campanha não autoriza o fluxo novo. Campo ausente,
objeto parcial, chave extra, string vazia/com espaços externos ou tipo errado
é resposta malformada: a validação falha de modo controlado e registra somente
`promo_authorization_invalid`, sem payload, UID, cupom, Offering ou Product ID.

## Autoridade e resolução comercial

`subscriptionOffer.ts` separa explicitamente a rota iOS em `standard`,
`promotional` ou `blocked`. A API que cria essa rota recebe somente
`iosPromotion`; ela não recebe `promoApplied`, o texto digitado, código de
cupom, campanha ou heurística de sufixo de SKU. Essa ausência é uma garantia
estrutural de que estado visual não pode selecionar a Offering promocional.

```txt
standard
  → offerings.current
  → packageType MONTHLY ou ANNUAL

promotional
  → offerings.all[authorization.offeringIdentifier]
  → packageType MONTHLY/ANNUAL correspondente ao plano
  → package.product.identifier exatamente igual ao Product ID autorizado
```

No fluxo promocional, Offering ausente, package do plano ausente, Product ID
divergente, Product ID sob `packageType` errado ou duplicidade exata resultam
em erro tipado. Não há fallback para Current/default, para outro plano ou para
um SKU semelhante. O identificador `promo_7d` não é regra no resolver; o teste
`special_promo_test` prova que a chave sempre vem da autorização backend.

O fluxo standard continua usando Current conforme a configuração externa do
RevenueCat e não exige que seu identificador seja literalmente `default`.

## Ciclo de vida no cliente

O estado antes local ao hook do Paywall foi elevado para um
`PromoCodeProvider` em memória, montado acima de `RootNavigator`. Isso preserva
uma autorização válida durante um remount comum do Paywall, sem criar
persistência permanente. Não há AsyncStorage/SecureStore para a autorização:
um restart exige nova validação backend.

O provider conserva os guards anteriores de UID, geração de identidade e
sequência de tentativa. Logout, troca de usuário, início de validação de outro
cupom, falha definitiva ou resposta assíncrona obsoleta não preservam a
autorização anterior. Durante a janela render→effect de uma troca de UID, o
estado da identidade anterior é ocultado sincronicamente e nenhuma validação
é iniciada até o reset da nova identidade.

## Integração deliberadamente incompleta nesta fase

O Paywall calcula a resolução iOS e emite diagnósticos simbólicos para
inconsistências do catálogo, porém esse resultado não participa de
`effectiveRoute` nem de `handlePurchase`. Portanto:

```txt
Paywall chama authorizePromoPurchase — NÃO.
Paywall compra o PurchasesPackage promocional — NÃO.
purchaseIntent é criado ao aplicar cupom/trocar plano — NÃO.
Apple Offer Code legado/presentCodeRedemptionSheet — preservado.
Android SubscriptionOption/offerToken/purchaseSubscriptionOption — preservado.
Webhook/correlação Apple/attributionSync/subscriptionSync — inalterados.
Premium — exclusivamente CustomerInfo.entitlements.active["premium"].
```

A Fase 5 deve, no toque de compra, chamar `authorizePromoPurchase` para o plano
escolhido, reconciliar sua resposta com a autorização/resolução já preparada e
só então comprar o package promocional exato. Não deve criar intent antes do
tap nem reutilizar uma resolução que tenha mudado.

## Cobertura automatizada da Fase 4

Os testes do app cobrem: standard mensal/anual; promoção mensal/anual;
identificador dinâmico de Offering; Offering/package ausente por plano;
Product ID divergente por plano; `packageType` errado mesmo com Product ID
igual; autorização nula/parcial/vazia/tipo errado/chave extra; duplicidade;
independência de `promoApplied`/ARNALDO; transporte e limpeza por identidade;
provider acima do navegador; ausência de persistência; ausência de nova compra
e de `authorizePromoPurchase`; preservação do Apple Offer Code; autoridade
Premium; e toda a suíte Android preexistente.

---

# 39. Migração Promo SKU + Introductory Offer — FASE 5 (compra no Paywall)

A Fase 5 conecta a resolução segura da Fase 4 à compra real no iOS. O fluxo
standard continua em `offerings.current` e chama a compra normal, sem criar
intent. Uma campanha iOS legada (`iosPromotion: null`) continua usando Apple
Offer Code. Somente uma autorização `iosPromotion` completa troca a superfície
para os dois packages da Offering backend:

```txt
iosPromotion válida
  → offerings.all[offeringIdentifier]
  → MONTHLY + Product ID mensal exato
  → ANNUAL + Product ID anual exato
  → Intro data real de cada StoreProduct
  → eligibility real RevenueCat/StoreKit por Product ID
  → authorizePromoPurchase({ plan }) somente no toque
  → revalidar todos os campos da intent
  → purchasePackage(package promocional exato)
  → CustomerInfo entitlement premium
```

Se qualquer metade do catálogo promocional estiver ausente ou divergente, o
catálogo inteiro falha sem fallback para Current/default.

## SDK instalado e elegibilidade

O app usa `react-native-purchases@10.6.0`, bridge
`PurchasesHybridCommon@18.28.0` e `RevenueCat/purchases-ios@5.83.0`. A API JS
instalada é:

```ts
Purchases.checkTrialOrIntroductoryPriceEligibility(productIdentifiers)
// Promise<Record<string, IntroEligibility>>
```

`IntroEligibility.status` preserva `UNKNOWN`, `INELIGIBLE`, `ELIGIBLE` e
`NO_INTRO_OFFER_EXISTS`. É iOS-only; Android retorna `UNKNOWN`. A própria
documentação instalada classifica a resposta como best effort quando faltam
informações do subscription group e recomenda preço não introdutório para
`UNKNOWN`. Neste Paywall promocional, `UNKNOWN`/erro bloqueiam a compra porque
a UI não consegue garantir antecipadamente quais termos a folha Apple
aplicará; nunca viram `eligible`.

`PurchasesStoreProduct.introPrice` expõe preço, `priceString`, ciclos, período,
unidade e número de unidades. O bridge RN desta versão não serializa o
`paymentMode` que existe no SDK Swift nativo. Assim, “grátis” somente aparece
quando o preço introdutório real é numericamente zero, duração/ciclos/unidade
são válidos e a eligibility é `ELIGIBLE`. Intro ausente, paga ou malformada é
inconsistência de configuração e bloqueia o fluxo novo. Nenhum termo nasce de
cupom, nome da Offering, sufixo do SKU ou Product ID.

Para `INELIGIBLE`, não há promessa de trial: a tela mostra o preço regular do
próprio Promo SKU. A compra pode continuar, pois StoreKit aplica a Introductory
Offer automaticamente apenas ao cliente elegível; o cliente inelegível compra
pelas condições regulares do produto, confirmadas na folha nativa.

Fontes oficiais consultadas:

* RevenueCat — Subscription Offers:
  https://www.revenuecat.com/docs/subscription-guidance/subscription-offers
* RevenueCat — iOS Subscription Offers:
  https://www.revenuecat.com/docs/subscription-guidance/subscription-offers/ios-subscription-offers
* RevenueCat — Intro eligibility codelab:
  https://revenuecat.github.io/codelabs/guides/check-intro-eligibility.html
* Apple — Set up introductory offers:
  https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions
* Apple — Implementing introductory offers:
  https://developer.apple.com/documentation/storekit/implementing-introductory-offers-in-your-app

## Intent tardia, snapshot e races

`authorizePromoPurchase` recebe exatamente `{ plan }`. O wrapper valida em
runtime uma resposta fechada contendo `authorized: true`, plano, Offering,
Product ID esperado, `purchase_pending` e `expiresAt`. Imediatamente antes da
compra, todos esses campos são comparados ao package capturado no toque e a
expiração é verificada duas vezes. Erro, conflito, payload extra/malformado,
mismatch ou intent expirada nunca chamam StoreKit e nunca caem no standard.

O snapshot local inclui UID, geração de identidade, cupom aplicado, plano,
autorização e package. Sua chave é reavaliada a cada render; logout, troca de
UID/cupom/plano/package ou resposta atrasada invalida a tentativa antes da
compra. `actionInFlight` é adquirido sincronicamente antes do primeiro
`await`, impedindo double tap. Cancelamento/erro StoreKit não concede Premium
nem escreve consumo da intent no cliente; a correlação continua exclusiva do
webhook. Sucesso libera acesso apenas quando o `CustomerInfo` retornado contém
`entitlements.active["premium"]`.

## Limites preservados

```txt
presentCodeRedemptionSheet no novo fluxo — NÃO
Apple Promotional Offer assinada/getPromotionalOffer — NÃO
Apple Offer Code legado no código/rota sem iosPromotion — SIM
Android SubscriptionOption/purchaseSubscriptionOption — inalterado
webhook/attributionSync — inalterado
subscriptionSync.ts — inalterado
polling de Offerings — NÃO
deploy/configuração remota — NÃO
```

---

# 40. Migração Promo SKU + Introductory Offer — FASE 6 (remoção do Offer Code no cliente)

A Fase 6 conclui a troca de arquitetura no cliente iOS. A rota antiga de
Apple Offer Code foi removida do Paywall, do contexto de assinatura, do
serviço RevenueCat e dos helpers temporários. O cliente não chama mais
`presentCodeRedemptionSheet` e não transporta `storeConfig.ios` para o estado
promocional.

O cliente iOS possui agora exatamente dois caminhos comerciais:

```txt
sem promoção
  → offerings.current
  → package normal selecionado
  → purchasePackage
  → CustomerInfo

com promoção autorizada
  → validatePromoCode
  → iosPromotion completa
  → Offering e Promo SKU exatos
  → Intro Eligibility real
  → authorizePromoPurchase no toque
  → purchasePackage do Promo SKU
  → CustomerInfo
```

Um cupom aplicado sem `iosPromotion`, uma autorização malformada ou uma
resolução divergente falham fechados. Não existe fallback Promo → Current,
Promo → Apple Offer Code ou compra → redemption. O CTA único de compra volta
a ser `Continuar`; a cópia e o estado específicos de “Resgatar na App Store”
foram eliminados.

## Compatibilidade deliberadamente preservada

O backend permanece backward-compatible. `appleOfferCorrelation.ts`, os
campos Apple históricos no Firestore, o webhook da Fase 3,
`attributionSync.ts` e `subscriptionSync.ts` não foram alterados. O tipo da
resposta de `validatePromoCode` ainda aceita `storeConfig.ios` como campo de
wire legado, evitando ampliar o escopo para Functions; o app não o consome,
não o armazena e não o usa para rotear compras.

Também permanecem intactos:

* Android com `SubscriptionOption`, `offerToken` e
  `purchaseSubscriptionOption`;
* Intro Eligibility com os quatro estados do SDK;
* purchase intent tardia, TTL e validações da Fase 5;
* listener global identity-scoped de `CustomerInfo`;
* revalidação legítima no foreground por `AppState`;
* `CustomerInfo.entitlements.active["premium"]` como única autoridade de
  acesso Premium.

O helper `awaitCustomerInfoUpdate` e sua suíte exclusiva foram removidos. Não
existia `redemptionDiagnostics` nem listener de `AppState` exclusivo da sheet
no baseline da Fase 5; portanto nenhum desses componentes compartilhados foi
removido por associação nominal. A Fase 6 não faz deploy, push nem alteração
de configuração remota. Ainda é obrigatória a validação E2E real da Fase 5 em
Sandbox antes de qualquer declaração de prontidão para produção.

---

# 41. Migração Promo SKU + Introductory Offer — FASE 7 (auditoria residual)

A Fase 7 auditou código, testes, configuração e documentação em busca de
instrumentação criada para a antiga Redemption Sheet. A limpeza executável já
estava quase integralmente concluída pela Fase 6:

```txt
appleOfferCodeSandboxTest — já ausente
teste do sandbox override — já ausente
presentCodeRedemptionSheet/redeemOfferCode — já ausentes em produção
awaitCustomerInfoUpdate — já ausente em produção
redemptionDiagnostics e eventos temporários — já ausentes
AppState exclusivo da sheet — não existia no baseline
```

O único resíduo executável encontrado foi a flag local órfã
`EXPO_PUBLIC_ENABLE_APPLE_OFFER_CODE_SANDBOX_TEST` no `.env`; ela foi removida.
Não havia a flag em `.env.example`, `app.json`, `app.config.*`, `eas.json`,
scripts ou código-fonte, e nenhum helper ainda a consumia.

Os testes estruturais da Fase 6 que citam símbolos antigos como strings foram
preservados: eles impedem a reintrodução da rota, não testam o comportamento
morto. Também foram preservados o listener global identity-scoped de
`CustomerInfo`, o refresh real de assinatura no foreground por `AppState` e
os logs operacionais de billing, promo, purchase intent, attribution e
webhook.

O backend Apple histórico continua intencionalmente compatível, incluindo
`appleOfferCorrelation`, snapshots/campos antigos e parsing do webhook.
`storeConfig.ios` permanece como legado tipado sem consumo runtime no cliente.
O novo caminho `iosPromotion` → Promo Offering/SKU → Intro Eligibility →
`authorizePromoPurchase` → `purchasePackage` → `CustomerInfo`, assim como
Android e `subscriptionSync.ts`, não sofreu alteração funcional.

Esta fase não executa compra Sandbox, deploy, push nem mutação de configuração
remota. O próximo passo continua sendo o E2E Sandbox controlado.

---

# 42. Migração Promo SKU + Introductory Offer — FASE 8 (backend ativo)

A Fase 8 retirou do modelo ativo do backend a compatibilidade operacional com
Apple Offer Code. O cliente já não produzia esse fluxo desde a Fase 6; agora o
catálogo, o admin, `validatePromoCode`, os novos `couponRedemptions` e o webhook
iOS também deixaram de ler, escrever ou correlacionar
`appleOfferCode*`, `appleProductId*`, `appleOfferReference*`, `appleOffer` e
`appleOfferCorrelation`. `storeConfig.ios` e seu tipo wire foram removidos.

O caminho iOS atual é exclusivamente:

```txt
validatePromoCode
  → iosPromotion
  → Promo Offering/SKU exatos
  → Intro Eligibility
  → authorizePromoPurchase
  → purchaseIntent
  → purchasePackage
  → CustomerInfo
  → webhook por correlateApplePromoPurchaseIntent
```

`correlateAppleOffer` e seu fallback `product_id + offer_code` foram removidos.
Um Promo SKU com intent ausente/inválida e um produto App Store normal sem
intent permanecem sem attribution; `event.offer_code` não pode reativar o
legado. O campo genérico de wire continua aceito porque a correlação Google
Play usa `offer_code`; ele não possui dependência de negócio no caminho iOS.

Dados Firestore antigos não foram apagados. O parser de `promoCodes` aceita os
seis campos Apple históricos como extras conhecidos, mas não os expõe no tipo
ativo. Escritas por merge em `couponRedemptions` preservam extras históricos
existentes sem relê-los nem reescrevê-los. Admin create/update opera somente
com Android e `iosPromotion`.

Permanecem intactos: `correlateApplePromoPurchaseIntent`, purchase intent/TTL/
idempotência, Intro Eligibility fail-closed, `purchasePackage`, logs permanentes
de attribution, `subscriptionSync.ts`, `CustomerInfo` como única autoridade
Premium e Android com `SubscriptionOption`, `offerToken`,
`purchaseSubscriptionOption` e `googlePlayOfferCorrelation`.

---

# 43. Migração Promo SKU + Introductory Offer — FASE 9 (preservação Android)

A Fase 9 auditou o fluxo promocional Android como regressão, sem migrá-lo para
a arquitetura criada para iOS e sem alterar código de produção. A separação
atual é deliberada:

```txt
iOS
validatePromoCode → iosPromotion → Promo SKU → Intro Eligibility
→ authorizePromoPurchase → purchaseIntent → purchasePackage
→ correlateApplePromoPurchaseIntent

Android
validatePromoCode → androidOffer → SubscriptionOption exata
→ purchaseSubscriptionOption → Google Play/RevenueCat
→ correlateGooglePlayOffer
```

No Android, o backend autoriza somente o par `basePlanId`/`offerId` de cada
plano. O cliente compara a identidade exata
`basePlanId:offerId` e o `storeProductId` contra as opções reais retornadas
pelo RevenueCat. Zero match, mais de um match, oferta ausente ou plano
incompatível bloqueiam a rota promocional sem escolher por posição, preço,
trial ou tag. A `SubscriptionOption` resolvida é entregue inteira a
`Purchases.purchaseSubscriptionOption`; o app não recebe nem fabrica um
`offerToken` textual. A resolução final do token é responsabilidade da camada
nativa RevenueCat/Google Play a partir da option real.

O webhook roteia `PLAY_STORE` somente para `correlateGooglePlayOffer`, usando
o `basePlanId` extraído de `product_id`, o `offer_code` real e o snapshot
`androidOffer`. `APP_STORE` usa somente purchase intent; lojas desconhecidas
falham fechadas. `iosPromotion`, purchase intent, Intro Eligibility e os
Product IDs Promo SKU não participam da seleção nem da correlação Android.

`validatePromoCode` continua aceitando campanha Android-only com
`iosPromotion: null`, grava `androidOffer` no redemption e não exige purchase
intent. Cupom, option e attribution não concedem Premium; a autoridade
client-side permanece `CustomerInfo.entitlements.active["premium"]`. Billing
continua independente em `subscriptionSync.ts`.

---

# 44. Migração Promo SKU + Introductory Offer — FASE 10 (E2E-like automatizado)

A Fase 10 é a barreira **AUTOMATED / EMULATED** anterior ao primeiro E2E
Apple Sandbox. Nenhuma compra, folha StoreKit, webhook RevenueCat real ou
configuração remota participa desta validação.

No app, a matriz usa os identificadores atuais. Sem `iosPromotion`, mensal e
anual resolvem exclusivamente de `offerings.current`, respectivamente para
`ajfit_premium_monthly` e `ajfit_premium_annual`, mesmo quando
`offerings.all["promo_7d"]` existe. O cliente não hardcoda o nome `default`:
Current é a autoridade externa da rota standard. Com a autorização completa
do backend, a rota usa somente `promo_7d`,
`ajfit_premium_monthly_promo` e `ajfit_premium_annual_promo`, validando em
conjunto Offering, `packageType` e Product ID, sem fallback.

Intro Eligibility preserva os quatro estados reais. Trial gratuito só é
comunicado para `ELIGIBLE` com `introPrice.price === 0` e duração válida
derivada de `cycles × periodNumberOfUnits` e `periodUnit`. `INELIGIBLE` usa o
preço regular do Promo SKU; `UNKNOWN`, erro, intro ausente/paga/malformada e
`NO_INTRO_OFFER_EXISTS` não prometem trial e seguem a política fail-closed da
Fase 5.

Os testes do cliente provam a ordem obrigatória
`authorizePromoPurchase({ plan })` → validação estrita da response/TTL →
`purchasePackage(package promocional exato)`. UID, cupom, Offering, Product
ID, campanha, status e timestamps nunca são enviados como autoridade. Mudança
de UID, geração, cupom, plano ou package invalida o snapshot; o lock local é
adquirido antes do primeiro `await`.

No Firestore Emulator, os fluxos mensal e anual atravessam os módulos reais:

```txt
catálogo → validatePromoCodeHandler → redemption snapshot
→ authorizePromoPurchaseHandler → purchase_pending
→ webhook APP_STORE sintético → purchase_confirmed + attribution locked
```

Também ficam provados reuso bloqueado após `lockedAt` com o mesmo ou outro
cupom, restart conceitual com estado client vazio, dois códigos concorrentes
sem snapshot híbrido, dois dispositivos do mesmo UID, mensal/anual
simultâneos, retry idempotente sem extensão, substituição de intent expirada,
snapshot independente do catálogo vivo e consumo concorrente por exatamente
um webhook.

A matriz de webhook cobre mensal/mensal, anual/anual, os dois mismatches entre
planos, Promo SKU sem intent, produto normal com intent promo, `offer_code`
Apple sem fallback, timestamps anterior/expirado/ausente e limites inclusivos,
evento duplicado e segundo evento contra intent consumida. Falha de attribution
é resultado normal e não bloqueia billing.

As Rules negam writes diretos do cliente em `couponRedemptions`,
`purchaseIntent`, `lockedAt`, `trialStartedAt` e `convertedAt`. Android mantém
`SubscriptionOption`/`purchaseSubscriptionOption` e correlação Google Play.
`subscriptionSync.ts` não foi alterado.

Cupom, `iosPromotion`, intent, timestamps e attribution não concedem Premium.
A única autoridade client-side continua sendo
`CustomerInfo.entitlements.active["premium"]`. Esta fase altera somente
testes e documentação, sem Sandbox real, push, deploy ou mutação remota.

---

# 45. Migração Promo SKU + Introductory Offer — FASE 11 (deploy backend)

Em 2026-08-13, o backend da nova arquitetura iOS foi publicado de forma
controlada no único projeto Firebase documentado, `ajfit-2f321`, antes de
qualquer distribuição do cliente novo. O deploy usou filtro explícito e
afetou somente:

```txt
validatePromoCode
authorizePromoPurchase
revenueCatWebhook
```

`authorizePromoPurchase` passou a existir em produção. `validatePromoCode` e
`revenueCatWebhook` receberam novas revisões Gen2. Functions existentes de
health/vault e as quatro Functions administrativas de catálogo não foram
incluídas; Rules, Storage, Remote Config e app também não foram publicados.

O inventário final confirmou as três Functions em `ACTIVE`, região
`us-central1` e runtime Node.js 20. `authorizePromoPurchase` e
`validatePromoCode` compartilham o hash de fonte
`d2f52faff88d557f1aa6589935accc377c90230d`; o webhook usa
`3cae361d6353f27fc498511a133403c0489d7cf5`. `backendHealth`, `createVault` e
`recoverVaultKey` mantiveram seus hashes anteriores, provando que ficaram fora
do blast radius.

Os smokes remotos confirmaram autenticação obrigatória nas callables, rejeição
de webhook sem assinatura e aceitação de um HMAC válido. O evento assinado
usado no smoke tinha tipo não suportado de propósito, retornou HTTP 200
`ignored` e não percorreu billing nem attribution. Uma identidade descartável
confirmou que `validatePromoCode` acessa o catálogo real e grava o espelho de
attribution no Firestore; a conta e todos os documentos de teste foram
removidos ao final. Essa limpeza atingiu apenas registros temporários criados
pela própria validação; nenhum documento histórico foi apagado.

As Rules remotas foram lidas pela API e comparadas com o arquivo local. Os
hashes diferem porque há mudanças locais fora desta migração, mas o estado
publicado nega explicitamente leitura/escrita de `couponRedemptions`, impede
alteração client-side de `users.attribution` e deixa `purchaseIntent`,
`lockedAt`, `trialStartedAt` e `convertedAt` protegidos pelo deny-all ou pela
imutabilidade do documento. Por isso, e para não ampliar o escopo, nenhuma
Rule foi publicada. Os dez índices locais/remotos são equivalentes após
normalização; nenhum índice, Storage Rule ou Hosting foi publicado.

## Estado do catálogo remoto após o deploy

O código `ARNALDO` existe e está elegível, mas a resposta real retornou:

```txt
iosPromotion: null
```

Consequentemente, a redemption snapshot não contém a autorização iOS e
`authorizePromoPurchase({ plan: "monthly" })` responde fail-closed com
`ios_promotion_unavailable`, sem criar `purchaseIntent`. Isso é comportamento
correto do código implantado, mas bloqueia a validação positiva da cadeia:

```txt
Promo SKU → purchase_pending → webhook APP_STORE → purchase_confirmed
```

O deploy não autoriza alterar o catálogo, portanto nenhum campo remoto foi
criado automaticamente. Antes de distribuir o cliente novo, a configuração
`iosPromotion` aprovada deve ser cadastrada por um canal administrativo
controlado e a validação backend-only positiva deve ser repetida.

Os secrets do webhook/API permanecem no Secret Manager e nenhum valor foi
registrado. A autoridade Premium continua exclusivamente em
`CustomerInfo.entitlements.active["premium"]`; o espelho Firestore, cupom,
intent e attribution não autorizam acesso.

## Resultado de conformidade

O App typecheck, as 1.038 provas do App, os gates i18n e `git diff --check`
não foram repetidos nesta fase **antes** do deploy. Eles estavam verdes na
Fase 10 e todos passaram novamente após o deploy, junto com 474 testes de
Functions, 63 testes de Rules e as matrizes focalizadas iOS (197) e Android
(93), mas o resultado posterior não reescreve a ordem operacional exigida.

Portanto, a Fase 11 fica **NÃO APROVADA**: o código backend está publicado e
operacional nas fronteiras exercitadas, porém o critério de gates pré-deploy
não foi integralmente satisfeito e o catálogo remoto ainda impede o smoke
positivo de purchase intent. Não foi feito redeploy sem necessidade apenas
para produzir uma nova execução.

Riscos operacionais restantes: o E2E RevenueCat/StoreKit real não foi
executado; o RevenueCat Dashboard não foi inspecionado ou alterado nesta fase;
e o CLI alertou que Node.js 20 não aceitará novos deploys após 2026-10-30 e que
`firebase-functions` está defasado. Essas correções pertencem a tarefas
separadas e não foram misturadas ao deploy promocional.

---

# 46. Migração Promo SKU + Introductory Offer — FASE 11B (catálogo remoto)

A Fase 11B configurou o único dado comercial que bloqueava a validação
backend-only. A API oficial do RevenueCat, consultada para o app iOS,
confirmou que a Offering `promo_7d` existe e contém exatamente:

```txt
$rc_monthly → ajfit_premium_monthly_promo
$rc_annual  → ajfit_premium_annual_promo
```

Não houve mutação no RevenueCat. O App Store Connect, Subscription Group e a
Introductory Offer não foram verificados diretamente porque não havia acesso
seguro não interativo disponível. Nenhum dado Apple foi criado por suposição;
a autoridade final sobre elegibilidade introdutória continua sendo a resposta
StoreKit/RevenueCat em runtime, com a política fail-closed da Fase 5.

O canal administrativo oficial identificado foi `adminUpdatePromoCode`. Como
essa callable não estava disponível remotamente e não existe UI de cupons no
painel administrativo local, todos os gates foram executados antes de um
deploy seletivo apenas dessa Function. A atualização de `ARNALDO` ocorreu pela
API allowlisted completa, preservando Android e os campos históricos:

```txt
iosPromotion = {
  offeringIdentifier: "promo_7d",
  monthlyProductId: "ajfit_premium_monthly_promo",
  annualProductId: "ajfit_premium_annual_promo"
}
```

O read-back remoto confirmou a configuração exata, sem escrita manual no
Firestore. O smoke backend autenticado comprovou:

```txt
validatePromoCode(IOS)
→ iosPromotion exata + snapshot sem Apple Offer Code
→ authorizePromoPurchase(monthly)
→ purchase_pending, TTL 600 s
→ retry idempotente, expiresAt inalterado
```

`lockedAt`, `trialStartedAt` e `convertedAt` permaneceram nulos/ausentes. Nem
o cupom, nem `iosPromotion`, nem a intent concederam Premium. Não houve
StoreKit, compra, webhook artificial ou cliente distribuído. A identidade e
os documentos QA descartáveis foram removidos.

Android foi validado separadamente: `storeConfig.android` continuou contendo
os pares mensal/anual originais, a resposta Android não recebeu
`iosPromotion`, e o app permanece baseado em `SubscriptionOption` +
`purchaseSubscriptionOption`. O webhook permaneceu `ACTIVE` com o HMAC já
vinculado e não recebeu novo deploy. A única autoridade client-side de Premium
continua `CustomerInfo.entitlements.active["premium"]`.

A etapa seguinte é exclusivamente o E2E iOS Sandbox real, que validará App,
RevenueCat SDK, StoreKit, Apple ID Sandbox, Intro Eligibility,
`purchasePackage`, CustomerInfo e webhook real no mesmo circuito.
