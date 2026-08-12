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

**Próxima fase (iOS-3, não iniciada):** decidir e implementar o mecanismo
Apple real (Offer Codes/Promotional Offers), habilitar a UI do cupom no
iOS, obter evidência de payload real de um evento RevenueCat de uma
transação com Apple Offer Code, e só então implementar
`correlateAppleOffer` de fato — nunca antes dessa evidência existir.

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
