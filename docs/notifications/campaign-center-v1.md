# Central de Campanhas de Push — V1

## Arquitetura

`notificationCampaigns/{id}` guarda definição, versão CAS, status, próxima ocorrência e autoria. Cada ocorrência usa `runs/{campaignId}.{scheduledAtMs}`. O run congela conteúdo, público, janela e fuso. `recipients/{uid}` tem ID determinístico, horário distribuído por hash estável, lease de worker, referência ao dispatch e `openedAt` idempotente. Esses dois níveis expiram em 90 dias por TTL.

O scheduler `processNotificationCampaigns` executa a cada minuto. Ele materializa ocorrências em transação, varre o público em páginas de até 250 usuários, cria destinatários com `batch.create`, envia lotes de até 2.000 destinatários por execução e retoma leases vencidos. Cursores persistentes fazem a seleção percorrer runs e campanhas posteriores mesmo quando as mais antigas aguardam `dueAt`. A pausa suspende fan-out e novos envios, inclusive retries; a retomada restaura runs e permite os retries no mesmo dispatch. Cancelamento interrompe fan-out, recipients ainda não iniciados e retries; requisições já iniciadas à Expo ainda podem terminar. O dispatcher existente continua responsável por dispositivos, preferências, Expo Push API, retries, receipts, invalidação de token e histórico em `notificationDispatches`/`deliveries`.

`nextAttemptAt` permanece exclusivo do estado `RETRY_SCHEDULED`. A janela inicial da campanha usa `recipients.dueAt`; ela não altera a semântica de retry. O hash de `runId:uid` distribui cada destinatário de forma reproduzível dentro da janela.

Uma run conclui somente depois de materializar todo o público, resolver todos os recipients e não restar dispatch em claim, retry ou aguardando receipt. A campanha sem próxima ocorrência conclui quando todas as suas runs concluem. Recipients com erro permanente ficam em `FAILED_PERMANENT`; dispatches já existentes são reconciliados por ID determinístico após falha entre dispatch e recipient.

Métricas da página de detalhe: `segmentUsers` conta recipients materializados (não elegibilidade push); `remainingRecipients` conta `PENDING`/`CLAIMED`; `dispatchesCreated` conta dispatches lógicos; `attemptedUsers` conta dispatches com tentativa persistida e ao menos um dispositivo selecionado; `acceptedUsers` conta dispatches que tiveram algum ticket aceito pela Expo (`everAccepted` histórico); `receiptConfirmedUsers` conta dispatches com ao menos um receipt positivo de FCM/APNs; `failedDispatches` conta dispatches em falha terminal ou parcial; `permanentRecipientErrors` conta erros permanentes antes do dispatch; `receiptUnconfirmedUsers` conta `RECEIPT_EXHAUSTED` separadamente; `openedUsers` conta recipients com abertura idempotente. Ticket ou receipt não comprovam exibição no aparelho. O alcance antes do agendamento conta usuários do segmento; preferências, exclusão de conta e disponibilidade de dispositivos podem reduzir o envio real.

## Deploy

1. Publicar a versão mobile com payload `CAMPAIGN`, destinos tipados (`home`, `workout`, `progress`, `profile`) e callable `recordCampaignOpen`. Validar App Check em builds iOS e Android.
2. Publicar `firestore.rules` e `firestore.indexes.json`. Aguardar os índices compostos e TTL de `runs.expireAt` e `recipients.expireAt` ficarem ativos.
3. Publicar Cloud Functions, incluindo `processNotificationCampaigns` e as callables `admin*Campaign`/`recordCampaignOpen`.
4. Publicar `ajfit-admin` e testar com uma lista pequena de UIDs antes de agendar campanhas amplas.

Não há backfill ou migração de documentos existentes. As callables admin usam `users/{uid}.metadata.role == 'admin'` no backend. Clientes não têm leitura ou escrita direta em campanhas, runs, recipients ou dispatches.

## Limites operacionais

- O scheduler processa até 2.000 destinatários por execução de um minuto, além do fan-out paginado. Uma campanha imediata de 100 mil pessoas pode levar aproximadamente 50 minutos para escoar, dependendo de quotas, dispositivos e concorrência. Cursores persistentes dão progresso eventual entre muitas runs, mas não garantem terminar uma janela curta sob backlog alto.
- A Expo Push API não fornece chave de idempotência no envio externo. O Firestore deduplica run, recipient e dispatch, mas uma falha entre o aceite do provedor e a persistência do resultado deixa o envio ambíguo. O pipeline existente pode tentar novamente após claim vencido. Não é possível provar entrega externa "no máximo uma vez" nesse ponto sem suporte do provedor.
- A Expo aceita `richContent.image` no Android. Para exibir imagem remota no iOS é necessária uma Notification Service Extension nativa; a V1 mantém título, mensagem e navegação no iOS.
- Aberturas são armazenadas em uma fila local limitada por UID no toque e reenviadas quando o mesmo usuário estiver autenticado. A callable é idempotente e exige dispatch com ticket aceito. Um encerramento do processo antes da escrita no storage local ainda pode perder o evento.
