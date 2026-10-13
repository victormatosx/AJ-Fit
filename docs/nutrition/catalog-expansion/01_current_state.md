# C1 — Auditoria do estado atual do catálogo

Status: pesquisa/documentação apenas. Nenhum código alterado, nenhum commit, nenhum push.

## 1. Modelo de dados

Fonte única de verdade: `src/types/nutrition.ts` (cópia gerada e consumida por Cloud Functions em
`functions/src/nutrition/shared/types/nutrition.ts`, com comentário "GENERATED from
src/types/nutrition.ts; do not edit").

Existe **um único tipo global de alimento** hoje — não há separação entre catálogo de geração e
catálogo de registro no modelo atual:

```ts
export interface NutritionFood<TTimestamp = unknown> {
  id: string;
  name: string;
  aliases: string[];
  category: NutritionFoodCategory;        // enum fechado de 11 valores
  source: NutritionFoodSource;            // { type, sourceId, sourceName, sourceVersion? }
  nutritionPer100g: NutritionFoodNutritionValues; // kcal, proteinG, carbsG, fatG, fiberG?
  dietaryFlags: NutritionFoodDietaryFlags;        // vegetarian/vegan/pescatarian, boolean|null
  allergens: NutritionFoodAllergen[] | null;      // null = revisão incompleta
  generationStatus: NutritionFoodGenerationStatus; // approved | pending_review | blocked
  brand?: { name: string; productName?: string } | null;
  catalogVersion: string;
  searchPrefixes: string[];               // prefixos pré-computados p/ busca Firestore
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}
```

- `NutritionFoodSourceType` é um enum fechado de **5 valores**: `tbca, taco, usda, label, manual`.
  Não existe `fatsecret` nem `openfoodfacts` ainda.
- Não existe campo `barcode` em lugar nenhum do modelo. O documento
  `docs/nutrition/01_product/feature_matrix.md` lista "barcode" e "foto de alimentos"
  explicitamente em **"Fora da V1"**.
- `allergens: null` ≠ `[]`: `null` é "não revisado", `[]` é "revisado, nenhum alérgeno". Um
  alimento só pode ser `approved` se `allergens` não for `null` **e** as três `dietaryFlags`
  não forem `null` (regra `UNREVIEWED_FOOD_CANNOT_BE_APPROVED` em `normalize.ts`).
- `catalogVersion` é uma string livre que marca o lote de importação inteiro.
- `searchPrefixes` é um índice de prefixos (não fuzzy, não full-text) — ver seção 4.

Outras entidades relacionadas:
- `NutritionCustomFood` — muito mais simples: `{ id, name, nutritionPer100g, createdAt, updatedAt }`.
  Sem categoria, fonte, alérgenos, aliases ou generationStatus.
- `NutritionRecipe` — ver seção 6.

## 2. `nutritionFoods` / catálogo global

- **Armazenamento**: coleção top-level `nutritionFoods/{foodId}` (global, fora de `users/`), mais
  um doc singleton `nutritionCatalogMeta/current` com metadados do último import.
- **Esquema de ID**: `nf_{source}_{sourceId-saneado}_{hash-16-hex}`, gerado deterministicamente em
  `src/nutrition/catalog/normalize.ts`. O hash usa `"{sourceType}:{sourceId}"` — a identidade é
  **fonte + ID externo**, nunca o nome. Isso é relevante para múltiplas fontes (ver seção 9).
- **Pipeline de seeding**:
  1. JSON brutos por fonte em `scripts/nutrition/sources/` — hoje só existem dados **TACO**
     (`taco-4a-edicao-2011-raw.json` → `-prepared.json` → `-curated.json`, 519 registros,
     `catalogVersion: "taco-4a-edicao-2011-v1"`), mais um arquivo de enriquecimento
     (`taco-v1-enrichment.json`) para alérgenos/flags.
  2. `normalize.ts` — `normalizeFoodRecord()` valida/normaliza um registro: nome, aliases
     (deduplicados), categoria (enum fechado), unidades nutricionais (g/mg/kcal/kJ,
     `nutritionPerServing`+`servingGrams` → per-100g), flags dietéticas (com checagem de
     contradição), alérgenos, e gera `searchPrefixes`.
  3. `import.ts` — `parseCatalogImportFile`/`prepareCatalogImport` processam um arquivo inteiro,
     deduplicam por ID e falham em conflitos intra-arquivo.
  4. `scripts/nutrition/importCatalog.ts` — CLI real. Dry-run por padrão; `--confirm --project`
     grava via Firestore Admin, uma transação por alimento. Protege contra colisão de hash
     (`FOOD_ID_COLLISION`) e contra escrita acidental em produção
     (`assertNotProductionProject`).
  5. `scripts/nutrition/catalogAudit.ts` existe para auditoria do catálogo.

- **Tamanho/escopo atual**: ~519 registros TACO, só Brasil, nomes em PT-BR. A documentação
  (`04_food_catalog/nutritional_data_sources.md`) já declara a hierarquia **pretendida**
  TBCA → TACO → USDA → label/manual, com TBCA como fonte primária — mas **nenhum dado TBCA
  foi de fato importado ainda**. O documento também afirma explicitamente: fontes distintas
  nunca são fundidas automaticamente; equivalência TBCA/TACO exige revisão/crosswalk manual,
  nunca média por nome.

## 3. Custom foods

- Caminho: `users/{uid}/nutritionFoods/{foodId}` — mesmo nome de coleção do catálogo global,
  mas em um path Firestore diferente (não é merge).
- Prefixo de ID: `custom_{id-aleatório}` vs. `nf_{...}` do catálogo e `recipe_{...}` das receitas
  — usado em despacho de lógica (ex.: `resolveRecipeFoodValues` troca comportamento por
  `startsWith('custom_')` vs `'nf_'`, lançando `UNKNOWN_RECIPE_FOOD_NAMESPACE` fora disso).
- CRUD em `src/services/nutritionFoods.ts`. Busca é **filtragem client-side por substring**
  sobre até 200 documentos — deliberadamente simples porque a lista de um usuário nunca deveria
  ser grande.
- Firestore Rules restringem rigidamente os campos aceitos
  (`hasOnly(['id','name','nutritionPer100g','createdAt','updatedAt'])`) — qualquer expansão de
  schema de custom food exige mudança de rules.
- Não há merge real de resultados: `FoodSearchScreen`/`RegisterMealScreen` buscam
  `listCustomFoods` e `searchNutritionCatalog` separadamente e concatenam os resultados na UI,
  com um discriminador `origin: 'catalog' | 'custom' | 'recipe'`. Não há ranking unificado.
- Por política de produto, custom foods nunca entram na IA nem no catálogo global.

## 4. Busca

`searchNutritionCatalog()` (`src/services/nutritionFoods.ts`):

```ts
where('generationStatus', '==', 'approved'),
where('searchPrefixes', 'array-contains', prefix),
orderBy(documentId()), limit(pageSize)
```

- É uma **query Firestore pura**, não Algolia/Typesense/Elasticsearch.
- `prefix` vem de `normalizeSearchText()`: minúsculas, remove acentos (NFD + strip de marcas
  combinantes), normaliza para `[a-z0-9 ]`. Texto de busca precisa ter 2–32 caracteres.
- `searchPrefixes` é pré-computado **no momento do import**: todos os prefixos (2..32 chars) da
  string completa normalizada e de cada palavra individual, deduplicados, limitado a 200
  entradas/alimento (erro `TOO_MANY_SEARCH_PREFIXES` acima disso).
- Isso cobre prefixo exato por palavra/frase, mas **não** cobre meio de palavra, sufixo, erros de
  digitação (fuzzy), nem buscas multi-palavra fora de ordem.
- Paginação por cursor de `documentId()` — ordem **arbitrária**, não por relevância.
- Só alimentos `approved` são buscáveis; `pending_review`/`blocked` são invisíveis tanto para
  busca quanto para geração de dieta.
- Aliases são de primeira classe (até 12 por alimento) e entram no mesmo conjunto de
  `searchPrefixes` (ex.: mandioca/aipim/macaxeira).
- Índices compostos em `firestore.indexes.json` para `nutritionFoods`: (1)
  `generationStatus, category, __name__` (usado pela geração), (2)
  `generationStatus, searchPrefixes CONTAINS, __name__` (usado pela busca). Não há índice para
  `source.type`, `catalogVersion` ou `brand.name`.
- Custom foods e recipes são buscados só por substring client-side sobre até 200 docs — não
  escalaria para um catálogo de registro grande.

## 5. RegisterMealScreen / diário

`RegisterMealScreen.tsx` reimplementa (não reaproveita como componente compartilhado) a mesma
busca de `FoodSearchScreen` (catálogo + custom foods).

**Denormalização total**: os itens do diário são snapshots nutricionais completos, não
referências vivas:

```ts
interface NutritionLoggedFoodItem<TTimestamp> extends NutritionFoodReference {
  id: string;
  source: NutritionLoggedFoodSource;  // 'catalog_food' | 'custom_food' | 'recipe'
  snapshot: NutritionFoodSnapshot;    // { name, kcal, proteinG, carbsG, fatG, fiberG? }
  loggedAt: TTimestamp;
}
```

`foodId`+`grams` são mantidos junto do snapshot computado — o diário continua íntegro mesmo se o
alimento original for editado/apagado depois. O cálculo de nutrientes acontece uma vez, no
momento da escrita.

Estrutura de documentos: `nutritionDailyLogs/{localDate}` → `meals/{slot}` →
`meals/{slot}/items/{itemId}` — um doc por item logado. Essa separação foi forçada pelo limite
de **1000 expressões por escrita** nas Firestore Rules, que estourava com arrays aninhados de
6 refeições × 6 itens revalidados a cada escrita. É um limite de escala já atingido mesmo com o
catálogo pequeno atual — relevante para qualquer expansão.

`NutritionLoggedFoodSource` é um enum fechado de 3 valores. Adicionar uma 4ª origem (ex.:
"alimento externo via barcode") exigiria estender esse enum, o mapeador
`foodPickOriginToDiarySource`, e o validador de Firestore Rules do item.

## 6. Recipes

`NutritionRecipe` em `users/{uid}/nutritionRecipes/{recipeId}`: até 6 ingredientes
(`{ foodId, grams }`), `calculatedNutrition` sempre recomputado no servidor a partir dos
ingredientes atuais (nunca confiado do cliente). Ingredientes resolvem via o mesmo despacho de
prefixo `nf_`/`custom_` — uma terceira fonte de ID externa precisaria ser explicitamente
suportada nesse resolver.

## 7. Nutrition Engine / IA vs. catálogo

A geração de dieta lê da **mesma coleção global** `nutritionFoods` — não há coleção curada
separada hoje.

```ts
db.collection('nutritionFoods')
  .where('generationStatus', '==', 'approved')
  .where('category', '==', category)
  .limit(60).get()
...
candidates.filter(food => food.catalogVersion === catalogVersion)
```

Pontos-chave:
- Só `approved` é elegível — mesmo gate usado pela busca do usuário. Não existe hoje um nível
  "visível para registro, mas não para geração".
- `catalogVersion` é filtrado por **igualdade exata** na geração, mas a busca do usuário não tem
  esse filtro — ou seja, um novo import sob outra versão apareceria na busca imediatamente, mas
  ficaria invisível para geração até algo atualizar "a versão ativa". Essa é uma divergência
  latente já existente mesmo no estado atual.
- Um alimento só vira `approved` com `allergens` revisado e as 3 `dietaryFlags` revisadas —
  correto para segurança de IA, mas inviável como critério de aceitação em massa de milhares de
  itens externos.
- A categoria (11 valores, voltada para composição de refeição) é pensada para o motor de
  geração, não para uma taxonomia de registro alimentar de consumo (que tende a ser mais fina e
  orientada a marca/varejo).
- Planos de dieta fazem snapshot de `source`/`catalogVersion`/`brand` no momento da geração, para
  que edições retroativas no catálogo nunca alterem planos históricos.

## 8. Firestore Rules e índices

```
match /nutritionFoods/{foodId} {
  allow read: if isSignedIn() && accountActive(request.auth.uid);
  allow write: if false;               // só via Admin SDK / importer
}
match /nutritionCatalogMeta/{metaId} {
  allow read: if metaId == 'current' && isSignedIn() && accountActive(request.auth.uid);
  allow write: if false;
}
```

- Custom foods e recipes por usuário têm whitelists de campo rígidas (`hasOnly`/`hasAll`).
- Existe uma regra catch-all de "negar tudo que não está documentado" no final do arquivo —
  qualquer coleção nova (ex.: um catálogo de registro separado) precisa de bloco de regras
  explícito; é um padrão deliberado do repositório, não um obstáculo.
- Nenhum índice existe para `source.type`, `catalogVersion` ou `brand.name`.

## 9. Limitações para integrar fontes externas

1. **Um único enum (`generationStatus`) conflita "visível para uso" com "seguro para IA".**
   Hoje não dá para ter um alimento pesquisável/logável mas ainda `pending_review` para IA — a
   query de busca já fixa `generationStatus == 'approved'`.
2. **Colisão de ID é parcialmente resolvida, mas não há crosswalk entre fontes.** O esquema de ID
   evita colisão de hash, mas a documentação já afirma que TBCA/TACO nunca são fundidos
   automaticamente. Em escala FatSecret/OFF, o mesmo alimento real poderia existir como N
   documentos desconectados.
3. **Não existe campo `barcode`.** Está listado como fora de escopo da V1. Open Food Facts é
   fundamentalmente indexado por barcode.
4. **Busca por prefixo Firestore não escala para catálogos grandes/ricos em marca.** Sem ranking
   por relevância, sem tolerância a erro de digitação, sem busca multi-palavra fora de ordem, com
   limite de 200 prefixos por documento.
5. **`catalogVersion` é uma string global única, comparada por igualdade na geração** — múltiplas
   fontes ativas simultaneamente quebrariam essa premissa sem mudança de lógica.
6. **Critério de `approved` é incompatível com import em massa** de dados não revisados
   individualmente.
7. **Taxonomia de categoria (11 valores) é pensada para geração de dieta**, não para um catálogo
   de consumo amplo.
8. **Rules exigem bloco explícito por coleção/campo** — surface de engenharia previsível, não
   bloqueador.
9. **Não há metadado de proveniência além de `source.sourceVersion`** — falta timestamp de
   sincronização, confiança/qualidade, licença/atribuição. O importer atual assume snapshots
   JSON estáticos versionados no repo, não um pipeline de sincronização contínua com API externa.
10. **Despacho por prefixo de ID (`nf_`/`custom_`) está hardcoded em pelo menos dois lugares**
    (resolver de receitas, mapeamento de origem do diário) — uma nova fonte de ID cabe dentro do
    padrão `nf_{type}_...` (já que `type` é extensível), mas o enum `NutritionFoodSourceType` é
    fechado e usado em validações exaustivas.

### O que é reaproveitável vs. o que precisa de novo design

**Reaproveitável como está**: formato de valores nutricionais per-100g; padrão de snapshot
imutável em planos/diário (protege histórico de edições no catálogo); tripla de proveniência
`source.type/sourceId/sourceVersion` e seu esquema de hash de ID (extensível a novos
`NutritionFoodSourceType`); padrão de Firestore Rules (coleção global somente leitura + escrita
só via Admin); padrão de importer CLI dry-run-then-confirm.

**Precisa de novo design para um catálogo de registro separado**: um gate de
visibilidade/busca independente do significado de segurança de IA do `generationStatus`; campo e
índice de barcode; uma solução de busca de texto real (Algolia/Typesense) já que
prefix-array-contains do Firestore não aguenta a escala do FatSecret/OFF; taxonomia de categoria
mais ampla ou camada de mapeamento; e uma estratégia de deduplicação/equivalência entre fontes.
