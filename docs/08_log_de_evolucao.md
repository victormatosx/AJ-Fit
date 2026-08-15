# Log de Evolução

## 1. Objetivo deste documento

Registrar a evolução do projeto.

Registrar decisões.

Registrar alterações aprovadas.

Registrar pendências.

Registrar divergências.

Registrar eventos importantes do desenvolvimento.

Este documento é a fonte oficial de histórico do projeto.

---

# 2. Regras gerais

Toda decisão relevante deve ser registrada.

Nenhuma decisão importante deve existir apenas em conversas temporárias.

O log deve refletir a evolução real do projeto.

---

# 3. Quem pode registrar entradas

Podem registrar entradas:

* humano coordenador
* agente PO
* agente arquiteto
* agente backend
* agente frontend
* agente QA
* demais agentes autorizados

---

## Regra obrigatória

Toda entrada deve informar:

* data
* responsável
* categoria
* descrição

---

# 4. Categorias oficiais

## [DECISÃO]

Decisões aprovadas.

---

## [REQUISITO]

Novos requisitos aprovados.

---

## [IMPLEMENTAÇÃO]

Mudanças técnicas relevantes.

---

## [CORREÇÃO]

Correções importantes.

---

## [PENDENTE]

Informações aguardando decisão humana.

---

## [QUESTIONAMENTO]

Possíveis inconsistências identificadas.

---

## [CONFLITO]

Contradições entre documentos.

---

## [BLOQUEIO]

Impossibilidade de execução.

---

## [DESCARTADO]

Ideias avaliadas e rejeitadas.

---

# 5. Estrutura obrigatória das entradas

Modelo:

```txt id="iw7k6j"
Data:
Responsável:
Categoria:

Descrição:

Impacto:

Próxima ação:
```

---

# 6. Registro de decisões

Toda decisão aprovada deve registrar:

* o que foi decidido
* motivo da decisão
* impacto esperado

---

# 7. Registro de requisitos

Todo requisito novo deve registrar:

* requisito
* origem
* documentos impactados

---

# 8. Registro de implementação

Alterações relevantes devem registrar:

* módulo afetado
* alteração realizada
* motivo

---

# 9. Registro de correções

Correções devem registrar:

* problema encontrado
* causa identificada
* solução aplicada

---

# 10. Registro de pendências

Pendências devem registrar:

* informação ausente
* responsável esperado
* impacto da ausência da decisão

---

# 11. Registro de conflitos

Conflitos devem registrar:

* documentos envolvidos
* descrição da contradição
* necessidade de validação humana

---

# 12. Registro de bloqueios

Bloqueios devem registrar:

* causa
* impacto
* condição necessária para desbloqueio

---

# 13. Registro de itens descartados

Toda ideia descartada deve registrar:

* proposta original
* motivo do descarte

---

# 14. Ordem das entradas

As entradas devem ser registradas em ordem cronológica.

A entrada mais recente deve permanecer no topo do arquivo.

---

# 15. Restrições

Não registrar:

* discussões irrelevantes
* opiniões sem impacto
* alterações temporárias
* informações duplicadas

---

# 16. Leitura obrigatória

Todos os agentes devem consultar este documento antes de iniciar uma tarefa.

A leitura deve focar nas entradas relevantes para a atividade atual.

---

# 17. Exemplo de entrada

```txt id="ht4v7m"
Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso do RevenueCat para gerenciamento de assinaturas.

Impacto:
Integração obrigatória com App Store e Google Play.

Próxima ação:
Criar documentação específica de billing.
```

---

# 18. Primeiras entradas do projeto

Data: 2026-08-12
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado localmente o hardening pré-lançamento do Photo Vault (Fase 12).
A proteção visual usa `expo-screen-capture` apenas enquanto a área privada está
aberta, com bloqueio antes do render privado, overlay neutro no lifecycle,
proteção do app switcher e retorno sempre travado. Sair da tela Fotos agora
revoga a sessão e libera a proteção somente depois do frame seguro.

O grid foi migrado para `FlatList`, mantendo duas colunas e limite global de
três downloads. Célula e viewer compartilham uma única URI plaintext, removida
quando o último owner sai. Resultados do manipulator são movidos para o cache
controlado; cold start remove plaintext e staging cifrado sem retomada possível;
buffers plaintext próprios são zerados após uso.

Criado módulo Expo local `AJFitAppCheck`: Android usa Debug Provider em Debug e
Play Integrity em Release; iOS usa Debug Provider em Debug e App Attest em
Release, sem DeviceCheck. O token e a expiração oficiais alimentam um
`CustomProvider` ligado à mesma Firebase JS App. Auth, Firestore, Storage e
Functions permanecem no Firebase JS SDK. Enforcement não foi ativado porque a
prova runtime real ainda é obrigatória.

Criada scheduled Function local `cleanupPhotoVaultOrphans`, com idade mínima de
7 dias, confirmação adicional de 24 horas, segunda leitura e precondições de
generation/updateTime. Storage/Firestore são paginados; falhas individuais não
abortam o lote; logs não contêm uid/path/photoId. A Function não foi publicada.

Validação automática:
1.423 testes mobile, 182 testes backend (2 KMS integration skips), 107 testes
Firestore Rules, 33 Storage Rules, 550 i18n, typechecks, build backend,
`expo-doctor` e `git diff --check` aprovados. Android Debug APK e iOS arm64
sem assinatura compilaram; instalação/runtime físico da Fase 12 permanece
pendente. `npm audit --omit=dev` registrou 21 alertas mobile e 9 backend;
nenhum fix forçado/breaking foi aplicado. Runbook em
`docs/21_photo_vault_pre_launch.md`.

Impacto:
Nenhum deploy, enforcement ou alteração de Console foi feito. RevenueCat e
billing ficaram intocados; não houve merge nem deploy geral.

Próxima ação:
Registrar debug tokens manualmente, executar matriz física iOS/Android, validar
App Check em Functions/Firestore/Storage sem enforcement e revisar o deploy
seletivo de `cleanupPhotoVaultOrphans`. Só então decidir rollout progressivo.

---

Data: 2026-08-04
Responsável: Agente Frontend + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Consolidada a infraestrutura final de internacionalização para `pt-BR`, `en`
e `es`. O registro de resources e namespaces passou a ter fonte única em
`src/i18n/resourceCatalog.ts`; o helper global de paridade agora detecta
chaves ausentes/extras, folhas vazias e valores não-string. Foram adicionados
os comandos `i18n:check`, `i18n:audit` e `quality`, além da documentação
permanente em `docs/17_internacionalizacao.md`.

O baseline contém 9 namespaces, 582 folhas por idioma e 1.746 traduções. O
auditor registra 33 hardcodes visuais suspeitos existentes e seis números de
mock legados em `home`, mantidos em allowlist explícita. Os guards de Assessment
foram classificados como regressões permanentes de payload, fórmulas,
protocolos e queries, apesar dos nomes históricos dos arquivos.

Impacto:
Novos namespaces entram automaticamente na paridade ao serem registrados no
catálogo. Erros estruturais encerram a auditoria com falha; hardcodes suspeitos
são reportados para triagem humana. Nenhuma lógica funcional, autenticação,
sincronização, persistência, fórmula ou protocolo foi alterado.

Próxima ação:
Revisão editorial contínua e tratamento autorizado dos hardcodes registrados
no baseline. Não houve deploy.

Data: 2026-08-11
Responsável: Codex — Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada localmente a Fase 3 — persistência e revalidação do Premium — sem
alterar a arquitetura de billing, o Paywall ou o backend.

- `SubscriptionContext` passou a representar separadamente Auth pendente,
  configuração do RevenueCat, sincronização de identidade, estado pronto,
  refresh e erro. `unknown`/erro inicial não é tratado como não Premium.
- Toda identidade possui Firebase UID + geração monotônica. Logout/troca de
  conta invalida imediatamente CustomerInfo e Offerings anteriores; respostas
  de sync, refresh, compra, restore e listener só são aplicadas se UID + geração
  ainda corresponderem.
- Operações do SDK dependentes de identidade são serializadas. O
  `CustomerInfo` já retornado por `Purchases.logIn(uid)` é usado no cold start e
  login, removendo o `getCustomerInfo()` duplicado da inicialização.
- O CustomerInfo listener agora é registrado somente após a identidade ser
  confirmada, captura UID + geração e é removido na troca/unmount. Callback
  enfileirado de uma geração antiga é descartado.
- Transições React Native `background|inactive → active` revalidam
  `CustomerInfo`; refreshes concorrentes do mesmo UID + geração são
  coalescidos. Não existe polling.
- Erro de refresh preserva somente um snapshot já confirmado para o mesmo UID.
  Erro sem snapshot seguro mantém o Gate fail-closed e apresenta retry neutro.
- A política offline usa somente o cache oficial identity-scoped do RevenueCat
  SDK. Nenhum cache Premium foi criado em AsyncStorage, SecureStore ou
  Firestore. A antiga previsão documental de timestamps/TTL próprio de 24h foi
  substituída e registrada em `docs/12` e `docs/13`.
- Adicionado roteiro manual iOS/Android em
  `docs/17_checklist_fase3_assinatura.md`.

Impacto:
`CustomerInfo.entitlements.active['premium']` continua sendo a única fonte de
autorização e o Gate continua sendo a única porta para o AppShell. Compra e
restore alimentam o estado central, sem navegação manual. Firestore permanece
somente espelho administrativo. Nenhum arquivo de Function, webhook, HMAC,
TRANSFER, rules, secret, produto, cupom ou trial foi alterado.

Testes:
- Nova matriz automatizada A–AA com 27 casos: cold start, Auth/sync pendentes,
  login/logout/troca A↔B, requests/listeners obsoletos, compra, restore,
  foreground, revogação/aquisição, offline/erros, single-flight e independência
  do espelho Firestore.
- `npx tsc --noEmit`: aprovado.
- `npm test`: 9 arquivos e 109 testes aprovados.
- `npx expo export --platform all`: bundles web, Android e iOS aprovados.
- `git diff --check`: aprovado. Lint não está configurado no projeto.

Próxima ação:
Humano coordenador executar os 12 testes de dispositivo/sandbox descritos em
`docs/17_checklist_fase3_assinatura.md` em iOS e Android antes de encerrar a
Fase 3.

---

Data: 2026-08-10
Responsável: Agente Backend + Agente QA
Categoria: [CORREÇÃO]

Descrição:
Concluída localmente a reconciliação comercial de `TRANSFER` após a ampliação
manual da mesma `REVENUECAT_API_SECRET_KEY` para leitura de Subscriptions. Um
TRANSFER resolvido agora obtém o customer V2 comprovado pela resolução de
identidade e consulta
`GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions`, com
paginação e validação integral das subscriptions e de seus entitlements.

A subscription relevante é localizada pela relação real com o entitlement
cujo `lookup_key` é `premium`; nunca pelo primeiro item. `gives_access` define
`entitlementActive`. Uma única Premium ativa é normalizada para o schema já
existente. Mais de uma Premium ativa é ambígua e não escreve. Uma resposta
completa sem Premium ativa substitui o mapa por estado inativo, evitando que
um espelho antigo continue marcando acesso; quando não há uma única
subscription inativa cujos detalhes possam ser copiados sem arbitrariedade,
somente `provider` e `entitlementActive:false` são persistidos.

A escrita reutiliza `applySubscriptionEventAtomically` com o `event.id` e
`event_timestamp_ms` do TRANSFER. Foi adicionado um modo explícito de
substituição do mapa aninhado somente para snapshots completos; eventos
comerciais normais preservam o merge anterior. A transação continua barrando
duplicados, stale, conflitos e a recriação de `users/{uid}` excluído. Timeout,
429, 5xx, resposta inválida e 404 na leitura de subscriptions retornam 503 sem
escrita; 401/403 retornam 500 operacional. Secrets, headers e payloads não são
registrados.

Impacto:
`users/{uid}.subscription` passa a refletir imediatamente o estado atual
consultado no RevenueCat depois de um TRANSFER inequivocamente resolvido. O
Firestore continua sendo apenas espelho administrativo: o aplicativo e o Gate
Premium continuam autorizando exclusivamente por
`CustomerInfo.entitlements.active['premium']`. Nenhum arquivo cliente, regra do
Gate, Paywall, schema Firestore, secret ou configuração externa foi alterado.
Não houve deploy, commit, push, retry manual nem acesso a dados reais.

Testes:
- API V2 mockada: schema real, paginação de subscriptions/entitlements, 404,
  timeout, 429, 5xx, 401/403 e resposta inválida.
- Matriz A–O do handler: ativo, inativo, identidade unresolved/ambiguous,
  múltiplas subscriptions inequívocas/ambíguas, stale, duplicate, usuário
  removido durante a transação e regressão dos eventos comerciais.
- Normalização pura de `gives_access`, entitlement Premium, status, produto,
  store e datas; substituição transacional do mapa testada sem Firestore real.

Próxima ação:
Após revisão e autorização humana, fazer deploy controlado da Function e testar
em sandbox um TRANSFER novo ativo e outro inequivocamente inativo, verificando
resposta, logs sanitizados e o espelho Firestore sem usar esse espelho para
autorizar acesso.

---

Data: 2026-08-10
Responsável: Agente Backend + Agente QA
Categoria: [CORREÇÃO]

Descrição:
Corrigida a resolução RevenueCat → Firebase para eventos comerciais ligados a
identidades históricas. A causa raiz era a equivalência 1:1 entre
`app_user_id` e Firebase UID: quando o RevenueCat entregava um UID antigo já
excluído, `userExists()` falhava e o evento era reconhecido com HTTP 200 sem
atualizar `users/{uid}.subscription`.

A nova estratégia mantém o fast path sem rede para um `app_user_id` que exista
simultaneamente no Firebase Authentication e em `users/{uid}`. Se esse caminho
falhar, um cliente server-side mínimo consulta a RevenueCat REST API V2 por
`GET /v2/projects/{project_id}/customers?search=...` e
`GET /v2/projects/{project_id}/customers/{customer_id}/aliases`. Os candidatos
do evento (`app_user_id`, `original_app_user_id`, `aliases`) e do grafo V2 são
filtrados contra Auth + Firestore. Exatamente um usuário válido resulta em
`resolved`; zero em `unresolved`; mais de um em `ambiguous`. Os dois últimos
resultados não escrevem e ambiguidade nunca é resolvida escolhendo o primeiro
alias. IDs `$RCAnonymousID` nunca são usados como Firebase UID.

A Function passou a vincular também `REVENUECAT_API_SECRET_KEY`, além de manter
`REVENUECAT_WEBHOOK_SECRET`. O Project ID público fica centralizado no backend.
Nenhum valor de secret é registrado ou enviado ao cliente.

`TRANSFER` agora é tratado como sinal de identidade: `transferred_to` é
resolvido com a mesma política fail-closed e o evento nunca volta a exigir
`app_user_id`. Não há escrita direta de `subscription`, pois o payload não
contém estado comercial completo e a chave atual tem somente
`customer_information:customers:read`. Uma reconciliação comercial completa
exigiria adicionalmente `customer_information:subscriptions:read`; essa
permissão não foi ampliada nesta tarefa e nenhum campo foi fabricado.

Impacto:
Novos eventos comerciais associados inequivocamente a um alias histórico podem
atualizar o documento do usuário atual pela transação existente. Normalização,
HMAC, deduplicação, ordenação, schema, Premium Gate e Paywall não foram
alterados. O webhook não cria usuários, não faz backfill e não corrige eventos
históricos automaticamente. Timeout/429/5xx/JSON V2 inválido retornam 503 para
retry limitado do provedor; 401/403 retornam erro operacional 500 sanitizado;
`unresolved` e `ambiguous` são reconhecidos com HTTP 200 sem escrita.

Testes:
- Cliente V2 totalmente mockado: busca, aliases, timeout, 401/403, 429/5xx e
  schema inválido, sem acesso à RevenueCat real.
- Resolução direta, alias histórico único, zero/dois candidatos, anonymous ID,
  `original_app_user_id` e destinos TRANSFER único/ambíguo.
- Handler: HMAC e ordem de validação preservados, escrita no UID resolvido,
  falhas V2, TRANSFER sem `app_user_id` e ausência de escrita em ambiguidade.
- Typecheck, build, suíte Functions e `git diff --check` executados localmente.

Próxima ação:
Após revisão humana, realizar deploy controlado somente da Function e validar
em sandbox um novo evento comercial com alias histórico. Se for desejada
reconciliação imediata no próprio `TRANSFER`, aprovar separadamente a permissão
read-only de Subscriptions e projetar a conversão do estado V2 sem alterar o
Premium Gate.

---

Data: 2026-08-10
Responsável: Agente Backend + Agente QA
Categoria: [CORREÇÃO]

Descrição:
Correção mínima da ordem de validação do `revenueCatWebhook`. Após HMAC,
envelope, `event.id` e `event.type`, o handler agora descarta tipos não
processados com HTTP 200 antes de exigir `app_user_id`. Assim, `TRANSFER`
(que usa `transferred_from`/`transferred_to`) continua fora do escopo
comercial e não acessa Firestore, mas deixa de receber HTTP 400 e gerar retry.
Eventos processáveis continuam exigindo `app_user_id` e seguindo o pipeline
existente, inclusive `userExists()` e a transação de `subscription`.

Impacto:
Nenhuma mudança em HMAC, schema, regras, cliente, Gate Premium, Paywall ou no
tratamento `user_not_found`. Os logs temporários `diag:*` encontrados apenas
na revisão deployada não existiam no código local e não foram reintroduzidos.
Nenhum deploy foi realizado nesta correção.

Testes:
- 7 testes novos do handler: `TRANSFER` sem `app_user_id`, evento suportado
  sem `app_user_id`, pipeline suportado completo, ausência de ID, ausência de
  tipo, HMAC inválido e outro tipo não suportado.
- Typecheck e build das Functions limpos.
- Suíte Functions: 5 arquivos, 54 testes aprovados.
- `git diff --check` limpo.

Próxima ação:
Realizar, quando autorizado, deploy exclusivo de `revenueCatWebhook` e
confirmar nos logs que novos eventos `TRANSFER` recebem HTTP 200. Investigar
`user_not_found` separadamente, sem mascará-lo nesta correção.

---

Data: 2026-08-10
Responsável: Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 2 — Paywall real — consolidando a experiência de
assinatura em uma única `PaywallScreen`.
- A tela usa exclusivamente `useSubscription()` para carregar
  `offerings.current.availablePackages`, comprar o próprio objeto
  `PurchasesPackage` selecionado e restaurar compras.
- Todos os packages retornados pelo Offering atual são renderizados na ordem
  recebida. O preço exibido vem de `product.priceString`; não existem preços,
  IDs de produto ou planos de fallback hardcoded na UI.
- A seleção inicial respeita o primeiro package na ordem do Offering e passa
  exatamente esse objeto para `purchasePackage`. Compra/restore apenas
  atualizam `CustomerInfo` no `SubscriptionContext`; nenhum callback navega
  para `app`.
- Estados cobertos: loading, Offering indisponível, Offering sem packages,
  offline, erro genérico, compra em andamento/cancelada/com erro/sem
  entitlement e restore em andamento/com Premium/sem Premium/com erro. Ações
  concorrentes são bloqueadas por ref.
- Removidas todas as promessas de trial da Paywall. A CTA é neutra
  (`Continuar`), pois a elegibilidade individual não é determinada por esta
  infraestrutura.
- Os links existentes de Privacidade e Termos foram preservados.
- `PremiumScreen` foi removida após auditoria dos chamadores. `AppShell` passou
  a reutilizar `PaywallScreen` no overlay de assinatura, eliminando a segunda
  implementação de Offerings/compra/restore.
- O X da rota obrigatória continua chamando o logout Firebase; o mesmo
  componente, quando aberto pelo Perfil, recebe apenas o callback de fechar o
  overlay. O botão agora fica em um header dentro do fluxo e da Safe Area.

Impacto:
RevenueCat `CustomerInfo.entitlements.active['premium']` permanece como única
fonte de autorização. `resolvePremiumGate` não foi alterado: somente ele pode
montar `AppShell`. Nenhuma alteração em backend, webhook, Cloud Functions,
Firestore, autenticação, questionário, cupom, referral, offer codes ou trial.

Testes:
- 11 testes novos em `subscriptionOffer.test.ts`: estados do Offering,
  packages dinâmicos, seleção do objeto, preço localizado, compra e restore
  com/sem entitlement, cancelamento e erro.
- `npx tsc --noEmit` limpo.
- `npm test`: 8 arquivos, 82 testes aprovados.
- `git diff --check` limpo.
- Lint não está configurado no projeto.

Pendência preservada da Fase 1:
Ainda exige validação manual em dispositivo com compra sandbox: confirmar o
entitlement `premium`, fazer cold start e login posterior com a mesma conta,
verificando `Loading → AppShell` sem flash de Paywall. Testes unitários não
encerram essa pendência.

Próxima ação:
Humano coordenador executar compra/restore sandbox e a validação definitiva de
cold start/login Premium em dev build Android e iOS.

---

Data: 2026-08-10
Responsável: Agente Frontend + Agente QA
Categoria: [CORREÇÃO]

Descrição:
Correção mínima do botão X da rota `PaywallScreen` na Fase 1 do Gate
Premium. O X deixou de compartilhar o callback legado do CTA, que solicitava
`app`, e agora chama `useAuth().logout()`. Esse fluxo reutiliza
`signOutUser()` (Firebase `signOut` + limpeza da sessão criptografada); a
mudança reativa do Firebase UID continua sendo processada pelo
`SubscriptionContext`, inclusive `Purchases.logOut()` e invalidação do
snapshot anterior. Uma guarda por ref impede logouts concorrentes em toques
repetidos. Após validação manual, o X foi deslocado 40 pontos para baixo
(`top: 12` → `top: 52`) para ficar fora da área superior de difícil toque.

Impacto:
`Paywall → X → logout → Auth`. Nenhuma mudança no Gate Premium,
entitlement, compra, preços, planos, layout, `PremiumScreen`, Firestore,
webhook ou Cloud Functions.

Testes:
`npx tsc --noEmit` limpo; `npm test` com 71 testes aprovados;
`git diff --check` limpo. Lint não está configurado no projeto.

Próxima ação:
Humano coordenador validar logout e login sequencial de contas distintas em
dev build Android/iOS antes de concluir a Fase 1.

---

Data: 2026-08-10
Responsável: Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 1 do controle de acesso Premium no roteador raiz.
- `App.tsx` passou a resolver autenticação, carregamento do perfil,
  questionário e assinatura em um único gate antes de renderizar qualquer
  tela. Usuário autenticado com questionário só chega ao `AppShell` quando o
  `CustomerInfo.entitlements.active['premium']` está ativo; caso contrário,
  chega à rota `paywall`. Enquanto o RevenueCat não resolveu o usuário atual,
  o roteador exibe o estado neutro de carregamento.
- `SubscriptionContext.tsx` passou a vincular cada snapshot de `CustomerInfo`
  ao Firebase UID para o qual `Purchases.logIn`/`logOut` terminou. Em logout ou
  troca de UID, o snapshot anterior deixa de ser exposto imediatamente;
  respostas antigas de sync, refresh, compra, restauração e listener não podem
  ser aplicadas a outra identidade.
- `src/lib/premiumGate.ts` concentra a decisão pura de rota. O callback legado
  do `PaywallScreen` ainda pode solicitar `app`, mas o gate recusa a transição
  sem entitlement; `PaywallScreen`/`PremiumScreen` e a lógica de compra não
  foram refatorados nesta fase.
- Adicionados 9 testes unitários cobrindo os cenários A-H e o pedido direto de
  `app` sem Premium.

Impacto:
O Firestore permanece fora da autorização Premium. RevenueCat `CustomerInfo`
e o entitlement `premium` continuam sendo a única fonte de verdade no cliente.
Nenhuma alteração em webhook, Cloud Function, preços, cupom ou trial.

Testes:
- App: `npx tsc --noEmit` limpo; `npm test` com 71 testes aprovados.
- Functions (não alteradas): `npm run typecheck` limpo; `npm test` com 47
  testes aprovados.
- Lint não está configurado no projeto.

Próxima ação:
Humano coordenador validar cold start, logout e troca de conta em dev build
Android/iOS. A unificação das responsabilidades de `PaywallScreen` e
`PremiumScreen` permanece para a Fase 2.

---

Data: 2026-07-30
Responsável: Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Preparação operacional para release da Avaliação Física (revisão de
infraestrutura, UX de falha pós-salvamento, observabilidade, checklist de
staging). Não houve deploy — nem de rules/indexes, nem de app.

- `firebase.json` (novo): não existia no repositório; sem ele os comandos
  `firebase deploy --only firestore:*` não têm como saber quais arquivos
  publicar. Aponta para `firestore.rules`/`firestore.indexes.json`.
  `.firebaserc` NÃO foi criado — não existe projeto de staging separado do
  único projeto Firebase configurado (`ajfit-2f321`, via `.env`), e não
  cabe a este agente escolher um projeto arbitrariamente. Registrado como
  risco (ver `16_checklist_staging_avaliacao_fisica.md` §2).
- `firestore.rules`: `assessments.createdAt` passou de `is timestamp` para
  `== request.time` — a checagem anterior aceitava qualquer timestamp
  fabricado pelo cliente; a nova força o uso real de `serverTimestamp()`,
  fechando uma lacuna que já existia (de forma idêntica, não corrigida
  aqui) em `questionnaires.createdAt`. Demais pontos do checklist de
  revisão (índice composto batendo com a query, direção dos campos,
  isolamento por `uid`, `update`/`delete` proibidos, `keys().hasOnly`,
  `measuredAt` não-futuro) já estavam corretos.
- `useAssessments.ts`/`AssessmentScreen.tsx`: `saveGuided`/`saveImported`
  agora retornam `{ refreshFailed }`. A UI mostra três mensagens distintas
  e sempre em português simples, sem detalhe técnico: sucesso normal,
  "Avaliação salva, mas não foi possível atualizar os dados agora" (escrita
  OK, só a releitura falhou — antes essa distinção não existia: o comitê
  anterior só evitava reportar como erro, mas mostrava a mesma mensagem de
  sucesso normal, sem avisar que a tela podia estar desatualizada), e
  "Falha ao salvar" (antes deste ajuste, uma falha real de escrita não
  mostrava NENHUM texto ao usuário, só a animação de shake). O toast virou
  um componente genérico com 3 tons (`success`/`warning`/`error`) em vez de
  um componente fixo só de sucesso.
- Observabilidade: confirmado que o projeto não tem Sentry, Crashlytics
  nem serviço próprio de logs — só `console.error` avulso, mais o padrão
  `logAuthError` já existente em `services/auth.ts`. Generalizado em
  `src/lib/logError.ts` (mesmo formato `[scope] {code, message}`, sem PII)
  e aplicado em: falha ao carregar avaliações, falha no refresh pós-escrita,
  falha ao salvar (guiada/importada), questionário sem campo `answers`.
  Nenhuma dependência nova foi instalada — ausência de observabilidade
  remota permanece registrada como pendência de produção.
- Novo `docs/16_checklist_staging_avaliacao_fisica.md`: roteiro manual para
  Android/iOS (usuário novo, usuário legado, ordenação/evolução, erros e
  rede, UI), com dados de teste concretos e resultados esperados batendo
  com `src/lib/__tests__/skinfoldCalculator.test.ts`, e critérios de
  aprovação (bloqueadores vs. não-bloqueadores).

Impacto:
Nenhuma mudança de arquitetura. Mensagens de erro/sucesso mais honestas;
lacuna de segurança fechada nas rules; observabilidade mínima sem nova
dependência; existe agora um roteiro executável antes do release.

Testes: `npm test` (49 testes) e `npx tsc --noEmit` limpos após todas as
alterações desta entrada.

Próxima ação:
Humano coordenador decide sobre projeto de staging (§2 do checklist),
publica `firestore.rules`/`firestore.indexes.json`, e executa o roteiro
manual em dispositivo real antes do release.

---

Data: 2026-07-30
Responsável: Agente QA
Categoria: [CORREÇÃO]

Descrição:
Auditoria final de produção da Avaliação Física (onboarding, autenticação,
questionário, idade, avaliação física, Firestore, regras, testes,
componentes, hooks, services). Bugs corrigidos:
- `useAssessments.ts`: `saveGuided`/`saveImported` propagavam falha de
  `refresh()` pós-escrita como se a própria gravação tivesse falhado — a
  avaliação já estava salva no Firestore, mas a UI mostrava erro,
  arriscando duplicata em um retry. Agora a falha do refresh só é logada.
- `useAssessments.ts`: sem guarda de sequência em `refresh()` — respostas
  fora de ordem (troca rápida de `uid`, duplo clique em "tentar novamente")
  podiam sobrescrever dados mais novos com uma resposta mais antiga.
  Adicionado `fetchSeq` (mesmo padrão do `loadSeq` de `AuthContext.tsx`).
- `userProfile.ts`/novo `src/lib/questionnaireAnswers.ts`: `fromPersistedAnswers`
  quebrava (`TypeError`) se o documento de questionário estivesse sem o
  campo `answers` (documento corrompido). Agora nunca lança — usa
  `defaultQuiz` como base segura. As funções de conversão foram extraídas
  para `src/lib/questionnaireAnswers.ts` (sem o efeito colateral de
  inicializar o app Firebase), o que também as tornou testáveis.
- `AssessmentScreen.tsx` (`GuidedAssessmentModal`): idade automática podia
  exibir um valor negativo/absurdo ("-3 anos") se `birthDate` estivesse
  corrompido para o futuro; salvar já era bloqueado, mas o número exibido
  era enganoso. Agora cai para "—" nesse caso.
- `AssessmentScreen.tsx` (`GuidedAssessmentModal`): IMC/massa magra/massa
  gorda eram recalculados inline em vez de reusar `computeBmi`/
  `computeLeanMass`/`computeFatMass` de `skinfoldCalculator.ts` (duplicação
  de lógica de negócio já existente e testada).
- `DateFieldsInput.tsx`: `maxLength` era 4 para todos os campos (dia/mês
  aceitavam até 4 dígitos); ajustado para 2/2/4.

Testes: `src/lib/__tests__/questionnaireAnswers.test.ts` (6 casos novos —
round-trip, compat de `age` legado ancorado em `createdAt`, documento
ausente/corrompido nunca lança). Suíte completa: 49 testes, `npx tsc --noEmit`
limpo.

Riscos residuais documentados (não corrigidos nesta auditoria — fora do
escopo "sem mudanças grandes de arquitetura"): regras do Firestore não
validam a lista completa de dobras exigidas por protocolo+sexo (só exigem
`folds` não vazio); `useAssessments` refaz a consulta completa toda vez que
a tela de Avaliação Física é montada (sem cache entre aberturas); corrida em
`saveGuided`/`saveImported`/`fetchSeq` não tem cobertura de teste automatizado
(exigiria mock de Firestore/React Testing Library, não configurado no projeto).

Impacto:
Nenhuma mudança de arquitetura ou de schema. Cinco correções pontuais de
robustez, sem alteração de comportamento visível no caminho feliz.

Próxima ação:
Nenhuma pendência de código aberta nesta auditoria.

---

Data: 2026-07-30
Responsável: Agente Arquiteto + Agente Backend + Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Migração `age` → `birthDate` no onboarding, e suíte de testes unitários da
calculadora de dobras cutâneas.

**Migração de idade:**
- `Quiz.birthDate: Date | null` substitui `Quiz.age: number`
  (`src/state/AppState.tsx`). Motivo: `age` capturado uma única vez no
  onboarding nunca era recalculado — o usuário "parava de envelhecer" no
  app.
- Novo `src/lib/ageCalculator.ts`: `computeAge(birthDate, referenceDate)`
  é agora a ÚNICA função que calcula idade em todo o projeto (Avaliação
  Física, calculadoras JP3/JP7). `birthDateFromLegacyAge(age, referenceDate)`
  existe só para compatibilidade retroativa (ver abaixo).
- `QuizScreen.tsx`: pergunta "SUA IDADE?" (wheel numérico) substituída por
  "QUANDO VOCÊ NASCEU?" (`kind: 'date'`, novo `BirthDateWheel`), usando os
  novos `src/hooks/useDateParts.ts` e `src/components/ui/DateFieldsInput.tsx`
  (compartilhados com `AssessmentScreen.tsx`, que já tinha um seletor de
  data equivalente para `measuredAt` — extraído para evitar duplicação).
- `userProfile.ts`: `answers.birthDate` persistido como `Timestamp`
  (`toPersistedAnswers`/`fromPersistedAnswers`). Contrato atualizado em
  `04_contratos_de_api.md §5`.
- **Compatibilidade com usuários antigos**: documentos de questionário
  gravados antes desta migração têm `age: number`, sem `birthDate`. Nunca
  são reescritos. Na leitura (`getLatestQuestionnaire`), se `birthDate`
  estiver ausente, é aproximado a partir de `age` ANCORADO no `createdAt`
  do próprio questionário (não em "hoje") — isso faz a idade derivada
  continuar avançando corretamente nos anos seguintes, em vez de ficar
  congelada no valor original. Nenhuma escrita nova usa `age`.
- `AssessmentScreen.tsx` (`GuidedAssessmentModal`): quando existe
  `birthDate`, a idade na data da avaliação é sempre calculada
  automaticamente (inclusive para avaliações retroativas) — o campo manual
  de idade só aparece quando não há `birthDate` disponível (fallback).

**Suíte de testes:**
- Vitest escolhido (não Jest/jest-expo): os alvos de teste
  (`skinfoldCalculator.ts`, `ageCalculator.ts`) são TypeScript puro, sem
  nenhuma dependência de React Native/Expo — Vitest evita o overhead do
  pipeline de transformação RN do jest-expo para testar funções puras.
  `vitest.config.mts` + scripts `npm test`/`npm run test:watch`.
- `src/lib/__tests__/skinfoldCalculator.test.ts` (43 casos, com
  `ageCalculator.test.ts`): JP3/JP7 masculino/feminino com valores de
  referência calculados independentemente das fórmulas documentadas em
  `15_calculadora_de_dobras_subcutaneas.md` §6–§8, soma de dobras, IMC,
  massa magra/gorda, arredondamento (§14), validações de entrada (peso,
  altura, idade, dobras, protocolo inválido, BF fora da faixa plausível).
- `src/lib/__tests__/ageCalculator.test.ts`: aniversário ainda não
  ocorrido/já ocorrido, dia 29/02, avaliação retroativa, round-trip de
  `birthDateFromLegacyAge`.

Impacto:
Idade nunca mais fica congelada. Toda a base de usuários existente
continua funcionando sem migração manual de dados. Regra de negócio
crítica (cálculo de % de gordura) agora protegida por testes automatizados.

Próxima ação:
Nenhuma pendência de código aberta. `npx tsc --noEmit` e `npm test` limpos.
Validação humana recomendada do novo seletor de data de nascimento no
onboarding (dispositivo real).

---

Data: 2026-07-13
Responsável: Agente Arquiteto Frontend + Agente UI/UX + Agente React Native + Agente Revisor
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Refatoração completa de UI/UX da tela Avaliação Física (`AssessmentScreen.tsx`).
A tela era um formulário linear único (peso/altura, dobras, resultados,
histórico e CTA de salvar todos no mesmo nível). Reorganizada em blocos
hierárquicos conforme especificação do humano coordenador:

- `PhysicalAssessmentSummaryCard` (novo, `components/fitness/`): card de
  destaque no topo com peso, % gordura, massa magra, IMC e data da última
  avaliação.
- `AssessmentEvolutionCard` (novo): deltas desde a avaliação anterior +
  espaço reservado para gráfico futuro + CTA "Ver histórico completo".
- `AssessmentSection` (novo): wrapper genérico título+conteúdo, substitui os
  blocos `Slash` soltos repetidos na tela antiga.
- `AssessmentMetricCard` (novo): tile de métrica reutilizável (substitui
  `ResultCard`/`MiniStat` duplicados).
- `FoldableSection` (novo, `components/ui/`, genérico/reutilizável): usado
  para colapsar "Dobras Cutâneas" — só expande sob demanda, não fica visível
  por padrão.
- `AssessmentActionCard` (novo): bloco "Adicionar Avaliação" com duas opções
  — Avaliação Guiada (fluxo existente) e Importar Avaliação Profissional
  (novo).
- `AssessmentHistoryCard` (novo): histórico compacto (data/peso/BF%/chevron),
  com tag "IMPORTADO" para entradas vindas do fluxo profissional.

Lógica preservada integralmente: cálculo de IMC, estimativa de % de gordura
via Jackson & Pollock 7 dobras (fórmula e fallback 18,2% inalterados,
conforme 15_calculadora_de_dobras_subcutaneas.md), validação de peso/altura,
animação de shake/toast, dropdown de protocolo, todos os 4 protocolos de
dobras. O formulário original (Avaliação Guiada) foi movido para dentro de um
modal full-screen (`GuidedAssessmentModal`), aberto a partir do novo card de
ação — não fica mais exposto por padrão na tela principal.

Novo (UI + registro local, sem cálculo): `ImportAssessmentModal` — formulário
para registrar avaliação profissional já calculada (peso, BF%, massa magra,
massa gorda, água corporal, IMC, metabolismo basal, gordura visceral). O app
apenas grava os valores informados, sem recalcular nada, conforme pedido.

Fora de escopo (decisão registrada): fotos de evolução já existem em
`ProgressScreen.tsx` (aba Evolução, fora desta tela) — não foram duplicadas
nem movidas para Avaliação Física, para não expandir escopo sobre outra tela
sem solicitação explícita.

Verificação: app rodado localmente via `expo start` (porta 8081 já ativa),
navegado com Playwright headless até Perfil → Avaliação Física, com
screenshots confirmando resumo/evolução/informações básicas/dobras/ação/
histórico, e abertura de ambos os modais (Guiada e Importar) sem erros de
console. `App.tsx` foi temporariamente alterado para pular o gate de login
durante o teste e revertido ao estado original antes de finalizar (`git diff`
confirmado limpo).

Impacto:
Nenhuma regressão de comportamento identificada. Tela reorganizada, com menos
informação visível de início e aparência mais premium, mantendo toda a lógica
de cálculo e validação original.

Próxima ação:
Humano coordenador validar visualmente em dispositivo. Ciclo futuro: gráfico
real de evolução (placeholder reservado em `AssessmentEvolutionCard`);
avaliar se `ImportAssessmentModal` deve gravar em backend real (hoje é
somente estado local, igual ao fluxo guiado).

---

Data: 2026-07-13
Responsável: Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Navegação funcional conectando `ProfileScreen` → `SettingsScreen` (solicitação
pontual do humano coordenador, fora do escopo original "apenas frontend" da
entrada anterior desta mesma data).
- `ProfileScreen.tsx`: item "Configurações" (grupo PREFERÊNCIAS) recebe
  `onPress={onOpenSettings}`, nova prop opcional `onOpenSettings`.
- `AppShell.tsx`: novo estado `showSettings`, renderizado como overlay
  absoluto (mesmo padrão de `ConsistencyScreen`/`AssessmentScreen`), incluso
  em `overlayOpen` para ocultar a tab bar.

Impacto:
Botão "Configurações" no Perfil agora abre a tela real. Demais itens da tela
de Configurações continuam com `onPress={() => {}}` (sem lógica).

Próxima ação:
Nenhuma pendência de código aberta. Lógica individual de cada item de
Configurações permanece para ciclo futuro.

---

Data: 2026-07-13
Responsável: Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Criada do zero a tela Configurações (frontend, sem lógica). Componentes novos
em `src/components/ui/SettingsSection.tsx` (`SettingsSection`, `SettingsItem`,
`SettingsValue`, `SettingsDivider`, `SettingsHeader`), reutilizando o padrão
visual já existente em `ProfileScreen.tsx` (agrupamento tipo `ProfileGroup`,
`Slash`, cores e tipografia de `theme/tokens.ts`). Tela em
`src/screens/SettingsScreen.tsx` com as seções: Conta, Treino, Notificações,
Preferências, Privacidade, Suporte e Sobre. Ícones novos adicionados a
`src/components/ui/Icon.tsx`: `bell`, `moon`, `globe`, `ruler`, `download`,
`trash`, `help-circle`, `message`, `alert-triangle`, `info`, `file-text`,
`key`.

Todos os itens usam `onPress={() => {}}` (exceto "Versão", sem ação). Sem
navegação funcional, sem integração com backend/Firebase/RevenueCat, sem
estados ou persistência — conforme escopo solicitado. `ProfileScreen.tsx` não
foi alterado.

Impacto:
Nenhum. Tela isolada, não registrada em `AppShell.tsx` nem em nenhum fluxo de
navegação existente.

Próxima ação:
Humano coordenador validar visualmente a tela. Em ciclo futuro: conectar
navegação real a partir do item "Configurações" já existente em
`ProfileScreen.tsx` (grupo PREFERÊNCIAS) e implementar lógica de cada item.

---

Data: 2026-07-11
Responsável: Agente Segurança + Agente Arquiteto + Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Auditoria completa de encerramento da persistência de login (arquitetura,
segurança, limpeza de código, performance, memory leaks, fluxo de
autenticação, conformidade com 12_seguranca_geral_do_app.md). Ver relatório
completo entregue ao humano coordenador na mesma data.

Ações concretas desta entrada:
- Removidos todos os logs de depuração temporários (`[BOOT]`, `[AUTH]`,
  `[ROUTER]`) de `App.tsx`, `src/state/AuthContext.tsx` e
  `src/screens/SplashScreen.tsx`, junto dos comentários "TEMPORARY
  DIAGNOSTIC" associados.
- Mantida a correção comportamental encontrada na entrada anterior
  (2026-07-11, splash animation sem cleanup): `sequence.stop()` no cleanup do
  `useEffect` de `SplashScreen.tsx`, e a guarda `screenRef.current ===
  'splash'` em `App.tsx` antes de aplicar o `onDone` do splash.
- Nenhuma mudança na criptografia, no `secureAuthStorage.ts` ou no
  `firebase.ts` — auditoria de segurança não encontrou desvio de boas
  práticas que justificasse alteração (AES-256-GCM, IV aleatório por
  operação, chave em Keychain/Keystore via expo-secure-store, limpeza no
  logout já cobertos pela implementação de 2026-07-09).

Impacto:
Código de produção sem logs de depuração. Nenhuma dívida técnica nova
identificada nesta auditoria além das já registradas (offline-first do
Firestore, pendente desde 2026-07-04).

Próxima ação:
Nenhuma ação de código pendente. Validação manual do humano coordenador
(cold start Android/iOS, e-mail/senha e Google) permanece recomendada antes
de publicação.

---

Data: 2026-07-11
Responsável: Agente Frontend
Categoria: [CORREÇÃO]

Descrição:
Correção da auditoria anterior (2026-07-09, entrada abaixo): a conclusão de
que a persistência do Firebase era a causa raiz estava incompleta. A
persistência de fato funciona (confirmado por log real: sessão restaurada,
decriptada, `onAuthStateChanged` com uid correto). O defeito real estava no
roteamento inicial em `App.tsx`.

Causa raiz:
`SplashScreen` (`src/screens/SplashScreen.tsx`) inicia uma animação de
1.8s (`Animated.sequence`, `useNativeDriver: true`) que chama `onDone` ao
terminar, mas o `useEffect` que a inicia não tinha função de limpeza — a
animação nativa continuava rodando mesmo após o componente desmontar. Em
cold start autenticado: `RootNavigator` (`App.tsx`) renderiza `SplashScreen`
assim que `initializing` vira `false` (tela ainda é `'splash'`, valor
inicial); no mesmo ciclo de efeitos, o bootstrap de `App.tsx` (linha ~62,
versão anterior) já troca a tela para `'app'` porque o usuário existe,
desmontando o `SplashScreen`. Sem cleanup, a animação iniciada nesse
`SplashScreen` já desmontado continua e, ~1.8s depois, chama o `onDone`
antigo (`() => setScreen('onboarding')`), sobrescrevendo `'app'` por
`'onboarding'` — o usuário via a Home por um instante e depois "voltava"
para o onboarding público, mesmo autenticado.

Solução aplicada:
- `src/screens/SplashScreen.tsx`: a sequência de animação agora é capturada
  em variável; o `useEffect` retorna um cleanup que chama `.stop()`,
  impedindo que `onDone` dispare após o unmount.
- `App.tsx`: reforço defensivo no roteador — o `onDone` do `SplashScreen`
  agora consulta uma `ref` (`screenRef`) com a tela atual e ignora a
  transição para `'onboarding'` se a tela já não for mais `'splash'` (guarda
  contra qualquer race futura do mesmo tipo, sem uso de timeout artificial).
- Logs temporários `[BOOT]`/`[AUTH]`/`[ROUTER]` com timestamp adicionados em
  `App.tsx`, `AuthContext.tsx` e `SplashScreen.tsx` para validação manual.
  Mantidos até validação humana (não remover nesta entrada).

Impacto:
Nenhuma mudança na criptografia/persistência (fora de escopo desta correção,
confirmada funcional na entrada anterior). Usuário autenticado em cold start
não deve mais "saltar" de volta para o onboarding público.

Testes feitos:
- `npx tsc --noEmit` sem erros.
- Aguardando validação manual do humano coordenador: fechar o app
  completamente, reabrir, e confirmar que a Home permanece estável (sem
  voltar para onboarding) mesmo após os ~1.8s da janela de risco.

Próxima ação:
Humano coordenador validar manualmente em dispositivo (Android e iOS) e
confirmar remoção dos logs temporários.

---

Data: 2026-07-09
Responsável: Agente Segurança
Categoria: [CORREÇÃO]

Descrição:
Auditoria da persistência de login (relato: usuário deslogava ao fechar e
reabrir o app, tanto por e-mail/senha quanto por Google).

Problema encontrado:
A implementação de persistência criptografada registrada na entrada abaixo
(2026-07-09, "Persistência de login criptografada em repouso") havia sido
adicionada ao `package.json`/`app.json` (`expo-secure-store`) sem que os
projetos nativos `android/`/`ios/` (gerados localmente, fora do controle de
versão) fossem reconstruídos. O dev client instalado no dispositivo não
possuía o módulo nativo `expo-secure-store` compilado. Toda vez que
`initializeAuth` tentava usar a persistência criptografada, a checagem
interna `_isAvailable()` do Firebase Auth (que grava/lê um valor de teste via
`secureAuthStorage`) falhava silenciosamente, e o Firebase caía para
persistência em memória sem lançar nenhum erro visível — a sessão nunca
sobrevivia ao fechamento completo do app. Isso não é um bug de lógica: o
código de `src/lib/secureAuthStorage.ts` e `src/lib/firebase.ts` está correto
(API do `expo-crypto` AES e do `expo-secure-store` conferida contra o código
nativo instalado).

Causa raiz:
Build nativo desatualizado — dependência nova adicionada sem `expo prebuild`/
rebuild do dev client.

Diagnóstico:
Instrumentação temporária (logs `[authDiag]`) foi adicionada em
`secureAuthStorage.ts`, `firebase.ts` e `AuthContext.tsx`, além de um módulo
de auto-teste isolado (`authPersistenceDiagnostics.ts`, removido após a
confirmação) que exercitava SecureStore, o roundtrip AES e o contrato
`_isAvailable()`/`_set`/`_get` do Firebase de forma independente. Após rodar
`npx expo run:android` (reconstrução completa do dev client), dois cold
starts reais (fechar totalmente o app e reabrir) mostraram a sessão sendo
lida do `AsyncStorage`, decriptada com sucesso e `onAuthStateChanged`
disparando com o `uid` correto — sem nenhum erro na cadeia.

Solução aplicada:
Nenhuma alteração de código foi necessária. A instrumentação temporária foi
revertida (código voltou ao estado da entrada de implementação anterior).
Rollback da camada de criptografia foi avaliado e descartado — não há
evidência de defeito nela.

Impacto:
Nenhuma pendência de código aberta. Este documento agora registra
explicitamente que **qualquer nova dependência nativa (SDK Expo) exige rebuild
do dev client (`npx expo run:android` / `npx expo run:ios`, ou novo build
EAS) antes de validar em dispositivo** — `android/`/`ios/` são gerados e não
acompanham automaticamente mudanças em `package.json`/`app.json`.

Testes feitos:
- `npx tsc --noEmit` sem erros após reverter a instrumentação.
- Cold start real (app fechado via app switcher e reaberto) validado 2x após
  `npx expo run:android`, com sessão de e-mail/senha persistindo.
- Logout (`signOutUser`) não foi alterado nesta entrada; segue limpando a
  sessão via `clearSecureAuthSession` (ver entrada anterior).

Próxima ação:
Humano coordenador validar também o cold start com login Google (mesma
camada de persistência, risco residual baixo) e num build iOS.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Autenticação social (Google e Apple) para produção (dev/EAS build).
- Firebase JS SDK mantido; login social via `signInWithCredential` (Google:
  @react-native-google-signin/google-signin; Apple: expo-apple-authentication
  + nonce SHA-256 com expo-crypto).
- Camada centralizada e agnóstica de provedor: `src/services/socialAuth.ts` +
  `src/services/providers/{google,apple}.{native,web}.ts` (split de plataforma;
  web fica sem imports nativos). Telas chamam `signInWithProvider(provider)`,
  sem ifs por provedor.
- Primeiro login social provisiona `users/{uid}` (e questionário só se houver
  respostas reais). Reuso de `ensureUserProvisioned` (checa existência —
  nunca duplica/sobrescreve). Listener continua somente-leitura.
- Account Linking: `auth/account-exists-with-different-credential` →
  `fetchSignInMethodsForEmail` → reautenticação + `linkWithCredential`
  (mesmo UID, dados preservados). Cobre Email↔Google↔Apple.
- AuthContext expõe `linkedProviders`; ProfileScreen lista métodos vinculados.
- app.json: plugins google-signin (iosUrlScheme) + expo-apple-authentication,
  `ios.usesAppleSignIn`, `googleServicesFile` (iOS/Android), client IDs em
  `extra`.

Impacto:
Login Google/Apple funcional em build nativa, sem duplicação de usuários.
Nenhum `addDoc` em `users`. Web permanece compilável (stubs de plataforma).

Próxima ação:
Ver [PENDENTE] de configuração de console/credenciais abaixo.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [DECISÃO]

Descrição:
Mantido o Firebase JS SDK (sem migrar para @react-native-firebase). Login social
usa credenciais nativas + `signInWithCredential`, padrão suportado do JS SDK em
React Native. Arquivos de plataforma (.native/.web) evitam imports nativos no
bundle web; tipos resolvidos por `.d.ts` (Metro resolve o arquivo de plataforma).

Impacto:
Menor disrupção. A pendência de offline-first do Firestore em RN permanece
independente desta decisão.

Próxima ação:
Nenhuma imediata.

---

Data: 2026-07-04
Responsável: Agente Backend
Categoria: [PENDENTE]

Descrição:
Configuração externa necessária (não código) para o login social funcionar:
- Firebase Console → habilitar provedores Google e Apple; manter "uma conta por
  e-mail"; avaliar proteção de enumeração de e-mail (afeta
  `fetchSignInMethodsForEmail` usado no account linking).
- Apple Developer: Sign In with Apple, Service ID; credenciais no EAS.
- Build: requer dev/EAS build (não Expo Go) para validar em dispositivo.

Impacto:
Sem essa configuração o fluxo social não completa em runtime. Verificação em
dispositivo real fica pendente.

Próxima ação:
Humano coordenador configurar console/credenciais e rodar em dev build.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [CORREÇÃO]

Descrição:
Corrigida condição de corrida na criação do documento do usuário.
Problema: a criação era feita dentro do listener `onAuthStateChanged` via
`ensureUserProfile` (padrão check-then-act não atômico: getDoc → setDoc). O
listener dispara múltiplas vezes no cadastro (criação da conta + updateProfile
do displayName), executando a criação mais de uma vez. Com o documento chaveado
por uid (setDoc) isso gerava escrita redundante; com id gerado (subcoleção)
geraria documentos duplicados.
Causa: creation dentro de fluxo reativo disparado N vezes, sem atomicidade.
Solução: a criação passou a ser um fluxo único em `signUp` (writeBatch atômico:
documento principal + questionário inicial), executado exatamente uma vez. O
listener tornou-se somente-leitura (carrega perfil + questionário no estado
global), com guarda de sequência para descartar leituras obsoletas. Nenhum uso
de `addDoc` na coleção `users` (sempre `doc(db,'users',uid)` + `setDoc`).

Impacto:
Elimina definitivamente a duplicação. `ensureUserProfile`/`createUserProfile`
removidos; `provisionNewUser` é a única função de criação.

Próxima ação:
Publicar `firestore.rules` atualizadas e validar em ambiente real.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [DECISÃO]

Descrição:
Modelagem do questionário movida para subcoleção
`users/{userId}/questionnaires/{questionnaireId}` com campos `answers`,
`version` (>=1), `createdAt` (serverTimestamp). O documento principal do usuário
deixa de conter `questionnaire`. Resolve o [PENDENTE] anterior sobre histórico
de questionários: cada reavaliação cria um novo documento imutável; o atual é o
de `createdAt` mais recente. Documentado em 03_modelagem §12 e 04_contratos §5.

Impacto:
Histórico de questionários passa a ser preservado. Regras Firestore incluem a
subcoleção (leitura/criação só do próprio dono; documentos imutáveis).
AuthContext passa a expor `profile` e `questionnaire` (mais recente).

Próxima ação:
Ao implementar reavaliações (novo treino a cada 30/60 dias), usar
`addQuestionnaire` com `version` incremental.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DESCARTADO]

Descrição:
Descartada a modelagem anterior com `users/{userId}.questionnaire` como campo
único no documento principal (snapshot mutável). Substituída pela subcoleção
`questionnaires`. A nota de "Escopo do campo questionnaire" em 04 §5 foi
substituída pela seção "Subcoleção de questionários".

Impacto:
O campo `questionnaire` no documento principal não deve mais ser usado.

Próxima ação:
Nenhuma — modelagem consolidada na subcoleção.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido o escopo do campo `users/{userId}.questionnaire`: ele representa
apenas o questionário inicial/atual usado na criação da conta (snapshot único e
mutável, atualizado junto com `updatedAt`). NÃO é histórico definitivo de todos
os questionários do usuário. Documentado em 04_contratos_de_api.md §5 ("Escopo
do campo questionnaire").

Impacto:
Nenhum agente deve tratar o campo atual como fonte de histórico. Reavaliações ou
novo questionário sobrescrevem o valor anterior. Sem impacto em código agora.

Próxima ação:
Ver pendência técnica abaixo ([PENDENTE]) sobre a modelagem de histórico.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [PENDENTE]

Descrição:
Falta modelagem de histórico de questionários. Quando o app implementar
evolução contínua, reavaliações periódicas ou novos questionários com
necessidade de histórico, será preciso criar uma modelagem própria, provável:

```txt
users/{userId}/questionnaires/{questionnaireId}
```

Nesse caso, `users/{userId}.questionnaire` passaria a referenciar apenas o
questionário ativo (ex.: por id), com o histórico na subcoleção.

Impacto:
Enquanto não existir, o sistema mantém apenas o último questionário. Histórico
de evolução do perfil (respostas anteriores) não é recuperável.

Próxima ação:
Definir a subcoleção e a estratégia de migração antes de habilitar reavaliações
— responsável: Agente Arquiteto + Humano Coordenador.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Aprovada a expansão do contrato do usuário (04_contratos_de_api.md §5),
resolvendo o [CONFLITO] registrado anteriormente nesta data. O documento
`users/{userId}` passa a incluir campos client-owned adicionais:
`role` (default "user"), `name`, `questionnaire` (respostas do questionário
inicial) e `updatedAt`. Os campos de assinatura/treino permanecem backend-owned.

Impacto:
- O app grava `userId, role, name, email, questionnaire, createdAt, updatedAt`.
- `role` restrito a "user" pelo cliente (regras Firestore); promoção só no
  backend.
- `name` e `questionnaire` tornam-se editáveis pelo próprio usuário.
- Cadastro passa a coletar o nome; questionário é persistido no documento.
- Regras Firestore e repositório `userProfile.ts` atualizados.

Próxima ação:
Revisar/publicar `firestore.rules`. Unificar o enum de status de assinatura
(04 §11 `GRACE_PERIOD` vs 13 §22) permanece pendente.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Integração inicial Firebase Authentication + Firestore para o fluxo de usuário.
- Auth por e-mail/senha (cadastro, login, recuperação de senha, logout).
- Repositório `src/services/userProfile.ts` (createUserProfile, getUserProfile,
  ensureUserProfile, updateUserProfile) como única camada de acesso a
  `users/{userId}`.
- Estado global de autenticação + perfil em `src/state/AuthContext.tsx`.
- Perfil (ProfileScreen) passa a exibir dados reais (e-mail, ano de criação,
  status de assinatura quando existir).
- Proteção de rotas: telas privadas exigem usuário autenticado.
- `firestore.rules` sugerido (acesso apenas ao próprio documento; campos
  backend-owned protegidos).

Impacto:
Cadastro cria o documento mínimo do usuário. Login carrega o perfil. Módulos
seguintes (treino, assinatura) podem consumir `activeWorkoutId` e
`subscriptionStatus` quando o backend os popular.

Próxima ação:
Validação humana das regras Firestore e das divergências abaixo.

---

Data: 2026-07-04
Responsável: Agente Backend
Categoria: [DECISÃO]

Descrição:
O documento `users/{userId}` segue o contrato oficial (04_contratos_de_api.md
§5). O aplicativo grava apenas os campos client-owned: `userId`, `email`,
`createdAt` (serverTimestamp). Os campos `subscriptionStatus`,
`subscriptionProvider`, `trialEndsAt`, `subscriptionEndsAt` e `activeWorkoutId`
são backend-owned e nunca escritos pelo cliente (RevenueCat/Cloud Functions são
a fonte de verdade — 12_seguranca §3–§11).

Impacto:
Front não define status de assinatura nem treino ativo. Regras Firestore
bloqueiam escrita desses campos pelo cliente.

Próxima ação:
Implementar Cloud Function `syncSubscriptionStatus` e webhook RevenueCat para
popular os campos de assinatura.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [CONFLITO]

Descrição:
Divergências entre a tarefa solicitada e a documentação oficial no schema do
usuário. Não foram inventados campos fora do contrato (00_orientacao §3.2):
- `displayName`/`name`, `role`, `updatedAt`, `onboardingCompleted`,
  `questionnaireCompleted`, `couponCode`: pedidos na tarefa, ausentes no
  contrato 04 §5. Não persistidos até decisão humana.
- Nome do campo de identificação: contrato usa `userId` (adotado); a tarefa
  sugeria `uid`.
- Status de assinatura: 04 §11 lista `GRACE_PERIOD`; 13 §22 lista
  `BILLING_ISSUE`/`CANCELED`. Adotado o conjunto de 13 §22 no tipo do cliente
  (não escrito pelo front). Requer unificação documental.

Impacto:
Modelo do usuário permanece aderente ao contrato. Campos adicionais dependem de
atualização do contrato antes de serem gravados.

Próxima ação:
Humano coordenador decide se o contrato 04 §5 será expandido (nome, role,
flags de onboarding, cupom) e unifica o enum de status.

---

Data: 2026-07-04
Responsável: Agente Frontend
Categoria: [PENDENTE]

Descrição:
Offline-first (02 §3.5) para Firestore não é atendido de forma durável pelo
Firebase JS SDK em React Native (persistência baseada em IndexedDB). A
integração atual usa cache em memória por sessão.

Impacto:
Leituras/escritas offline não persistem entre reinícios do app com o SDK atual.

Próxima ação:
Decidir arquitetura offline (ex.: @react-native-firebase nativo) — responsável:
Agente Arquiteto + Humano Coordenador.

---

Data: 2026-07-04
Responsável: Agente Frontend
Categoria: [PENDENTE]

Descrição:
Captura de cupom promocional no cadastro (03 §15, 13 §19) não implementada por
ausência de campo no formulário atual e de definição do campo no contrato 04 §5.

Impacto:
Origem do usuário/comissão não é rastreada no cadastro atual.

Próxima ação:
Definir UI do cupom e o campo correspondente no contrato — responsável: Agente
PO + Humano Coordenador.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso de Firebase como plataforma principal de backend.

Impacto:
Uso de Firestore, Authentication, Storage e Cloud Functions.

Próxima ação:
Definir modelagem detalhada dos dados.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso do RevenueCat para gerenciamento de assinaturas.

Impacto:
Assinaturas passam a utilizar App Store, Google Play e RevenueCat como fonte oficial de verdade.

Próxima ação:
Criar documentação específica de billing.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido que os treinos serão pré-definidos e selecionados através do questionário.

Impacto:
O sistema não gera treinos livres na versão inicial.

Próxima ação:
Definir lógica de seleção de treinos.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido funcionamento offline como requisito obrigatório.

Impacto:
Todas as decisões de arquitetura devem considerar sincronização posterior.

Próxima ação:
Definir estratégia de sincronização.

---

Data: 2026-07-09
Responsável: Agente Segurança + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Persistência de login criptografada em repouso (12 §16.1).
- `src/lib/secureAuthStorage.ts` (novo): backend compatível com
  `AsyncStorage` para `getReactNativePersistence` do Firebase JS SDK. Cada
  valor é cifrado com AES-256-GCM (`expo-crypto`, `AESEncryptionKey` /
  `aesEncryptAsync` / `aesDecryptAsync`) antes de gravar no `AsyncStorage`;
  falha de descriptografia (chave corrompida/ausente) descarta o item em vez
  de derrubar o app.
- A chave de criptografia é gerada uma vez por dispositivo e armazenada só
  no Keychain/Keystore via `expo-secure-store` (nova dependência, plugin
  registrado em `app.json`), nunca no `AsyncStorage`.
- `src/lib/firebase.ts`: `initializeAuth` passa a usar `secureAuthStorage` no
  lugar do `AsyncStorage` puro.
- `src/services/auth.ts`: `signOutUser` chama `clearSecureAuthSession` após
  `signOut`, descartando a chave de criptografia no logout (defesa em
  profundidade além da limpeza própria do Firebase).
- `docs/12_seguranca_geral_do_app.md`: adicionada seção 16.1 documentando a
  decisão (Firebase JS SDK mantido — sem Keychain nativo — logo a
  criptografia é aplicada na camada de storage).

Motivo:
12 §16 exige mecanismo seguro de armazenamento local; o `AsyncStorage` puro
usado antes é texto plano, expondo tokens de sessão em caso de acesso ao
dispositivo. Migrar para `@react-native-firebase/auth` (Keychain/Keystore
nativo) foi avaliado e descartado por ora (maior escopo/risco de regressão
no login social) — decisão validada com o humano coordenador.

Impacto:
Nenhuma mudança de comportamento para o usuário (login continua persistindo
entre reinícios). Requer novo build nativo/dev client (plugin
`expo-secure-store` adicionado ao `app.json`), mesmo fluxo já necessário por
`expo-apple-authentication`.

Próxima ação:
Humano coordenador validar em dev build. Nenhuma pendência de código aberta.

```
```

---

Data: 2026-08-06
Responsável: Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado o módulo de Suporte do aplicativo: Central de Ajuda pesquisável e
categorizada, artigos locais por repositório substituível, formulários de bug,
sugestão e chamado, anexo opcional no Firebase Storage, criação atômica do
ticket e primeira mensagem, tela de sucesso, i18n em pt-BR/en/es e regras de
segurança testadas no emulador. Contrato detalhado em
`docs/18_modulo_suporte.md`.

Impacto:
Usuários autenticados podem criar e ler somente os próprios tickets. O cliente
não pode alterar status/prioridade nem criar mensagens administrativas. A
estrutura já suporta histórico de mensagens e evolução por backend.

Próxima ação:
Publicar `firestore.rules` e `storage.rules` no ambiente alvo; em fase futura,
implementar painel administrativo, respostas, push e limpeza de anexos órfãos.

---

Data: 2026-08-07
Responsável: Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Reorganizadas exclusivamente as telas de Perfil e Configurações. Perfil
passou a concentrar evolução, plano, conta, métodos de login e sessão; a área
de Avisos Inteligentes foi preparada como componente apresentacional que não
renderiza quando vazia. Configurações passou a concentrar somente preferências
do aplicativo, notificações, privacidade e dados, suporte e informações sobre
o app. Os fluxos existentes de Avaliação Física, Editar Perfil, idioma,
unidades e Suporte foram preservados. Itens sem tela permanecem placeholders
visuais, sem novas rotas ou lógica.

Impacto:
Nenhuma alteração em serviços, providers, hooks, contexts, Firebase,
RevenueCat, modelos ou regras de negócio. A estrutura neutra de listas foi
unificada em `SettingsSection`; adicionada cobertura estrutural contra itens
duplicados ou removidos acidentalmente. A entrada Versão passou a ler
`expo.version` do `app.json` por `Constants.expoConfig`, sem valor fixo na tela.

Próxima ação:
Validar comparação visual em iOS e Android antes do merge.

---

Data: 2026-08-07
Responsável: Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado exclusivamente o front-end da tela Segurança, acessível por
Configurações. A tela possui as seções Segurança da conta, Sessões,
Atividade e Zona de segurança, com textos estáticos e itens visuais sem ação.
O componente compartilhado `SettingsSection` passou a aceitar descrição de
item, descrição de seção e estado desabilitado.

Impacto:
Adicionado somente um overlay de navegação local entre Configurações e
Segurança. Nenhuma autenticação, biometria, validação, persistência,
integração, serviço, provider, hook ou regra de negócio foi implementada.

Próxima ação:
Validar a composição visual em iOS e Android antes do merge. As futuras ações
de segurança dependem de requisitos e contratos próprios antes da implementação.

---

Data: 2026-08-07
Responsável: Agente Segurança + Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado o fluxo de alteração de senha para contas que possuem o provider
Firebase `password`. A tela solicita senha atual, nova senha e confirmação; o
hook aplica as validações locais e o serviço executa obrigatoriamente
`reauthenticateWithCredential` antes de `updatePassword`. O item fica oculto
para contas exclusivamente Google/Apple e há proteções adicionais na
navegação, na tela, no hook e no serviço. Estados de carregamento, sucesso e
erros controlados foram traduzidos em pt-BR, inglês e espanhol.

Impacto:
Somente a ação Alterar senha passou a ter lógica. Biometria, verificação em
duas etapas, sessões, histórico e exclusão de conta permanecem estritamente
visuais. Nenhuma senha é persistida ou enviada a serviços próprios; as
credenciais são usadas apenas pela API oficial do Firebase Auth durante a
reautenticação. Adicionados testes de validação, mapeamento de erro, elegibilidade
por provider, ordem das chamadas e interrupção do fluxo em falhas.

Próxima ação:
Validar o fluxo com uma conta de teste e-mail/senha em dev build. O repositório
não possui emulador de Firebase Auth configurado, portanto a suíte automatizada
cobre o contrato com mocks, não uma autenticação real.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Reorganizada exclusivamente a apresentação da Avaliação Física. A tela
principal passou a seguir Resumo, Evolução, Adicionar avaliação, Dobras
cutâneas e Histórico. Removidos o aviso azul do estado vazio e a seção visual
duplicada de Informações básicas; seus valores continuam disponíveis
internamente como preenchimento inicial dos formulários. Dobras cutâneas virou
um resumo compacto. O protocolo ganhou ênfase visual nos formulários e as
ações de salvar das avaliações guiada e importada passaram para um rodapé fixo
compartilhado. A avaliação mais recente recebeu maior destaque na timeline.
No estado sem evolução, dicas repetidas dentro dos dois gráficos foram
suprimidas e permaneceu apenas a mensagem central já traduzida.

Impacto:
Nenhum cálculo, validação, protocolo, gráfico, callback, payload, consulta,
persistência, serviço, hook, provider, navegação ou resource de i18n foi
alterado. A mudança se limita a `AssessmentScreen`, apresentação da timeline,
testes estruturais e documentação de staging.

Próxima ação:
Humano coordenador validar hierarquia, rodapé fixo e comportamento do teclado
em iOS e Android, incluindo telas compactas.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Simplificado o formulário de Avaliação Guiada (“Novo registro”). Os campos
visuais de sexo e idade foram removidos; sexo passa a priorizar o questionário
persistido do cadastro e idade continua calculada internamente pela data de
nascimento, considerando a data da avaliação. O campo de data foi substituído
por `NativeDatePickerField`: diálogo nativo no Android, picker nativo em modal
no iOS e fallback textual ISO na web. Datas futuras permanecem bloqueadas.

Impacto:
O payload guiado continua enviando `measuredAt`, `sex` e `age` exatamente como
antes. Fórmulas, protocolos, validação do serviço, Firestore, hooks e navegação
não foram alterados. Adicionada mensagem localizada para cadastros legados sem
sexo/data de nascimento e cobertura estrutural do picker nas duas plataformas.

Próxima ação:
Validar o seletor nativo em dispositivo iOS e Android e confirmar a seleção de
datas retroativas em ambos.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Altura removida dos formulários de Avaliação Guiada e Avaliação Importada. O
valor agora vem do questionário persistido do cadastro, com a avaliação mais
recente usada apenas como compatibilidade para contas legadas. A tela de
importação foi alinhada ao Novo registro: datepicker nativo, bloco separado de
informações básicas e resultados, e peso em campo de largura integral.

Impacto:
Altura continua sendo usada internamente no IMC e persistida no payload das
duas avaliações, sem alteração de contrato ou fórmulas. Cadastros sem altura
válida recebem uma mensagem localizada e não salvam dados inconsistentes.

Próxima ação:
Validar em iOS e Android o layout dos dois formulários, incluindo datepicker,
teclado e rodapé fixo em telas compactas.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Removida da página principal de Avaliação Física a seção visual de Dobras
cutâneas. A hierarquia agora segue diretamente de Adicionar avaliação para
Histórico. Também foram removidos o resumo derivado da última avaliação guiada
e as quatro traduções que existiam exclusivamente para esse bloco.

Impacto:
As dobras continuam disponíveis no formulário de Novo registro, permanecem
nos cálculos e seguem sendo persistidas normalmente. Nenhum contrato, fórmula,
serviço, consulta, payload ou registro histórico foi alterado.

Próxima ação:
Validar visualmente a transição entre Adicionar avaliação e Histórico em telas
iOS e Android.

---

Data: 2026-08-11
Responsável: Agente Frontend + QA
Categoria: [CORREÇÃO]

Descrição:
Auditoria pós-Fase 3 identificou duas esperas sequenciais artificiais no cold
start: os providers só montavam após as fontes e o listener do Firebase Auth só
liberava a sincronização RevenueCat depois das leituras de
perfil/questionário. Os providers agora montam durante a hidratação de fontes;
após o Auth fornecer o UID, Firestore e `Purchases.logIn(uid)` avançam em
paralelo. O Gate continua fail-closed até todos os dados obrigatórios estarem
resolvidos. O loading inicial e o loading comercial do Paywall passaram a usar
a mesma superfície visual.

Foi confirmado que não existe `getCustomerInfo()` redundante depois de
`Purchases.logIn(uid)` e que Offerings só são carregados após o Gate escolher o
Paywall. Foram adicionados sete testes de orquestração/loading; suíte total:
116 testes aprovados e TypeScript sem erros.

Impacto:
Menor caminho crítico estrutural no cold start e transição visual contínua para
usuário sem Premium, sem mudar a autoridade de
`CustomerInfo.entitlements.active['premium']`, sem usar Firestore no Gate e sem
permitir decisão enquanto assinatura é desconhecida.

Próxima ação:
Repetir os cold starts Premium e sem Premium no dispositivo e manter os testes
offline da Fase 3 como pendentes até validação real.
Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a verificação obrigatória de e-mail exclusivamente para contas
que possuam o provider Firebase `password`. O cadastro inicia um único
`sendEmailVerification` assim que o usuário é criado, preservando em paralelo
o provisionamento existente. A nova `EmailVerificationScreen`, o hook e o
serviço dedicado oferecem confirmação explícita via `User.reload()`, reenvio
manual com loading/rate limit, feedback localizado e logout pelo fluxo já
existente.

O guard central de `App.tsx` passou a priorizar a condição `password` +
`emailVerified === false` antes do questionário e do aplicativo, inclusive em
sessões restauradas. Firebase Authentication permanece como única fonte de
verdade; nenhum campo foi adicionado ao Firestore ou à persistência local.
Google e Apple foram preservados sem regra de verificação inferida por
provider. O linking continua no mesmo UID e agora devolve explicitamente o
`User` atualizado retornado por `linkWithCredential`, incluindo o valor real
de `emailVerified` após a operação.

Impacto:
Usuários de e-mail/senha não acessam o fluxo principal até a confirmação real
no Firebase. Contas exclusivamente Google/Apple não são bloqueadas. Não houve
migração do Firebase Auth, dependência nova, alteração de Rules, deep linking,
polling ou implementação de MFA.

Testes feitos:
- serviço de envio/recarga, sessão nula/trocada e
  `auth/too-many-requests` com mocks;
- regra do guard para password verificado/não verificado, Google, Apple,
  providers vinculados e ausência de sessão;
- contrato estrutural do guard, cadastro, logout e account linking;
- paridade e cobertura de textos em pt-BR, inglês e espanhol;
- suíte completa e TypeScript.

Próxima ação:
Humano coordenador validar o fluxo real em development build com contas de
teste e-mail/senha, Google e Apple. O repositório não possui emulador de
Firebase Auth; os testes automatizados cobrem o contrato com mocks.

Assinatura:
Codex — 2026-08-10 — prompt da tarefa de verificação de e-mail (versão 1).

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
POC técnica isolada de TOTP MFA preparada na branch
`feature/totp-mfa-poc`, mantendo Firebase Authentication no JS SDK. A POC
temporária e exclusiva de development cobre geração do segredo, URI
`otpauth://`, assertion/enrollment, leitura de `enrolledFactors`, captura de
`auth/multi-factor-auth-required`, seleção do hint TOTP e resolução do login.
O fluxo concluído por `resolveSignIn` não navega manualmente: permanece sob o
listener do `AuthContext` e o guard central já existente.

Resultado:
TypeScript, 870 testes da suíte completa, 548 testes de i18n, auditoria i18n e
21 verificações do Expo Doctor foram aprovados. A execução real do ciclo com o
backend Firebase e autenticador ainda não foi realizada em development builds
Android e iOS; portanto, o resultado desta fase permanece **NO-GO** até a
validação obrigatória nos dois sistemas.

Impacto:
Não houve implementação de MFA de produção, migração de SDK, dependência nova,
mudança de persistência, Firestore/Storage Rules, claims, SMS, reCAPTCHA ou
alteração da `SecurityScreen`. O segredo e o OTP não são persistidos nem
logados. O acesso à POC e a captura experimental no login são condicionados a
`__DEV__`.

Próxima ação:
Executar enrollment, código incorreto e novo login com TOTP em Android e iOS,
confirmando que um usuário com questionário existente retorna ao Dashboard e
não ao Quiz. Somente após os dois resultados reais a POC poderá ser marcada
como GO.

Assinatura:
Codex — 2026-08-10 — Fase 1 da POC TOTP MFA.

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Substituído o enrollment experimental da POC por gerenciamento TOTP de
produção em Configurações → Segurança → Verificação em duas etapas. O status
é relido de `multiFactor(user).enrolledFactors`; ativação e desativação exigem
reauth de senha, operam sobre fatores TOTP explícitos e não criam flags no
Firestore ou na persistência local. O enrollment oferece QR Code, chave
manual, cópia explícita e abertura segura da URI `otpauth://`.

Segurança:
O segredo permanece somente na memória do hook e é limpo após sucesso,
cancelamento, troca de usuário e unmount. Nenhum segredo, OTP ou token é
logado. Contas somente Google/Apple ficam bloqueadas até a reautenticação
federada da Fase 3. Na desativação de contas já protegidas, o fluxo também
resolve o challenge TOTP se o Firebase o exigir durante a reautenticação.

Resultado automático:
TypeScript, 879 testes da suíte completa, 548 testes de i18n, auditoria i18n,
21 verificações do Expo Doctor e `git diff --check` aprovados. A validação
manual desta implementação em development builds Android/iOS permanece
pendente antes da aprovação humana da fase.

Limites:
O enrollment DEV da POC e seu acesso em Configurações foram removidos. A ponte
DEV de challenge por e-mail/senha permanece temporariamente para preservar a
prova da Fase 1. O challenge definitivo de login para e-mail/senha, Google e
Apple, recovery e revogação de sessões não foram implementados.

Próxima ação:
Executar o roteiro manual de ativação, configuração com um celular, código
incorreto, cancelamento e desativação em Android e iOS. Depois da revisão
humana, iniciar a Fase 3 para o challenge de login de produção.

Assinatura:
Codex — 2026-08-10 — Fase 2 de enrollment/gerenciamento TOTP.

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado o challenge TOTP definitivo no login de produção para
e-mail/senha, Google e Apple. Os services preservam o
`auth/multi-factor-auth-required` original; `src/services/mfaTotp.ts` mantém o
`MultiFactorResolver` somente em memória; `useTotpChallenge` controla seleção
de fator, OTP, retry, expiração e cancelamento; `TotpChallengeScreen` fornece a
UI única do fluxo. A ponte DEV da POC e seus três arquivos paralelos foram
removidos.

Integração:
Após `resolveSignIn`, nenhum `User` é definido e nenhuma rota é aberta
manualmente. `onAuthStateChanged` continua sendo a autoridade, carrega perfil
e questionário e entrega o estado ao guard central. Assim, um usuário existente
com questionário e TOTP retorna ao Dashboard, sem passar pelo Quiz. Linking
continua separado de `account-exists-with-different-credential` e conclui a
credencial pendente no mesmo UID depois do segundo fator.

Segurança:
Resolver, hints internos, credencial de linking e OTP não são persistidos nem
logados. Cancelamento/unmount/erro terminal limpam a memória. Código incorreto,
rede e rate limit permitem retry. Nenhuma alteração foi feita em
`secureAuthStorage`, inicialização/persistência do Firebase, Firestore/Storage
Rules, schemas ou custom claims. SMS, reCAPTCHA, recovery codes e revogação de
outras sessões seguem fora do escopo.

Validação:
Testes automatizados cobrem primeiro fator com e sem MFA nos três provedores,
resolução/retry/limpeza do resolver, linking, múltiplos hints, fator não TOTP,
expiração, logout, verificação de e-mail, persistência segura, guard
Quiz/Dashboard e paridade i18n. A validação runtime com contas reais e
development builds Android/iOS continua obrigatoriamente manual.

Assinatura:
Codex — 2026-08-10 — Fase 3 do challenge de login TOTP.

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 4 do TOTP MFA com reautenticação federada para enrollment e
unenrollment. Contas Google-only e Apple-only deixaram de ser bloqueadas em
Configurações → Segurança → Verificação em duas etapas. A nova camada
`reauthentication.ts` reutiliza as aquisições nativas existentes e aplica a
credencial exclusivamente com `reauthenticateWithCredential` ao usuário atual.
Login, linking, provisionamento e navegação não fazem parte dessa operação.

Google reutiliza configuração, Play Services, folha nativa, extração de idToken
e `GoogleAuthProvider.credential` já existentes. Apple gera raw nonce novo em
cada tentativa, envia SHA-256 à Apple, usa o raw nonce apenas na credencial
Firebase e não solicita nem depende de nome/e-mail durante reauth. Senha mantém
o serviço anterior e segue como primeira opção quando vinculada. Contas
multi-provider exibem todas as alternativas reais na ordem senha, Google e
Apple, sem inferência por `providerData[0]`.

Segurança:
O UID original é validado antes da chamada Firebase, depois do resultado e
novamente nas fronteiras assíncronas de geração do segredo e unenrollment.
Cancelamento, provider indisponível, credencial divergente ou troca de sessão
abortam sem tocar os fatores. Credenciais, id/identity tokens, raw nonce, senha,
OTP, segredo e MultiFactorSession permanecem somente em memória e não são
logados nem persistidos. A desativação continua resolvendo o TOTP já cadastrado
quando a reautenticação retorna `auth/multi-factor-auth-required`.

Validação automática:
TypeScript aprovado; 945 testes da suíte completa aprovados; 75 testes focados
de providers/reauth/MFA/regressão aprovados; 550 testes de i18n aprovados;
auditoria i18n sem bloqueios; Expo Doctor com 21/21 verificações aprovadas; e
`git diff --check` aprovado. Os testes cobrem os sete conjuntos de providers,
nonce Apple novo, hash/raw nonce, códigos reais instalados do Google,
cancelamento, mismatch de UID, enrollment/unenrollment federado e regressão dos
challenges de login e account linking.

Pendência:
Executar em development builds o ciclo real Google-only no Android/iOS e o
ciclo Apple-only em dispositivo iOS real: ativar, cancelar, escolher conta
divergente quando possível, sair, entrar com TOTP e desativar. O repositório não
possui emulador Firebase Auth capaz de substituir essa validação nativa.

Assinatura:
Codex — 2026-08-10 — Fase 4 de reautenticação federada TOTP.

---

Data: 2026-08-11
Responsável: Codex — Agente Backend + Segurança
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 3 (preparação segura da infraestrutura) do backend do Photo
Vault. Removido `functions/lib`, código JavaScript compilado e órfão (de uma
integração RevenueCat desenvolvida em branches remotas separadas, commitado por
engano no commit `12991ba`), sem `functions/src` correspondente e incompatível
com o `firestore.rules` atual. Em seu lugar, criada uma estrutura real de Firebase
Functions v2 em TypeScript (`functions/src`, `functions/package.json`,
`functions/tsconfig.json`), com `firebase-admin` inicializado via Application
Default Credentials (sem service account JSON), um logger estruturado com
política explícita de nunca logar segredos/tokens/chaves, um guard `requireAuth`
reutilizável para futuras callable functions autenticadas, e uma única function
real hoje: `backendHealth` (callable pública, retorna apenas `ok`/versão/hora do
servidor). `firebase.json` passou a declarar a pasta `functions`; criado
`.firebaserc` com apenas o alias `production` (`ajfit-2f321`), sem `default`, para
que nenhum deploy aconteça implicitamente. Documentado em
`docs/20_backend_functions_photo_vault.md`, incluindo o passo a passo manual
necessário para criar o projeto de staging (ainda inexistente).

Segurança:
Nenhum Cloud KMS, Vault Key, `createVault`/`recoverVaultKey`, criptografia de
fotos ou App Check foram implementados nesta fase — travado por teste estrutural
(`foundationStructure.test.ts`) que falha se qualquer um desses termos aparecer no
código-fonte do backend. Nenhuma credencial privilegiada foi adicionada ao
repositório; nenhum deploy (produção ou staging) foi executado.

Validação automática:
`npm run typecheck`, `npm run build` e `npm run test` (13 testes) aprovados em
`functions/`. Suíte completa do mobile (`npm run typecheck` + `npm run test`, 945
testes em 60 arquivos) aprovada sem regressão após as alterações em
`firebase.json`.

Pendência:
Criar o projeto Firebase de staging (ação manual, ver
`docs/20_backend_functions_photo_vault.md` §7) antes de qualquer deploy de
staging real. Próxima fase: modelagem Firestore/Storage + Rules do Photo Vault.

Assinatura:
Codex — 2026-08-11 — Fase 3 de preparação segura da infraestrutura backend.

---

Data: 2026-08-11
Responsável: Codex — Agente Backend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 4 (modelagem de dados + Security Rules) do Photo Vault.
Criados três contratos amarrados ao mesmo uid/photoId: o objeto cifrado em
`users/{uid}/progressPhotos/{photoId}.enc` no Storage (ciphertext opaco,
`application/octet-stream`, nunca `image/*`), os metadados em
`users/{uid}/progressPhotos/{photoId}` no Firestore (schema fechado com
hasAll/hasOnly, sem downloadURL/signed URL/thumbnail), e o documento
backend-only `users/{uid}/privateSecurity/photoVault`. O `storagePath` do
metadado é preso por igualdade exata de string ao uid e ao photoId do próprio
documento, impedindo apontar para o arquivo de outro usuário. Documentos e
objetos são imutáveis: substituir uma foto exige excluir o par e criar um novo
photoId. Criada a suíte de testes de Storage Rules, que não existia no projeto,
cobrindo também por regressão os paths pré-existentes de avatar e de anexos de
suporte. Adicionado o emulador de Storage ao `firebase.json` e os scripts
`test:rules:firestore`/`test:rules:storage`, com `test:rules` passando a rodar
as duas suítes.

Segurança:
O documento `photoVault` é negado ao cliente em leitura E escrita
(`allow read, write: if false`) — o app nunca precisa da chave embrulhada, pois
receberá a Vault Key já desembrulhada por Function autenticada. Como o Admin SDK
ignora as regras, o schema fechado e versionado do vault vive em
`functions/src/photoVault/schema.ts`, onde é de fato aplicável; uma validação em
`firestore.rules` seria código morto e falsa sensação de segurança.

Um teste falhou e revelou um erro real durante a implementação: no Cloud Storage
um upload sobre caminho existente cria uma nova geração do objeto e é avaliado
como `create`, não como `update` — logo `allow update: if false` sozinho NÃO
impede sobrescrita. A regra passou a exigir `resource == null` no `create`.

Validação automática:
105 testes de Firestore Rules aprovados; 33 testes de Storage Rules aprovados;
52 testes do backend Functions aprovados; suíte completa do mobile (945 testes)
aprovada sem regressão; typecheck do mobile e do backend aprovados; build do
backend aprovado. Todos os testes rodaram contra o Firebase Emulator Suite com o
project id descartável `ajfit-rules-test` — nenhum dado foi escrito em
`ajfit-2f321`.

Pendência:
As rules NÃO foram publicadas — deploy pendente de revisão humana. Achado
pré-existente fora do escopo, apenas registrado: anexos de suporte
(`users/{uid}/support/{ticketId}/attachments/{fileName}`) também podem ser
sobrescritos pelo dono pelo mesmo motivo (ausência de `resource == null`),
apesar do `allow update, delete: if false`; corrigir exige avaliar se o app
depende desse comportamento.

Assinatura:
Codex — 2026-08-11 — Fase 4 de modelagem e Security Rules do Photo Vault.

---

Data: 2026-08-11
Responsável: Codex — Agente Backend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 5 (Cloud KMS + IAM + KEK) do Photo Vault. Integrado
`@google-cloud/kms` ao backend e criada a camada de envelope encryption em
`functions/src/photoVault/`: `kmsClient.ts` (cliente singleton, constantes de
KeyRing/CryptoKey e construção controlada do resource name), `vaultKeyCrypto.ts`
(`wrapVaultKey`/`unwrapVaultKey`) e `errors.ts` (taxonomia interna). Essas
funções são internas: não são callable, não são HTTP, não recebem uid, não tocam
o Firestore e o app não as alcança — travado por teste estrutural. Criado o
script idempotente e versionado `scripts/setup-photo-vault-kms.sh`, que habilita
a Cloud KMS API, cria o KeyRing `ajfit-photo-vault` e a CryptoKey
`photo-vault-kek` (simétrica, rotação de 90 dias) em us-central1, e concede
`roles/cloudkms.cryptoKeyEncrypterDecrypter` à service account de runtime das
Functions escopado à CryptoKey — nunca ao KeyRing, nunca ao projeto.

Região us-central1 escolhida por alinhamento com a Function já implantada
(`revenueCatWebhook`), evitando espalhar infraestrutura entre regiões.

Segurança:
Nenhuma service account JSON foi criada ou adicionada; a autenticação é ADC,
igual ao firebase-admin. O nome do KeyRing/CryptoKey é constante de backend e
nunca vem de input — um cliente capaz de influenciá-lo poderia pedir decrypt
contra uma chave sob seu controle. O project id vem do ambiente gerenciado, não
hardcoded, para rodar em staging sem edição. Erros do Google Cloud são
descartados deliberadamente (carregam projeto, chave e estado de IAM) e mapeados
para códigos internos. Há teste que falha se material de chave aparecer em
qualquer chamada ao logger.

Recursos criados em ajfit-2f321 mediante autorização humana explícita, após
dry run revisado: Cloud KMS API habilitada, KeyRing ajfit-photo-vault, CryptoKey
photo-vault-kek e o binding de IAM. Registrado que KeyRings e CryptoKeys do
Cloud KMS nunca podem ser excluídos no GCP — apenas versões de chave podem ser
destruídas —, portanto esses nomes são permanentes no projeto.

Validação automática:
89 testes do backend aprovados (2 de integração pulados por serem opt-in);
typecheck e build do backend aprovados; suíte completa do mobile (945 testes) e
seu typecheck aprovados; 105 testes de Firestore Rules e 33 de Storage Rules
aprovados; script validado por dry run, execução e reexecução (idempotência
confirmada: "already exists" em todos os passos).

Validação da KEK:
Round trip real executado contra a chave com 32 bytes aleatórios descartáveis
(32 → 112 bytes wrapped → 32 bytes restaurados, idênticos; ciphertext difere do
plaintext). Material temporário sobrescrito e removido. Nenhuma chave de usuário
real foi envolvida e nada foi persistido.

Pendência:
O teste de integração opt-in em vitest exige `gcloud auth application-default
login` (ADC), ausente na máquina — a validação equivalente foi feita via gcloud
CLI. Risco operacional pré-existente identificado e registrado: a Function
`revenueCatWebhook` está ATIVA em produção (us-central1) mas seu código-fonte
não existe nesta branch — um `firebase deploy --only functions` a partir daqui a
removeria.

Assinatura:
Codex — 2026-08-11 — Fase 5 de Cloud KMS, IAM e KEK do Photo Vault.

---

Data: 2026-08-11
Responsável: Codex — Agente Backend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 6 do Photo Vault: as callables autenticadas `createVault` e
`recoverVaultKey`, primeiras operações reais do vault. `createVault` gera a
Vault Key com CSPRNG (randomBytes, 32 bytes), embrulha via KMS e persiste apenas
a forma wrapped; recusa-se a agir se o usuário já tem vault, retornando
`already-exists` — nunca gera segunda chave, o que órfãozaria permanentemente as
fotos existentes. A atomicidade usa `DocumentReference.create()`, cuja
pré-condição server-side de "não pode existir" garante que duas chamadas
concorrentes nunca criem duas chaves. `recoverVaultKey` exige reautenticação
recente, lê o próprio vault, valida o documento armazenado, desembrulha e
devolve a chave; nunca cria vault implicitamente.

Criados `vaultRepository.ts` (única fronteira Firestore, onde o schema fechado é
de fato aplicado) e o guard `requireRecentAuth` em `lib/auth.ts`. A camada KMS
foi evoluída para que `wrapVaultKey` devolva também o `kmsKeyVersion` extraído
de `EncryptResponse.name` — a versão nunca é inventada, e uma resposta sem
versão é rejeitada.

Segurança:
O uid vem exclusivamente de `request.auth.uid`. Testado explicitamente que
`uid`, `userId`, `email`, `path` e `documentPath` no corpo são ignorados nas
duas callables, e um teste estrutural falha se `request.data` for lido nesses
arquivos. A janela de reautenticação é de 5 minutos, lida do claim `auth_time`
do token verificado pelo Firebase; ausente, NaN, Infinity ou futuro anômalo
falham fechado, e qualquer alegação de frescor vinda do corpo é ignorada.

Erros de KMS e Firestore são achatados em HttpsError genéricos — testado que
`photo-vault-kek`, `ajfit-2f321` e `PERMISSION_DENIED` não aparecem nas
mensagens devolvidas. Nenhuma chave, corpo de requisição ou resposta é logado.
A zeroização dos buffers é best effort e a limitação do runtime está
documentada, sem prometer o que V8/GC não entregam.

Validação automática:
172 testes do backend aprovados (2 de integração pulados por serem opt-in),
typecheck e build aprovados; 105 testes de Firestore Rules e 33 de Storage Rules
aprovados; suíte completa do mobile (945 testes) e typecheck aprovados.

Pendência:
Nenhum deploy foi executado, conforme escopo. App Check e rate limiting de
`recoverVaultKey` permanecem como hardening futuro, registrados na seção 20 do
doc 20. Reiterado: o deploy destas Functions deve ser feito por nome
(`--only functions:createVault,functions:recoverVaultKey`), nunca com
`--only functions`, porque `revenueCatWebhook` está ativa em produção e seu
código vive em branch paralela. Nenhum arquivo de RevenueCat foi tocado.

Assinatura:
Codex — 2026-08-11 — Fase 6 de createVault e recoverVaultKey.

---

Data: 2026-08-12
Responsável: Agente Documentador (registro de descoberta técnica validada pelo
Humano Coordenador)
Categoria: [CORREÇÃO]

Descrição:
Google Sign-In funcionava no development build Android, mas retornava
`DEVELOPER_ERROR` (code 10) no app instalado a partir da Google Play — log real
capturado do build distribuído:

```txt
This android application is not registered to use OAuth2.0, please confirm
the package name and SHA-1 certificate fingerprint match what you registered
in Google Developer Console.
```

O Web Client ID em runtime (`753375043967-oldj9c61p82vni4s1n5fjkks3gueh4se.apps.googleusercontent.com`)
foi confirmado correto, descartando-o como causa. O app Android
(`com.ajfit.mobile`) já tinha cadastrado no Firebase o SHA-1 atual do Google
Play App Signing. Foi criado o OAuth Client Android correspondente, o
`google-services.json` foi atualizado, um novo AAB foi gerado, enviado,
revisado e instalado via Play Store — o erro persistiu.

Causa raiz:
O Google Play Console (Assinatura de apps → Play App Signing → "Chaves de
assinatura do app anteriores") expõe um SHA-1 de uma chave de assinatura
anterior, além da chave atual. Esse SHA-1 anterior não estava cadastrado no
app Android do Firebase. Após cadastrá-lo (mesmo `com.ajfit.mobile`), o app já
instalado pela Play Store — sem nenhum rebuild — passou a autenticar com
Google Sign-In com sucesso poucos minutos depois.

Evidência de que não foi o `google-services.json`/rebuild que resolveu: a
sequência atualizar `google-services.json` → gerar AAB → publicar → instalar
via Play Store já tinha sido executada antes da inclusão do SHA-1 anterior e
não corrigiu o erro. A correção só ocorreu quando o SHA-1 passou a existir no
Firebase/Google OAuth — configuração server-side, não embarcada no binário já
instalado.

SHA-1 cadastrados no app Firebase Android `com.ajfit.mobile` (finalidade de
cada um — nenhum é secreto, são fingerprints públicos de certificado):

```txt
1. Development/debug:
   5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25

2. Google Play App Signing — chave atual:
   FB:50:07:DE:A3:15:4C:EF:B5:25:FF:21:08:1F:16:81:35:B5:D4:BF

3. Google Play App Signing — chave anterior:
   97:11:72:4E:30:C7:65:C3:E8:41:BB:0F:6F:D1:01:F9:7B:56:C0:04
```

Princípio para evitar regressão (não é lista fechada):
Sempre que o Google Play App Signing possuir chave atual e chave(s)
anterior(es) que ainda possam assinar/distribuir versões compatíveis do app
para dispositivos já existentes, todos os SHA-1 relevantes — atual e
anteriores — precisam estar cadastrados no app Firebase/Google OAuth do
mesmo package. Um certificado antigo não deve ser removido do Firebase apenas
por parecer obsoleto, sem antes verificar se ainda assina versões em
distribuição.

Diagnóstico:
Reprodução confirmada via logs reais (adb/logcat) do app instalado pela
própria Google Play, isolando a mensagem de erro do SDK do Google Sign-In
(`DEVELOPER_ERROR` / code 10 e a mensagem de package+SHA-1 não registrados)
antes de qualquer alteração de configuração.

Impacto:
Nenhuma alteração de código de autenticação foi necessária. A causa era
puramente de configuração OAuth (SHA-1 ausente para uma chave de assinatura
válida do Google Play). `google-services.json` não precisou de nova geração
para esta correção específica — isso não deve ser generalizado como "nunca
precisa atualizar `google-services.json`" para outras mudanças (ex.: novo
OAuth Client, novo package, nova chave de assinatura futura ainda não
cadastrada).

Próxima ação:
Nenhuma pendência de código. Ao rotacionar ou adicionar chave de assinatura no
Google Play App Signing no futuro, cadastrar o novo SHA-1 no Firebase antes de
assumir que o Google Sign-In continuará funcionando na versão distribuída.
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 7 do Photo Vault: integração mobile da Vault Key. Criados
`src/lib/firebaseFunctions.ts` (cliente Callable com região fixada em
us-central1), `src/lib/photoVaultKeyStorage.ts` (chave no Keychain/Keystore via
expo-secure-store, namespaced por uid), `src/lib/photoVaultErrors.ts`,
`src/services/photoVault.ts` (ensure/create/recover com validação de resposta) e
`src/services/photoVaultRecovery.ts` (composição reauth → recover, separada para
não arrastar os providers nativos para dentro do service do vault). O logout
passou a remover a chave local.

A chave é guardada em arquivo separado do secureAuthStorage por terem ciclos de
vida diferentes: a sessão rotaciona e morre no logout, a Vault Key é estável e
recuperável do backend. A validação de 32 bytes é feita sem decodificar o
base64, calculando o comprimento pela forma da string — Buffer e atob não são
garantidos no runtime do React Native.

Segurança:
`already-exists` nunca gera segunda chave: não há limpeza do vault remoto, nem
retry com chave nova, nem chave inventada localmente — o único caminho é reauth
→ recover, sem loop automático. A checagem de frescor no cliente usa janela de 4
minutos, menor que os 5 do backend, para preferir pedir reautenticação a
disparar uma chamada que seria rejeitada na fronteira; o backend continua sendo
a autoridade. O namespace por uid é a isolação primária (uid faz parte da chave
do SecureStore); o uid no payload é conferido como defesa em profundidade. Um
uid não namespaceável falha fechado. Logs registram apenas o `issue` — nunca
chave, payload, resposta, senha ou token. Reautenticação reutiliza
`reauthenticateCurrentUser`, cobrindo senha/Google/Apple sem criar login
paralelo, e força `getIdToken(true)` para que o `auth_time` novo chegue à
callable.

Ajuste de camada durante a implementação: o logout passou a importar
`deleteVaultKey` do storage, não do service, para não puxar o cliente de
Functions para o grafo de módulos da autenticação.

Validação automática:
1058 testes do mobile aprovados (63 arquivos), typecheck aprovado; 172 testes do
backend aprovados; 105 de Firestore Rules e 33 de Storage Rules aprovados.

Pendência:
Nenhum deploy foi executado — as Functions da Fase 6 seguem não publicadas,
então o fluxo mobile ainda não pode ser exercitado ponta a ponta contra o
ambiente real. Biometria (`requireAuthentication`) permanece fora, como fase
própria. Nenhum arquivo de RevenueCat foi tocado.

Assinatura:
Codex — 2026-08-12 — Fase 7 de integração mobile da Vault Key.

---

Data: 2026-08-12
Responsável: Agente Documentador (validação manual reportada pelo Humano
Coordenador)
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Estado da validação Android das assinaturas (RevenueCat + sistema
promocional), conforme validação manual em dispositivo/Google Play reportada
pelo Humano Coordenador. Estas afirmações são registradas como "informação
fornecida a partir da validação manual realizada" — não foram reverificadas
automaticamente pelo agente documentador contra código ou logs nesta tarefa:

* carregamento dos planos RevenueCat;
* plano mensal e plano anual;
* reconhecimento do cupom ARNALDO;
* rejeição de cupom inexistente;
* correlação do cupom com a oferta promocional correta;
* matcher da `SubscriptionOption` corrigido (Android);
* oferta promocional mensal correta: `monthly:influencer-trial-7d`;
* oferta promocional anual correta: `annual:influencer-trial-7d-annual`;
* RevenueCat expondo `freeTrialPeriodIso8601 = P1W`;
* Google Play apresentando corretamente 7 dias grátis em teste válido;
* compra/teste realizados, trial aparecendo na Google Play, próximo
  pagamento agendado após os 7 dias;
* entitlement `premium` ativo;
* sincronização RevenueCat → backend/Firestore;
* `subscription.status = TRIAL` durante o período gratuito;
* `trialEndsAt` coerente com 7 dias e `currentPeriodEndsAt` coerente;
* atribuição do cupom persistida;
* acesso Premium liberado;
* Google Sign-In funcionando na versão realmente distribuída pela Google
  Play (causa raiz e correção registradas na entrada [CORREÇÃO] acima).

Impacto:
Nenhum item desta lista foi verificado por este agente via leitura de
código/testes automatizados nesta tarefa — ver 13_assinaturas_e_billing.md
para as regras de negócio correspondentes (§6–§11, §25–§30) e
17_checklist_fase3_assinatura.md para o roteiro estrutural de lifecycle
(cold start, background/foreground, restore, TRANSFER), que cobre um escopo
diferente (lifecycle do Gate) do sistema de cupom/oferta promocional listado
acima.

Próxima ação:
Nenhuma determinável apenas pelos documentos/evidências disponíveis nesta
tarefa — os itens de sistema de cupom/oferta promocional (matcher de
`SubscriptionOption`, roteamento `campaignId → Offering`) não possuem ainda
um checklist formal equivalente ao 17_checklist_fase3_assinatura.md; se essa
lacuna for confirmada como real, cabe ao Humano Coordenador decidir se cria
um checklist dedicado ou expande o existente.
Data: 2026-08-13
Responsável: Codex — Agente Backend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 2 da migração iOS Promo SKU + Introductory Offer. A nova
callable autenticada `authorizePromoPurchase` aceita somente `monthly` ou
`annual` e cria, dentro de transação Firestore, a intenção pré-compra aninhada
em `couponRedemptions/{uid}.purchaseIntent`. Campanha, Offering e Product ID
são derivados do snapshot `iosPromotion` da redemption; UID e timestamps são
autoridade exclusiva do backend. A intent `purchase_pending` expira
logicamente em 10 minutos, retry equivalente é idempotente sem renovar a
janela, intent ativa conflitante é recusada e intent expirada pode ser
substituída. O fluxo de aplicação de cupom também passou a impedir troca de
campanha enquanto uma intent está ativa.

Impacto:
Somente backend, tipos, testes e documentação foram alterados. Paywall,
StoreKit, correlação do webhook, Android e Apple Offer Code legado permanecem
sem alteração. A intent não define `lockedAt`, `trialStartedAt` ou
`convertedAt` e não concede Premium; `CustomerInfo.entitlements.active["premium"]`
continua sendo a autoridade final.

Próxima ação:
Na Fase 3, após aprovação humana, correlacionar o webhook real com a intent
pré-existente e o `product_id` esperado, sem inferir campanha pelo SKU.

---

Data: 2026-08-13
Responsável: Codex — Agente Backend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 3 da migração iOS Promo SKU + Introductory Offer. O
webhook RevenueCat passa a correlacionar `APP_STORE` `INITIAL_PURCHASE` com a
`purchaseIntent` pré-existente usando campanha, Offering, plano, Product ID e
`purchased_at_ms` dentro da janela autorizada. O match e o consumo auditável
(`purchase_confirmed`, `confirmedAt`, `revenueCatEventId`) ocorrem na mesma
transação que confirma attribution. Retry exato é reconhecido e eventos
distintos não reutilizam a intent.

Impacto:
`subscriptionSync.ts`, Gate Premium, cliente e Android permaneceram
inalterados. Apple Offer Code legado continua disponível somente quando não há
evidência aplicável do novo fluxo; conflito no fluxo novo nunca cai para o
legado. Falha de correlação continua um resultado normal e não bloqueia o
billing. O cliente ainda não chama `authorizePromoPurchase` nem compra os SKUs
promocionais.

Próxima ação:
Após validação humana, integrar o cliente ao Offering `promo_7d`, à callable e
à compra do SKU promocional na Fase 4.

---

Data: 2026-08-13
Responsável: Codex — Agente App
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 4 da migração iOS Promo SKU + Introductory Offer. O cliente
agora tipa e valida em runtime o `iosPromotion` retornado por
`validatePromoCode`, preserva a autorização em estado efêmero isolado por UID
e resolve de forma pura a Offering standard (`offerings.current`) ou a
Offering promocional indicada pelo backend (`offerings.all[offeringIdentifier]`).
O package promocional só é aceito quando `packageType` e Product ID coincidem
com a autorização; inconsistências falham sem fallback.

Impacto:
O estado promocional passou a viver em provider em memória acima do navegador,
portanto sobrevive a remount do Paywall, mas não a restart, logout ou troca de
usuário. O Paywall apenas prepara/diagnostica a resolução nesta fase: não chama
`authorizePromoPurchase` e não compra Promo SKU. Android, Premium gate,
Functions, webhook, `subscriptionSync.ts` e Apple Offer Code legado ficaram
inalterados.

Próxima ação:
Na Fase 5, integrar no tap de compra a criação imediata da purchase intent e a
compra do package promocional já validado, sem fallback comercial silencioso.

---

Data: 2026-08-13
Responsável: Codex — Agente App
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 5 da migração iOS Promo SKU + Introductory Offer. O
Paywall passa a exibir os packages promocionais estritamente resolvidos pela
autorização backend, consulta a elegibilidade introdutória real do
RevenueCat/StoreKit por Product ID e deriva trial somente do `introPrice` real
com preço zero, duração válida e status `ELIGIBLE`. `INELIGIBLE` mostra o preço
regular do Promo SKU; `UNKNOWN`, erro e configuração introdutória inconsistente
falham de modo seguro sem prometer trial.

Impacto:
No toque em Continuar, o app chama `authorizePromoPurchase` enviando somente o
plano, revalida a intent contra o snapshot de UID/cupom/plano/Offering/Product
ID/package/TTL e só então compra o package promocional exato. Double tap,
resposta obsoleta, mismatch, expiração, conflito e falha de autorização não
chegam ao StoreKit e não fazem fallback. O fluxo standard, Apple Offer Code
legado, Android, webhook, `subscriptionSync.ts` e autoridade Premium por
CustomerInfo foram preservados. Não houve deploy nem alteração remota.

Próxima ação:
Executar a Fase 6 / E2E controlada no sandbox iOS, incluindo Apple IDs
elegível e inelegível e validação visual da folha de pagamento Apple.

---

Data: 2026-08-13
Responsável: Codex — Agente App
Categoria: [REFATORAÇÃO]

Descrição:
Implementada a Fase 6 da migração iOS Promo SKU + Introductory Offer. Foi
removido exclusivamente do cliente o terceiro caminho Apple Offer Code:
rota/tipos/resolvers, operação pública do `SubscriptionContext`, serviço de
redemption, chamada `presentCodeRedemptionSheet`, helper temporário de espera,
CTA e testes/mocks exclusivos. O campo `storeConfig.ios` permanece apenas no
contrato de resposta client-side como wire legado não consumido, evitando
alteração desnecessária de Functions.

Impacto:
O Paywall iOS agora compra somente o package normal de `offerings.current` ou
o Promo SKU autorizado por `iosPromotion`, Intro Eligibility e
`authorizePromoPurchase`. Um cupom legado sem a nova autorização falha
fechado, sem fallback para preço standard ou redemption. CustomerInfo segue
como autoridade Premium; listener global, refresh de foreground, Android,
purchase intent, webhook, `subscriptionSync.ts` e compatibilidade histórica
do backend foram preservados. Não houve push, deploy ou mutação remota.

Próxima ação:
Executar a Fase 7 / E2E Sandbox controlado em iOS para contas elegível e
inelegível, verificando catálogo, termos exibidos, folha StoreKit, purchase
intent e ativação exclusivamente por CustomerInfo.

Assinatura:
Codex — Agente App; 2026-08-13; prompt AJ FIT FASE 6.

---

Data: 2026-08-13
Responsável: Codex — Agente App
Categoria: [AUDITORIA]

Descrição:
Executada a Fase 7 da migração iOS Promo SKU + Introductory Offer, dedicada à
auditoria residual da antiga Redemption Sheet. Helpers, bypass de sandbox,
testes comportamentais antigos, chamada da sheet, espera temporária de
CustomerInfo e diagnostics específicos já estavam ausentes no baseline da
Fase 6. A única ocorrência executável remanescente era a flag órfã
`EXPO_PUBLIC_ENABLE_APPLE_OFFER_CODE_SANDBOX_TEST` no `.env` local; ela foi
removida sem expor seu valor. A flag já estava ausente de `.env.example`,
configuração Expo/EAS, scripts e código.

Impacto:
Nenhuma implementação de app ou Functions foi alterada. Foram preservados os
testes estruturais de ausência da Fase 6, o listener global de CustomerInfo, o
refresh legítimo por AppState, os logs permanentes de attribution/billing, o
backend Apple legado, `storeConfig.ios` como wire tipado não consumido, o novo
Promo SKU, Intro Eligibility, purchase intent, webhook, Android e
`subscriptionSync.ts`. Não houve E2E, push, deploy nem mutação remota.

Próxima ação:
Executar a Fase 8 / E2E Sandbox controlado no iOS, sem declarar prontidão para
produção antes da validação real de usuários elegível e inelegível.

Assinatura:
Codex — Agente App; 2026-08-13; prompt AJ FIT FASE 7.

---

Data: 2026-08-13
Responsável: Codex — Agente Backend + QA
Categoria: [REFATORAÇÃO]

Descrição:
Executada a Fase 8 da migração iOS Promo SKU + Introductory Offer. O modelo
ativo Apple Offer Code foi removido do catálogo tipado, admin,
`validatePromoCode`, novos `couponRedemptions` e correlação do webhook.
`correlateAppleOffer` e sua suíte exclusiva foram removidos; `storeConfig.ios`
e o tipo wire cliente correspondente também deixaram de existir.

Impacto:
O webhook `APP_STORE` correlaciona attribution apenas por
`correlateApplePromoPurchaseIntent`; produto normal ou Promo SKU sem intent
válida não recebe attribution, mesmo com `event.offer_code`. Dados Firestore
históricos não foram apagados: campos Apple antigos são tolerados e ignorados,
e o writer preserva extras existentes sem depender deles. Android,
`subscriptionSync.ts`, Intro Eligibility, purchase intent, logs permanentes e
autoridade Premium por CustomerInfo permaneceram intactos. Não houve E2E,
push, deploy ou mutação remota.

Próxima ação:
Após validação humana, executar a Fase 9 / E2E Sandbox controlado para os
cenários iOS standard e Promo SKU elegível/inelegível.

Assinatura:
Codex — Agente Backend + QA; 2026-08-13; prompt AJ FIT FASE 8.

---

Data: 2026-08-13
Responsável: Codex — Agente QA
Categoria: [AUDITORIA]

Descrição:
Executada a Fase 9 da migração iOS Promo SKU + Introductory Offer como
auditoria de regressão Android. O fluxo real permaneceu baseado em
`validatePromoCode` → snapshot `androidOffer` → match exato de
`SubscriptionOption` → `purchaseSubscriptionOption` → webhook `PLAY_STORE` →
`correlateGooglePlayOffer`. Nenhum arquivo de produção foi alterado.

Impacto:
A cobertura passou a provar explicitamente Android standard e promocional
mensal/anual, independência de `iosPromotion` e purchase intent, passagem da
option exata ao SDK, campanha Android-only, roteamento por loja e fail-closed
para loja desconhecida. Permaneceram intactos o uso Google Play de
`offer_code`, admin Android, `subscriptionSync.ts`, Promo SKU iOS, Intro
Eligibility e autoridade Premium exclusiva por CustomerInfo. Não houve E2E,
push, deploy ou mutação remota.

Próxima ação:
Após validação humana, executar a Fase 10 / E2E Sandbox controlado conforme
roteiro próprio, sem inferir equivalência entre as estratégias internas de
iOS e Android.

Assinatura:
Codex — Agente QA; 2026-08-13; prompt AJ FIT FASE 9.

---

Data: 2026-08-13
Responsável: Codex — Agente QA
Categoria: [TESTES]

Descrição:
Executada a Fase 10 da migração iOS Promo SKU + Introductory Offer como matriz
E2E-like **AUTOMATED / EMULATED**, anterior ao E2E Sandbox real. A cobertura
do app prova standard mensal/anual por `offerings.current` sem Promo SKU,
autorização backend como única origem de `promo_7d`, Product IDs promocionais
exatos, Intro Eligibility baseada em dados StoreKit/RevenueCat e ordem
obrigatória de intent antes da compra simulada.

Impacto:
O Firestore Emulator atravessa catálogo, `validatePromoCode`, snapshot,
`authorizePromoPurchase`, purchase intent e webhook sintético nos planos
mensal e anual. Também cobre reuso após lock com mesmo/outro cupom, catálogo
alterado após snapshot, intent expirada, dois códigos/dispositivos/planos
concorrentes, mismatch e consumo atômico. Rules negam cada write sensível. A
matriz do Premium Gate confirma que somente CustomerInfo concede acesso;
Android e `subscriptionSync.ts` permanecem intactos. Nenhum arquivo de
produção foi alterado e não houve compra real, push, deploy ou mutação remota.

Próxima ação:
Após validação humana dos gates, executar a Fase 11 de deploy controlado do
backend promocional antes de qualquer cliente novo ou E2E iOS Sandbox real.

Assinatura:
Codex — Agente QA; 2026-08-13; prompt AJ FIT FASE 10.

---

Data: 2026-08-13
Responsável: Codex — Agente Backend + QA
Categoria: [DEPLOY CONTROLADO]

Descrição:
Executada a Fase 11 da migração iOS Promo SKU + Introductory Offer com deploy
seletivo no projeto Firebase confirmado `ajfit-2f321`. Foram publicados
somente `validatePromoCode`, `authorizePromoPurchase` e
`revenueCatWebhook`; Functions de vault, health e administração de catálogo
ficaram fora do alvo e foram preservadas. `authorizePromoPurchase` foi criada
e as outras duas Functions receberam novas revisões Gen2 ativas, todas em
`us-central1`/Node.js 20. Os secrets `REVENUECAT_WEBHOOK_SECRET` e
`REVENUECAT_API_SECRET_KEY` já existiam e permaneceram vinculados às versões
habilitadas. Para um smoke HMAC sem efeito de negócio, o valor do secret do
webhook foi acessado somente em memória; não foi exibido, persistido nem
registrado. O secret da API RevenueCat não foi acessado.

Validação:
- pós-deploy: App typecheck e 59 arquivos / 1.038 testes aprovados;
- pós-deploy: Functions typecheck/build e 22 arquivos / 474 testes aprovados;
- pós-deploy: Firestore Emulator/Rules, 3 arquivos / 63 testes aprovados com
  Java 21;
- pós-deploy: i18n check, 22 arquivos / 544 testes; audit de 839 chaves, 14
  suspeitas conhecidas e zero bloqueio; `git diff --check` aprovado;
- regressão backend focalizada: iOS, 7 arquivos / 197 testes; Android, 3
  arquivos / 93 testes;
- chamadas sem autenticação a `validatePromoCode` e
  `authorizePromoPurchase`: HTTP 401 `UNAUTHENTICATED`;
- webhook sem assinatura: HTTP 401 `invalid_signature`;
- webhook com HMAC válido e tipo deliberadamente não suportado: HTTP 200
  `ignored/unsupported_event_type`, sem escrita;
- identidade descartável autenticada: `ARNALDO` foi reconhecido e o espelho
  `users/{uid}.attribution` foi gravado, provando Function + Firestore;
- todos os documentos e a conta Auth temporários foram removidos após cada
  tentativa, sem resíduo conhecido e sem apagar dados históricos.

Auditoria de infraestrutura:
- as Rules remotas não são byte a byte iguais às locais, porém protegem
  `couponRedemptions` explicitamente e `purchaseIntent`, `lockedAt`,
  `trialStartedAt` e `convertedAt` por deny-all/imutabilidade; diferenças
  locais incluem áreas fora desta migração, portanto Rules não foram
  publicadas;
- os dez índices locais e remotos são equivalentes após normalização dos
  campos implícitos; nenhum índice foi publicado;
- Storage Rules, Hosting, Remote Config, RevenueCat Dashboard, App Store
  Connect e Google Play Console não foram alterados.

Bloqueio encontrado:
O catálogo remoto de produção respondeu `iosPromotion: null` para `ARNALDO`.
Por isso `authorizePromoPurchase` falhou fechado com
`ios_promotion_unavailable` e não criou purchase intent. A correlação positiva
Promo SKU → intent → webhook não pôde ser exercitada. Nenhuma configuração
remota foi alterada para contornar o bloqueio.

Conformidade do procedimento:
Os gates de App, i18n e `git diff --check` não foram repetidos nesta Fase 11
antes do comando de deploy. Eles estavam verdes na Fase 10 e ficaram verdes
quando executados após o deploy, mas isso não satisfaz retroativamente o
critério obrigatório de todos os gates pré-deploy. Assim, apesar das três
Functions estarem `ACTIVE` e os smokes seguros terem o resultado esperado, a
Fase 11 é registrada como **NÃO APROVADA**. Não foi feito novo deploy apenas
para repetir uma operação remota já concluída.

Impacto:
O código backend novo está implantado antes do cliente e suas fronteiras de
autenticação/HMAC estão operacionais, mas a cadeia promocional remota fica
parcial enquanto o catálogo não fornecer `iosPromotion`. Não houve deploy do
app, Rules, Storage, Hosting, Remote Config ou Functions fora do alvo; não
houve push, compra Sandbox nem mutação RevenueCat/App Store/Google Play. O CLI
alertou que Node.js 20 está deprecated e deixará de aceitar novos deploys em
2026-10-30, e que `firebase-functions` está defasado; a migração deve ser
planejada em tarefa separada, sem ampliar esta fase.

Próxima ação:
Obter autorização explícita para cadastrar no catálogo remoto a configuração
iOS aprovada de `ARNALDO` (`promo_7d` + SKUs mensal/anual promocionais) por um
canal administrativo controlado. Depois repetir a validação backend-only de
purchase intent, com todos os gates executados antes de qualquer novo deploy,
e só então avançar ao E2E iOS Sandbox real.

Assinatura:
Codex — Agente Backend + QA; 2026-08-13; prompt AJ FIT FASE 11.

---

Data: 2026-08-13
Responsável: Codex — Agente Backend + QA
Categoria: [OPERAÇÃO CONTROLADA]

Descrição:
Executada a Fase 11B para resolver o bloqueio remoto registrado na Fase 11.
O mecanismo oficial encontrado foi a callable administrativa
`adminUpdatePromoCode`; não existe UI correspondente no painel administrativo
local e a Function ainda não estava publicada. O catálogo RevenueCat do app
iOS foi consultado pela API oficial e confirmou `promo_7d` com os packages
mensal/anual apontando, respectivamente, para
`ajfit_premium_monthly_promo` e `ajfit_premium_annual_promo`, sem ambiguidade.
O App Store Connect não pôde ser auditado diretamente por ausência de acesso
seguro não interativo; nenhuma configuração Apple foi criada ou alterada.

Operação:
Todos os gates obrigatórios passaram antes de qualquer deploy. Foi então
publicada exclusivamente `adminUpdatePromoCode` no projeto `ajfit-2f321`.
Por essa API allowlisted, e não por escrita manual, `ARNALDO.iosPromotion` foi
configurado com a Offering e os dois Product IDs confirmados. O read-back
preservou configuração Android, estado comercial, metadados de criação e
campos Apple históricos tolerados. Nenhuma outra Function, Rule, índice,
cliente, Remote Config, RevenueCat, App Store Connect ou Google Play recebeu
mutação.

Validação remota:
Uma identidade QA descartável confirmou `validatePromoCode` no iOS, o snapshot
de `iosPromotion` sem `appleOffer`/`appleOfferCorrelation` e
`authorizePromoPurchase({ plan: "monthly" })` com Product ID correto, Offering
correta, estado `purchase_pending` e TTL de 600 segundos. Um único retry
reutilizou a intent sem renovar nenhum timestamp. Nenhum marcador de consumo
ou campo de Premium foi criado. O smoke Android continuou retornando seus
pares mensal/anual corretos e sem interferência de `iosPromotion`. StoreKit,
compra e webhook artificial não foram executados. A conta Auth e os documentos
QA foram removidos e confirmados como ausentes.

Impacto:
O backend agora alcança, remotamente, a fronteira prevista para esta fase:
`validatePromoCode → iosPromotion → authorizePromoPurchase → purchase_pending`.
O webhook continua `ACTIVE`, com HMAC preservado, e não foi redeployado.
CustomerInfo continua sendo a única autoridade client-side de Premium.

Próxima ação:
Executar a Fase 12 / E2E iOS Sandbox real. Antes da compra, validar no circuito
real do app o catálogo StoreKit e a Intro Eligibility; a configuração direta
do App Store Connect permanece não verificada nesta fase.

Assinatura:
Codex — Agente Backend + QA; 2026-08-13; prompt AJ FIT FASE 11B.

---

Data: 2026-08-13
Responsável: Codex — Agente App + QA
Categoria: [BLOQUEIO]

Descrição:
Durante a Fase 12A.1, foram neutralizadas as promessas prematuras de trial na
`AuthScreen` e na `PlanReadyScreen`, com regressões focais aprovadas. A busca
global posterior não encontrou outro caso runtime que prometesse benefício
comercial antes da autoridade da loja.

Bloqueio:
O logging atual não identifica explicitamente todos os marcos exigidos para o
E2E manual: rota standard/promocional, plano selecionado, compra iniciada,
cancelamento/sucesso e estado Premium resultante. Como a tarefa determina
parada antes de adicionar instrumentação quando houver essa lacuna, os gates,
o build iOS e o commit final não foram executados.

Próxima ação:
Obter autorização explícita para acrescentar logging simbólico e sanitizado,
sem UID completo, cupom, receipt, token, payload ou CustomerInfo. Depois,
retomar os gates, o development build iOS e os roteiros E2E da mesma fase.

Assinatura:
Codex — Agente App + QA; 2026-08-13; prompt AJ FIT FASE 12A.1.

---

Data: 2026-08-13
Responsável: Codex — Agente App + QA
Categoria: [CORREÇÃO + PRÉ-FLIGHT]

Descrição:
Retomada autorizada da Fase 12A.1 e concluída a Fase 12A.2. As promessas de
trial anteriores ao Paywall permaneceram neutralizadas na criação de conta e
na tela de plano pronto. Foi adicionada observabilidade iOS estritamente
allowlisted para rota standard/promo, plano mensal/anual, Intro Eligibility,
autorização da purchase intent, início/cancelamento/conclusão/falha da compra e
`premiumActive` derivado exclusivamente do CustomerInfo retornado pelo SDK.
Os logs não transportam UID, email, cupom, Product ID, Offering, CustomerInfo,
receipt, token, SubscriptionOption ou Offer Token.

Validação:
- App typecheck aprovado;
- App: 61 arquivos / 1.055 testes aprovados;
- Functions typecheck/build aprovados e 22 arquivos / 474 testes aprovados;
- Firestore Emulator/Rules: 3 arquivos / 63 testes aprovados com Java 21;
- i18n check: 22 arquivos / 545 testes aprovados;
- i18n audit: 838 chaves, 14 suspeitas conhecidas e zero bloqueio;
- `git diff --check` aprovado após a documentação final;
- build iOS Debug para dispositivo genérico: `BUILD SUCCEEDED`, zero erros e
  seis avisos não bloqueadores; artefato `AJFit.app` gerado para
  `com.ajfit.app`.

Arquitetura preservada:
CustomerInfo continua sendo a única autoridade client-side de Premium. O
listener global único e o refresh legítimo por AppState foram preservados. O
fluxo standard não cria purchase intent; o fluxo promo mantém validação
estrita, Intro Eligibility fail-closed, autorização antes da compra e ausência
de fallback Promo → standard/Offer Code. Functions, webhook, billing, Android,
RevenueCat e configurações remotas não foram alterados.

Preparação manual:
Foram finalizados no plano de testes o checklist humano de 13 pontos do App
Store Connect, a separação das contas Sandbox A–D, os roteiros Standard
Monthly, Promo Monthly elegível, Promo Annual elegível e Promo inelegível e a
ficha sanitizada de evidências. O App Store Connect não foi verificado pelo
agente; nenhuma compra, deploy, push ou mutação remota foi executada.

Próxima ação:
Victor deve confirmar o checklist do App Store Connect, instalar o build em
iPhone físico e iniciar pelo cenário A — Standard Monthly. Só então executar
os quatro cenários, preservando a independência de eligibility do Subscription
Group.

Assinatura:
Codex — Agente App + QA; 2026-08-13; prompt AJ FIT FASE 12A.2.
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 8 do Photo Vault: motor criptográfico AES-256-GCM
client-side e pipeline de arquivos temporários. Criados
`src/lib/photoVaultCrypto.ts` (cifra, decifra e enquadramento binário puros) e
`src/services/photoVaultFileCrypto.ts` (leitura/escrita de arquivos, diretórios
temporários e cleanup). Nenhuma dependência nova: o `expo-crypto` já presente
expõe AES-GCM nativo real, e nenhum algoritmo foi implementado à mão.

Formato de arquivo binário versionado de 36 bytes de header: MAGIC "AJFV",
versão, comprimentos de IV e tag, IV de 12 bytes, tag de 16 bytes e ciphertext.
Compacto por decisão — JSON+base64 inflaria uma foto de 10 MB em ~33% e exigiria
uma string gigante em memória. As três partes GCM são sempre manipuladas como
bytes crus via `fromParts`, porque o projeto já documentou que
`combined()`/`fromCombined()` e os encodings base64 do `expo-crypto` não fazem
round-trip corretamente no Android.

Segurança:
Nonce novo a cada operação (gerado pelo expo-crypto), verificado por teste que
25 cifragens produzem 25 IVs distintos — detecta IV constante, IV derivado da
chave e RNG mockado. A mesma foto cifrada duas vezes produz ciphertext
diferente. A Vault Key é importada via `AESEncryptionKey.import(base64)`, o que
mantém os bytes crus dentro do módulo nativo — não existe buffer de chave em
claro no JavaScript. Duas validações independentes de tamanho, por defesa em
profundidade.

AAD não foi usado na V1, decisão explícita e registrada: todo campo do header já
está coberto (parser estrito para magic/versão/comprimentos, GCM para
IV/tag/ciphertext), só existe uma versão de formato, e o caminho de AAD desta
biblioteca não pôde ser testado em dispositivo — dado o histórico de divergência
Android/iOS no expo-crypto, adicionar um caminho não verificado seria o risco
maior.

Plaintext só é gravado em `<cache>/photo-vault/tmp/` com nome UUID, nunca no
document directory. O cleanup preserva `.enc` por padrão (pode haver upload
pendente) e tem escopo estrito ao subdiretório do vault — testado que não toca
avatar, cache do expo-image, document nem a foto de origem.

Dois bugs próprios foram encontrados pelos testes e corrigidos: `readBytes`
usava try/catch síncrono em volta de função async, deixando a rejeição escapar;
e `plaintext.fill(0)` zerava um buffer pertencente à camada de arquivos —
mutação de buffer emprestado, removida com justificativa no código.

Validação automática:
1134 testes do mobile aprovados (65 arquivos), typecheck aprovado; 172 do
backend; 105 de Firestore Rules e 33 de Storage Rules. Os testes criptográficos
usam um duplo do expo-crypto respaldado pelo AES-256-GCM real do Node, de modo
que adulteração e chave errada são falhas genuínas de cifra, não de mock.

Pendência:
O módulo nativo do expo-crypto não pôde ser exercitado em dispositivo — isso
exige development build, especialmente dado o histórico Android citado. Nenhuma
foto é enviada à nuvem nesta fase. Limitação registrada e não mascarada: quando
o seletor de imagens existir, a foto original permanece na galeria do aparelho,
intacta e não criptografada. Nenhum arquivo de RevenueCat foi tocado e nenhum
deploy foi executado.

Assinatura:
Codex — 2026-08-12 — Fase 8 de criptografia AES-256-GCM das fotos.

---

Data: 2026-08-12
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 9 do Photo Vault: pipeline Firebase Storage + Firestore para
os arquivos já criptografados. Criado `src/services/progressPhotos.ts` com
upload, listagem, download e delete. A nuvem recebe apenas ciphertext: a foto é
cifrada localmente antes de qualquer persistência, e a decifragem só acontece
após o download, no dispositivo.

O upload segue a ordem cifrar → Storage → Firestore, para que o documento nunca
descreva um objeto que não chegou a existir. Isso inverte o risco para um objeto
órfão, tratado por rollback: se o Firestore falha, o objeto é deletado
imediatamente (`vaultMetadataCreateFailed`); se o próprio rollback falha, o erro
é `vaultUploadRollbackFailed`, distinto de propósito porque nesse caso resta um
órfão para limpeza futura. Nunca se reporta sucesso parcial, nunca se cria um
segundo photoId e nunca se pede nova Vault Key.

O delete inverte a ordem — Storage primeiro, Firestore depois — porque metadata
apontando para arquivo inexistente quebra toda listagem, enquanto um objeto órfão
é invisível e reclamável. Objeto já inexistente não interrompe a operação, o que
torna o retry idempotente; falha no Firestore após o Storage vira
`vaultPartialDelete`.

Segurança:
O uid vem sempre de `auth.currentUser` dentro da camada; nenhuma função pública
aceita uid ou path — as assinaturas recebem no máximo um photoId, e o path do
Storage é sempre derivado de uid + photoId. `getDownloadURL` não é chamado em
lugar nenhum (travado por teste): a referência é o storagePath e o download usa
`getBytes`, que respeita as Storage Rules, ao contrário de uma URL com token
permanente.

Antes de qualquer chave ser usada, o arquivo baixado é conferido contra o
documento que diz descrevê-lo — tamanho, IV e versão precisam bater, via
`describeEnvelope`, que lê o enquadramento sem decifrar. O `vaultKeyVersion` é
honrado e não ignorado: versão que o dispositivo não pode suprir falha fechado.
O `encryptedSize` é medido dos bytes efetivamente enviados, nunca vindo da UI.

O limite de 10 MB é aplicado três vezes: antes do upload (evitando gastar rede
com algo que as Rules rejeitariam), no teto do `getBytes`, e na validação da
metadata.

Validação automática:
1191 testes do mobile aprovados (66 arquivos), typecheck aprovado; 172 do
backend; 105 de Firestore Rules e 33 de Storage Rules. As Rules não precisaram
de alteração — a implementação encaixou no contrato da Fase 4 sem divergência.

Pendência:
Nenhum deploy foi executado, então o pipeline ainda não foi exercitado contra o
ambiente real: as Rules da Fase 4 e as Functions da Fase 6 seguem não publicadas.
Não há sync offline nesta V1 — upload e primeiro download exigem rede. Nenhuma
UI foi criada e nenhum arquivo de RevenueCat foi tocado.

Assinatura:
Codex — 2026-08-12 — Fase 9 do pipeline Storage + Firestore.

---

Data: 2026-08-12
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 10 do Photo Vault: a trava do cofre. Instalado
`expo-local-authentication ~56.0.5` via `npx expo install`, com plugin e
`faceIDPermission` em pt-BR no `app.json` — preservando as alterações em
andamento de outro desenvolvedor naquele arquivo. Criados
`src/services/localAuthentication.ts` (capabilities e prompt do SO),
`src/lib/photoVaultSession.ts` (sessão em memória por uid),
`src/lib/photoVaultLock.ts` (máquina de estados sem React) e
`src/state/PhotoVaultContext.tsx` (AppState e troca de conta).

A hierarquia face → digital → credencial do aparelho foi traduzida por uma única
escolha: `disableDeviceFallback: false`. No iOS isso usa
`LAPolicyDeviceOwnerAuthentication` (Face ID ou Touch ID, com queda nativa para
o passcode); no Android o módulo passa `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`
para o `setAllowedAuthenticators`, verificado no código nativo do pacote. O app
não sequencia prompts nem desenha seletor próprio — quem decide é o SO.

No Android usamos `biometricsSecurityLevel: 'strong'` em vez do default
`'weak'`, que aceitaria face unlock 2D Classe 2, derrotável por uma fotografia.
Em aparelho cuja única biometria é fraca, a biometria não é oferecida, mas a
credencial do aparelho permanece disponível — ninguém entra com biometria fraca
e ninguém fica sem acesso.

Segurança:
Estado inicial é sempre `locked`, nunca inferido de login, existência de Vault
Key ou abertura do app, e nunca persistido — travado por teste. `authenticating`
nunca é terminal. Chamadas concorrentes compartilham a tentativa em voo em vez
de abrir um segundo prompt. Sair do foreground (incluindo `inactive`, que no iOS
é o preview do app switcher) bloqueia na hora; voltar não desbloqueia nem abre
prompt automático.

O gate é real, não estético: `progressPhotos.ts` roteia todas as operações por
`currentUnlockedUid()`, que obtém o uid e exige a sessão no mesmo ponto — como
toda operação precisa do uid, é impossível adicionar uma que esqueça o gate.
Upload, listagem, download, decrypt e delete exigem `unlocked`. A sessão guarda
qual uid autenticou e revalida a cada operação; ao detectar divergência, é
destruída na hora.

`requireAuthentication: true` no SecureStore foi avaliado e NÃO ativado:
dispararia prompt a cada leitura da chave e, em ambas as plataformas, alterar a
biometria cadastrada invalidaria os itens, forçando reautenticação Firebase
completa a cada novo dedo ou rosto cadastrado. Decisão documentada.

Nenhum PIN, senha ou padrão próprio foi criado — a autenticação é inteiramente
delegada ao sistema operacional.

Validação automática:
1294 testes do mobile aprovados (70 arquivos), typecheck aprovado; 172 do
backend; 105 de Firestore Rules e 33 de Storage Rules. Ao aplicar o gate, 49
testes da Fase 9 passaram a falhar por falta de sessão — confirmação de que o
gate funciona; foram atualizados e ganharam um bloco dedicado provando que, com
o cofre travado, a Vault Key não é tocada e nenhum plaintext é produzido.

Pendência:
`expo-local-authentication` é módulo nativo — Expo Go não reproduz Face ID,
BiometricPrompt nem credencial do aparelho. É obrigatório gerar development
build e executar a matriz de teste físico documentada em `docs/20` §24, que
inclui um cenário crítico: `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` não é
suportado no Android 9–10 (API 28–29) pelo androidx.biometric, e o minSdk do
projeto é 24. Nenhum deploy Firebase foi executado e nenhum arquivo de
RevenueCat foi tocado.

Assinatura:
Codex — 2026-08-12 — Fase 10 de autenticação local e trava do Photo Vault.

---

Data: 2026-08-12
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a Fase 11 do Photo Vault: a UI completa da área de fotos privadas.
O placeholder de `ProgressScreen.tsx` foi trocado por `ProgressPhotosScreen`,
sem reescrever o resto da tela. Criados os componentes em
`src/components/photoVault/` (estado bloqueado, estado vazio, grid, viewer,
bottom sheet), o controlador `src/lib/photoVaultGallery.ts` e o service
`src/services/photoVaultPicker.ts`.

A lógica da galeria vive num módulo puro, não em Context, pelo mesmo motivo da
Fase 10: o projeto não tem renderizador de componentes, então lógica dentro de
React seria intestável. A UI ficou uma casca fina.

Entrar em Fotos não dispara prompt automático — o usuário vê o estado bloqueado e
toca em "Desbloquear". Enquanto travado, nada do conteúdo é renderizado: sem
fotos, contagem, datas ou preview. A cópia nunca nomeia "Face ID", porque o mesmo
build roda em aparelhos que pedirão digital ou PIN.

A lista carrega só metadata; cada célula pede sua imagem ao montar, com limite de
3 downloads simultâneos. Usa o Image do React Native, não expo-image, porque o
cache de disco deste copiaria fotos descriptografadas para fora do controle do
vault. Fotos são normalizadas para 1600px/JPEG 0.85 antes de cifrar — suficiente
para acompanhamento corporal e bem abaixo do teto de 10 MB. A extensão não é
confiada: o arquivo é reencodado ou rejeitado.

Segurança:
O controlador assina o estado da trava, então ao fechar o cofre os arquivos
temporários são apagados e todas as URIs zeradas no mesmo update — nada continua
renderizado. Um download em voo que resolve depois do lock tem seu arquivo
descartado em vez de pintado na tela; essa corrida está fechada e testada.
Permissões de câmera e galeria só são pedidas depois que o usuário escolhe
aquela fonte. A foto original nunca é apagada nem modificada, e a foto tirada
pela câmera não é salva na galeria do aparelho. `vaultPartialDelete` não finge
sucesso: mostra erro e refaz a listagem.

Validação automática:
1389 testes do mobile aprovados (73 arquivos), typecheck aprovado; 550 testes de
i18n com paridade nos três idiomas e `i18n:audit` sem bloqueios. Testes
estruturais impedem que a UI importe Firebase, use expo-image/cache de disco,
persista URI de plaintext ou exponha detalhes de criptografia. Removidas as
chaves `progress.photos.week` e `progress.photos.hint`, órfãs após a remoção do
placeholder, com o teste de consistência atualizado.

Pendência:
Nada foi validado em dispositivo físico — nem esta fase, nem o expo-crypto
nativo da Fase 8, nem a biometria da Fase 10. O roteiro ponta a ponta está em
`docs/20` §25 e inclui o cenário crítico do Android 9–10. Nenhum deploy foi
executado e nenhum arquivo de RevenueCat foi tocado.

Assinatura:
Codex — 2026-08-12 — Fase 11 da UI do Photo Vault.

---

Data: 2026-08-15
Responsável: Claude — Agente Frontend + Navegação + i18n
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Reconstruído o funil de aquisição/onboarding (Splash → Onboarding → Quiz →
Analyzing → Plan Ready → Auth → Paywall), de 3 telas de apresentação + 1 quiz
monolítico para 26 etapas orquestradas por uma state machine central
(`src/onboarding/steps.ts`, `useOnboardingFunnel.ts`, `OnboardingFunnelScreen.tsx`).
Documentação completa em `docs/24_funil_onboarding_arquitetura.md`.

`RootScreenId` (`premiumGate.ts`) colapsou os antigos `'onboarding'|'quiz'|
'socialProof'|'analyzing'|'plan'` num único `'onboardingFunnel'` — sem
nenhuma mudança de prioridade no gate, só renomeação de fixture nos testes.
`QuizScreen.tsx` (monolítico, 11 perguntas + `DevQuizNav` sem guard `__DEV__`)
foi removido; sua lógica de renderização (wheels, date picker, choice/multi
lists) foi extraída verbatim para `src/components/onboarding/QuestionRenderer.tsx`
+ `QuestionStepScreen.tsx`, reutilizada pelas perguntas antigas e novas.

Novas perguntas: nome (pré-auth, nunca duplicado com `profile.name`),
motivação, foco muscular (máx. 2, campo novo `Quiz.muscleFocus`),
compromisso. Cinco interstitials de valor novos (evolução, metodologia,
treino guiado, evolução AJ Fit, boas-vindas) — nenhuma credencial
profissional/CREF/estudo inventados; a tela de metodologia fica
deliberadamente neutra até existir informação real. A tela de prova social
(`SocialProofScreen`, com fotos reais em `assets/antes-depois/`) já existia de
uma implementação recente e foi só reposicionada no funil, não recriada.

`PlanReadyScreen` teve toda a "personalização falsa" removida: split semanal
fixo (ignorava `days` real), "+6,2kg massa magra" e `ProjectionChart` com
curva sempre igual, "12 semanas"/"48 treinos" hardcoded sem cálculo real. A
tela também não usava i18n (pt-BR hardcoded no JSX inteiro) — migrada para o
namespace novo `plan` nos 3 idiomas. O único valor derivado que ficou é
`deriveTrainingDaySlots(days)` (`src/lib/planDerivation.ts`), que distribui os
dias de treino reais na semana sem inventar nomes de split.

`AuthScreen`/`PaywallScreen` receberam só um prop `entryContext` (copy-only):
`AuthScreen` evita mostrar "salve seu plano" para quem clicou "Entrar" direto
(antes sempre abria em modo signup, mesmo vindo do link de login); nenhuma
função de signup/login/social/linking/reset foi tocada. `PaywallScreen` troca
só o subtítulo quando vem de um plano concluído; nenhuma função de
offerings/purchase/restore/promo/entitlement foi tocada. O botão X do
Paywall continua fazendo `logout()` — decisão documentada, não alterada
(não há destino de navegação alternativo sem estender `premiumGate`).

Draft anônimo persistido em AsyncStorage (`src/onboarding/draftStorage.ts`),
versionado (`ONBOARDING_DRAFT_SCHEMA_VERSION`), migração tolerante (nunca
lança em draft corrompido/futuro), limpo só depois que
`user && questionnaire` ficam ambos verdadeiros no `RootNavigator`. Antes
desta mudança não existia nenhuma persistência do quiz — fechar o app
perdia todo o progresso anônimo.

`DevQuizNav` (sem guard `__DEV__`, potencialmente visível em produção) foi
substituído por `DevFunnelNavigator`, cobrindo as 26 etapas, com guard duplo
(componente + ponto de montagem) e `auth`/`paywall` desabilitados — nenhum
atalho fabrica sessão/CustomerInfo/Premium.

Segurança:
Nenhuma chamada a RevenueCat foi movida para fora de `SubscriptionContext`/
`revenueCatService.ts`. `provisionNewUser` continua sendo o único caminho de
criação de `users/{uid}`. `resolvePremiumGate` não foi reordenado — só teve o
literal de tela renomeado, com os mesmos casos de teste (A–K, FASE 10)
passando sem alteração de asserção.

Validação automática:
1820 testes (115 arquivos) aprovados, typecheck aprovado, `i18n:audit` sem
bloqueios (namespace `plan` novo, 24 chaves × 3 idiomas). Testes novos:
`steps.test.ts`, `draftStorage.test.ts`, `onboardingFunnelWiring.test.ts`,
`planDerivation.test.ts`, `authOnboardingContext.test.ts`,
`paywallOnboardingContext.test.ts`.

Pendência:
Motor real de geração de split/periodização ainda não existe — `muscleFocus`/
`limits` estão modelados para alimentá-lo no futuro, sem nenhuma lógica
clínica implementada agora. i18n do `PaywallScreen` continua com débito
pré-existente (fora de escopo). Nada foi validado em dispositivo físico —
o teste manual dos casos A–I do funil (novo usuário, abandono/resume, login
direto, social auth, email verification, usuário Premium/não-Premium,
restore, Dev Navigator) segue pendente.

Assinatura:
Claude — 2026-08-15 — Reconstrução do funil de aquisição/onboarding.

---

Data: 2026-08-16
Responsável: Claude — Agente Frontend
Categoria: [CORREÇÃO]

Descrição:
Corrigido, em todo o app (não só no funil), o corte do topo dos textos em
Anton (`fonts.display`) — reportado primeiro no número do Analyzing e depois
no título da tela de Apresentação. Ocorre só em iPhone; Android nunca teve o
problema porque `includeFontPadding` já reserva esse espaço por padrão ali.

Auditoria: todo uso de `fonts.display` no app (23 arquivos, 53 ocorrências)
foi mapeado em dois grupos. Grupo A/B — usa o componente `<Display>` ou chama
`displayLineHeight(size)` explicitamente (`WorkoutScreen`, `ConsistencyScreen`,
`PlanReadyScreen`, `AnalyzingScreen`, `CtaButton`, `Display.tsx`, mais o objeto
`typography` em `tokens.ts`) — esse era o grupo afetado, porque o fator usado
(1,15×) não deixava espaço suficiente dentro da caixa da linha para o
ascendente do glifo no iOS. Grupo C — texto grande sem `lineHeight` nenhum
(ex.: os dígitos gigantes do `NumberWheel`, a idade no `BirthDateWheel`) — sem
uma altura de linha explícita constrangendo a caixa, o iOS usa a métrica
natural da fonte e não corta; esse grupo não precisou de mudança.

Correção centralizada em `displayLineHeight()` (`src/theme/tokens.ts`),
único lugar que todo o Grupo A/B consome — fator ajustado de 1,15× para
1,45×, valor confirmado em iPhone real a partir do ajuste já validado na tela
de Analyzing. Removida a compensação manual (`+18`) que tinha sido aplicada
ali antes da causa raiz ser isolada, já redundante com o novo fator central.
Nenhum teste trava um valor numérico específico do multiplicador, então não
houve necessidade de atualizar snapshot/assertion nenhuma — só
`docs/19_design_system.md`, cuja tabela de `displayHero/Large/Medium/Small`
documentava os valores antigos de `lineHeight`.

Validação automática:
1820 testes aprovados, typecheck aprovado.

Pendência:
Validação visual em dispositivo físico iOS ainda não feita por mim — depende
de confirmação do usuário testando o app.

Assinatura:
Claude — 2026-08-16 — Correção do corte de glifos Anton no iOS (fix centralizado).

---
