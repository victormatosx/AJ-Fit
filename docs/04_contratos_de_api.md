# 2. Estratégia de integração

A versão inicial utiliza:

* Firebase Authentication
* Firestore
* Firebase Storage
* Cloud Functions
* RevenueCat

O aplicativo pode acessar Firestore diretamente quando permitido pelas regras de segurança.

Regras de negócio críticas devem ser executadas através de Cloud Functions.

O RevenueCat é a fonte oficial de informações relacionadas à assinatura.

---

# 5. Contrato do usuário

Documento:

```txt
users/{userId}
```

Campos mínimos:

```json
{
  "userId": "uuid",
  "email": "string",
  "activeWorkoutId": "string",
  "subscriptionStatus": "TRIAL",
  "subscriptionProvider": "REVENUECAT",
  "trialEndsAt": "datetime",
  "subscriptionEndsAt": "datetime",
  "createdAt": "datetime"
}
```

---

# 11. Integração RevenueCat

## Objetivo

Centralizar gerenciamento de:

* assinatura
* teste gratuito
* renovação
* cancelamento
* recuperação de compra
* mudança de plano

O aplicativo não deve validar assinaturas localmente.

O RevenueCat é a fonte oficial de verdade para assinaturas.

---

## Fluxo de ativação

Fluxo esperado:

1. usuário cria conta
2. usuário inicia teste gratuito
3. RevenueCat registra assinatura
4. webhook atualiza Firestore
5. acesso premium é liberado

---

## Status permitidos

```txt
TRIAL
ACTIVE
EXPIRED
CANCELED
GRACE_PERIOD
```

---

## Regra de prioridade

Em caso de divergência:

```txt
RevenueCat vence.
```

O Firestore deve refletir o estado informado pelo RevenueCat.

---

# 12. Cloud Function: Sincronizar assinatura

Função:

```txt
syncSubscriptionStatus
```

Objetivo:

Atualizar dados do usuário após eventos do RevenueCat.

Entrada:

```json
{
  "userId": "uuid"
}
```

Saída:

```json
{
  "subscriptionStatus": "ACTIVE"
}
```

---

# 13. Cloud Function: Selecionar treino inicial

Função:

```txt
selectInitialWorkout
```

Objetivo:

Selecionar o treino adequado após conclusão do questionário.

Entrada:

```json
{
  "userId": "uuid"
}
```

Saída:

```json
{
  "workoutId": "workout_001"
}
```

---

# 14. Cloud Function: Atualizar treino

Função:

```txt
generateWorkoutVariation
```

Objetivo:

Criar nova versão do treino através de:

* reordenação
* substituições válidas

Entrada:

```json
{
  "userId": "uuid"
}
```

Saída:

```json
{
  "newWorkoutId": "workout_002"
}
```

---

# 15. Cloud Function: Calcular percentual de gordura

Função:

```txt
calculateBodyFat
```

Objetivo:

Calcular percentual estimado através de dobras subcutâneas.

Entrada:

```json
{
  "userId": "uuid",
  "measurements": {}
}
```

Saída:

```json
{
  "bodyFat": 14.2
}
```

---

# 16. Webhook RevenueCat

Eventos mínimos esperados:

```txt
INITIAL_PURCHASE
RENEWAL
CANCELLATION
EXPIRATION
BILLING_ISSUE
```

Os webhooks devem atualizar automaticamente o documento do usuário no Firestore.

---

# 17. Firebase Storage

## Fotos de progresso

```txt
progress-photos/{userId}
```

---

## Vídeos de exercícios

```txt
exercise-videos/{exerciseId}
```

---

# 18. Controle de versão

Mudanças em contratos exigem:

* atualização deste documento
* registro no log de evolução
* validação humana

Alterações implícitas são proibidas.
