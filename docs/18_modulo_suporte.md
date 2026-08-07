# Módulo de Suporte

## Escopo atual

O aplicativo disponibiliza Central de Ajuda, Reportar Problema e Enviar
Sugestão. Artigos são fornecidos por um repositório local que implementa
`HelpArticleRepository`; uma futura origem Firestore pode substituir essa
implementação sem alterar as telas.

O aplicativo cria tickets e a primeira mensagem. O mesmo projeto Firebase
também atende ao painel administrativo. Notificações e rotinas de backend
continuam fora desta fase.

## Firestore

Documento `supportTickets/{ticketId}`:

```txt
id, userId, userName, userEmail, type, subject, status, priority,
lastMessage, createdAt, updatedAt, appVersion, platform, osVersion,
deviceModel, language, attachmentsCount
```

Subcoleção `supportTickets/{ticketId}/messages/{messageId}`:

```txt
senderType, senderId, message, attachments, createdAt, readAt
```

Enums persistidos não são traduzidos. Tipos: `BUG`, `FEEDBACK`, `SUPPORT`.
O cliente sempre cria `status = OPEN`, `priority = NORMAL` e
`senderType = USER`. Ticket e primeira mensagem são gravados no mesmo batch.

As regras preservam o fluxo mobile: o usuário autenticado cria tickets, cria
mensagens `USER` e lê somente tickets e mensagens próprios. Ele não altera nem
exclui tickets ou mensagens e não pode criar conteúdo `ADMIN`.

## Painel administrativo

O painel usa Firebase Authentication com e-mail e senha. Depois do login, lê
somente `users/{uid}` do próprio operador e exige `metadata.role = admin`. Esse
papel é provisionado exclusivamente pelo backend; as regras do cliente impedem
criação de conta com outro papel e qualquer alteração posterior de
`metadata.role`.

Administradores podem listar e abrir todos os tickets, ler suas conversas,
responder e atualizar somente:

```txt
status, priority, assignedTo, lastMessage, updatedAt, lastReplyAt, closedAt
```

Status aceitos: `OPEN`, `IN_PROGRESS`, `WAITING_USER`, `RESOLVED`, `CLOSED`.
Prioridades aceitas: `LOW`, `NORMAL`, `HIGH`, `CRITICAL`. A atribuição usada pelo
painel é limitada ao UID do próprio administrador autenticado. `updatedAt`,
`lastReplyAt` e `closedAt` usam timestamps do servidor; `closedAt` só recebe
timestamp em `CLOSED` e fica `null` nos demais status.

Uma resposta administrativa é atômica: cria uma mensagem `ADMIN`, sem anexos,
e atualiza `lastMessage`, `updatedAt` e `lastReplyAt` no ticket no mesmo batch.
Administradores não ganham permissão para excluir tickets, editar/excluir
mensagens, listar usuários ou acessar perfis de terceiros.

Se dois operadores responderem simultaneamente, o Firestore pode confirmar os
dois batches em sequência ou recusar um deles durante a validação concorrente.
Em ambos os casos cada batch permanece indivisível: não existe mensagem sem o
update pareado do ticket. O painel apresenta a falha para permitir reenvio.

Uma conta administrativa mantém os fluxos comuns do aplicativo para o próprio
documento (perfil, foto, idioma e unidades). O papel `admin` é aceito como estado
válido já provisionado, mas criação pelo cliente continua restrita a `user` e o
campo permanece imutável em qualquer atualização.

### Fonte de verdade e manutenção

`firestore.rules`, `storage.rules` e `firestore.indexes.json` deste repositório
são a única fonte de verdade da infraestrutura compartilhada. O projeto Web não
deve publicar versões próprias desses arquivos. Toda mudança futura do painel
deve ser mesclada aqui, mantendo separados os ramos de proprietário e de
administrador e acompanhada por testes no Emulator Suite.

A evolução recomendada é migrar a autorização administrativa para custom claim
(`request.auth.token.admin == true`), reduzindo leituras auxiliares nas Rules.
Até essa migração, a promoção e a revogação do papel no documento do usuário
devem permanecer operações exclusivas de backend.

### Índices do painel

`firestore.indexes.json` contém 9 índices compostos: cada filtro opcional
(`status`, `type`, `priority`) combinado com cada ordenação usada
(`updatedAt desc`, `createdAt desc`, `createdAt asc`). O Firestore mescla esses
índices para consultas com dois ou três filtros de igualdade, evitando 12
combinações redundantes. Consultas sem filtros e a conversa ordenada por
`createdAt` usam índices de campo único automáticos. Pesquisa textual e ranking
de prioridade continuam locais no navegador e não possuem índices dedicados.

## Storage

Anexos são imagens de até 8 MB em:

```txt
users/{userId}/support/{ticketId}/attachments/{attachmentId}.{ext}
```

O documento da mensagem armazena uma lista de objetos `{ url, path, type }`.
A interface atual limita a uma imagem, mantendo o contrato preparado para
múltiplos anexos.

O painel não usa o SDK do Storage nem envia anexos: ele somente renderiza as
URLs HTTPS já persistidas nas mensagens. Por isso, as regras de Storage seguem
exclusivamente proprietárias e não receberam permissão administrativa.

## Metadados automáticos

O app coleta UID, nome e e-mail do contexto autenticado; plataforma e versão do
SO do React Native; versão do app de `expo-constants`; idioma de
`expo-localization`; modelo do dispositivo quando exposto pela plataforma; e
timestamps do servidor.

## Limitações

- FAQ ainda é local.
- Não existe listagem ou acompanhamento de chamados no app mobile.
- Não há push ou Cloud Functions para o módulo.
- Se o upload concluir e o batch Firestore falhar, o arquivo pode permanecer
  órfão; uma rotina backend de limpeza é recomendada antes de múltiplos anexos.
- O suporte depende de conexão para envio, consistente com a exigência de
  confirmação real da gravação do chamado.
