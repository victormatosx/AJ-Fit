# Photo Vault — validação de performance da Fase 13

## Arquitetura medida

```text
picker → full JPEG 1600px/0,85
       → thumbnail JPEG 480px/0,75
       → AES-256-GCM independente (IV full != IV thumbnail)
       → uploads paralelos de ciphertext
       → metadata Firestore atômica

Firestore list → grid imediato → thumbnail download/decrypt (5 lanes)
toque → viewer com thumbnail → full download/decrypt (2 lanes) → substituição
```

Os timings são opt-in, somente em development e registram apenas estágio e
duração. Não contêm URI, uid, photoId, chave, token ou payload.

```bash
EXPO_PUBLIC_PHOTO_VAULT_PERF=1 npx expo start --dev-client --clear
```

Labels esperadas: `picker.*`, `upload.*`, `gallery.firestore.list`,
`gallery.thumbnail.*`, `viewer.*` e `delete.*`.

O staging de resultados do `ImageManipulator` usa a cópia nativa
`File.copy()` do `expo-file-system` 56 para evitar o antigo ciclo
arquivo → `Uint8Array` JS → arquivo. A cópia ainda é movida imediatamente para
o subtree de temporários coberto pelo cleanup de crash/startup.

No upload, o envelope `.enc` é aberto como `Blob` nativo pelo networking do
React Native antes de ser entregue ao Firebase Storage. Isso evita que o
multipart de arquivos pequenos (principalmente a thumbnail) tente construir
um `Blob` a partir de `ArrayBufferView`, operação não suportada no React Native
0.85. O adaptador recebe somente ciphertext, valida o tamanho oficial do
envelope e libera o recurso nativo depois que ambos os uploads terminam.

## Benchmark físico obrigatório

Executar antes/depois no mesmo aparelho e na mesma rede. A baseline anterior
deve vir de um build do código pré-Fase-13; não fabricar números a partir de
mocks ou CI.

| Operação | Antes | Depois | Observação |
|---|---:|---:|---|
| unlock → primeira thumbnail | pendente | pendente | aparelho/rede iguais |
| toque → primeira imagem no viewer | pendente | pendente | thumbnail conta |
| toque → full pronta | pendente | pendente | medir separadamente |
| seleção → card visível | pendente | pendente | tempo percebido |
| seleção → backend confirmado | pendente | pendente | tempo total |
| confirmar delete → card oculto | pendente | pendente | tempo percebido |
| confirmar delete → backend confirmado | pendente | pendente | tempo total |

## Fase 13B — cache cifrado

A arquitetura acima descreve a Fase 13. A Fase 13B inseriu um nível entre o
Firestore e o Storage:

```text
RAM plaintext (data URI base64) → disco ciphertext .thumb.enc → Storage
```

Para uma foto já conhecida, a rede sai do caminho crítico depois do primeiro
download. A thumbnail em claro deixou de ser arquivo e passou a existir somente
em memória. O pipeline da full continua exatamente como medido aqui.

Benchmarks de cache hit vs. miss ficam em
`23_photo_vault_encrypted_cache.md` §15 e continuam **pendentes** de aparelho
físico.

## Segurança invariável

* Firebase recebe apenas envelopes AJFV `application/octet-stream`.
* Thumbnail plaintext existe somente em RAM (Base64), nunca em disco. Full
  plaintext existe somente como temporário controlado durante uso.
* Não há `getDownloadURL`, cache `memory-disk`, AsyncStorage ou
  `documentDirectory` para fotos.
* Lock invalida geração assíncrona e limpa thumbnail, full, preview e viewer.
* Rollback tenta remover os dois objetos; falhas são cobertas pela rotina
  conservadora de órfãos (sete dias + confirmação de 24 horas).

Como a `ProgressPhotosScreen` mantém a política da Fase 12 de travar ao sair da
área privada, o LRU acelera scroll e reaberturas do viewer dentro da sessão
atual. Navegar definitivamente para Home trava e destrói o cache, mesmo que
reter thumbnails fosse mais rápido — segurança prevalece.

## Paginação

A consulta continua sem paginação nesta entrega porque a base observada é
pequena e o gargalo dominante era baixar a full para cada card. Antes de uma
galeria poder chegar a centenas/milhares de documentos, introduzir cursor
Firestore e carregamento incremental de 20–30 itens sem alterar o schema.
