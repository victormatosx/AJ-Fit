# Modelagem de Banco e Dados

## 1. Objetivo deste documento

Definir:

* tecnologias de persistência
* responsabilidades de armazenamento
* entidades principais do sistema
* diretrizes de modelagem
* regras de sincronização

Este documento não define o schema final.

O schema detalhado será definido posteriormente.

---

# 2. Stack de persistência

## Firestore

Responsável por:

* usuários
* templates de treino
* treinos dos usuários
* exercícios
* histórico
* progresso
* medidas corporais
* configurações
* assinaturas
* sincronização

O Firestore é a fonte principal de dados do sistema.

---

## Cloud Functions

Responsável por:

* automações
* processamento de eventos
* atualizações periódicas
* notificações
* integrações externas
* regras de negócio sensíveis

Toda lógica crítica deve permanecer no backend.

---

## Firebase Storage

Responsável por:

* fotos de progresso
* imagens do sistema
* vídeos de exercícios
* arquivos estáticos

Arquivos não devem ser armazenados diretamente no Firestore.

---

# 3. Princípios de modelagem

A modelagem deve priorizar:

* simplicidade
* escalabilidade
* baixa quantidade de consultas
* compatibilidade com funcionamento offline

---

## 3.1 Firestore não é relacional

Evitar:

* joins complexos
* múltiplas consultas encadeadas
* dependências excessivas entre coleções

---

## 3.2 Leitura rápida

Os dados mais utilizados pelo aplicativo devem exigir o menor número possível de consultas.

---

## 3.3 Offline first

Toda modelagem deve considerar:

* cache local
* sincronização posterior
* funcionamento sem internet

---

# 4. Entidades principais

## Usuário

Representa a conta do usuário.

Exemplos de dados:

* identificação
* assinatura
* configurações
* treino ativo

As respostas do questionário NÃO ficam no documento principal do usuário; são
armazenadas na subcoleção `users/{userId}/questionnaires` (ver §12 e
04_contratos_de_api.md §5).

---

## Template de treino

Representa um treino oficial do sistema.

Os templates são cadastrados previamente.

O sistema não gera treinos livres na versão inicial.

---

## Treino do usuário

Representa uma instância personalizada de um template.

É a versão efetivamente executada pelo usuário.

Cada atualização periódica pode gerar uma nova versão.

---

## Exercício

Representa um exercício individual.

Cada exercício pode possuir:

* vídeo
* instruções
* substituições válidas

---

## Sessão de treino

Representa uma execução realizada pelo usuário.

---

## Histórico

Representa os registros acumulados do usuário.

---

## Medidas corporais

Representa:

* peso
* medidas
* percentual de gordura estimado

---

## Fotos de progresso

Representa imagens enviadas pelo usuário para acompanhamento visual.

---

# 5. Estrutura dos treinos

Os templates de treino são armazenados como modelos pré-definidos.

Cada template possui:

* nome
* categoria
* fase
* frequência semanal
* lista de exercícios

---

## Fases disponíveis

Inicialmente existem apenas:

* adaptativo
* avançado

---

# 6. Estrutura dos exercícios

Schema definitivo, taxonomias (músculos, regiões, padrões de movimento,
equipamentos) e política de IDs: ver `27_biblioteca_de_exercicios.md`.

Resumo: cada exercício em `exercises/{exerciseId}` possui identificação
estável (ID/slug em inglês, independente da tradução exibida), nome
localizado (ptBR/en/es), músculo alvo (principal e secundários), padrão de
movimento, mecânica, lateralidade, equipamento, vídeos de execução
(vertical/horizontal, opcionais) e instruções opcionais, `status`
(active/inactive/draft) e `availability` por fluxo (geração de treino,
seleção manual, substituição). Exercícios usados historicamente nunca são
deletados — apenas desativados via `status`/`availability`. Administrado
via `scripts/seedExercises.ts` (carga inicial/em lote) e pelo painel
`ajfit-admin` (`/exercises`, CRUD do dia a dia por administradores).

---

# 7. Estrutura das substituições

Cada exercício possui `substitution.group` (família funcional, ex.:
`hip_hinge`, `horizontal_back_row`) e `substitution.similarExerciseIds`.

As substituições devem:

* preservar grupo muscular e padrão de movimento
* preservar objetivo do exercício
* manter estímulo semelhante

Detalhes de como `group`/`similarExerciseIds` são derivados: ver
`27_biblioteca_de_exercicios.md` §6.

---

# 8. Histórico do usuário

O histórico deve permitir armazenar:

* treinos executados
* frequência
* cargas registradas
* evolução física
* medidas corporais
* percentual de gordura estimado

---

# 9. Fotos de progresso

As imagens devem ser armazenadas no Firebase Storage.

O Firestore deve armazenar apenas:

* referência da imagem
* metadados
* data de envio

## 9.1 Foto de perfil do usuário

A foto atual do usuário é armazenada no Firebase Storage em:

```txt
users/{userId}/profile/avatar
```

O documento `users/{userId}` mantém a URL de download em `profile.photoURL` e
um timestamp exclusivo de cache em `profile.photoVersion`, atualizado pelo
servidor somente quando a foto muda. O arquivo é substituído no mesmo caminho e removido
fisicamente quando a foto é excluída, evitando objetos órfãos.
O acesso e a escrita são restritos ao proprietário, com limite de 5 MB e
conteúdo obrigatoriamente do tipo `image/*`. Antes do upload, o app recorta,
comprime progressivamente e reduz a resolução somente quando necessário.

---

# 10. Vídeos dos exercícios

Os vídeos devem ser armazenados no Firebase Storage.

O Firestore deve armazenar apenas:

* referência do vídeo
* metadados necessários

---

# 11. Instâncias de treino do usuário

Os templates de treino servem apenas como modelos.

Quando um treino é atribuído ao usuário, uma cópia deve ser criada dentro da área do usuário.

Essa cópia representa o treino efetivamente executado.

As atualizações periódicas criam novas versões dessa instância.

Exemplos:

* workout_001
* workout_002
* workout_003

Cada nova versão pode:

* alterar a ordem dos exercícios
* utilizar substituições válidas
* preservar a lógica original do treino

O sistema não gera novos treinos livremente.

Versões anteriores devem permanecer armazenadas para histórico e rastreabilidade.

O usuário deve possuir um identificador de treino ativo.

---

# 12. Estrutura inicial esperada

A modelagem deve considerar inicialmente:

```txt
exercises
workout_templates
users
users/{userId}/questionnaires
```

## Subcoleção de questionários

```txt
users/{userId}/questionnaires/{questionnaireId}
  answers      // respostas do questionário (snapshot)
  version      // inteiro >= 1, incremental entre questionários
  createdAt    // serverTimestamp
```

O documento principal do usuário não guarda respostas de questionário. O
questionário inicial é criado no cadastro (version 1). Reavaliações/novos
questionários criam novos documentos imutáveis; o atual é o de `createdAt` mais
recente. Isso preserva o histórico de evolução do perfil do usuário.

Os templates de treino referenciam exercícios.

Os usuários referenciam seus treinos ativos.

Os treinos dos usuários devem ser armazenados dentro da estrutura do próprio usuário.

---

# 13. Segurança dos dados

As regras de segurança não devem ser definidas neste documento.

Consultar:

`12_seguranca_geral_do_app.md`

---

# 14. Pedido para o Agente Arquiteto

Defina:

* coleções
* subcoleções
* documentos
* índices necessários
* estratégia de sincronização
* estratégia offline
* regras de versionamento dos dados

Respeitando as diretrizes deste documento.

---

## 15. Controle de origem do usuário

O sistema deve permitir armazenar o cupom promocional utilizado no cadastro.

O objetivo é rastrear a origem do usuário para fins de comissão e análise interna.

O cupom não influencia a lógica de treino.

---

# 16. Redemption promocional e intenção de compra iOS

`couponRedemptions/{uid}` é o registro de ciclo de vida server-managed da
atribuição promocional atual do UID. O ID do documento é o próprio Firebase
UID; clientes não podem ler nem escrever essa coleção pelas Firestore Rules.

Na migração iOS Promo SKU, o documento pode conter:

```txt
couponRedemptions/{uid}
  uid
  couponCode
  campaignId
  influencerId
  androidOffer
  iosPromotion
    offeringIdentifier
    monthlyProductId
    annualProductId
  purchaseIntent (opcional)
    campaignId
    plan                  // monthly | annual
    expectedProductId
    offeringIdentifier
    status                // purchase_pending | purchase_confirmed
    createdAt             // timestamp do backend
    updatedAt             // timestamp do backend
    expiresAt             // timestamp do backend
    confirmedAt           // somente purchase_confirmed; relógio do evento RevenueCat
    revenueCatEventId     // somente purchase_confirmed; idempotência/auditoria
  appliedAt
  createdAt
  updatedAt
  trialStartedAt
  convertedAt
  lockedAt
```

`iosPromotion` é um snapshot capturado quando o cupom é aplicado. A intenção
pré-compra deriva campanha, Offering e Product ID exclusivamente desse
documento; não relê `promoCodes/{code}` e não aceita esses valores do cliente.

Existe no máximo uma `purchaseIntent` aninhada por UID. A validade é lógica:
o backend sempre compara `expiresAt` com seu próprio relógio, independentemente
de eventual limpeza futura por Firestore TTL. Uma intent expirada pode ser
substituída transacionalmente; uma intent ativa conflitante não pode.

`purchase_pending` não altera `lockedAt`, `trialStartedAt` ou `convertedAt` e
não concede Premium. Um `INITIAL_PURCHASE` App Store somente transiciona a
intent para `purchase_confirmed` quando campanha, Offering, plano, Product ID
e `purchased_at_ms` forem consistentes e a compra tiver ocorrido dentro da
janela inclusiva `createdAt..expiresAt`. A transição, `lockedAt` e os demais
timestamps de attribution são gravados na mesma transação. A intent confirmada
preserva `confirmedAt` e `revenueCatEventId`, não pode ser reautorizada e
permite reconhecer retry exato sem reescrita.

Nenhum desses campos concede Premium. A autoridade de acesso continua sendo
exclusivamente o `CustomerInfo.entitlements.active["premium"]` do RevenueCat.

Desde a Fase 8 da migração iOS Promo SKU, `appleOffer` e
`appleOfferCorrelation` não fazem parte do modelo ativo nem são escritos ou
lidos por fluxos novos. Documentos históricos podem continuar contendo esses
campos como evidência legítima; readers atuais toleram e ignoram os extras, e
nenhuma migração destrutiva é executada. A atribuição iOS ativa depende de
`iosPromotion`, `purchaseIntent`, `product_id` e `purchased_at_ms`.
