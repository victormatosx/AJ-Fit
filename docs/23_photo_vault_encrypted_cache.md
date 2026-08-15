# Photo Vault — cache local criptografado de thumbnails

Fase 13B. Cliente mobile apenas: nenhuma Rule, Function, Auth ou App Check foi
alterada.

## 1. Ameaça e decisão

Antes desta fase, o cache era só em memória e morria no lock. Cada unlock
repetia `Storage → download → decrypt → render` para toda thumbnail visível,
colocando a rede no caminho crítico de conteúdo que o aparelho já havia baixado.

A decisão é persistir **somente ciphertext**. Um `.thumb.enc` é um envelope
AES-256-GCM completo: sem a Vault Key — que fica no Keychain/Keystore e nunca no
diretório de cache — o arquivo não revela nada. Por isso ele pode sobreviver ao
lock, ao background e ao restart, enquanto toda representação em claro é
destruída no primeiro desses eventos.

O cache **não é fonte de verdade**. Firebase é. O SO pode reclamar o
`cacheDirectory` a qualquer momento e a única consequência permitida é um novo
download.

## 2. Hierarquia

```text
RAM plaintext (data URI base64, LRU de 20)   ← só enquanto unlocked
  ↓ miss
disco ciphertext .thumb.enc do uid            ← sobrevive lock/restart
  ↓ miss
Firebase Storage getBytes                     ← origem
```

Centralizada em `progressPhotos.downloadProgressPhotoThumbnail`. A UI não sabe
que existe cache.

## 3. Diretório

```text
<cacheDirectory>/photo-vault/
├── tmp/                      plaintext temporário (fulls) — varrido no lock
├── enc/                      staging de upload — varrido no cold start
└── encrypted-thumbnails/     ciphertext persistente
    └── {uid}/
        └── {photoId}.thumb.enc
```

`encrypted-thumbnails` é **irmão** de `tmp` e `enc`, nunca filho.
`cleanupPhotoVaultTempFiles` lista exatamente esses dois nomes, então o cache é
fisicamente invisível para a varredura de startup. A sobrevivência é garantida
pelo layout, não por uma condicional que alguém possa remover sem perceber.
Coberto por teste dedicado em `photoVaultCacheLifecycle.test.ts`.

## 4. Namespace por uid

O isolamento é o caminho físico, não um campo de metadata. `uid` e `photoId` são
validados contra `/^[A-Za-z0-9._-]+$/`, limitados a 128 caracteres e rejeitados
se contiverem `..` — o mesmo padrão de falha fechada de
`photoVaultKeyStorage.storageKeyFor`. Um id de documento inesperado não constrói
caminho.

A chave de cache deriva exclusivamente de uid autenticado + photoId. Nunca de
nome original, e-mail, URL ou timestamp.

## 5. Escrita atômica

Escreve em `{uid}/.tmp-<uuid>` e faz `moveSync` para o nome final. O nome final
só passa a existir quando o conteúdo está completo, então um arquivo
parcialmente escrito nunca é lido como cache hit. Temporários abandonados por um
crash são varridos na próxima manutenção e nunca são servidos.

Falha de escrita não é fatal: a foto ainda renderiza a partir dos bytes já em
memória, e o custo é um download futuro.

## 6. Validação

Idêntica para cache local e rede, na mesma função (`validateEncryptedAsset`).
Um arquivo deste aparelho não recebe menos escrutínio que um recém-baixado:

1. tamanho igual a `thumbnailEncryptedSize` do Firestore;
2. envelope: MAGIC `AJFV`, `version`, IV conferido contra `thumbnailEncryption.iv`;
3. `vaultKeyVersion` corrente;
4. tag GCM no decrypt.

**Corrupção:** entrada removida → **um único** redownload, controlado por
retorno e não por loop → se falhar de novo, o erro real é propagado. Corrupção
remota nunca é mascarada.

## 7. Plaintext: o que existe e o que não existe

Esta é a parte que precisa ser lida literalmente.

| Afirmação | Verdadeiro? |
|---|---|
| Não há plaintext de thumbnail no filesystem | **Sim** |
| Não há `Uint8Array` plaintext de thumbnail no heap JS | **Sim** |
| Não há plaintext de thumbnail em RAM | **Não.** Existe, em Base64 |

`aesDecryptAsync(sealed, key, { output: 'base64' })` produz a string dentro do
módulo nativo, então o JPEG nunca vira array de bytes no JS e nunca toca o
disco. Mas **Base64 descriptografado é plaintext**. Ele vive no heap JS
enquanto o Vault está unlocked, alimentando `data:image/jpeg;base64,…` no
`<Image>` do React Native.

A proteção é o limite do LRU (20 entradas) e o ciclo de vida — lock, background,
logout e troca de usuário zeram as referências — **não** a ausência do dado.

Limitação registrada: uma `String` JavaScript é imutável e **não pode ser
zerada**. Um `Uint8Array` podia receber `.fill(0)`, como o pipeline de upload
ainda faz. A troca foi "plaintext em disco, igualmente não zerável depois de
escrito" por "plaintext em heap, não zerável, que desaparece com o lock e nunca
sobrevive ao processo". É ganho líquido, e a limitação fica documentada em vez
de omitida.

Overhead: JPEG 480px/0,75 de ~40–60 KB → string de ~53–80 KB. Vinte entradas ≈
1,1–1,6 MB de strings, contra os ~17,6 MiB de bitmaps decodificados que o mesmo
LRU já implicava. A string nunca é logada, nunca vai para AsyncStorage ou
SecureStore e nunca é persistida.

## 8. Limites e LRU

* **24 MB** (limite primário, por bytes);
* **300 entradas** (proteção contra muitos arquivos pequenos).

Nenhuma metadata é persistida — não há sidecar. Recência é
`max(acesso em RAM nesta sessão, File.lastModified)`.

**Recência sobrevive ao restart.** Ler um arquivo não atualiza `lastModified`
(atualiza `atime`, que o `expo-file-system` não expõe e que costuma estar
desabilitado por `noatime`). Sem tratamento, a ordenação pós-restart degradaria
para ordem de inserção e uma foto aberta todos os dias seria despejada antes de
uma nunca mais reaberta.

Tratamento: **touch throttled**. Em cache hit com `lastModified` mais antigo que
12 h, os bytes recém-lidos e já validados são reescritos pelo mesmo caminho
atômico. Custo amortizado: no máximo uma reescrita de algumas dezenas de KB por
entrada por 12 h. Passar pelo caminho atômico importa — um crash no meio do
touch não pode corromper uma entrada que já era válida.

## 9. Ciclo de vida

| Evento | Plaintext RAM | Cache `.thumb.enc` |
|---|---|---|
| Lock / background | removido | **preservado** |
| Cold start | n/a | **preservado** |
| Logout | removido | removido (todos os namespaces) |
| Troca de usuário | removido | removido, exceto o uid atual |
| Delete de foto | removido | entrada removida |
| Refresh | preservado | entradas órfãs removidas |

Logout e troca usam `pruneCachedThumbnailsExcept(uid)`, expresso como "manter
apenas quem está logado" em vez de "remover o anterior". Fica correto sem
rastrear quem estava logado antes, e cobre logout (`null` não mantém nada) e
namespaces deixados por uma conta que este install nunca viu logar.

## 10. Race de identidade

Apagar o namespace não bastava. Uma operação assíncrona iniciada pela sessão
anterior podia resolver depois do logout e recriar o cache de A ou repopular a
galeria. Dois guardas independentes:

**Epoch do cache.** O módulo de cache mantém um contador que
`pruneCachedThumbnailsExcept` incrementa. `writeCachedThumbnail` recusa um write
com epoch antigo. A checagem e o `moveSync` são síncronos no mesmo turno do
runtime single-threaded, então não há ponto de interleaving entre validar e
gravar — a janela fecha por completo.

**Geração de sessão.** `photoVaultSessionGeneration()` é incrementado ao abrir e
ao fechar a sessão. `progressPhotos` captura na entrada e revalida antes de
devolver plaintext. Isso pega inclusive o caso que o uid sozinho não pega: um
ciclo logout/login **da mesma conta**, onde o uid volta a bater mas a sessão é
outra.

O `generation` de `photoVaultGallery` continua guardando o estado React. Os três
atuam em camadas diferentes e não se substituem.

Ambos os guardas foram verificados por mutação: removê-los faz os testes de race
falharem.

## 11. Full images — inalteradas

Nada mudou no pipeline de armazenamento, decrypt ou cache das imagens completas.
A full continua sendo decriptada para `<cache>/photo-vault/tmp/*.jpg` e apagada
no lock. **Não existe cache persistente de `.enc` full**, e isso permanece fora
de escopo.

O viewer consome a thumbnail Base64 como placeholder e aceita os dois formatos
de URI. Fotos legadas sem thumbnail continuam usando o fallback controlado para
a full, que produz URI de arquivo — nenhuma thumbnail cifrada é inventada para
foto que não tem uma, e o schema legado não foi tocado.

## 12. Offline

Uma thumbnail já cacheada aparece depois do unlock **sem rede**. Uma nunca
cacheada mantém o comportamento offline anterior. Este é um ganho real de
usabilidade, não só de performance.

## 13. Instrumentação

Stages no vocabulário fechado de `photoVaultPerformance`:
`gallery.thumbnail.cache-read`, `cache-write`, `cache-hit.render-ready`,
`cache-miss.render-ready`, mais os contadores `hits`/`misses`/`avoidedRequests`.

Apenas durações e agregados. O módulo não contém sequer os literais `uid`,
`photoId`, `storagePath` ou `vaultKey` — há teste garantindo isso.

```bash
EXPO_PUBLIC_PHOTO_VAULT_PERF=1 npx expo start --dev-client --clear
```

## 14. Ganho de IO

| | Antes | Depois |
|---|---|---|
| Cache miss | 3 escritas + 2 leituras + 1 request | 1 escrita + 1 request |
| Cache hit | não existia | 1 leitura, **0 requests** |

O fluxo anterior escrevia o `.enc` baixado, relia para descriptografar,
escrevia o `.jpg` em claro e o apagava depois. Agora o decrypt roda sobre os
bytes já em memória nos dois ramos.

## 15. Benchmarks físicos — pendentes

Os números reais exigem aparelho e **não foram medidos**. A instrumentação e o
procedimento estão prontos; a tabela abaixo só pode ser preenchida por execução
humana, no mesmo aparelho e na mesma rede. Não preencher a partir de mocks ou CI.

| Operação | Cache miss | Cache hit | Observação |
|---|---:|---:|---|
| unlock → primeira thumbnail | pendente | pendente | após lock/unlock |
| unlock → grid completo | pendente | pendente | mesmas fotos |
| decrypt por thumbnail | pendente | pendente | |
| requests Storage no unlock | pendente | pendente | esperado 0 no hit |
| armazenamento local usado | pendente | — | medir `.thumb.enc` real |

Medir o tamanho real de um `.thumb.enc` é o que valida os 24 MB / 300 entradas.
O teto por arquivo já validado no código é 512 KB
(`MAX_THUMBNAIL_ENCRYPTED_BYTES`); a estimativa de 40–60 KB precisa de
confirmação.

## 16. Segurança invariável

* Storage continua recebendo somente envelopes AJFV `application/octet-stream`.
* Sem `getDownloadURL`, sem cache `memory-disk`, sem `expo-image`, sem
  AsyncStorage e sem `documentDirectory` para fotos.
* Locked continua sem renderizar thumbnail. Ciphertext local não é atalho:
  sem unlock não há chave, sem chave não há decrypt.
* Nenhuma API pública aceita uid ou storagePath arbitrário.
* Nenhum módulo nativo novo — só `expo-file-system` e `expo-crypto` já
  instalados. O development build atual serve.
