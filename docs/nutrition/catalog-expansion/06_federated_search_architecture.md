# C1 — Arquitetura de busca federada (proposta, não implementada)

## Ordem de busca proposta

1. **Favoritos/recentes do usuário** (já logados antes) — latência zero, sem rede.
2. **Custom foods do usuário** — já existe, client-side.
3. **Catálogo local amplo** (`foodLogCatalog`: TACO + TBCA, quando disponível) — via índice de
   busca dedicado (ver abaixo), não Firestore prefix-match.
4. **Fonte externa paga** (FatSecret, se contratada) — só chamada se os passos 1–3 não
   satisfizerem (poucos resultados) ou sob demanda explícita ("buscar mais").
5. **Open Food Facts** — usado principalmente para **barcode scan** e como fallback de produtos
   de marca quando FatSecret não está disponível/contratada.
6. **Fallback "criar alimento"** — leva para o fluxo de custom food já existente.

## Deduplicação e ranking

- Deduplicação por `barcode` quando presente (ver `03_canonical_model.md`).
- Sem fusão automática por nome — em vez disso, ranking prioriza:
  1. exact/prefix match no nome normalizado,
  2. favoritos/recentes do usuário,
  3. fonte local (TACO/TBCA) antes de fonte externa, para preferir dados sem custo/latência,
  4. alimentos genéricos antes de marca quando a busca não menciona marca.
- Resultados de fontes diferentes aparecem com um badge de proveniência na UI (ex.: "TBCA",
  "Open Food Facts") — importante tanto para confiança do usuário quanto para cumprir
  atribuição.

## Índice de busca

A busca por `array-contains` de prefixos do Firestore (mecanismo atual) não escala para um
catálogo de dezenas/centenas de milhares de itens com ranking de relevância. Recomendação: um
motor de busca dedicado (Algolia ou Typesense) alimentado por um pipeline Firestore → índice
(Cloud Function on-write), mantendo o Firestore como fonte de verdade e o índice como camada de
busca descartável/reconstruível. Isso é decisão de implementação de **C2**, não desta fase.

## Debounce, paginação, timeout, fallback

- **Debounce**: 300–400ms no campo de busca antes de disparar qualquer chamada (padrão já comum
  em telas de busca; hoje o catálogo pequeno não demandou isso, mas um catálogo maior exige).
- **Paginação**: cursor-based, igual ao padrão atual (`startAfter`), mas com paginação própria
  por fonte — não há uma paginação unificada cross-fonte; cada fonte pagina seus próprios
  resultados e a UI mescla por seção/grupo, não por lista única intercalada.
- **Timeout por fonte**: recomendado ~2s para fontes externas (FatSecret/OFF); se estourar,
  omitir essa seção de resultados silenciosamente, sem bloquear os resultados locais que já
  chegaram.
- **Fallback offline/API externa fora do ar**: a busca sempre deve retornar resultados locais
  (catálogo TACO/TBCA + custom foods) mesmo se todas as fontes externas falharem — nunca travar
  a tela de registro de refeição por uma dependência externa.
- **Evitar resultados repetidos**: dedup por barcode entre fontes dentro da mesma resposta de
  busca (não cross-sessão); se duas fontes retornam o "mesmo" alimento sem barcode em comum,
  aceitar a duplicata aparente em vez de arriscar fundir itens diferentes.

## Persistência de alimento externo logado no diário

Reaproveitar o padrão de snapshot já existente no diário (`NutritionLoggedFoodItem`): ao logar um
alimento vindo de FatSecret/OFF, grava-se:
- `foodId` apontando para o documento espelhado/cacheado localmente (ver próxima seção) — nunca
  um ID bruto de API externa direto no diário, para manter o diário independente de
  disponibilidade futura da API.
- `snapshot` com nome/macros no momento do registro (já é o comportamento atual — reaproveitado
  sem mudança).

## Cache local de alimentos externos usados

Recomendado: ao primeiro uso de um alimento de fonte externa (FatSecret/OFF), **espelhar** o
registro dentro de `foodLogCatalog` (como um documento `flc_fatsecret_...`/`flc_off_...` com
`provenance.license` e `lastSyncedAt` preenchidos) em vez de manter só uma referência à API.
Isso:
- cumpre a recomendação de cache da OFF (evita poll repetido da API de busca),
- dá estabilidade ao diário/receitas mesmo se a fonte externa mudar/remover o item depois,
- tem custo de armazenamento desprezível frente ao benefício de resiliência.

Reimportação/atualização periódica (ex.: re-sync de preços/macros) é decisão de C2/C3, fora do
escopo desta fase.
