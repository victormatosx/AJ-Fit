# Backend Functions — Fundação do Photo Vault

## 1. Status atual

**Fases 3 a 11 concluídas** — o Photo Vault está funcionalmente completo e o
fluxo ponta a ponta já foi exercitado em aparelho. O hardening local da Fase 12
está implementado, mas ainda depende da matriz física iOS/Android, da prova
runtime de App Check e de autorização de deploy seletivo. O gate detalhado está
em `docs/21_photo_vault_pre_launch.md`.

O que existe hoje:

* um backend Firebase Functions v2 real, buildável, testado, com a base de código
  (Admin SDK, logger, guards de autenticação);
* o contrato de dados do Photo Vault: paths, schemas fechados, Security Rules do
  Firestore e do Storage, e testes provando o isolamento entre usuários
  (seções 11 a 15);
* a camada criptográfica de envelope: KEK no Cloud KMS, IAM mínimo, e
  `wrapVaultKey`/`unwrapVaultKey` internos (seções 16 a 18);
* as callables `createVault` e `recoverVaultKey`, com reautenticação recente
  obrigatória para a recuperação (seção 19);
* a integração mobile da Vault Key: cliente das callables, armazenamento no
  Keychain/Keystore namespaced por uid, e o fluxo reauth → recover (seção 21);
* o motor criptográfico das fotos: AES-256-GCM client-side, formato de arquivo
  versionado e pipeline de arquivos temporários (seção 22);
* o pipeline de nuvem: upload com rollback, listagem, download com validação de
  integridade e delete consistente (seção 23);
* a trava do cofre: autenticação local do SO, máquina de estados
  locked/authenticating/unlocked, lock em background e gate real nos services
  (seção 24);
* a UI completa: estado bloqueado, grid virtualizado, câmera e galeria, viewer
  em tela cheia e exclusão (seção 25);
* proteção visual scoped ao Vault, startup cleanup, App Check via módulo Expo
  local e reconciliação conservadora de órfãos (documento 21).

Functions publicadas pelo codebase: `backendHealth`, `createVault`,
`recoverVaultKey`, `cleanupPhotoVaultOrphans`. A última existe apenas no código
local até autorização de deploy seletivo.

**O que NÃO existe ainda** (propositalmente, fora do escopo destas fases):

* Rotação e destruição da Vault Key.
* Compartilhamento e edição de imagem.
* Enforcement App Check (integração local pronta, runtime/enforcement pendentes).
* Rate limiting por uid (ver seção 20).

As Rules e `createVault`/`recoverVaultKey` já haviam sido publicadas e o fluxo
real foi validado antes desta fase. **Esta fase não executou deploy nem alterou
recursos remotos.**

> **Deploy — atenção obrigatória:** este codebase não contém as Functions de
> billing/RevenueCat, desenvolvidas em paralelo em outra branch, mas
> `revenueCatWebhook` está **ativa em produção**. Um `firebase deploy --only
> functions` sem filtro tentaria removê-la. Deploy sempre **por nome**:
> `--only functions:createVault,functions:recoverVaultKey` (ou apenas
> `functions:cleanupPhotoVaultOrphans`, quando essa rotina for aprovada).

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

## 10. Modelo de dados — visão geral

Três artefatos, um por camada, sempre amarrados ao mesmo `uid` e `photoId`:

| Camada | Path | Conteúdo | Acesso do cliente |
|---|---|---|---|
| Storage | `users/{uid}/progressPhotos/{photoId}.enc` | ciphertext opaco da foto | dono: criar, ler, excluir |
| Storage | `users/{uid}/progressPhotos/{photoId}.thumb.enc` | ciphertext opaco da thumbnail | dono: criar, ler, excluir |
| Firestore | `users/{uid}/progressPhotos/{photoId}` | metadados da foto | dono: criar, ler, excluir |
| Firestore | `users/{uid}/privateSecurity/photoVault` | chave do vault embrulhada | **nenhum** (backend-only) |

Princípio: **a foto em claro nunca existe fora do dispositivo**. O Storage guarda
apenas ciphertext; o Firestore guarda apenas ponteiro e parâmetros; a chave que
liga os dois nunca é legível pelo app a partir do Firestore.

---

## 11. Firestore — `users/{uid}/privateSecurity/photoVault`

**Backend-only.** Guardará a Vault Key do usuário embrulhada (envelope
encryption) pela KEK do Cloud KMS.

```
{
  wrappedVaultKey: string,     // DEK cifrada pela KEK, base64
  encryptionVersion: int,      // versão do formato do documento
  vaultKeyVersion: int,        // versão da própria Vault Key (rotação)
  kmsKeyVersion: string,       // CryptoKeyVersion que fez o wrap
  algorithm: string,           // 'AES-256-GCM'
  createdAt: timestamp,
  updatedAt: timestamp
}
```

**Rules:** `allow read, write: if false;` — o cliente não cria, não atualiza, não
exclui e **não lê**. O app nunca precisa da chave embrulhada: ele recebe a Vault
Key já desembrulhada pela Function autenticada e a guarda localmente no
SecureStore. Negar a leitura remove a chave embrulhada da superfície de ataque do
app por completo. O Admin SDK continua acessando normalmente, pois ignora as
Security Rules.

**Consequência importante:** como o cliente é negado por completo e o Admin SDK
ignora as regras, o schema deste documento **não é validável em
`firestore.rules`** — uma função de validação ali seria código morto. O contrato
fechado e versionado vive em **`functions/src/photoVault/schema.ts`**
(`validatePhotoVault`/`assertValidPhotoVault`), que é onde ele será de fato
aplicado: toda escrita futura do backend deve passar por ele.

---

## 12. Firestore — `users/{uid}/progressPhotos/{photoId}`

Metadados da foto. **Nunca contém a imagem**, nem em claro nem cifrada.

```
{
  storagePath: string,         // 'users/{uid}/progressPhotos/{photoId}.enc'
  thumbnailStoragePath: string,// 'users/{uid}/progressPhotos/{photoId}.thumb.enc'
  createdAt: timestamp,        // == request.time (serverTimestamp obrigatório)
  takenAt: timestamp,          // <= request.time
  originalMimeType: string,    // image/jpeg|png|heic|heif|webp
  encryptedSize: int,          // > 0 e <= 10 MB
  thumbnailEncryptedSize: int, // > 0 e <= 512 KiB
  encryption: {
    version: int,              // >= 1
    algorithm: string,         // 'AES-256-GCM'
    iv: string,                // nonce base64, 16..32 chars
    vaultKeyVersion: int       // >= 1
  },
  thumbnailEncryption: {       // mesmo contrato, IV obrigatoriamente distinto
    version: int,
    algorithm: string,
    iv: string,
    vaultKeyVersion: int
  }
}
```

O schema legado sem os três campos `thumbnail*` continua aceito para fotos
anteriores à Fase 13. No schema novo, os três campos aparecem juntos; forma
parcial é inválida. Full e thumbnail usam a mesma Vault Key, mas nunca o mesmo
IV/nonce AES-GCM.

Schema fechado via `hasAll` + `hasOnly` (padrão do arquivo). Proibidos por
construção: `downloadURL`, signed URL, thumbnail em base64, chave, ou qualquer
campo não listado.

**`storagePath` é preso ao dono e ao documento** por igualdade exata de string:

```
d.storagePath == 'users/' + userId + '/progressPhotos/' + photoId + '.enc'
```

Igualdade (não regex) impede apontar o metadado para o arquivo de outro usuário
ou para outro `photoId`.

**Rules:** dono pode ler, criar e excluir. `allow update: if false` — o documento
é **imutável**; trocar uma foto significa excluir o par (documento + objeto) e
criar um novo `photoId`.

---

## 13. Storage — full e thumbnail criptografadas

Ciphertext opaco. `contentType` **deve** ser `application/octet-stream` — nunca
`image/*`, porque o Storage nunca vê uma imagem aqui.

Metadados customizados obrigatórios: `ownerId` (== uid do path) e `photoId` (o
nome do arquivo deve ser exatamente `{photoId}.enc`). Isso amarra path, metadata
e documento Firestore à mesma foto. **Nenhum segredo vai em metadata** — o IV
fica centralizado no Firestore.

**Imutabilidade (armadilha importante):** no Cloud Storage, objetos são imutáveis
e um upload sobre um caminho existente cria uma **nova geração**, avaliada como
`create` — não como `update`. Portanto `allow update: if false` **sozinho não
impede sobrescrita**. A regra exige `resource == null` no `create`, o que garante
que o caminho esteja vazio. Isso foi descoberto por um teste que falhou; sem ele,
a imutabilidade seria falsa.

A thumbnail usa o path exato `{photoId}.thumb.enc`, `assetKind=thumbnail`,
`application/octet-stream` e teto próprio de 512 KiB. A full nova usa
`assetKind=full`; uploads full legados com apenas `ownerId` + `photoId`
continuam aceitos durante o rollout. Nenhum path aceita `image/*`.

---

## 14. Limites adotados

| Path | Limite | Justificativa |
|---|---|---|
| `progressPhotos/*.enc` (Storage) | **10 MB** | Acima dos 8 MB dos anexos de suporte e dos 5 MB do avatar, porque fotos corporais têm resolução maior antes da compressão. Comporta uma foto de celular moderno em alta resolução sem compressão agressiva, e ainda limita abuso. AES-GCM acrescenta apenas ~28 bytes (nonce + tag) ao tamanho original. |
| `encryptedSize` (Firestore) | **10 MB** | Espelha o limite do Storage para que os dois não possam divergir. |
| `progressPhotos/*.thumb.enc` / `thumbnailEncryptedSize` | **512 KiB** | Derivação JPEG de 480 px/0,75; limite próprio impede uma miniatura de consumir megabytes. |

Decisão técnica registrada, não de produto: se o time definir compressão
client-side obrigatória (como já ocorre no avatar via `expo-image-manipulator`),
esse teto pode ser reduzido.

---

## 15. Testes de Rules

| Suíte | Arquivo | Cobertura |
|---|---|---|
| Firestore | `firestore-tests/photoVault.rules.test.ts` | dono, cross-user, não autenticado, imutabilidade, schema fechado, binding de `storagePath`, metadados de criptografia, e negação total de `privateSecurity` |
| Storage | `storage-tests/progressPhotos.rules.test.ts` | dono, cross-user, não autenticado, content type, limite de tamanho, binding de metadata, imutabilidade, confinamento de path, além de regressão dos paths pré-existentes (avatar e anexos de suporte) |

Comandos:

```bash
npm run test:rules             # Firestore + Storage (um único emulators:exec)
npm run test:rules:firestore   # só Firestore
npm run test:rules:storage     # só Storage
```

Os testes rodam **exclusivamente contra o Firebase Emulator Suite**, com o
project id descartável `ajfit-rules-test`. Nenhum dado é escrito em
`ajfit-2f321`.

---

## 16. Cloud KMS — arquitetura KEK/DEK

Envelope encryption em duas camadas:

```
Cloud KMS
  └── KEK (photo-vault-kek)        ← nunca sai do KMS
        wrap/unwrap
          └── Vault Key / DEK      ← 32 bytes, uma por usuário
                AES-256-GCM
                  └── fotos        ← cifradas no dispositivo
```

A **KEK não criptografa fotos.** Ela só protege a Vault Key de cada usuário. A
Vault Key é que cifra as fotos, e isso acontece no dispositivo.

### Recursos

| Item | Valor |
|---|---|
| Location | `us-central1` |
| KeyRing | `ajfit-photo-vault` |
| CryptoKey (KEK) | `photo-vault-kek` |
| Purpose | `encryption` (simétrica) |
| Algoritmo | `GOOGLE_SYMMETRIC_ENCRYPTION` |
| Rotação | 90 dias (automática) |

**Região:** `us-central1` foi escolhida por alinhamento — é onde a Cloud Function
já existente (`revenueCatWebhook`) roda. Manter KEK e workload na mesma região
evita salto entre regiões no caminho quente e reduz a superfície operacional.
Esses nomes **não são segredos**.

O KeyRing é exclusivo do Photo Vault: não é compartilhado com billing, Secret
Manager, nem qualquer outra feature.

### Política de rotação

Rotação automática a cada **90 dias**. Como funciona:

* o KMS cria uma nova **CryptoKeyVersion** e a torna a versão primária;
* toda nova operação de `encrypt` passa a usar a versão primária;
* versões antigas **permanecem ativas** e continuam podendo decifrar;
* `decrypt` não recebe versão — o KMS identifica sozinho qual versão produziu
  aquele ciphertext.

Consequência prática: `wrappedVaultKey` gravadas antes de uma rotação continuam
funcionando indefinidamente, sem migração. Não há rewrap em massa, e ele não é
necessário. O campo `kmsKeyVersion` do documento existe para auditoria e para
viabilizar um rewrap futuro, caso alguma versão precise ser desativada.

> **Irreversibilidade:** KeyRings e CryptoKeys do Cloud KMS **nunca podem ser
> excluídos** — apenas versões de chave podem ser destruídas. Os nomes acima são
> permanentes no projeto depois de criados.

### IAM — least privilege

| Identidade | Papel | Escopo |
|---|---|---|
| `753375043967-compute@developer.gserviceaccount.com` (runtime das Functions Gen 2) | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | **apenas a CryptoKey** `photo-vault-kek` |

Esse papel concede exatamente `encrypt` e `decrypt` — não permite ler o material
da chave, criar versões, destruir versões nem administrar o KMS. O binding é
aplicado **na CryptoKey**, não no KeyRing e não no projeto, de modo que nenhuma
outra chave é alcançada.

Identidade de deploy e identidade de runtime são distintas: o deploy é feito por
um humano autenticado no `gcloud`/`firebase`; o runtime usa a service account
acima. Nenhuma das duas usa arquivo de credencial.

### ADC — sem credencial estática

O `KeyManagementServiceClient` é instanciado sem argumentos e autentica por
Application Default Credentials, exatamente como o `firebase-admin`. Não existe
service account JSON no repositório, nenhuma variável aponta para arquivo de
chave, e nenhum material criptográfico está em `.env` ou no Secret Manager.

---

## 17. Camada de wrap/unwrap

`functions/src/photoVault/` :

| Arquivo | Responsabilidade |
|---|---|
| `kmsClient.ts` | Cliente KMS singleton, constantes do KeyRing/CryptoKey e construção do resource name |
| `vaultKeyCrypto.ts` | `wrapVaultKey` / `unwrapVaultKey` |
| `errors.ts` | Taxonomia de erros internos |
| `schema.ts` | Contrato do documento do vault (Fase 4) |

**Estas funções são internas.** Não são callable, não são HTTP, não recebem
`uid`, não tocam o Firestore e o app não as alcança. A Function autenticada da
Fase 6 será a única chamadora e é quem cuidará de autorização.

O nome do KeyRing/CryptoKey é **constante de backend**, nunca vem de input. Um
cliente capaz de influenciar o resource name poderia pedir ao backend que
decifrasse contra uma chave sob seu controle. O project id, por outro lado, vem
do ambiente gerenciado (`GCLOUD_PROJECT`), para que o mesmo código rode em um
futuro staging sem edição.

### Formato dos dados

| Momento | Formato |
|---|---|
| Vault Key em memória | `Uint8Array`/`Buffer` de **exatamente 32 bytes** (AES-256) |
| Input do `encrypt` | bytes crus — nunca string |
| `wrappedVaultKey` persistida | **base64** (string), como no schema da Fase 4 |
| Output do `unwrap` | `Buffer` de 32 bytes; o chamador deve zerá-lo após o uso |

A chave só vira string no ponto em que precisa ser persistida. Não há conversão
para formato "legível" em momento algum.

### Validação

`wrapVaultKey` rejeita: input que não seja bytes, e qualquer tamanho diferente de
32 — antes de chamar o KMS. Valida a resposta: ciphertext não vazio e produzido
pela chave esperada.

`unwrapVaultKey` rejeita: string vazia, não-string, acima do limite defensivo, e
base64 inválido (verificação por round-trip, que pega truncamento). Valida a
resposta: plaintext não vazio e com **exatamente 32 bytes** — qualquer outra
coisa falha alto em vez de devolver bytes não validados.

### Erros

`KMS_CONFIGURATION_ERROR`, `KMS_ENCRYPT_FAILED`, `KMS_DECRYPT_FAILED`,
`INVALID_VAULT_KEY`, `INVALID_WRAPPED_KEY`.

O erro original do Google Cloud é **deliberadamente descartado** — ele carrega
projeto, nome de chave e estado de IAM. A Function da Fase 6 deverá mapear esses
códigos para um `HttpsError` genérico, sem repassar detalhe interno ao cliente.

### O que nunca pode ser logado

Vault Key (em claro ou embrulhada), plaintext enviado ao KMS, plaintext
retornado, ciphertext integral, header `Authorization`, Firebase ID Token.
Os logs contêm apenas a operação (`vault key wrapped`/`unwrapped`) e o escopo.
Há teste automatizado que falha se qualquer material de chave aparecer em
`logger.info/warn/error`.

---

## 18. Setup do KMS

Script idempotente e versionado: **`scripts/setup-photo-vault-kms.sh`**

```bash
# 1. Dry run — imprime o plano, não cria nada
./scripts/setup-photo-vault-kms.sh --project ajfit-2f321

# 2. Executar (pede confirmação digitando o project id)
./scripts/setup-photo-vault-kms.sh --project ajfit-2f321 --apply
```

Proteções: `--project` é obrigatório (sem default, para que uma invocação
acidental não caia no que estiver no `gcloud config`); exige `--apply` explícito;
pede confirmação digitada; verifica billing antes de agir; e checa cada recurso
antes de criar, de modo que reexecutar é seguro. O script **só cria** — nunca
exclui, desabilita ou altera recursos existentes, e nunca concede IAM de projeto.

O script executa quatro passos: habilita `cloudkms.googleapis.com`, cria o
KeyRing, cria a CryptoKey com rotação de 90 dias, e aplica o binding de IAM na
CryptoKey.

### Verificação manual do round trip (opt-in)

Existe um teste de integração que exercita a KEK real, **pulado por padrão**:

```bash
cd functions
PHOTO_VAULT_KMS_INTEGRATION=1 GCLOUD_PROJECT=ajfit-2f321 \
  npx vitest run src/__tests__/kmsRoundTrip.integration.test.ts
```

Exige **`gcloud auth application-default login`** — as bibliotecas Google usam
ADC, que é diferente das credenciais do `gcloud` CLI (`gcloud auth login`). Ele
gera bytes aleatórios descartáveis, faz wrap e unwrap, compara, e zera os
buffers no `finally` — nunca persiste nem imprime chave alguma, e nunca usa a
chave de um usuário real.

Atenção: o binding de IAM foi concedido à **service account de runtime das
Functions**, não a contas humanas. Rodar esse teste localmente com ADC de uma
conta pessoal pode falhar com `PERMISSION_DENIED` se essa conta não tiver o
papel na chave — isso é o least privilege funcionando, não um defeito.

Alternativa que **não exige ADC** (usa as credenciais do `gcloud` CLI) para
confirmar rapidamente que a KEK está operacional:

```bash
openssl rand 32 > /tmp/p.bin
gcloud kms encrypt --location us-central1 --keyring ajfit-photo-vault \
  --key photo-vault-kek --project <PROJECT_ID> \
  --plaintext-file /tmp/p.bin --ciphertext-file /tmp/w.bin
gcloud kms decrypt --location us-central1 --keyring ajfit-photo-vault \
  --key photo-vault-kek --project <PROJECT_ID> \
  --ciphertext-file /tmp/w.bin --plaintext-file /tmp/r.bin
cmp /tmp/p.bin /tmp/r.bin && echo OK
rm -f /tmp/p.bin /tmp/w.bin /tmp/r.bin
```

---

## 19. Operações do vault (callables autenticadas)

Duas Callable Functions v2 — as **únicas** chamadoras de
`wrapVaultKey`/`unwrapVaultKey`. A camada KMS nunca ganha endpoint próprio: um
endpoint que cifrasse ou decifrasse bytes arbitrários transformaria a KEK em um
oráculo.

### `createVault`

```
usuário autenticado
  → requireAuth  (uid vem do token verificado)
  → randomBytes(32)                      ← CSPRNG do Node
  → wrapVaultKey(vaultKey)               ← KMS; devolve wrapped + kmsKeyVersion
  → assertValidPhotoVault(documento)
  → create() em users/{uid}/privateSecurity/photoVault
  → retorna { vaultKey, vaultKeyVersion } ao cliente
  → zera o buffer da chave (best effort)
```

**Não exige reautenticação recente.** A criação acontece dentro de uma sessão
autenticada válida e não expõe nenhum segredo pré-existente — a chave está sendo
criada naquele instante. Exigir reauth aqui adicionaria atrito sem ganho.

**Idempotente por recusa:** se o usuário já tem vault, retorna `already-exists`
e **não** gera nova chave, não sobrescreve, não rotaciona. Criar uma segunda
chave silenciosamente órfãozaria permanentemente todas as fotos cifradas com a
primeira.

**Atomicidade:** usa `DocumentReference.create()`, que carrega uma pré-condição
server-side de "não pode existir". Duas chamadas concorrentes nunca criam duas
chaves: uma vence, a outra recebe `already-exists`. Uma transação faria um ciclo
read-modify-write sem fortalecer a garantia, e correria risco de reexecutar em
retry. **Nunca last-write-wins para material criptográfico.**

### `recoverVaultKey`

```
usuário autenticado
  → requireRecentAuth  (uid + frescor, ambos do token verificado)
  → readVaultDocument(uid)               ← null ⇒ not-found
  → validatePhotoVault(documento)        ← inválido ⇒ data-loss
  → unwrapVaultKey(wrappedVaultKey)      ← KMS; valida 32 bytes
  → retorna { vaultKey, vaultKeyVersion }
  → zera o buffer (best effort)
```

**Nunca cria vault.** Um usuário sem vault recebe `not-found`; criação é
operação separada e explícita.

### Reautenticação recente (obrigatória na V1)

| Item | Valor |
|---|---|
| Claim | `auth_time` do ID Token **verificado pelo Firebase** |
| Janela | **5 minutos** (`RECENT_AUTH_MAX_AGE_SECONDS`) |
| Tolerância de clock skew | 60s no futuro |
| Ausente/`NaN`/`Infinity`/futuro anômalo | **falha fechado** |

Um ID Token válido porém antigo **não** basta: um aparelho roubado com sessão
viva não pode extrair a chave sem reprovar a credencial da conta. O `auth_time`
vem exclusivamente do token verificado — qualquer `auth_time`, `reauthenticated`
ou timestamp no corpo da requisição é ignorado (testado).

Isso **não é biometria**. Reautenticação aqui significa reprovar a credencial
Firebase (senha, Google ou Apple). A Function não conhece nem quer conhecer a
senha; ela só lê o frescor do token. Como o mobile obtém esse frescor é assunto
de fase posterior.

### Autorização e isolamento

O caminho é derivado exclusivamente de `request.auth.uid`:

```
users/{request.auth.uid}/privateSecurity/photoVault
```

Nunca de `uid`, `userId`, `email`, `path` ou `documentPath` vindos do corpo.
Mesmo que o cliente envie `{ uid: "OUTRO_UID" }`, o backend acessa apenas o
próprio vault — há teste explícito para cada uma dessas formas, nas duas
callables. Um teste estrutural também falha se `request.data` for lido nesses
arquivos.

### Erros públicos

| Situação | `HttpsError` |
|---|---|
| Sem autenticação | `unauthenticated` |
| Token não recente / `auth_time` ausente ou anômalo | `failed-precondition` |
| Vault já existe (create) | `already-exists` |
| Vault inexistente (recover) | `not-found` |
| Documento armazenado inválido | `data-loss` |
| Falha de KMS ou Firestore | `internal` |

Nunca retornam: erro cru do KMS, `PERMISSION_DENIED`, resource name, stack
trace, ciphertext, `wrappedVaultKey` ou detalhe de IAM. Testado que
`photo-vault-kek`, `ajfit-2f321` e `PERMISSION_DENIED` não aparecem nas
mensagens devolvidas.

### Respostas

Ambas devolvem exatamente dois campos:

```json
{ "vaultKey": "<base64>", "vaultKeyVersion": 1 }
```

A Vault Key trafega em claro nessa resposta autenticada sobre TLS — é o
propósito da operação. Nunca são devolvidos `wrappedVaultKey`, nome de recurso
KMS, metadata interna ou token.

### Zeroização — limitação honesta do runtime

Os buffers são sobrescritos com `fill(0)` em `finally`, mas **Node/V8 não
garante zeroização**: o GC pode ter copiado os bytes, e strings base64 são
imutáveis e permanecem na heap até serem coletadas. Mitigamos o que dá
(`Buffer`/`Uint8Array`, mínimo de cópias, uma única conversão para string) e
registramos a limitação em vez de prometer o que o runtime não entrega.

### Hardening ainda não enforced

* **App Check** — bridge nativo + `CustomProvider` JS implementados localmente,
  sem enforcement. O contrato ainda precisa passar em iPhone/Android reais e
  nos produtos Functions/Firestore/Storage; ver documento 21.
* **Rate limiting** — não implementado. Ver seção 20.

---

## 20. Risco conhecido: ausência de rate limiting

`recoverVaultKey` não tem limite de chamadas. Mitigações que já existem, sem
infraestrutura adicional:

* exige autenticação **e** reautenticação nos últimos 5 minutos, o que limita
  bastante a janela de abuso de um token roubado;
* devolve sempre a mesma chave do próprio usuário — não é um oráculo que revele
  informação nova a cada chamada;
* o Cloud Run por trás das Functions v2 tem limites de concorrência e escala que
  contêm abuso grosseiro.

**Não foi implementado rate limiting por usuário** para não introduzir um banco
ou contador só para isso. Registrado como hardening futuro; o caminho natural é
App Check primeiro (barra clientes que não são o app real), e só então um
contador se houver evidência de necessidade.

---

## 21. Integração mobile (Fase 7)

### Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/firebaseFunctions.ts` | Cliente Callable, região **fixada** em `us-central1` |
| `src/lib/photoVaultKeyStorage.ts` | Chave no Keychain/Keystore, namespaced por uid |
| `src/lib/photoVaultErrors.ts` | `PhotoVaultError` + `PhotoVaultIssue` |
| `src/services/photoVault.ts` | `ensure`/`create`/`recover`, validação de resposta |
| `src/services/photoVaultRecovery.ts` | Composição reauth → recover |

A UI **nunca** chama `httpsCallable` diretamente, e nenhum componente recebe a
chave como prop.

### Região

`us-central1`, explicitamente. Confiar no default do SDK produziria `not-found`
em runtime se esse default mudasse — um erro de configuração silencioso.

### Armazenamento local

`expo-secure-store`, em arquivo separado do `secureAuthStorage`. São segredos
com ciclos de vida diferentes: a sessão Firebase rotaciona a todo momento e
morre no logout; a Vault Key é estável pela vida da conta e é recuperável do
backend. Compartilhar um blob tornaria a chave dano colateral de qualquer
problema de sessão.

Guarda apenas `{ uid, vaultKey, vaultKeyVersion }`. Nunca `wrappedVaultKey`,
token, URL ou foto.

**Formato:** a chave permanece como a string base64 que o backend devolve e o
Keychain armazena. Decodificar para bytes aqui e recodificar para guardar
adicionaria cópias da chave na memória em vez de removê-las — a decodificação
acontece no ponto de uso, na camada de criptografia (Fase 8). JavaScript não
garante zeroização de qualquer forma; a limitação está registrada, não
mascarada.

A validação de tamanho (32 bytes) é feita **sem decodificar**, calculando o
comprimento a partir da forma do base64 — `Buffer` e `atob` não são garantidos
no runtime do React Native.

### Namespace por uid

Chave de storage: `ajfit_photo_vault_key_v1_{uid}`. O uid faz parte da própria
chave do SecureStore, então outra conta **fisicamente não alcança** a entrada —
essa é a isolação primária. O `uid` também é gravado dentro do payload e
conferido na leitura, como defesa em profundidade, não como proteção única. Um
uid que não case com `[A-Za-z0-9._-]+` **falha fechado**, jamais recai em uma
chave compartilhada.

### Fluxo `ensurePhotoVaultKey()`

```
chave local válida?  → local-key-available   (não toca o backend)
        │ não
        ▼
createVault
   ├─ sucesso            → vault-created
   └─ already-exists
          ├─ auth recente (checagem conservadora, 4 min) → recoverVaultKey → recovered
          └─ auth antiga                                  → reauthentication-required
```

A janela do cliente (4 min) é **menor** que a do backend (5 min) de propósito:
preferimos pedir reautenticação a disparar uma chamada que o backend rejeitaria
na fronteira. O backend continua sendo a autoridade — se ele discordar, o
resultado vira `reauthentication-required` em vez de um retry.

**`already-exists` nunca gera segunda chave.** Não há limpeza do vault remoto,
não há retry com chave nova, não há chave inventada localmente. O único caminho
é reauth → recover.

Esta função **não abre UI**. Ela devolve `reauthentication-required` e a tela
decide como pedir a credencial.

### Reautenticação

`reauthenticateAndRecoverVaultKey(request)` reutiliza
`reauthenticateCurrentUser` — o caminho único de reautenticação do projeto, que
já cobre **senha, Google e Apple** com o tratamento de nonce/credencial
existente. Nenhum login paralelo foi criado, e a senha nunca é armazenada.

Depois do reauth, o token é **forçadamente atualizado** (`getIdToken(true)`):
sem isso o SDK poderia enviar o token anterior, cujo `auth_time` o backend
rejeitaria logo após uma reautenticação bem-sucedida.

### Ciclo de vida da chave local

| Evento | Comportamento |
|---|---|
| Login normal | chave do próprio usuário é preservada |
| **Logout** | chave local **removida** (`signOutUser`) |
| Troca de usuário | namespaces distintos; a chave anterior nunca é reutilizada |
| Reinstalação | ausência de chave é situação normal → caminho de recuperação |
| Entrada corrompida | descartada e tratada como ausente → recuperação |

O logout remove porque encerra a sessão explicitamente e a chave continua
recuperável do backend — manter um segredo em um aparelho cuja sessão o usuário
encerrou não compra nada. A remoção é best effort e **nunca bloqueia o logout**.

### Falhas do SecureStore

* **Falha ao salvar depois de `createVault`** → o vault remoto existe, mas a
  chave não chegou ao Keychain. Reporta `vaultStorageFailed` e **não cria outra
  chave**; o próximo fluxo verá `already-exists` e seguirá para recuperação.
* **Falha ao salvar depois de `recoverVaultKey`** → o vault remoto fica intacto,
  nada é apagado, e a recuperação pode ser repetida.
* **Dado local corrompido** → entrada removida, tratada como ausência.

### Erros

`vaultKeyNotAvailable`, `vaultAlreadyExists`, `vaultReauthRequired`,
`vaultRecoveryFailed`, `vaultCreateFailed`, `vaultStorageFailed`,
`vaultInvalidResponse`, `vaultLocalKeyCorrupted`.

Logs registram **apenas** o `issue` — nunca a chave, o payload da callable, a
resposta, a senha ou o token.

### Ainda ausente nesta fase

Criptografia AES das fotos, upload/download, galeria, **biometria**. A chave
está protegida pelo Keychain/Keystore, mas ainda **não** por
`requireAuthentication` — o gate biométrico é fase própria, e ligá-lo aqui
mudaria a semântica de desbloqueio antes da UI existir.

---

## 22. Criptografia das fotos (Fase 8)

### API escolhida

**`expo-crypto`** — já é dependência do projeto (`~56.0.4`) e expõe AES-GCM
nativo real: `AESEncryptionKey` (128/192/**256** bits), `aesEncryptAsync`,
`aesDecryptAsync`, `AESSealedData`. Nenhuma dependência nova foi adicionada e
**nenhum algoritmo foi implementado à mão**.

Restrição herdada do próprio projeto: `combined()` / `fromCombined()` e os
encodings base64 do `AESSealedData` **não fazem round-trip corretamente no
Android** (registrado em `src/lib/secureAuthStorage.ts`). Por isso as três
partes GCM são sempre manipuladas como bytes crus, via `fromParts`, e o
enquadramento binário é feito por nós.

### Algoritmo

`AES-256-GCM`. Nonce de **12 bytes** (96 bits — o tamanho para o qual o GCM é
especificado e o default do `expo-crypto`) e tag de **16 bytes** (128 bits — o
default, e o único valor que a Apple aceita). Nada de CBC, ECB, CTR sem
autenticação, XOR ou construção caseira.

### Formato do arquivo `.enc`

Binário compacto, não JSON+base64 (que inflaria uma foto de 10 MB em ~33% e a
obrigaria a existir como string gigante em memória):

```
offset  size  campo
     0     4  MAGIC "AJFV"          (identifica o formato; não é segredo)
     4     1  VERSION               (1)
     5     1  comprimento do IV     (12)
     6     1  comprimento da tag    (16)
     7     1  reservado             (0, mantém o header alinhado em 8 bytes)
     8    12  IV / nonce
    20    16  tag de autenticação GCM
    36     N  ciphertext            (tag NÃO anexada)
```

Header fixo de 36 bytes. Arquivo com magic errado, versão desconhecida,
comprimentos divergentes, menor que o header, ou header sem ciphertext → **falha
fechada**.

### Versionamento

`encryptionVersion = 1`. O parser **nunca tenta adivinhar** um formato futuro:
versão desconhecida vira `vaultCryptoUnsupportedVersion`, não uma tentativa de
decifrar.

### Vault Key

`AESEncryptionKey.import(base64, 'base64')` — a decodificação acontece **dentro
do módulo nativo**, então os bytes crus da chave nunca são materializados como
array JavaScript. Não há buffer de chave em claro para vazar ou esquecer de
zerar.

Duas validações independentes, por defesa em profundidade: o comprimento base64
é reconferido aqui (32 bytes) mesmo já tendo sido validado no storage, e depois
`key.size === AES256` é verificado usando a visão do próprio módulo.

### AAD — decisão explícita de não usar na V1

`expo-crypto` suporta `additionalData`, e AAD sobre o header seria a prática
canônica. **Não usamos na V1**, deliberadamente:

* todo campo do header já está coberto — MAGIC, VERSION e os comprimentos são
  rejeitados pelo parser estrito; IV, tag e ciphertext são autenticados pelo
  próprio GCM. Não existe campo desprotegido;
* só existe uma versão de formato, então não há downgrade possível — versão
  adulterada vira recusa, não decifragem mais fraca;
* o caminho de AAD desta biblioteca **não pôde ser testado em dispositivo**, e
  o projeto já tem histórico documentado de divergência Android/iOS no
  `expo-crypto`. Adicionar um caminho não verificado seria o risco maior.

Registrado como hardening natural quando surgir um formato v2.

### `encryptPhotoFile`

Lê os bytes → `encryptBytes` (nonce novo a cada chamada) → grava `.enc` com nome
aleatório. Retorna:

```ts
{ encryptedUri, encryptedSize, encryption: { version, algorithm, iv, vaultKeyVersion } }
```

O `iv` devolvido é **exatamente** o nonce enquadrado dentro do arquivo — uma
única fonte de verdade, então o metadado do Firestore (Fase 4) não pode divergir
do arquivo que descreve. A Vault Key nunca aparece no retorno.

### `decryptPhotoFile`

Lê o `.enc` → valida magic/versão/comprimentos → `fromParts` → GCM verifica a
tag → grava o plaintext **apenas** no diretório temporário. Falha de escrita
remove o arquivo parcial.

### Diretórios

| Uso | Caminho |
|---|---|
| `.enc` aguardando upload | `<cache>/photo-vault/enc/` |
| Plaintext temporário | `<cache>/photo-vault/tmp/` |

Ambos sob **cache**, nunca `document`: plaintext não pode parecer dado durável
do app, e o SO pode reclamar o espaço. Nomes são UUIDs — nenhum caminho de
plaintext é previsível.

### Ciclo de vida do plaintext

Temporário por contrato: nome aleatório, no subdiretório de cache do vault,
removível por `discardDecryptedPhoto(uri)` assim que o chamador termina, e
varrido por `cleanupPhotoVaultTempFiles()`. Em qualquer erro, nada parcial
sobrevive.

### `cleanupPhotoVaultTempFiles`

Por padrão remove **apenas** os plaintexts — um `.enc` pode estar aguardando um
upload que ainda não aconteceu, e apagá-lo perderia dado. `{ includeEncrypted:
true }` remove ambos. Escopo estrito ao subdiretório do vault: **não** toca
avatar, cache do `expo-image`, `document`, nem a foto de origem. Idempotente e
tolerante a arquivo que sumiu no meio da varredura.

### Limites e memória

A cifragem é one-shot em memória: o arquivo inteiro é lido, cifrado e gravado.
Com o teto de **10 MB** definido na Fase 4, o pico é da ordem de ~30 MB
(plaintext + ciphertext + envelope), aceitável. **Não** há streaming, e não vale
introduzi-lo na V1. Compressão continua fora desta camada — ela pertence ao
pipeline de upload, e misturá-la aqui acoplaria duas preocupações sem ganho.

### Zeroização — limitação real

Os buffers próprios devolvidos por `File.bytes()` e pela descriptografia são
sobrescritos com `fill(0)` após criptografia/escrita. O limite honesto continua:
o V8 pode criar cópias internas e o GC não oferece garantia formal de
zeroização. Isso é registrado, não prometido.

### A foto original permanece na galeria

Quando o seletor de imagens for adicionado, a foto original **continua na
biblioteca do aparelho**, intacta e não criptografada. O Photo Vault protege a
cópia que o AJ Fit guarda; ele não apaga nem cifra o original do usuário. Não
prometer o contrário ao usuário.

### Erros

`vaultCryptoInvalidKey`, `vaultCryptoEncryptFailed`, `vaultCryptoDecryptFailed`,
`vaultCryptoInvalidFile`, `vaultCryptoUnsupportedVersion`,
`vaultCryptoIntegrityFailed`, `vaultFileReadFailed`, `vaultFileWriteFailed`,
`vaultTempCleanupFailed`. Nenhuma mensagem carrega chave ou conteúdo de foto.

Chave errada e adulteração são **indistinguíveis por construção** — ambas viram
`vaultCryptoIntegrityFailed`, porque em ambos os casos os bytes não podem ser
confiados.

---

## 23. Pipeline de nuvem (Fase 9)

`src/services/progressPhotos.ts` — move fotos **já criptografadas** entre o
dispositivo e o Firebase. A nuvem só vê ciphertext.

### Autoridade de identidade

O `uid` vem sempre de `auth.currentUser` **dentro da camada**. Nenhuma função
pública aceita uid nem path: as assinaturas são `uploadProgressPhoto(params)`,
`listProgressPhotos()`, downloads de assets tipados e `deleteProgressPhoto()`.
Mesmo quando metadata já validada é reutilizada para evitar uma segunda leitura
Firestore, o path do Storage é sempre novamente derivado de
`uid + photoId`, nunca aceito pronto.

O `photoId` é um UUID (`randomUUID` do `expo-crypto`) — nada de timestamp,
índice sequencial ou nome de arquivo original. O mesmo `photoId` identifica o
documento no Firestore e o objeto no Storage.

### Upload

```
sourceUri → full 1600px/0,85 ─┬→ encrypt (IV A) → full.enc ─┐
                             └→ thumb 480px/0,75            │
                                  → encrypt (IV B) → thumb.enc
                    uploads paralelos de ciphertext ────────┤
                                    → cria metadata Firestore
                                    → remove temporários locais
```

**Ordem deliberada: Storage antes do Firestore.** O documento nunca pode
descrever um objeto que não chegou a existir. Isso inverte o risco para um
objeto órfão, tratado pelo rollback.

O arquivo original **nunca** vai ao Storage — apenas o `.enc`.

### Rollback

Se os uploads sobem mas o Firestore falha, os dois objetos são **deletados imediatamente** e
o erro é `vaultMetadataCreateFailed`. Se o rollback também falhar, o erro é
`vaultUploadRollbackFailed` — distinto de propósito, porque nesse caso existe um
objeto órfão que precisará de limpeza futura. **Nunca** se reporta sucesso
parcial, nunca se cria um segundo `photoId`, e nunca se pede uma nova Vault Key.

### Metadata Firestore

O schema fechado inclui a base da Fase 4 e o conjunto atômico
`thumbnailStoragePath`/`thumbnailEncryptedSize`/`thumbnailEncryption`: `storagePath`, `createdAt`
(`serverTimestamp()`, exigido pela rule `createdAt == request.time`), `takenAt`,
`originalMimeType`, `encryptedSize`, e o mapa `encryption`
(`version`/`algorithm`/`iv`/`vaultKeyVersion`). Testado que nenhum campo extra
é escrito — sem `downloadURL`, sem signed URL, sem base64, sem thumbnail plaintext, sem
`wrappedVaultKey`.

O `encryptedSize` é medido dos **bytes efetivamente enviados**, nunca vindo da
UI; divergência entre o tamanho medido e o reportado aborta antes do upload.

### Metadata Storage

`contentType: application/octet-stream` e metadata customizada
`{ ownerId, photoId, assetKind }` — exatamente o que as Storage Rules exigem nos
novos objetos. Nada de chave,
IV, token, e-mail ou nome.

### Sem downloadURL persistente

`getDownloadURL()` **não é chamado** em lugar algum deste pipeline (travado por
teste estrutural). A referência primária é sempre o `storagePath` derivado, e o
download usa `getBytes()` — que respeita as Storage Rules, ao contrário de uma
URL com token permanente.

### Listagem

`listProgressPhotos()` lê do **Firestore**, não de uma listagem de bucket:
documentos são o índice, e uma listagem de bucket não seria autorizável por
usuário. Ordenado por `takenAt` desc — campo único, então **nenhum índice
composto é necessário**. Um documento corrompido é registrado e pulado, para que
uma foto ruim não esconda todas as outras.

### Download

```
documento Firestore → valida metadata → getBytes (teto 10 MB)
                    → confere tamanho e envelope contra a metadata
                    → grava .enc temporário → decryptPhotoFile
                    → URI de plaintext temporária
```

O Firebase nunca fornece plaintext. O `.enc` baixado é descartado ao final —
sempre pode ser buscado de novo.

### Consistência metadata ↔ envelope

Antes de qualquer chave ser usada, o arquivo baixado é conferido contra o
documento que diz descrevê-lo: **tamanho**, **IV** e **versão** precisam bater
(`describeEnvelope` lê o enquadramento sem decifrar). Divergência →
`vaultDownloadIntegrityFailed`. Duas fontes que discordam nunca são resolvidas
confiando silenciosamente em uma delas.

O `vaultKeyVersion` é **honrado, não ignorado**: se o documento pede uma versão
de chave que o dispositivo não tem, falha fechado em vez de produzir lixo. Hoje
só existe a versão 1, mas a checagem já está no lugar.

### Delete

**Storage primeiro, Firestore depois.** Metadata apontando para arquivo
inexistente quebra toda listagem; um objeto órfão sem metadata é invisível e
reclamável — o segundo é o mal menor.

* Storage falha → o documento é **preservado** (`vaultDeleteFailed`), a operação
  pode ser repetida.
* Objeto já inexistente (`storage/object-not-found`) → segue em frente, para que
  um retry ainda limpe a metadata. **Idempotente.**
* Storage ok, Firestore falha → `vaultPartialDelete`, distinto para sinalizar
  que o retry é seguro e necessário.

Delete **não** obtém a Vault Key, não baixa e não decifra — é uma questão de
autorização, não de criptografia.

### Cleanup local

O `.enc` temporário é removido após upload bem-sucedido, após rollback, e após
falha de upload. Uma falha de limpeza local **não** desfaz um upload remoto
bem-sucedido. A foto original do usuário nunca é tocada.

### Offline e cache

Upload e o primeiro download **exigem rede**; não há sync offline nesta V1 e
nenhum plaintext é persistido para "modo offline". O cache do Firestore pode
servir a metadata — aceitável, porque metadata não contém foto. Nenhum cache
permanente de imagem descriptografada: sem `expo-image`, sem `memory-disk`
(travado por teste).

### Limite de 10 MB

Aplicado três vezes: antes do upload (`encryptedSize > MAX` aborta sem gastar
rede), no `getBytes(..., MAX_ENCRYPTED_BYTES)`, e na validação da metadata. O
`encryptedSize` inclui o envelope de 36 bytes.

### Erros

`vaultPhotoTooLarge`, `vaultUploadFailed`, `vaultUploadRollbackFailed`,
`vaultMetadataCreateFailed`, `vaultMetadataInvalid`, `vaultListFailed`,
`vaultDownloadFailed`, `vaultDownloadIntegrityFailed`, `vaultDeleteFailed`,
`vaultPartialDelete`.

Logs registram apenas o `issue` — nunca foto, ciphertext, chave, URL ou payload.

---

## 24. Autenticação local e trava (Fase 10)

### Duas autenticações diferentes — não confundir

| | Firebase Reauth | Local Auth |
|---|---|---|
| Prova | posse da **conta** | posse do **aparelho** |
| Quando | recuperar a Vault Key em aparelho novo/reinstalação | abrir o cofre no uso diário |
| Mecanismo | senha, Google, Apple | Face ID, digital, PIN/padrão/senha do aparelho |
| Frequência | raro | toda vez que o cofre é aberto |

Abrir a galeria **nunca** dispara reautenticação Firebase.

### Biblioteca

`expo-local-authentication ~56.0.5`, instalada via `npx expo install`. Plugin em
`app.json` com `faceIDPermission` em pt-BR. **O AJ Fit não implementa PIN, senha,
padrão nem pergunta de segurança própria** — a autenticação é inteiramente
delegada ao SO.

### Hierarquia `face → digital → credencial`: como foi traduzida

Uma única escolha implementa a intenção nas duas plataformas —
**`disableDeviceFallback: false`** (o default, mantido de propósito):

* **iOS** → usa `LAPolicyDeviceOwnerAuthentication`. O sistema mostra Face ID ou
  Touch ID (o que aquele iPhone tiver) e cai para o **passcode do aparelho**
  sozinho após falhas.
* **Android** → o módulo passa `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` para
  `BiometricPrompt.setAllowedAuthenticators` (verificado no código nativo do
  pacote). O sistema oferece a biometria cadastrada **e** a credencial de tela de
  bloqueio no mesmo prompt.

O AJ Fit **não sequencia prompts** e **não desenha seletor "escolha face ou
digital"**: quem decide é o SO. A hierarquia é uma regra conceitual de produto,
não licença para furar a abstração de segurança da plataforma.

### Android: biometria facial e o problema do Classe 2

`biometricsSecurityLevel` tem default `'weak'`, que aceita **Classe 2** —
tipicamente face unlock 2D por câmera, derrotável por uma fotografia. Fotos
privadas não justificam isso, então usamos **`'strong'` (Classe 3)**.

Consequência honesta: num aparelho cuja única biometria é fraca, a biometria
**não** será oferecida — mas o usuário ainda autentica, porque a credencial do
aparelho permanece no conjunto permitido. Ninguém fica sem acesso; ninguém entra
com biometria fraca.

### Limitações de plataforma encontradas

* **`BIOMETRIC_STRONG | DEVICE_CREDENTIAL` não é suportado no Android 9–10
  (API 28–29)** pelo `androidx.biometric`. O `minSdk` do projeto é 24. O módulo
  tem um caminho de fallback próprio (`promptDeviceCredentialsFallback`, usando
  `KeyguardManager` abaixo da API 30), mas o caminho principal não faz essa
  checagem de versão. **Precisa de validação em aparelho Android 9/10** —
  registrado como pendência, não como resolvido.
* iOS não expõe biometria "fraca": lá `BIOMETRIC_WEAK` não existe.
* `getEnrolledLevelAsync` reporta o nível **do aparelho**, não por mecanismo; não
  é possível saber por API se uma face específica é Classe 2 ou 3.

### Dispositivo sem proteção alguma

Sem biometria utilizável **e** sem credencial de tela de bloqueio, o cofre
permanece `locked` e o prompt **nem é aberto** (`vaultAuthNotConfigured`). Não
existe caminho que abra o cofre sem autenticação — não há toggle, flag ou
configuração que desative a proteção.

### Arquitetura em camadas

```
UI
 └─ PhotoVaultContext        (React: espelha estado, AppState, troca de conta)
     └─ lib/photoVaultLock    (máquina de estados, sem React)
         └─ lib/photoVaultSession  (sessão em memória, por uid)
             └─ services      (consultam o gate)
                 └─ crypto/storage
```

A criptografia nunca importa React. A trava pertence ao app, não a uma subárvore
de componentes.

### Máquina de estados

`locked` → `authenticating` → `unlocked` (sucesso)
`locked` → `authenticating` → `locked` (cancelamento, falha, lockout, erro)

**Estado inicial é sempre `locked`**, jamais inferido de "o usuário está logado",
"existe Vault Key" ou "o app acabou de abrir". `authenticating` nunca é terminal.

### Nunca persistido

O estado desbloqueado existe **apenas em memória**. Não vai para AsyncStorage,
SecureStore, Firestore nem arquivo — travado por teste. Restart ou kill do app
retornam a `locked`.

### Sessão: por que não um booleano

`lib/photoVaultSession` guarda **qual uid** autenticou, e cada operação
revalida contra a identidade do chamador. Um booleano global seria fácil de
esquecer e sobreviveria a uma troca de conta; a sessão por uid não. Ao detectar
uid divergente, a sessão é **destruída na hora** — chegar ali significa que uma
troca de conta escapou, e o grant não pode sobreviver à descoberta.

### Double prompt

Chamadas concorrentes **compartilham a tentativa em voo** em vez de abrir um
segundo prompt. Sem isso, o `BiometricPrompt` do Android rejeitaria a segunda
com um erro indistinguível de cancelamento do usuário, e o iOS empilharia
prompts. Testado.

### Lifecycle

| Evento | Efeito |
|---|---|
| `active → inactive` ou `background` | **lock imediato** + cleanup |
| `background → active` | **continua locked**, sem prompt automático |
| Logout | lock + cleanup (a Vault Key local já era removida desde a Fase 7) |
| Troca de usuário | lock imediato; B nunca herda o grant de A |
| Restart / kill | locked |
| Troca de aba dentro do app | **não** bloqueia — o app continua em foreground |

`inactive` é incluído de propósito: no iOS é o preview do app switcher e a
central de notificações, exatamente quando a tela fica visível fora do app.

**Sem timeout por minutos nesta V1**: foreground contínuo permanece unlocked,
background bloqueia na hora. Timeout fica como hardening futuro.

### Gate real — não é só esconder botão

`services/progressPhotos.ts` roteia **todas** as operações por
`currentUnlockedUid()`, que obtém o uid **e** exige a sessão. Como toda operação
precisa do uid, é impossível adicionar uma que esqueça o gate.

Exigem `unlocked`: **upload, listagem, download, decrypt, delete** — inclusive
delete, que nem usa a Vault Key. Testado que, travado, nada chama a chave e
nenhum plaintext é produzido.

### SecureStore e `requireAuthentication` — decisão

**Não ativado.** A arquitetura escolhida separa responsabilidades: o SecureStore
protege o *armazenamento* da chave, e a autenticação local abre uma *sessão*.
Durante a sessão os serviços usam a chave livremente.

Ativar `requireAuthentication: true` dispararia um prompt biométrico a cada
leitura da chave — vários por foto — e, em ambas as plataformas, **alterar a
biometria cadastrada invalida os itens assim protegidos**. Seria recuperável
(existe `recoverVaultKey`), mas ao custo de uma reautenticação Firebase completa
sempre que o usuário cadastrasse um novo dedo ou rosto. O ganho é marginal:
quem consegue ler o Keychain já comprometeu o aparelho em nível que a sessão não
protege de qualquer forma.

### Cleanup ao bloquear

Ordem deliberada: **sessão fecha e estado vira `locked` primeiro**, cleanup
depois. Um cleanup que falha nunca devolve o cofre a `unlocked` — perder um
arquivo temporário é recuperável, ficar destravado não. Ciphertext é preservado.

### Erros

`vaultAuthUnavailable`, `vaultAuthNotEnrolled`, `vaultAuthNotConfigured`,
`vaultAuthCancelled`, `vaultAuthFailed`, `vaultAuthLockedOut`, `vaultLocked`,
`vaultUnlockFailed`. Códigos nativos nunca chegam à UI.

Cancelar **não é erro fatal** — volta a `locked`, sem operação privada em
andamento e sem plaintext novo. Lockout do sistema é **respeitado**, nunca
contornado.

### Logging

Nunca: Vault Key, dado biométrico, credencial, PIN, senha, token, resultado
integral do LocalAuthentication. Apenas operação, transição e `issue`
sanitizado.

### Development build obrigatório

`expo-local-authentication` é módulo nativo: **Expo Go não reproduz** Face ID,
BiometricPrompt nem credencial do aparelho. É necessário
`npx expo prebuild` + `npx expo run:ios` / `run:android` (ou build EAS) antes de
qualquer validação real.

### Matriz de teste físico (obrigatória, ainda não executada)

**iPhone com Face ID**
1. Abrir o cofre → prompt de Face ID aparece → autenticar → `unlocked`.
2. Cancelar o prompt → permanece `locked`, nenhuma foto carrega.
3. Falhar o rosto 3× → o sistema oferece o passcode → autenticar com ele.
4. Com o cofre aberto, minimizar o app → reabrir → **continua locked**, sem
   prompt automático.
5. Abrir o app switcher (sem sair) → o cofre já deve estar travado.
6. Trocar de aba dentro do app e voltar → **não** deve pedir Face ID de novo.

**iPhone com Touch ID** — repetir 1–4.

**Android com digital**
1. Abrir → BiometricPrompt → autenticar.
2. Cancelar → `locked`.
3. Errar até o lockout → confirmar que o resultado nativo é respeitado.
4. Background → voltar → `locked`.

**Android com face Classe 3** — repetir 1–4; confirmar que a face é aceita.

**Android com face Classe 2 apenas** — confirmar que a face **não** é oferecida e
que o PIN/padrão/senha aparece como alternativa.

**Android sem biometria, com PIN/padrão/senha** — confirmar que o prompt pede a
credencial e desbloqueia.

**Android 9 ou 10** — cenário crítico da limitação API 28–29 acima.

**Aparelho sem proteção alguma** — confirmar que o cofre permanece `locked` e que
nenhum prompt abre.

**Logout e troca de conta** — abrir o cofre, sair, entrar com outra conta,
confirmar que o cofre está `locked` e que nenhuma foto da conta anterior aparece.

---

## 25. UI da área de fotos (Fase 11)

### Estrutura

```
src/screens/ProgressPhotosScreen.tsx      orquestração
src/components/photoVault/
  PhotoVaultLockedState.tsx               cofre fechado
  PhotoVaultEmptyState.tsx                sem fotos
  PhotoVaultGrid.tsx                      grid + carregamento sob demanda
  PhotoVaultViewer.tsx                    tela cheia
  AddPhotoSheet.tsx                       câmera / galeria
src/lib/photoVaultGallery.ts              estado da galeria (sem React)
src/services/photoVaultPicker.ts          picker + normalização
```

A `ProgressScreen` só teve o placeholder trocado por `<ProgressPhotosScreen />`
— o resto da tela permanece intacto.

A lógica da galeria vive num módulo puro pelo mesmo motivo da Fase 10: o projeto
não tem renderizador de componentes, então lógica dentro de um Context seria
intestável. A UI é uma casca.

### Fluxo de entrada

Selecionar "Fotos" **não** dispara prompt automático. O usuário vê o estado
bloqueado e toca em "Desbloquear" — intenção explícita, sem prompt disparado por
render acidental.

### Estado bloqueado

Ícone de cadeado, título, descrição e CTA. **Nada do conteúdo é renderizado**:
sem fotos, sem contagem, sem datas, sem preview — travado por teste. A cópia
nunca nomeia "Face ID", porque o mesmo build roda em aparelhos que vão pedir
digital ou PIN.

Sem mecanismo seguro no aparelho, mostra a mensagem de configuração e o botão
"Abrir configurações" (`Linking.openSettings`). **Nunca** oferece criar um PIN
próprio.

### Empty state e grid

Empty state com CTA. Grid de 2 colunas seguindo o padrão visual da tela de
progresso (`HudCorners`, raio 14, mesma altura de card).

Cada célula mostra a imagem e a data formatada por `Intl.DateTimeFormat` no
idioma do usuário. **Nenhum metadado criptográfico** aparece.

### Carregamento sob demanda (atualizado na Fase 13)

A lista vem de `listProgressPhotos()`; **nenhuma imagem é baixada junto**. Cada
célula pede somente a thumbnail cifrada. Há até **5** downloads/decrypts de
thumbnail e até **2** fulls, em filas independentes. Foto legacy sem thumbnail
usa fallback controlado para a full. O viewer abre com a thumbnail e a substitui
pela full assim que ela fica pronta.

### Cache persistente — deliberadamente ausente

Usa o `Image` do React Native, **não** `expo-image`: o cache de disco deste
último copiaria fotos descriptografadas para fora do controle do vault, que é
exatamente o que todo o desenho evita. Travado por teste estrutural.

Durante uma sessão desbloqueada existe um LRU em memória que apenas referencia
temporários do subtree do Vault: 20 thumbnails e 2 fulls. Ele é totalmente
invalidado no lock/logout/troca de usuário; não usa AsyncStorage,
`documentDirectory` nem cache `memory-disk`.

### Ciclo de vida do plaintext na UI

O controlador **assina o estado da trava**. Quando o cofre fecha:

* todos os arquivos temporários são apagados;
* todas as URIs são zeradas no mesmo update, então nada continua renderizado;
* o viewer se fecha sozinho ao perder a URI;
* um download que estava em voo e resolve **depois** do lock tem seu arquivo
  descartado em vez de pintado na tela — a corrida está fechada e testada.

### Adicionar foto

Bottom sheet com "Tirar foto" e "Escolher da galeria". **Nenhuma permissão é
pedida no mount** — só depois de escolher a fonte, e só a daquela fonte.

### Normalização antes de criptografar

Redimensiona para **1600px** na maior dimensão, JPEG **qualidade 0.85**. Mantém
detalhe suficiente para acompanhamento corporal e fica bem abaixo do teto de
10 MB — o que importa três vezes: cifrar em memória, subir e baixar depois.
Mais suave que o pipeline do avatar, que pode ser agressivo porque é exibido
pequeno.

Tudo vira **JPEG**: HEIC/HEIF do iPhone chegariam ao Storage num formato que
muitos visualizadores não decodificam, e a reconversão descarta os metadados do
contêiner (incluindo GPS) como efeito colateral. A extensão **não é confiada** —
o arquivo é reencodado ou rejeitado.

`takenAt` usa o EXIF `DateTimeOriginal` quando parseia e não está no futuro;
caso contrário, agora.

### Privacidade do original

Foto escolhida da galeria **não é apagada nem modificada** — o AJ Fit só lê.
Foto tirada pela câmera **não é salva na galeria do aparelho**: o
`expo-image-picker` a devolve do cache do app e só grava na biblioteca quando
explicitamente pedido, o que este código nunca faz. Travado por teste
(`expo-media-library` e `createAssetAsync` proibidos).

### Upload e atualização da lista

`addGalleryPhoto` → `uploadProgressPhoto` → **refetch**. O refetch (em vez de
inserir localmente) garante que a foto nova apareça na posição correta por
`takenAt`, sem duplicar.

Sem barra de progresso: o SDK não expõe progresso confiável para `uploadBytes`,
e **percentual inventado é pior que indicador simples**.

### Viewer

Modal em tela cheia com data, fechar e excluir. Renderiza **apenas** quando há
foto com URI viva. Estruturado num único `<Image>` para que proteção de
screenshot possa ser adicionada em volta desta subárvore depois, sem reescrever.

Sem compartilhamento nesta fase.

### Delete

Confirmação via `Alert` ("Excluir esta foto?" / "Esta ação não pode ser
desfeita"). Chama apenas `deleteProgressPhoto` — o gate da Fase 10 já exige
`unlocked`.

Em `vaultPartialDelete` **não finge sucesso**: mostra erro e faz refetch, porque
o documento pode ter sobrevivido e a lista local não pode divinhar.

### Offline

A metadata pode vir do cache do Firestore. Uma foto que não pôde ser baixada
mostra "Conecte-se à internet para carregar esta foto" — **nunca um preview
inventado**. Nenhum plaintext é persistido para modo offline.

### Estados de carregamento

Separados: desbloqueando (no botão), carregando lista, baixando cada foto (na
célula), enviando (faixa no topo), excluindo (botão do viewer). Sem spinner
global.

### Acessibilidade e i18n

`accessibilityRole`/`accessibilityLabel`/`accessibilityHint` em desbloquear,
adicionar, tirar foto, escolher da galeria, cada foto, excluir e fechar.
`accessibilityLiveRegion` nas mensagens de erro. `CtaButton` foi estendido de
forma aditiva para aceitar rótulos.

Todas as strings em **pt-BR, en e es**; nenhuma hardcoded. Paridade validada
pelos 550 testes de i18n e pelo `i18n:audit` (0 bloqueios).

### Validação física e pendências de hardening

O fluxo funcional completo já foi exercitado em aparelho. A plataforma não foi
identificada no registro disponível, e a Fase 12 ainda exige repetir em iOS e
Android com screenshot/recording/recent-apps e App Check. Roteiro:

1. Abrir Fotos → estado bloqueado → "Desbloquear" → autenticar.
2. Estado vazio → "Adicionar foto" → câmera → confirmar upload.
3. Repetir pela galeria; confirmar ordenação por data.
4. Abrir uma foto no viewer; confirmar que a imagem é idêntica à original
   (valida encrypt → upload → download → decrypt de ponta a ponta).
5. Minimizar o app com o viewer aberto → confirmar que fecha e o cofre trava.
6. Voltar → confirmar que continua bloqueado, sem prompt automático.
7. Desbloquear de novo → excluir uma foto → confirmar que some da lista.
8. Repetir tudo em Android com digital, Android com face Classe 3, e Android só
   com PIN/padrão/senha.
9. **Android 9 ou 10** — cenário crítico da limitação de device credential.
10. Sair da conta e entrar com outra → confirmar cofre bloqueado e nenhuma foto
    da conta anterior.

---

## 26. Hardening final e próxima fase

O hardening local está documentado em `docs/21_photo_vault_pre_launch.md`.
Depois que a matriz física, o App Check real e os deploys seletivos autorizados
passarem, a próxima fase é **auditoria final de release + fechamento da feature
Photo Vault**.
