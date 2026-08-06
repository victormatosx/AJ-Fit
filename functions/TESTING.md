# Estratégia de testes locais — Webhook RevenueCat (Sprint 4, atualizado na 4.1)

Sem testes de integração reais com o RevenueCat — nada aqui chama a API do
RevenueCat. Dois níveis.

## 1. Testes unitários (rodam agora, sem dependências externas)

```
cd functions
npm test
```

Cobrem as partes 100% puras (sem Firestore/Admin SDK):

- `src/billing/__tests__/normalizeSubscription.test.ts` — normalização para
  `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION` (caso voluntário, durante
  trial, e caso de reembolso — o antigo "REFUND"), `EXPIRATION`,
  `BILLING_ISSUE`, `PRODUCT_CHANGE` (com e sem `new_product_id`). Valida
  especificamente: `entitlementActive` derivado corretamente (inclusive
  período de carência do `BILLING_ISSUE`, e **nunca** inferido `true` quando
  `entitlement_ids` vem ausente/vazio — Sprint 4.1), `startedAt` nunca
  reescrito fora de `INITIAL_PURCHASE`, `canceledAt` limpo em
  `INITIAL_PURCHASE`/`RENEWAL`, `updatedAt`/`lastEventId`/`lastEventTimestampMs`
  nunca presentes na saída (Sprint 4.1 — são responsabilidade exclusiva do
  escritor, não da normalização). Também cobre `extractEventTimestampMs`:
  ausente, inválido (negativo, zero, não-inteiro).
- `src/billing/__tests__/validateSubscriptionPayload.test.ts` — aceita a
  saída real de `normalizeSubscription`; rejeita campo desconhecido, `status`
  inválido, tipo errado em campo Timestamp, e `updatedAt`/`lastEventId`/
  `lastEventTimestampMs` fornecidos pelo chamador (todos três são
  exclusivos do escritor).
- `src/billing/__tests__/webhookSignature.test.ts` — assinatura HMAC válida,
  segredo errado, corpo adulterado, timestamp expirado (> 5 min), header
  ausente/malformado, segredo vazio.
- `src/billing/__tests__/decideSubscriptionEventOutcome.test.ts` (**novo na
  Sprint 4.1**) — a função pura de decisão por trás de
  `applySubscriptionEventAtomically`: CASE A (duplicado), CASE B (evento
  antigo → stale), CASE C (evento novo → processed), CASE D (mesmo
  timestamp, id diferente → conflict), CASE E (documento sem
  `lastEventTimestampMs` ainda → processed, sem exigir backfill). Também
  cobre os cenários de negócio explícitos da auditoria: `RENEWAL` aplicado
  depois de `CANCELLATION` (deve processar), `CANCELLATION`/`PRODUCT_CHANGE`
  antigos chegando depois de um evento mais novo (devem ser `stale`, nunca
  sobrescrever).

Payloads de exemplo (fixtures) em `src/billing/__tests__/fixtures.ts`, com
nomes de campo idênticos aos da documentação oficial do RevenueCat
(`revenuecat.com/docs/integrations/webhooks/event-types-and-fields`).

### Limitação explícita: o que os testes unitários NÃO provam

`decideSubscriptionEventOutcome.test.ts` testa a **lógica de decisão** em
isolamento — puros valores de entrada/saída, sem Firestore. Ele **não**
prova que duas requisições genuinamente concorrentes contra um Firestore
real não podem observar o mesmo estado "antes" simultaneamente. Essa
garantia vem inteiramente do próprio Firestore serializando transações
conflitantes (`db.runTransaction` em `applySubscriptionEventAtomically`),
o que só um Firestore real (ou emulado) pode validar de fato.

Este ambiente de implementação **não tem Java 21**, exigido pela versão
atual do `firebase-tools` para rodar o Firestore Emulator — por isso a
atomicidade transacional sob concorrência real **não foi validada em
execução** nesta Sprint, apenas via inspeção de código e testes da lógica
pura de decisão. Não afirmar "concorrência validada" com base apenas nos
testes unitários — o roteiro abaixo existe exatamente para fechar essa
lacuna quando o Emulator estiver disponível.

## 2. Testes manuais com o Firebase Emulator (Firestore + Functions)

Cobre o que os testes unitários não alcançam: atomicidade real da transação,
concorrência genuína, retries simultâneos, escrita real em
`users/{uid}.subscription`, e usuário inexistente.

### Como rodar

```bash
cd functions
npm run build
firebase emulators:start --only functions,firestore --project demo-ajfit
```

Antes de disparar eventos, crie um usuário de teste no emulador do Firestore
(`users/{uid}` com `profile`/`preferences`/`subscription: {}`/`metadata`,
igual ao que `provisionNewUser` cria em produção).

Para simular o RevenueCat, é preciso assinar o payload manualmente (mesmo
algoritmo de `isValidWebhookSignature`):

```bash
SECRET="qualquer-valor-para-o-emulador"
sign_and_send() {
  local BODY="$1"
  local TS=$(date +%s)
  local SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
  curl -s -X POST "http://localhost:5001/<project-id>/us-central1/revenueCatWebhook" \
    -H "Content-Type: application/json" \
    -H "X-RevenueCat-Webhook-Signature: t=$TS,v1=$SIG" \
    -d "$BODY"
}
```

(No emulador, `REVENUECAT_WEBHOOK_SECRET.value()` precisa resolver para o
mesmo valor de `$SECRET` — configure via `.secret.local` do emulador, ver
docs do Firebase sobre `firebase-functions/params` em modo emulador.)

### Casos básicos

| Caso | Como simular | Esperado |
|---|---|---|
| Evento novo, usuário existente | payload válido, uid existente, `event_timestamp_ms` maior que o já salvo | 200 `{status:"processed"}`, `subscription` atualizado, `lastEventId`/`lastEventTimestampMs` = do evento |
| Evento duplicado | reenviar exatamente o mesmo payload duas vezes | 1ª: `processed`, escreve. 2ª: 200 `{status:"duplicate"}`, **nenhuma escrita** (checar `updatedAt` não muda) |
| Usuário inexistente | `app_user_id` de um uid que não existe em `users/` | 200 `{status:"ignored", reason:"user_not_found"}`, nenhum documento criado |
| Payload inválido | remover `app_user_id` ou `type` do body (mantendo assinatura válida sobre o novo corpo) | 400 `{error:"invalid_payload"}` |
| `event_timestamp_ms` ausente/inválido | remover o campo, ou usar `-5` | 400 `{error:"invalid_payload"}` |
| Assinatura inválida | assinar com secret errado, ou não enviar o header | 401 `{error:"invalid_signature"}`, nenhum log de "webhook event received" (nada é processado) |
| Evento reconhecido mas não suportado | `type: "UNCANCELLATION"` | 200 `{status:"ignored", reason:"unsupported_event_type"}` |

### Roteiro — eventos fora de ordem (`stale`)

1. Enviar um `RENEWAL` com `event_timestamp_ms = T` (mais alto). Esperado:
   `processed`, `subscription.status = "ACTIVE"`.
2. Enviar um `CANCELLATION` **diferente** (outro `id`) com
   `event_timestamp_ms = T - 86400000` (um dia antes). Esperado: 200
   `{status:"stale"}`, **nenhuma escrita** — `subscription.status` continua
   `"ACTIVE"`, não vira `"CANCELED"`.
3. Conferir o log `[billing:revenuecat] stale event ignored (older than last
   applied event)` com `uid`, `eventId`, `eventTimestampMs`,
   `currentEventId`, `currentEventTimestampMs`.

### Roteiro — conflito (`conflict`)

1. Enviar um evento A com `event_timestamp_ms = T`. Esperado: `processed`.
2. Enviar um evento B **diferente** (outro `id`, outro tipo) com o **mesmo**
   `event_timestamp_ms = T`. Esperado: 200 `{status:"conflict"}`, nenhuma
   escrita — o estado de A permanece intacto.
3. Conferir o log estruturado de erro `conflicting events share the same
   event_timestamp_ms` com ambos os `eventId`s e o timestamp.

### Roteiro — concorrência real (dois eventos diferentes, mesmo uid)

Requer duas requisições disparadas o mais simultaneamente possível — usar
`&` do shell para paralelizar:

```bash
sign_and_send "$BODY_RENEWAL" &
sign_and_send "$BODY_BILLING_ISSUE" &
wait
```

Esperado: **exatamente uma** das duas respostas reflete o evento com
`event_timestamp_ms` maior (`processed`); a outra, se seu timestamp for
menor, deve voltar `stale` — nunca as duas `processed` com o resultado final
dependendo só de qual terminou de escrever por último. Se ambas retornarem
`processed`, é um sinal de que a transação não está protegendo contra a
condição de corrida — investigar antes de prosseguir.

### Roteiro — retries simultâneos do mesmo evento

```bash
sign_and_send "$BODY_SAME_EVENT" &
sign_and_send "$BODY_SAME_EVENT" &
wait
```

Esperado: uma resposta `processed`, a outra `duplicate` — nunca as duas
`processed` (o que indicaria duas escritas lógicas para o mesmo evento).

### Verificação de logs

Sempre conferir no console do emulador (`firebase emulators:start`):
`[billing:revenuecat] webhook event received`, `event ignored: duplicate`,
`event ignored: stale`, `event ignored: conflict`, `event ignored: user does
not exist`, `subscription updated from webhook event` — mensagens
padronizadas conforme `src/lib/logger.ts`.
