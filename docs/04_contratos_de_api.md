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

Estrutura (revisada em 2026-08-01). O documento
principal NÃO contém respostas de questionário; elas ficam na subcoleção
`questionnaires`.

```json
{
  "profile": {
    "name": "string",
    "email": "string",
    "birthDate": "timestamp (opcional)",
    "photoURL": "string (opcional)",
    "photoVersion": "timestamp (opcional)"
  },
  "preferences": {
    "language": "pt-BR",
    "units": "metric | imperial",
    "theme": "dark | light | system"
  },
  "subscription": {
    "status": "TRIAL | ACTIVE | CANCELED | BILLING_ISSUE | EXPIRED (opcional)",
    "provider": "REVENUECAT (opcional)",
    "trialEndsAt": "datetime (opcional)",
    "endsAt": "datetime (opcional)"
  },
  "metadata": {
    "role": "user | admin",
    "activeWorkoutId": "string (opcional)",
    "createdAt": "serverTimestamp",
    "updatedAt": "serverTimestamp"
  }
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
    "birthDate": "timestamp | null",
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

Migração `age` → `birthDate` (2026-07-30, ver 08_log_de_evolucao.md): novas
escritas gravam somente `birthDate`. Documentos anteriores à migração ainda
têm `age: number` no lugar de `birthDate` — são lidos normalmente (compat
somente leitura em `userProfile.ts`, `birthDateFromLegacyAge`), nunca
reescritos com `age`. A idade nunca é persistida diretamente: é sempre
recalculada a partir de `birthDate` via `computeAge` (`src/lib/ageCalculator.ts`).

Regras de criação:

- No cadastro é criado o primeiro questionário com `version = 1`.
- Reavaliações/novos questionários criam **novos** documentos (nunca
  sobrescrevem os anteriores) com `version` incremental.
- O "questionário atual" é o documento com `createdAt` mais recente.
- Documentos são imutáveis (sem update/delete pelo cliente).

## Propriedade dos campos

Client-owned no documento principal (gravados pelo app):

```txt
profile.name, profile.email, profile.birthDate, profile.photoURL, profile.photoVersion,
preferences.*, metadata.createdAt, metadata.updatedAt
```

- `metadata.role` só pode ser `"user"` no cadastro pelo cliente. Promoção a admin é
  exclusiva do backend e, depois de criado, nenhum cliente pode alterar o papel.
- `profile.name` e `profile.birthDate` são editáveis pelo próprio usuário.
- `profile.photoURL` e `profile.photoVersion` mudam juntas em uploads,
  substituições ou remoções; `photoVersion` usa o timestamp do servidor e nunca
  é alterada por outras atualizações do perfil.
- `birthDate` no documento principal representa o valor atual do perfil. A
  resposta equivalente em cada questionário permanece imutável como snapshot
  histórico; consumidores recorrem ao último questionário apenas como fallback
  para documentos anteriores à migração.
- `profile.photoURL` aponta para a foto persistida no Storage e pode ser removido.
- Documentos no formato plano anterior são convertidos integralmente, em uma
  transação única, no primeiro carregamento autenticado.

Client-owned na subcoleção (gravados pelo app, imutáveis após criação):

```txt
questionnaires/{id}: answers, version, createdAt
```

Backend-owned (RevenueCat / Cloud Functions — nunca escritos pelo app,
12_seguranca §3–§11):

```txt
metadata.activeWorkoutId, subscription.status, subscription.provider,
subscription.trialEndsAt, subscription.endsAt
```

## Criação do usuário (fluxo único)

O documento `users/{userId}` e o questionário inicial são criados **uma única
vez**, de forma atômica (batch), no fluxo de cadastro (`signUp`) ou no primeiro
login social (`ensureUserProvisioned`). O listener de autenticação apenas **lê**
o estado; nunca cria documentos. Documentos em `users` são sempre chaveados por
uid (`setDoc`) — nunca `addDoc`/auto-id.

## Autenticação e provedores

Métodos suportados (12_seguranca §5): **e-mail/senha, Google, Apple**.

### Verificação de e-mail para contas com senha

Contas que possuam o provider Firebase `password` precisam ter
`User.emailVerified === true` antes de acessar o fluxo principal. A fonte de
verdade é exclusivamente o usuário retornado pelo Firebase Authentication;
nenhum campo equivalente é gravado no Firestore ou na persistência local.

Fluxo de cadastro por e-mail/senha:

1. `createUserWithEmailAndPassword` cria o usuário;
2. `sendEmailVerification(user)` é iniciado uma única vez automaticamente;
3. o provisionamento normal de perfil/questionário é preservado;
4. o guard central mantém o usuário em `EmailVerificationScreen` enquanto
   houver provider `password` e `emailVerified === false`;
5. a ação de confirmação executa `user.reload()` e relê
   `auth.currentUser.emailVerified` antes de liberar o fluxo;
6. reenvios posteriores usam `sendEmailVerification` somente após ação
   explícita, com bloqueio de submissão simultânea e tratamento de rate limit.

Google e Apple não são marcados localmente como verificados. Contas sem o
provider `password` não entram nesse bloqueio; contas vinculadas que incluam
`password` seguem o valor real de `emailVerified` retornado/atualizado pelo
Firebase após o linking.

### TOTP — enrollment e gerenciamento

O Firebase Authentication é também a única fonte de verdade para o status do
segundo fator TOTP. A aplicação relê `multiFactor(user).enrolledFactors` e
considera somente fatores cujo `factorId` seja
`TotpMultiFactorGenerator.FACTOR_ID`. Não existe flag de MFA no Firestore ou
na persistência local.

O contrato de enrollment começa com uma reautenticação escolhida entre todos
os providers vinculados, sem assumir a posição de `providerData`:

- `password`: `EmailAuthProvider.credential` com a senha atual;
- `google.com`: nova credencial obtida pelo Google Sign-In nativo;
- `apple.com`: novo raw nonce aleatório, SHA-256 enviado ao Apple Sign-In e
  raw nonce usado exclusivamente na criação da credencial Firebase.

Em todos os casos a credencial é aplicada com
`reauthenticateWithCredential(currentUser, credential)`, nunca com
`signInWithCredential` ou `linkWithCredential`. O UID original é conferido
antes e depois da reautenticação. Depois disso, o fluxo único:

1. exige `User.emailVerified === true` e ausência de TOTP já cadastrado;
2. obtém `multiFactor(user).getSession()` e gera `TotpSecret`;
3. gera a URI oficial com `TotpSecret.generateQrCodeUrl()`;
4. mantém segredo, URI e OTP exclusivamente em memória durante o fluxo;
5. cria `assertionForEnrollment` e executa `multiFactor(user).enroll()`;
6. elimina o segredo da tela e relê `enrolledFactors`.

O unenrollment sempre opera sobre o UID explicitamente selecionado, após
confirmação e reautenticação. Se o Firebase exigir o TOTP durante a própria
reautenticação, a operação resolve o `MultiFactorResolver` antes de chamar
`unenroll`. Contas Google-only e Apple-only usam o respectivo provider como
primeiro fator dessa reautenticação; cancelamento, erro ou UID divergente
interrompem a operação sem alterar fatores. Contas com múltiplos providers
recebem todas as opções vinculadas, ordenadas como senha, Google e Apple.

Credenciais Google/Apple, id tokens, raw nonce, senha e sessão MFA não são
persistidos. Cada ação sensível exige uma nova reautenticação em memória.

O challenge TOTP de login é parte interna do fluxo de autenticação para todos
os primeiros fatores suportados:

1. e-mail/senha ou `signInWithCredential` (Google/Apple) valida o primeiro
   fator;
2. `auth/multi-factor-auth-required` é preservado sem normalização;
3. `getMultiFactorResolver` captura a transação e filtra todos os hints TOTP;
4. resolver, hints internos e OTP permanecem somente em memória;
5. o usuário escolhe explicitamente o fator quando houver mais de um e informa
   o código de seis dígitos;
6. `TotpMultiFactorGenerator.assertionForSignIn` + `resolver.resolveSignIn`
   concluem a mesma tentativa, sem reabrir Google ou Apple;
7. `onAuthStateChanged` publica o `User`, e o `AuthContext` carrega perfil e
   questionário antes de o guard central decidir o destino.

Código incorreto preserva o resolver para retry. Cancelamento, unmount ou
sessão inválida eliminam resolver e OTP. Não existe rota MFA persistente no
funil: usuário existente com questionário volta ao Dashboard após o segundo
fator, nunca ao Quiz. Na versão instalada do SDK, o erro backend
`SESSION_EXPIRED` é exposto como `auth/code-expired`; não existe código público
`auth/session-expired`.

Implementação (Firebase JS SDK, apps nativos iOS/Android via dev/EAS build):

- Google: `@react-native-google-signin/google-signin` → `idToken` →
  `GoogleAuthProvider.credential` → `signInWithCredential`.
- Apple: `expo-apple-authentication` (+ nonce SHA-256 via `expo-crypto`) →
  `OAuthProvider('apple.com')` → `signInWithCredential`.

Para enrollment/unenrollment, as mesmas aquisições geram credenciais novas,
mas o consumidor obrigatório é `reauthenticateWithCredential`; elas nunca
entram nos contratos de login, provisionamento ou account linking.

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

Se a autenticação do método existente exigir MFA, a credencial de linking e o
resolver ficam apenas em memória. Após `resolveSignIn`, o app executa
`linkWithCredential` no usuário retornado, preservando o mesmo UID.

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
  "subscription": { "status": "ACTIVE" }
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

## Foto de perfil

```txt
users/{userId}/profile/avatar
```

- leitura, criação, substituição e exclusão: somente o próprio usuário;
- tamanho máximo: 5 MB;
- tipos aceitos: `image/*`;
- a URL atual fica em `users/{userId}.profile.photoURL`;
- a identidade imutável do cache usa `users/{userId}.profile.photoVersion`;
- o app recorta, comprime e valida antes do upload;
- PNG permanece PNG para preservar transparência quando possível;
- a remoção exclui fisicamente o objeto antes de apagar a referência;
- a URL exibida é versionada por `metadata.updatedAt` e o objeto exige
  revalidação HTTP, evitando avatares antigos em cache.

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
