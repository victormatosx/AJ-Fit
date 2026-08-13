# Photo Vault — Hardening e checklist pré-lançamento

## 1. Estado verificável em 2026-08-12

O fluxo funcional do Photo Vault já foi exercitado em aparelho real antes desta
fase: unlock, criação/recuperação de chave, câmera/galeria, criptografia,
upload, listagem, download, descriptografia, viewer, lock em background e
delete. O registro recebido não identifica a plataforma desse ensaio; portanto
ele não substitui a matriz iOS + Android deste documento.

A Fase 12 está **implementada e validada localmente**, mas ainda não está
encerrada. Faltam:

* debug tokens App Check registrados manualmente para builds de desenvolvimento;
* prova runtime do bridge em iPhone e Android reais;
* prova de token aceito por Functions, Firestore e Storage antes de enforcement;
* testes físicos de screenshot, gravação e recent apps nas duas plataformas;
* autorização e deploy seletivo de `cleanupPhotoVaultOrphans`;
* execução humana completa da matriz de regressão.

Nenhum enforcement foi ligado e nenhum recurso remoto foi alterado nesta fase.

## 2. Proteção visual

`expo-screen-capture ~56.0.4` é ativado somente antes da transição do Vault para
`unlocked`. O unlock falha fechado se a proteção não estiver disponível.

* Android: `preventScreenCaptureAsync` usa proteção nativa equivalente a
  `FLAG_SECURE`, cobrindo screenshot, gravação e preview de recent apps.
* iOS: a prevenção de captura é combinada com
  `enableAppSwitcherProtectionAsync(1)` para neutralizar o snapshot do app
  switcher.
* Sair da tela privada trava o Vault. Outras telas não ficam com screenshot
  bloqueado sem necessidade.
* Ao entrar em `inactive`/`background`, a sessão é revogada sincronicamente,
  URIs são removidas, um overlay neutro cobre a árvore e a proteção nativa é
  mantida até o primeiro frame seguro no retorno.
* O retorno continua `locked` e nunca abre autenticação automaticamente.

Referência oficial: https://docs.expo.dev/versions/latest/sdk/screen-capture/

## 3. App Check

### Arquitetura local

```text
Firebase App Check nativo
  → módulo Expo local AJFitAppCheck
  → { token, expireTimeMillis }
  → Firebase JS CustomProvider
  → mesma Firebase JS App
  → Auth / Firestore / Storage / Functions continuam no SDK JS
```

O módulo fica em `modules/ajfit-app-check` e usa autolinking da Expo Modules
API; nenhuma edição permanente de `ios/` ou `android/` é necessária.

Android:

* Firebase BoM `34.17.0`;
* Debug source set: `firebase-appcheck-debug` e
  `DebugAppCheckProviderFactory`;
* Release source set: `firebase-appcheck-playintegrity` e Play Integrity;
* `getAppCheckToken(forceRefresh)` fornece token e `getExpireTimeMillis()`
  oficiais.

iOS:

* `FirebaseAppCheck 12.14.0` e `AppCheckCore 11.2.0`;
* a versão é fixada no último par oficial anterior ao reCAPTCHA porque
  `FirebaseAppCheck 12.15+` não compilou no grafo CocoaPods estático do Expo
  56; não há patch em Pods gerados;
* Debug: `AppCheckDebugProviderFactory`, definido antes de
  `FirebaseApp.configure()`;
* Release: `AppAttestProviderFactory`; DeviceCheck não é usado;
* `expirationDate` oficial é convertida diretamente para Unix milliseconds.

O wrapper JS recusa token vazio, expiração não finita ou expirada. Não decodifica
JWT, não estima TTL, não persiste token e não monta
`X-Firebase-AppCheck` manualmente. O cache/auto refresh fica no Firebase JS;
as consultas nativas normais usam `forceRefresh=false`.

### Estado do Console conhecido

* Android `com.ajfit.mobile`: Play Integrity registrado.
* iOS `com.ajfit.app`: App Attest registrado, Team ID configurado.
* DeviceCheck: não configurado e não requerido.
* Enforcement: **desativado/pendente**.

Em development build, registrar manualmente o token emitido pelo SDK em:

```text
Firebase Console → App Check → app da plataforma
→ Gerenciar tokens de depuração
```

O valor nunca entra em código, `.env`, logs permanentes ou documentação.
Expo Go não contém o módulo local e não serve para essa validação.

### Ordem de validação e enforcement

1. Debug token Android e iOS.
2. Confirmar token + expiração reais nas duas plataformas.
3. Confirmar que o `CustomProvider` é aceito pela mesma Firebase JS App.
4. Confirmar Functions, Firestore e Storage com métricas do Console ainda sem
   enforcement.
5. Testar cliente sem token e estratégia de rollback.
6. Só após aprovação humana, ativar enforcement por produto, de maneira
   progressiva. Não usar opção global.
7. Depois de runtime válido, adicionar `enforceAppCheck: true` a `createVault`
   e `recoverVaultKey`, testar e publicar somente essas Functions por nome.

## 4. Reconciliação de órfãos

`cleanupPhotoVaultOrphans` é uma scheduled Function local, diária às 03:30 em
`America/Sao_Paulo`, sem retry automático. Ela não é callable e não aceita uid
de cliente.

Política:

```text
idade mínima: 7 dias
primeira observação sem par: cria marker backend-only
confirmação: mais 24 horas
segunda leitura: revalida os dois lados
delete: somente com generation/updateTime precondition
```

Storage é paginado em 250 objetos; Firestore, em 500 documentos. Um erro de
candidato incrementa somente um contador e não aborta o lote. Logs contêm
apenas etapa e agregados — nunca uid, photoId ou path.

Casos:

* Storage sem Firestore recente: preservar;
* Storage antigo sem Firestore em uma observação: marcar;
* Storage ainda órfão após confirmação: deletar a geração exata;
* objeto com Firestore: preservar e remover marker antigo;
* Firestore recente sem Storage: fora do cutoff, preservar;
* Firestore antigo sem Storage em duas observações: deletar a versão exata;
* mudança em qualquer lado entre observações: preservar/recomeçar.
* `.thumb.enc` ligada por `thumbnailStoragePath`: preservar;
* `.thumb.enc` antiga sem vínculo (inclusive documento legacy sem thumbnail):
  marcar e remover somente após a mesma confirmação conservadora;
* metadata nova sem thumbnail, mas com full presente: preservar a foto; o
  cliente usa fallback full e não há delete destrutivo da metadata.

Os markers ficam em `_photoVaultCleanupCandidates`, inacessível a clientes
pelas Rules e usado somente pelo Admin SDK.

Deploy necessário, somente após autorização:

```bash
firebase deploy --only functions:cleanupPhotoVaultOrphans --project ajfit-2f321
```

## 5. Performance e temporários (Fase 13)

O grid usa `FlatList` com duas colunas e baixa exclusivamente a thumbnail
cifrada quando ela existe. Fotos legadas sem thumbnail usam fallback controlado
para a full; não há migração destrutiva. O viewer abre imediatamente com a
thumbnail e pede a full separadamente.

Há filas distintas: até cinco thumbnails pequenas e até duas fulls. O índice
LRU é somente em memória e referencia temporários dentro do subtree controlado
do Vault: 20 thumbnails (pior caso decodificado aproximado de 17,6 MiB para
480×480 RGBA) e duas fulls (aproximadamente 19,6 MiB no pior caso 1600×1600
RGBA). Lock/logout/troca de usuário removem URIs do React primeiro e apagam
todos os arquivos logo depois.

Uploads criam um card local imediatamente, mostram progresso real ponderado dos
dois `uploadBytesResumable` e só confirmam sucesso depois de full + thumbnail +
Firestore. Delete oculta o card imediatamente e restaura/refaz a consulta em
falha. Nenhum estado otimista é persistido.

Resultados do picker/manipulator são movidos imediatamente para
`<cache>/photo-vault/tmp`. O app usa `Image` do React Native, não `expo-image`,
para não criar um segundo cache persistente fora do controle do Vault.

No cold start, `<cache>/photo-vault/tmp` e staging abandonado em
`<cache>/photo-vault/enc` são varridos. Isso é seguro porque não existe fila
local persistida capaz de retomar upload após a morte do processo. Durante um
processo vivo, o lock remove plaintext agressivamente e preserva `.enc` que
pode estar em upload.

Buffers plaintext próprios são preenchidos com zero assim que criptografia ou
escrita termina. Continua válida a limitação do JavaScript/GC: cópias internas
do runtime não oferecem garantia formal de zeroização.

## 6. Segurança e persistência

* O gate de sessão é obrigatório antes de list, upload, download, decrypt e
  delete.
* A sessão é vinculada ao uid e destruída em logout/troca de usuário.
* Nenhuma API pública aceita uid ou storagePath arbitrário.
* Firestore guarda metadata e parâmetros não secretos; Storage guarda somente
  ciphertext AJFV; SecureStore guarda somente a Vault Key local.
* Plaintext não vai para Firestore, Storage, AsyncStorage, SecureStore,
  `documentDirectory` ou cache de `expo-image`.
* Photo Vault não usa `getDownloadURL`; downloads usam `getBytes` sob Rules.
* Logs mobile: issue + código sanitizado. Logs backend: etapa + código/agregados.
* Nenhum token, URI, photoId, path, uid, key ou payload entra nos logs do Vault.

## 7. Resposta a incidentes

### KMS indisponível

Não criar nova chave nem sobrescrever o vault. Manter erro genérico ao cliente,
verificar status/IAM do KMS e repetir somente depois da restauração.

### Recuperação da Vault Key falha

Confirmar reautenticação recente e existência/versão do documento backend-only.
Não gerar chave substituta: isso tornaria as fotos existentes irrecuperáveis.

### Arquivo corrompido

Falhar fechado em tamanho/header/IV/tag GCM. Não exibir parcial e não atualizar
metadata para “consertar” o ciphertext.

### Rollback deixa órfão

Não apagar manualmente objeto recente. Aguardar as janelas 7 dias + 24 horas e
observar apenas os contadores sanitizados da rotina.

### App Check bloqueia cliente legítimo

Pausar o rollout/reverter enforcement do produto afetado; não desligar Auth ou
Rules. Confirmar app ID, assinatura/build, provider e métricas. Debug token é
somente para build Debug, nunca solução de produção.

## 8. Matriz física obrigatória

### iPhone real

Face ID/Touch ID/passcode; create/recover; câmera/galeria; encrypt-upload;
download-decrypt; screenshot; gravação; app switcher; background/foreground;
delete; logout/login; remoção local da chave e recuperação; App Check debug;
Google/Apple/TOTP e Dashboard/Firestore.

### Android real

Digital forte; face Classe 3 quando disponível; face fraca (deve cair para
credencial); somente PIN/padrão/senha; câmera/galeria; screenshot; gravação;
recent apps; background; delete; App Check debug; Google/TOTP e
Dashboard/Firestore.

### Android 9 e 10

Validar separadamente API 28 e 29. `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` tem
limitações nessas versões; não declarar suporte até o comportamento real estar
registrado.

## 9. Node runtime

Functions permanecem em Node 20. Node 22 é suportado atualmente e deve ser
avaliado antes do desligamento comunicado para Node 20, mas a mudança de
`engines` afeta o codebase compartilhado e pode alcançar RevenueCat. Fazer em
fase isolada, com a branch de billing integrada e deploy seletivo/revisado —
nunca como efeito lateral deste hardening.

Referência oficial: https://firebase.google.com/docs/functions/manage-functions

## 10. Auditoria de dependências

`npm audit --omit=dev` encontrou 21 alertas no workspace mobile (14 high, 7
moderate): `image-size` via Metro, `nanoid` via React Navigation/PostCSS,
`shell-quote` via React DevTools e `uuid` via o tooling Xcode/Expo. No backend,
foram 9 moderate em `uuid` transitivo de `firebase-admin`/Google Cloud.

Nenhum `audit fix` foi aplicado. O reparo completo sugerido pelo npm rebaixa
Expo 56 para Expo 53 ou sobe `firebase-admin` para uma major nova, mudanças
incompatíveis com um hardening isolado e com o codebase de Functions
compartilhado. Tratar em tarefa de manutenção de dependências, testar o bundle
e o backend completos e não usar `--force` automaticamente.

## 11. Gate de release

Obrigatório:

* matriz física iOS + Android;
* screenshot/recording/recent-apps sem conteúdo privado;
* App Check real nas duas plataformas e nos três produtos, antes de enforcement;
* deploy/revisão seletiva da limpeza de órfãos;
* Rules e regressões completas verdes;
* Google/Apple/TOTP/RevenueCat validados no build candidato.

Recomendado:

* registrar métricas de falha sanitizadas por versão do app;
* ensaio de rollback de enforcement App Check;
* validar Android API 28/29 se continuarem dentro da matriz suportada.

Futuro:

* rate limit por uid somente se telemetria mostrar abuso residual;
* migração separada de Functions para Node 22;
* reavaliar Firebase Apple SDK 12.15+ quando o grafo Expo/CocoaPods suportar o
  novo AppCheckCore sem patches gerados.

RevenueCat/billing não foi alterado, mesclado ou publicado nesta fase.
