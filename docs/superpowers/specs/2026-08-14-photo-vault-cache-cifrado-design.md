# Fase 13B — Cache local criptografado do Photo Vault

Data: 2026-08-14
Status: aprovado para implementação
Escopo: cliente mobile apenas. Sem Rules, sem Functions, sem deploy, sem RevenueCat.

---

## 1. Problema

O cache da Fase 13 é somente em memória e é destruído no lock. Depois de cada
unlock, toda thumbnail visível repete:

```text
Firebase Storage → download → decrypt → render
```

A rede está no caminho crítico de conteúdo que o aparelho já baixou antes.

## 2. Auditoria do fluxo atual

Caminho real hoje, em `progressPhotos.downloadAsset`:

```text
Firestore metadata (thumbnailStoragePath)
→ getBytes(ref, maxBytes)                    ← rede, toda vez
→ bytes.length === thumbnailEncryptedSize
→ describeEnvelope: MAGIC/version/IV vs metadata
→ writeEncryptedFile(bytes) → <cache>/photo-vault/enc/<uuid>.enc
→ decryptPhotoFile → relê o .enc, decrypt, escreve <cache>/photo-vault/tmp/<uuid>.jpg
→ discardEncryptedPhoto() apaga o .enc no finally
→ GalleryPhoto.thumbnailUri = file:///…/tmp/<uuid>.jpg
→ <Image> do React Native
```

| Pergunta | Estado auditado |
|---|---|
| Downloads da mesma thumbnail | Um por ciclo unlock→lock. O LRU RAM (20 entradas) só evita repetição dentro da sessão. |
| Onde fica o ciphertext | Em lugar nenhum de forma persistente. O `.enc` é scratch de milissegundos. |
| Onde fica o plaintext | Em disco: `<cache>/photo-vault/tmp/<uuid>.jpg`. O LRU indexa URIs de arquivo, não bytes. |
| Como o grid recebe | URI `file://`, `Image` do RN (sem `expo-image`, deliberado). |
| Cleanup no lock | `cleanupPhotoVaultTempFiles()` — só `tmp/`; preserva `enc/` por causa de upload em voo. |
| Cleanup no startup | `App.tsx` → `cleanupPhotoVaultTempFiles({ includeEncrypted: true })` — varre `tmp/` e `enc/`. |

Custo por thumbnail: **3 escritas + 2 leituras de arquivo + 1 request**.

### 2.1 Descobertas que alteram o desenho

**(a) O plaintext da thumbnail já é persistido em disco.** O requisito §7 do
pedido descreve um estado que ainda não existe. A 13B portanto também migra a
thumbnail para RAM-only; não é só adicionar cache.

**(b) Não existe namespace por uid no filesystem.** `<cache>/photo-vault/{tmp,enc}`
é compartilhado entre contas. Hoje é inofensivo porque tudo é varrido; para
cache persistente o namespace passa a ser obrigatório.

**(c) `clearLocalPhotoVaultKey` e `resetGallery` não têm call site.** O logout
hoje só dispara `lockPhotoVault()` via `PhotoVaultContext`. A remoção da Vault
Key local no logout não acontece. É lacuna pré-existente, **fora do escopo desta
fase** por decisão registrada, e deve entrar como item explícito da auditoria
final de release.

## 3. Arquitetura aprovada

```text
RAM plaintext (data URI base64, thumbnailLru)   ← mais rápido, só unlocked
  ↓ miss
disco ciphertext <cache>/photo-vault/encrypted-thumbnails/{uid}/{photoId}.thumb.enc
  ↓ miss
Firebase Storage getBytes                        ← origem, fonte de verdade
```

A hierarquia é centralizada em `progressPhotos.downloadProgressPhotoThumbnail`.
A UI não conhece cache.

### 3.1 Diretório

`<cache>/photo-vault/encrypted-thumbnails/{uid}/{photoId}.thumb.enc`

É **irmão** de `tmp/` e `enc/`, não filho. `cleanupPhotoVaultTempFiles` itera
`[PLAINTEXT_DIR, ENCRYPTED_DIR]` e lista cada um; um diretório irmão é
fisicamente invisível para essa varredura. A proteção do requisito §22 é
estrutural, não uma condicional removível por engano — e mesmo assim recebe
teste dedicado.

Fica em `Paths.cache`: o SO pode reclamar o espaço, e isso é aceitável. O cache
nunca é fonte de verdade; Firebase é.

### 3.2 Cache key

Derivada exclusivamente de `uid` autenticado + `photoId`. Nada de nome original,
e-mail, URL ou timestamp. `uid` e `photoId` são validados contra
`/^[A-Za-z0-9._-]+$/` e rejeitados se contiverem `..`, falhando fechado como
`photoVaultKeyStorage.storageKeyFor` já faz. Isso impede path traversal a partir
de um id de documento Firestore.

## 4. `src/services/photoVaultEncryptedCache.ts`

Responsabilidades: construir path, verificar existência, validar tamanho, ler,
escrever atomicamente, remover por photoId, remover por uid, remover tudo,
reconciliar, calcular tamanho, aplicar limites.

**Nunca descriptografa. Nunca importa Firebase. Nunca importa React.**

### 4.1 Escrita atômica

Escreve em `<uid>/.tmp-<uuid>` e faz `moveSync` para o nome final. Um arquivo
parcialmente escrito nunca ocupa o nome final e portanto nunca é lido como cache
hit. Falha na escrita remove o temporário e não propaga erro fatal: cache é
otimização, e uma falha de cache deve degradar para download, não quebrar a
galeria.

### 4.2 LRU e limites

Limites: **24 MB** (primário) e **300 entradas** (proteção contra muitos
arquivos pequenos). Constantes exportadas, ajustáveis após medição física.

Recência sem sidecar: `max(acesso em RAM nesta sessão, File.lastModified)`.
Eviction ordena ascendente por esse valor.

**Requisito crítico — recência sobrevive ao restart.** Ler um arquivo não
atualiza `lastModified` (atualiza `atime`, que `expo-file-system` não expõe e
que frequentemente está desabilitado por `noatime`). Sem tratamento, a recência
pós-restart degradaria para ordem de inserção, e uma thumbnail acessada todos os
dias seria despejada antes de uma nunca mais aberta.

Tratamento: **touch throttled**. Em cache hit, se `lastModified` for mais antigo
que `TOUCH_MIN_INTERVAL_MS` (12 h), os bytes — que acabaram de ser lidos e
validados, e já estão em RAM — são reescritos pelo mesmo caminho atômico
tmp + `moveSync`, o que atualiza `lastModified`. Custo amortizado: no máximo uma
reescrita de ~50 KB por entrada por 12 h. Passar pelo caminho atômico importa:
um crash no meio de um touch não pode corromper uma entrada válida.

Nenhuma metadata é persistida, porque nenhuma é necessária. Não há sidecar nesta
fase.

## 5. Validação de ciphertext (§13)

Idêntica para cache local e download de rede, extraída para uma função única
usada pelos dois caminhos. Um arquivo local não recebe menos escrutínio que um
baixado:

1. `bytes.length === thumbnailEncryptedSize` (Firestore);
2. `describeEnvelope`: MAGIC `AJFV`, `version`, IV contra `thumbnailEncryption.iv`;
3. `encryption.vaultKeyVersion === vaultKeyVersion` corrente;
4. tag GCM durante o decrypt.

## 6. Cache hit / miss / corrupção

**Hit:** lê → valida → decrypt → data URI. Zero chamadas a Storage. Uma leitura
de arquivo, zero escritas (salvo o touch throttled).

**Miss:** `getBytes` → valida → grava **uma vez** no cache (atômico) → decrypt
**dos bytes já em memória**, sem reler o arquivo. Uma escrita, zero leituras.
Isso elimina o ciclo escreve→lê→escreve→lê atual (§32).

**Corrupção:** hit → decrypt/integridade falha → remove a entrada → redownload
**uma única vez**, controlado por flag, não por loop → se falhar de novo,
propaga o erro real. Corrupção remota nunca é mascarada.

## 7. Plaintext em memória

`aesDecryptAsync(sealed, key, { output: 'base64' })` do `expo-crypto` produz o
base64 dentro do módulo nativo. Novo `decryptBytesToBase64` em
`photoVaultCrypto.ts`, ao lado de `decryptBytes`. O resultado vira
`data:image/jpeg;base64,…` e alimenta `<Image>` do React Native diretamente.

### 7.1 Terminologia honesta

Base64 descriptografado **é plaintext**. A afirmação correta desta fase é
exatamente esta, sem arredondamento:

* **Não há plaintext de thumbnail no filesystem.** Verdadeiro e verificável.
* **Não há `Uint8Array` plaintext de thumbnail no heap JS.** Verdadeiro: o
  módulo nativo entrega base64 já codificado; o JS nunca vê os bytes do JPEG.
* **Existe Base64 plaintext em RAM JS enquanto o vault está unlocked.** Também
  verdadeiro. A proteção é o limite do LRU (20 entradas) e o ciclo de vida
  (lock/background/logout/troca zeram as referências), não a ausência do dado.

Limitação a registrar: uma `String` JavaScript é imutável e **não pode ser
zerada**. Um `Uint8Array` podia receber `.fill(0)`, como o pipeline de upload já
faz. Trocar arquivo `.jpg` por string base64 troca "plaintext em disco, também
não zerável depois de escrito" por "plaintext em heap, não zerável, mas que
desaparece com o lock e nunca sobrevive ao processo". É ganho líquido, e a
limitação é documentada em vez de omitida.

Overhead (§9): JPEG 480px/0,75 de ~40–60 KB → string de ~53–80 KB. Vinte
entradas do LRU ≈ 1,1–1,6 MB de strings, contra os ~17,6 MiB de bitmaps
decodificados que o mesmo LRU já implica. A string nunca é logada, nunca vai
para AsyncStorage/SecureStore e nunca é persistida.

## 8. Race de logout e troca de usuário

Apagar o namespace não basta. Uma operação assíncrona iniciada pela sessão
anterior pode resolver depois do logout e recriar o cache de A ou repopular
RAM/gallery.

Dois guardas independentes:

**(a) Epoch do cache, dentro do próprio módulo de cache.** O módulo mantém
`cacheEpoch`. `pruneCachedThumbnailsExcept()` o incrementa.
`writeCachedThumbnail(..., epoch)` recusa se `epoch !== cacheEpoch`. O chamador
captura o epoch na entrada da operação. Como a checagem e o `moveSync` são
síncronos no mesmo turno do runtime single-threaded, não existe ponto de
interleaving entre validar e gravar. A janela fecha por completo.

**(b) Geração de sessão, em `photoVaultSession`.** Novo
`photoVaultSessionGeneration()`, incrementado em `openPhotoVaultSession` e
`closePhotoVaultSession`. `progressPhotos` captura na entrada e revalida antes
de devolver plaintext ao chamador. Combinado com o
`requirePhotoVaultUnlocked(uid)` já existente, uma conclusão tardia da sessão
anterior é descartada em vez de pintada.

O `generation` que `photoVaultGallery` já mantém continua guardando o estado
React. Os três atuam em camadas diferentes e não se substituem.

Teste obrigatório: A inicia operação → operação fica pendente → logout ou troca
para B → operação conclui → nenhum arquivo no namespace de A, nenhum estado
repopulado, nenhum plaintext devolvido.

## 9. Ciclo de vida

| Evento | Ação |
|---|---|
| Lock / background | Zera `thumbnailLru`, URIs do state, viewer, preview. **Cache `.thumb.enc` intacto.** |
| Startup | Varre `tmp/` e `enc/`. O cache persistente é invisível para essa varredura. |
| Logout / troca | `PhotoVaultContext` `useEffect([uid])` → `pruneCachedThumbnailsExcept(uid)`: remove todo namespace que não seja o uid atual. Cobre A→B e logout (`uid === null` remove tudo) sem rastrear o uid anterior. Incrementa o epoch. |
| Delete de foto | `removeCachedThumbnail(uid, photoId)` junto da limpeza de RAM existente. |
| Refresh | Reconciliação após o emit da listagem, sem bloquear render, com limite por execução. |
| Restart | Ciphertext local sobrevive quando o SO não o removeu. Após unlock: lê local, decrypt, render, sem rede. |

## 10. Full images — inalteradas

Nesta fase **nada** muda no pipeline de armazenamento, decrypt ou cache das
imagens completas. `downloadProgressPhoto`, `downloadAsset` para `full` e
`legacy-full`, `decryptPhotoFile`, `fullLru` e `discardDecryptedPhoto`
permanecem como estão. A full continua sendo decriptada para
`<cache>/photo-vault/tmp/*.jpg` e apagada no lock.

O viewer pode consumir a thumbnail Base64 como placeholder — ele já usa
`fullUri ?? thumbnailUri ?? previewUri` e passa a aceitar os dois formatos de
URI. Cache persistente de `.enc` full permanece **fora de escopo**.

Consequência para fotos legadas (§38): o fallback `legacy-full` do grid continua
produzindo URI de arquivo e alimentando `fullLru`. `downloadProgressPhotoThumbnail`
passa a devolver um resultado discriminado — `thumbnail` com data URI RAM-only,
ou `legacy-full` com URI de arquivo. Nenhuma thumbnail cifrada é inventada para
foto que não tem uma, e o schema legado não é tocado.

## 11. Instrumentação

Stages novos no vocabulário fechado de `photoVaultPerformance`:
`gallery.thumbnail.cache-read`, `gallery.thumbnail.cache-write`,
`gallery.thumbnail.cache-hit.render-ready`,
`gallery.thumbnail.cache-miss.render-ready`. Mais um contador sanitizado de
requests Storage evitados. Nenhum `photoId`, uid, path ou URI entra em log.

## 12. Testes

Cache service: miss, hit, write, atomic write, read, remove, remove user,
corrupted, truncated, wrong size, cleanup stale, LRU, size limit, touch
throttled, recência após restart simulado.

Download: hit não chama Storage; miss chama exatamente uma vez; segunda abertura
é hit.

Ciclo: restart simulado, lock preserva ciphertext e apaga plaintext, logout,
troca de usuário, race de conclusão tardia, delete, corrupção com redownload,
offline com cache.

Auditoria estrutural: nenhum `.jpg`/`.jpeg`/`.png`/`.webp` privado em diretório
persistente do Vault; nenhum plaintext em AsyncStorage, SecureStore ou
`documentDirectory`; ausência de `getDownloadURL` e `memory-disk`; o cache
persistente sobrevive a `cleanupPhotoVaultTempFiles({ includeEncrypted: true })`.

## 13. Fora de escopo

Cache persistente de full `.enc` (§37). Download com vault locked para aquecer
cache (§36). Rules, Functions, App Check, orphan cleanup backend (§40–§42).
Remoção da Vault Key local no logout (decisão registrada em 2.1c). RevenueCat.
Qualquer deploy.

Sem módulo nativo novo: apenas `expo-file-system` e `expo-crypto` já
instalados. O development build atual serve (§55).

## 14. Pendências que esta fase não resolve

Os benchmarks físicos (§54 e relatório §26–§28) exigem aparelho real e
permanecem **pendentes** para validação humana após a implementação. A entrega
inclui a instrumentação e o procedimento; não inclui números fabricados a partir
de mocks ou CI.
