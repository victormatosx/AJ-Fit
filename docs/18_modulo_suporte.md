# Módulo de Suporte

## Escopo atual

O aplicativo disponibiliza Central de Ajuda, Reportar Problema e Enviar
Sugestão. Artigos são fornecidos por um repositório local que implementa
`HelpArticleRepository`; uma futura origem Firestore pode substituir essa
implementação sem alterar as telas.

O aplicativo cria tickets e a primeira mensagem. Respostas administrativas,
atribuição, notificações e painel administrativo permanecem fora desta fase.

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

As regras permitem ao usuário autenticado criar e ler apenas seus tickets e
mensagens. Atualização/exclusão do ticket e mensagem são negadas ao cliente;
status, prioridade, atribuição e mensagens administrativas ficam reservados ao
backend/Admin SDK.

## Storage

Anexos são imagens de até 8 MB em:

```txt
users/{userId}/support/{ticketId}/attachments/{attachmentId}.{ext}
```

O documento da mensagem armazena uma lista de objetos `{ url, path, type }`.
A interface atual limita a uma imagem, mantendo o contrato preparado para
múltiplos anexos.

## Metadados automáticos

O app coleta UID, nome e e-mail do contexto autenticado; plataforma e versão do
SO do React Native; versão do app de `expo-constants`; idioma de
`expo-localization`; modelo do dispositivo quando exposto pela plataforma; e
timestamps do servidor.

## Limitações

- FAQ ainda é local.
- Não existe listagem ou acompanhamento de chamados no app.
- Não há resposta administrativa, push ou Cloud Functions.
- Se o upload concluir e o batch Firestore falhar, o arquivo pode permanecer
  órfão; uma rotina backend de limpeza é recomendada antes de múltiplos anexos.
- O suporte depende de conexão para envio, consistente com a exigência de
  confirmação real da gravação do chamado.
