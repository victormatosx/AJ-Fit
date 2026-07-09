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

Estrutura (revisada em 2026-07-04b — ver 08_log_de_evolucao.md). O documento
principal NÃO contém respostas de questionário; elas ficam na subcoleção
`questionnaires`.

```json
{
  "userId": "string",
  "role": "user",
  "name": "string",
  "email": "string",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",

  "activeWorkoutId": "string",
  "subscriptionStatus": "TRIAL | ACTIVE | CANCELED | BILLING_ISSUE | EXPIRED",
  "subscriptionProvider": "REVENUECAT",
  "trialEndsAt": "datetime",
  "subscriptionEndsAt": "datetime"
}
```

## Subcoleção de questionários

Documento:

```txt
users/{userId}/questionnaires/{questionnaireId}
```

`questionnaireId` é um id gerado (auto id do Firestore ou UUID). O documento é
um snapshot imutável:

```json
{
  "answers": {
    "sex": "m | f | null",
    "age": "number",
    "height": "number",
    "weight": "number",
    "goal": "string | null",
    "frequency": "string | null",
    "level": "string | null",
    "limits": "string[]",
    "duration": "string | null",
    "days": "number",
    "place": "string | null",
    "equipment": "string[]",
    "style": "string[]"
  },
  "version": "number (>= 1)",
  "createdAt": "serverTimestamp"
}
```

Regras de criação:

- No cadastro é criado o primeiro questionário com `version = 1`.
- Reavaliações/novos questionários criam **novos** documentos (nunca
  sobrescrevem os anteriores) com `version` incremental.
- O "questionário atual" é o documento com `createdAt` mais recente.
- Documentos são imutáveis (sem update/delete pelo cliente).

## Propriedade dos campos

Client-owned no documento principal (gravados pelo app):

```txt
userId, role, name, email, createdAt, updatedAt
```

- `role` só pode ser `"user"` no cadastro pelo cliente. Promoção a admin é
  exclusiva do backend.
- `name` é editável pelo próprio usuário.

Client-owned na subcoleção (gravados pelo app, imutáveis após criação):

```txt
questionnaires/{id}: answers, version, createdAt
```

Backend-owned (RevenueCat / Cloud Functions — nunca escritos pelo app,
12_seguranca §3–§11):

```txt
activeWorkoutId, subscriptionStatus, subscriptionProvider,
trialEndsAt, subscriptionEndsAt
```

## Criação do usuário (fluxo único)

O documento `users/{userId}` e o questionário inicial são criados **uma única
vez**, de forma atômica (batch), no fluxo de cadastro (`signUp`) ou no primeiro
login social (`ensureUserProvisioned`). O listener de autenticação apenas **lê**
o estado; nunca cria documentos. Documentos em `users` são sempre chaveados por
uid (`setDoc`) — nunca `addDoc`/auto-id.

## Autenticação e provedores

Métodos suportados (12_seguranca §5): **e-mail/senha, Google, Apple**.

Implementação (Firebase JS SDK, apps nativos iOS/Android via dev/EAS build):

- Google: `@react-native-google-signin/google-signin` → `idToken` →
  `GoogleAuthProvider.credential` → `signInWithCredential`.
- Apple: `expo-apple-authentication` (+ nonce SHA-256 via `expo-crypto`) →
  `OAuthProvider('apple.com')` → `signInWithCredential`.

Provisionamento no primeiro login social:

- Se `users/{uid}` não existe → cria o documento principal.
- O primeiro questionário só é criado se houver respostas reais do onboarding
  (nunca questionário vazio).
- Se `users/{uid}` já existe → nunca recria/sobrescreve.

## Account Linking (mesmo UID)

Com "uma conta por e-mail" (padrão do Firebase), tentar entrar com um provedor
diferente para um e-mail já existente lança
`auth/account-exists-with-different-credential`. O fluxo de vinculação:

1. guarda a credencial pendente;
2. `fetchSignInMethodsForEmail(email)` → método existente;
3. reautentica com o método existente (senha ou outro provedor social) e
   `linkWithCredential(user, credencialPendente)`.

Resultado: **mesmo UID**, todos os dados preservados, provedor adicional
vinculado. Cobre todas as direções (Email↔Google↔Apple). Nunca cria usuário,
documento ou questionário duplicado.

Provedores vinculados vêm de `user.providerData` (Firebase Auth), expostos no
estado global como `linkedProviders`.

### Configuração necessária (Firebase Console / credenciais)

- Authentication → Sign-in method: habilitar **Google** e **Apple**.
- Manter "uma conta por e-mail" (account linking depende disso).
- A proteção contra enumeração de e-mail pode zerar
  `fetchSignInMethodsForEmail`; nesse caso a UI orienta o usuário de forma
  genérica.
- Apple: Apple Developer (Sign In with Apple), Service ID e credenciais no EAS.
- Google: OAuth client IDs (iOS/Web) já presentes em `GoogleService-Info.plist`
  e `google-services.json`.

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
