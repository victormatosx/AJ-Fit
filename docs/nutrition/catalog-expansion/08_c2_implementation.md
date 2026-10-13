# C2 — Implementação do catálogo amplo de registro alimentar

Status: implementado e testado. Deploy real de Rules/Indexes e import real de dados feitos no
projeto de teste autorizado `ajfit-2f321` (alias `production` do `.firebaserc`, usado aqui sob a
autorização explícita do brief da C2 via `--allow-current-test-project`). Nenhum commit, nenhum
push.

## Diferenças encontradas entre a C1 e o código real (Parte 1)

A auditoria de código feita nesta fase confirmou a C1 ponto a ponto, com um achado adicional
importante: do dataset TACO de 519 registros já no repositório, **apenas 58 têm
`generationStatus: 'approved'`** — os outros 461 (incluindo praticamente todos os cortes de
frango/carnes: peito, coxa, sobrecoxa, contra-filé, acém, patinho etc.) estão com
`generationStatus: 'pending_review'` por falta de revisão de `allergens`/`dietaryFlags`, e por
isso **já eram invisíveis para busca e registro** mesmo antes da C2 — `searchNutritionCatalog`
filtra `generationStatus == 'approved'` incondicionalmente. Isso significa que boa parte da dor
original ("faltam cortes de frango") já estava resolvida nos dados, só não exposta. A C2 resolve
exatamente isso: todos os 519 registros TACO (sem exigir revisão de allergens/dietary) entram no
novo catálogo de registro.

Nenhuma outra divergência relevante foi encontrada — modelo de dados, scripts de import, rules e
índices batem com o que a C1 documentou.

## Arquitetura implementada (Parte 2-3)

Duas coleções Firestore, completamente separadas:

- **`nutritionFoods`** — inalterada. Continua sendo o único catálogo lido pelo Nutrition
  Engine/geração de IA (`functions/src/nutrition/generation/candidates.ts`, não tocado nesta
  fase).
- **`foodLogCatalog/{foodId}`** (novo) — catálogo amplo de registro/busca, com um documento
  singleton de metadados `foodLogCatalogMeta/current`.

Tipo canônico (`src/types/nutrition.ts`, espelhado em
`functions/src/nutrition/shared/types/nutrition.ts` via `scripts/syncNutritionToFunctions.cjs`):

```ts
interface FoodLogEntry<TTimestamp = unknown> {
  id: string;                    // flc_{source}_{sourceId-saneado}_{hash16}
  source: { type: 'taco'|'tbca'|'off'|'fatsecret'|'manual'; sourceId; sourceName; sourceVersion? };
  name: string;
  aliases: string[];
  brand?: { name: string; productName?: string } | null;
  barcode?: string | null;       // EAN/GTIN normalizado, só dígitos
  locale: string;                // 'pt-BR'
  category: NutritionFoodCategory;  // reaproveita a taxonomia da geração (decisão da C1)
  nutritionPer100g: NutritionFoodNutritionValues;  // mesmo tipo da geração
  status: 'active' | 'hidden' | 'deprecated';      // gate de VISIBILIDADE, não de segurança de IA
  provenance: { license; attributionRequired; attributionText? };
  catalogVersion: string;
  searchPrefixes: string[];      // mesma estratégia de prefixo já usada em nutritionFoods
  createdAt, updatedAt;
}
```

Deliberadamente **sem** `generationStatus`/`allergens`/`dietaryFlags` — esses campos carregam o
significado "seguro para gerar dieta com IA", que não se aplica a este catálogo. `status` é um
gate independente, só de visibilidade de busca/registro.

**Esquema de ID**: `flc_{type}_{sourceId-saneado}_{hash16}` — mesmo algoritmo de hash do
`nutritionFoodId` existente (FNV+djb2), com prefixo `flc_` para nunca colidir/confundir com
`nf_`/`custom_`/`recipe_`. Identidade = fonte + ID externo, igual ao catálogo de geração.

### Firestore Rules

```
match /foodLogCatalog/{foodId} {
  allow read: if isSignedIn() && accountActive(request.auth.uid);
  allow write: if false;
}
match /foodLogCatalogMeta/{metaId} {
  allow read: if metaId == 'current' && isSignedIn() && accountActive(request.auth.uid);
  allow write: if false;
}
```

Mesmo padrão do catálogo de geração: leitura autenticada, escrita só via Admin SDK (scripts de
import). Deploy real feito (`firebase deploy --only firestore:rules,firestore:indexes --project
ajfit-2f321`).

Também foi necessário estender `nutritionLogItemValid` (validador do item do diário) para aceitar
a nova origem `food_log_catalog` em `item.source` — sem isso, nenhum registro vindo do catálogo
amplo conseguiria ser salvo no diário.

### Índices

Dois novos índices compostos em `firestore.indexes.json`:
1. `foodLogCatalog`: `status ASC, searchPrefixes CONTAINS, __name__ ASC` — busca.
2. `foodLogCatalog`: `barcode ASC, status ASC` — lookup futuro por código de barras.

## Busca (Partes 7, 9, 10)

A busca atual via Firestore `array-contains` só casa um **termo literal único** por consulta.
Buscas de uma palavra ("frango", "arroz") já funcionavam bem com o mecanismo herdado da C1. Mas
buscas de múltiplas palavras como "peito de frango" falhavam **completamente** (zero resultados),
porque o nome armazenado ("Frango, peito, sem pele, cru") não começa com "peito" — o prefixo
literal da frase inteira nunca bate.

**Solução implementada** (`src/nutrition/foodLog/search.ts`, `buildFoodLogSearchPlan`):
1. A consulta é dividida em palavras, removendo stopwords PT-BR (de/da/do/com/sem/e/a/o/em).
2. A palavra mais longa (mais seletiva) vira o termo de busca no Firestore
   (`array-contains` nessa palavra exata).
3. As palavras restantes filtram o pool de candidatos **no cliente** (substring simples no nome
   normalizado ou em qualquer alias) — refinamento, não uma segunda ida ao Firestore.
4. Se o refinamento zerasse os resultados, cai de volta no pool não-refinado em vez de mostrar
   nada (ex.: "frango grelhado" ainda mostra resultados de "frango" mesmo sem nenhum item
   literalmente dito "grelhado").

Isso é a "melhor solução intermediária" pedida no brief — sem introduzir Algolia/Typesense agora,
mas sem fechar a porta para migrar depois (`06_federated_search_architecture.md`): a função
`rankFoodLogResults` é pura e já isolada do mecanismo de busca Firestore, pronta para ser
alimentada por um motor de busca real no lugar do par
`array-contains`+filtro-client-side.

**Ranking determinístico** (`src/nutrition/foodLog/rank.ts`, `rankFoodLogResults`):
1. match exato do nome normalizado
2. nome começa com o termo
3. alias bate exatamente
4. nome/alias contém o termo
5. empate: TACO/TBCA (genérico) antes de OFF/FatSecret (marca)
6. empate final: ordem alfabética PT-BR

Sem ML, sem personalização — 100% determinístico, como pedido.

**Debounce**: mantido o mesmo de 350ms já usado em `FoodSearchScreen`/`RegisterMealScreen`.
**Paginação**: cursor por `documentId()` sobre a consulta-âncora (limitação documentada: "load
more" pagina a consulta-âncora, não a view ranqueada/refinada — aceitável no tamanho atual do
catálogo).

## UI (Parte 11)

- `FoodSearchScreen` ganhou uma prop `catalog?: 'generation' | 'logging'`.
  - **`'generation'` (padrão, comportamento inalterado)**: usado por `NutritionProfileScreen`
    (pickers de preferido/usual/excluído, que alimentam o Nutrition Engine) — nunca deve mudar
    para `'logging'`.
  - **`'logging'`**: usado pelo picker de diário em `NutritionShell`.
- `RegisterMealScreen` trocou sua busca embutida de `searchNutritionCatalog` (catálogo curado)
  para `searchFoodLogCatalog` (catálogo amplo).
- `CreateRecipeScreen` **não foi alterado** — continua usando o catálogo de geração, por
  decisão deliberada: o resolvedor de ingredientes de receita
  (`resolveRecipeFoodValues`) só entende os prefixos `custom_`/`nf_`; estender isso para `flc_`
  é fora do escopo mínimo pedido ("não alterar fluxo de receitas além do necessário").
- `FoodRow` exibe nome, marca (quando existir), kcal/100g, proteína/100g, rótulo "por 100 g" —
  tudo já existia; só foi estendido para aceitar a origem `'food_log'` (reaproveita o mesmo badge
  visual do catálogo, sem nova string — fonte não aparece ao usuário, como pedido).

## Diário (Parte 12)

- `NUTRITION_LOGGED_FOOD_SOURCES` ganhou o valor `'food_log_catalog'`.
- `resolveAuthoritativeFoodNutrition` (`nutritionDiary.ts`) ganhou um branch que resolve a
  nutrição a partir de `loadFoodLogEntry` quando `source === 'food_log_catalog'`.
- O snapshot persistido no item do diário continua sendo o mesmo de sempre
  (`NutritionFoodSnapshot`: nome + macros no momento do registro) — histórico nunca depende de
  releitura futura do catálogo (TACO ou OFF podem mudar/sumir depois sem afetar dias já
  registrados).

## Favoritos (Parte 13)

`loadFavoriteFoods` (`nutritionFavorites.ts`) despachava por prefixo (`custom_` vs. resto =
catálogo de geração). Estendido para reconhecer também `flc_` → `loadFoodLogEntry`. Receitas e
custom foods continuam exatamente como estavam.

## Import/sync (Parte 14)

Scripts novos em `scripts/nutrition/foodLog/`, seguindo o padrão real do repo
(`scripts/nutrition/importCatalog.ts`): dry-run por padrão, `--confirm --project <id>` grava via
Admin SDK, reaproveita `assertNotProductionProject`/`--allow-current-test-project`.

- `npm run nutrition:food-log:taco-import` — converte o dataset TACO já existente (519 registros,
  **todos**, não só os 58 `approved`) para `FoodLogEntry` e importa.
- `npm run nutrition:food-log:off-fetch -- --out ... --pages N --delay-ms N` — busca produtos do
  Brasil via API oficial v2 de busca da Open Food Facts (sem scraping, `User-Agent` identificado,
  paginado com backoff em 429/503), grava um checkpoint incremental a cada página.
- `npm run nutrition:food-log:off-import` — aplica o filtro de qualidade determinístico e importa.
- `npm run nutrition:food-log:search-benchmark -- --project <id>` — roda o benchmark da C1 contra
  o catálogo real.

Todas as escritas são por transação (`tx.get`/`tx.create`/`tx.set`), com guarda de colisão de ID
(`FOOD_LOG_ID_COLLISION`) idêntica à do catálogo de geração, e idempotentes (reimportar o mesmo
arquivo não duplica nem reescreve documentos inalterados).

Ver `09_c2_import_results.md` para os números reais de produção.

## Não alterado (Parte 19 — confirmação)

- Nutrition Engine (`functions/src/nutrition/generation/`, `src/nutrition/engine/`): zero
  alterações.
- `nutritionFoods`/`nutritionCatalogMeta`: zero escritas desta fase — só leitura (inalterada) pela
  geração.
- Metas de calorias/macros, validador de geração, prompt de IA, regras de segurança
  (gravidez/lactação): zero alterações.
- Semântica de `generationStatus`: inalterada — continua só `approved | pending_review | blocked`,
  sem novo valor.
