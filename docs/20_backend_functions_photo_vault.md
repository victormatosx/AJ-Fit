# Backend Functions — Fundação do Photo Vault

## 1. Status atual

**Fase 3 (Preparação segura da infraestrutura) concluída.**

O que existe hoje: um backend Firebase Functions v2 real, buildável, testado, com um
único endpoint de health check (`backendHealth`) e a base de código (Admin SDK,
logger, guard de autenticação) sobre a qual as próximas fases do Photo Vault serão
construídas.

**O que NÃO existe ainda** (propositalmente, fora do escopo desta fase):

* Cloud KMS — nenhum KeyRing/CryptoKey/KEK foi criado.
* Vault Key (DEK) — não há geração, wrap ou unwrap de chave.
* `createVault` / `recoverVaultKey` — não implementadas.
* Criptografia de fotos (client-side ou server-side).
* Qualquer alteração em `firestore.rules`/`storage.rules` para o Vault.
* Firebase App Check.
* Qualquer alteração no app mobile.

Essas peças são objeto de fases futuras, descritas na seção 8.

---

## 2. Histórico — por que este documento existe

Uma auditoria anterior (não documentada como arquivo, registrada em conversa)
encontrou `functions/lib` no repositório contendo JavaScript **compilado e órfão**:
código de uma feature de billing (RevenueCat) desenvolvida em branches remotas
separadas (`origin/revenuecat-em-andamento`,
`origin/feature/subscription-persistence-revalidation`), commitado por engano no
commit `12991ba` ("logica de mudar senha" — mensagem sem relação com o conteúdo).
Não havia `functions/src`, nem `functions/package.json`, nem seção `functions` em
`firebase.json`. O código também era incompatível com o schema atual de
`firestore.rules` (`subscriptionValid()`).

Esse código foi removido (`git rm -r functions/lib`) e substituído pela estrutura
descrita abaixo. Nenhuma lógica de negócio do RevenueCat foi portada — se a
integração de billing for retomada no futuro, ela deve ser reconstruída como um
módulo próprio (`functions/src/billing/...`), consultando a branch remota citada
acima apenas como referência de requisitos, não como fonte de código a copiar.

---

## 3. Stack

* Firebase Functions **v2** (`firebase-functions ^5.1.1`)
* `firebase-admin ^12.7.0`
* Node **20** (`engines.node` em `functions/package.json`)
* TypeScript `~5.6.3`, `strict: true`
* Vitest (mesmo test runner do projeto mobile) para os testes do backend

---

## 4. Estrutura

```
functions/
  src/
    index.ts                    # único ponto de export das Cloud Functions
    lib/
      firebaseAdmin.ts           # singleton do Admin SDK (ADC, sem credencial)
      logger.ts                  # logging estruturado (política de "nunca logar" abaixo)
      auth.ts                    # requireAuth() — guard reutilizável para futuras callables autenticadas
    health/
      backendHealth.ts           # única function hoje: health check público
    __tests__/
      backendHealth.test.ts
      auth.test.ts
      foundationStructure.test.ts # testes estruturais que travam as regras de segurança desta fase
  package.json
  tsconfig.json
  vitest.config.mts
  .gitignore                     # lib/ (build output) nunca é commitado, só src/
```

Módulos futuros (Photo Vault) devem seguir o mesmo padrão de pasta por
responsabilidade — por exemplo `functions/src/photoVault/createVault.ts` — e serem
exportados a partir de `src/index.ts`, sem precisar reorganizar o que já existe.

---

## 5. Firebase Admin — por que não há credencial no repositório

`functions/src/lib/firebaseAdmin.ts` chama `initializeApp()` **sem argumentos**.
Cloud Functions roda em um ambiente gerenciado pela Google que já fornece
Application Default Credentials (ADC) automaticamente. Isso significa:

* Nenhum arquivo de service account JSON deve ser adicionado ao repositório, em
  nenhuma fase futura (inclusive KMS).
* Nenhuma variável de ambiente com credencial privilegiada deve ser lida do
  `.env` do backend.
* O teste `foundationStructure.test.ts` trava essa regra automaticamente
  (verifica ausência de `"type": "service_account"`, `private_key`,
  `credential.cert`, `serviceAccount`, `GOOGLE_APPLICATION_CREDENTIALS` no código).

---

## 6. `backendHealth`

Callable function v2, pública (sem autenticação — propositalmente, seu único
objetivo é provar que o deploy/runtime funcionam, não validar autenticação).
Retorna exclusivamente:

```json
{ "ok": true, "backendVersion": "0.1.0", "serverTime": "2026-08-11T..." }
```

Nunca retorna project ID, variáveis de ambiente, informações de service account,
secrets, tokens, headers ou detalhes de IAM — coberto por teste.

---

## 7. Ambientes Firebase

### Produção

Projeto: **`ajfit-2f321`** — único projeto Firebase existente hoje, identificado em
`.firebaserc` sob o alias `production`:

```json
{
  "projects": {
    "production": "ajfit-2f321"
  }
}
```

Não existe alias `default`, **de propósito**: qualquer comando `firebase` rodado
sem `--project`/`-P` explícito falha em vez de assumir produção implicitamente.
Scripts em `functions/package.json` sempre passam `--project` explicitamente:

```json
"deploy:production": "npm run build && firebase deploy --only functions --project production",
"deploy:staging": "npm run build && firebase deploy --only functions --project staging"
```

`deploy:staging` **falhará hoje** ("Unknown project alias staging") até que o
projeto de staging seja criado e adicionado ao `.firebaserc` — isso é intencional,
não um bug. Veja a seção 8 do checklist de staging pré-existente
(`docs/16_checklist_staging_avaliacao_fisica.md`) e a ação manual abaixo.

### Staging

**Ainda não existe.** Nenhum project ID foi inventado nem associado como staging —
fazer isso exige as seguintes ações manuais no Firebase/GCP Console (fora do
alcance de qualquer agente, exige acesso administrativo):

1. Criar um novo projeto no [Firebase Console](https://console.firebase.google.com)
   (ex.: `ajfit-2f321-staging`, ou outro nome à escolha do responsável) —
   **não** reaproveitar `ajfit-2f321`.
2. Habilitar Firestore no modo nativo (mesma região do projeto de produção, para
   evitar divergência de latência/comportamento).
3. Habilitar Firebase Storage e criar o bucket padrão.
4. Habilitar Firebase Authentication com os mesmos providers de produção
   (email/senha, Google, Apple) — Apple exige configurar o Service ID/Key
   separadamente para o novo bundle ID de staging, se houver um app iOS de
   staging.
5. Registrar apps Android (`com.ajfit.mobile` ou um `applicationId` de staging
   dedicado) e iOS (`com.ajfit.app` ou um bundle ID de staging dedicado) — gerar
   novos `google-services.json`/`GoogleService-Info.plist` para staging (nunca
   reaproveitar os de produção).
6. Definir as permissões IAM mínimas do responsável/CI que fará deploy de
   staging (papel `Firebase Admin` ou papéis granulares equivalentes) — não
   reaproveitar credenciais de produção.
7. Depois de criado, adicionar o alias ao `.firebaserc` na raiz do repositório:
   ```json
   {
     "projects": {
       "production": "ajfit-2f321",
       "staging": "<project-id-do-staging>"
     }
   }
   ```
8. Só a partir daí `npm run deploy:staging` (em `functions/`) passa a funcionar.

Até que isso seja feito, qualquer teste de integração real do Photo Vault
(especialmente KMS/unwrap) só pode ser validado contra o emulador local
(`npm run serve`) — nunca contra `ajfit-2f321`.

---

## 8. Como desenvolver localmente

```bash
cd functions
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> functions/lib (nunca commitado)
npm run test         # vitest run
npm run serve        # build + firebase emulators:start --only functions
```

`npm install` local pode emitir um aviso `EBADENGINE` se sua máquina não estiver
no Node 20 exato (o runtime de deploy real usa Node 20, conforme `engines`, mas o
`tsc`/`vitest` locais funcionam em versões próximas sem problema).

---

## 9. Política de logging (vale para todas as fases futuras)

`functions/src/lib/logger.ts` centraliza todo log (nunca usar `console.*`
diretamente). Nunca logar, em nenhuma function futura:

* Firebase ID Token / header `Authorization`
* Vault Key (wrapped ou em claro), ciphertext/plaintext de KMS
* conteúdo integral de foto
* Signed URLs privadas
* secrets ou credenciais de serviço

Um `uid` isolado é aceitável (logs de Cloud Functions são operacionais, não
expostos ao usuário) — ver `docs/12_seguranca_geral_do_app.md`.

---

## 10. Próxima fase recomendada

Com esta fundação pronta, a próxima fase é a **modelagem Firestore/Storage +
Rules do Photo Vault** (schema de `users/{uid}/privateSecurity/photoVault` e/ou
`users/{uid}/progressPhotos/{photoId}`, path de Storage
`users/{uid}/progressPhotos/{photoId}.enc`, e as regras correspondentes) — só
depois disso faz sentido iniciar a fase de Cloud KMS e as functions
`createVault`/`recoverVaultKey` propriamente ditas.
