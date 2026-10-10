# C1 — Modelo canônico proposto

O modelo atual (`NutritionFood`, ver `01_current_state.md` §1) já tem boas fundações
(per-100g, proveniência `source.type/sourceId/sourceVersion`, ID determinístico por hash,
snapshot imutável no diário/plano). A proposta abaixo **estende** esse modelo em vez de
substituí-lo, e introduz uma segunda coleção para o catálogo de registro amplo.

## Duas coleções, dois contratos

### 1. `nutritionFoods` (catálogo de geração — já existe, mudanças mínimas)

Mantém o contrato atual **sem alterações estruturais**. Única adição recomendada:
- Nenhuma mudança obrigatória para C1. Este catálogo continua pequeno, curado, com
  `generationStatus` como hoje. TBCA pode futuramente alimentar este catálogo (não o de
  registro) já que é uma fonte de qualidade equivalente/superior ao TACO — mas isso é decisão de
  fase C2+, condicionada à resolução jurídica com a USP.

### 2. `foodLogCatalog` (catálogo de registro — novo, proposto)

```ts
interface FoodLogEntry<TTimestamp = unknown> {
  id: string;                      // flc_{source}_{sourceId-saneado}_{hash16}
  source: FoodLogSource;           // { type, sourceId, sourceName, sourceVersion?, lastSyncedAt? }
  name: string;
  aliases: string[];
  brand?: { name: string; productName?: string } | null;
  barcode?: string | null;         // GTIN/EAN, quando disponível
  locale: string;                  // ex.: "pt-BR"
  category: string;                // taxonomia MAIS AMPLA que NutritionFoodCategory (ver abaixo)
  nutritionPer100g: NutritionFoodNutritionValues; // reaproveita o tipo existente
  servings?: FoodServing[];        // tamanhos de porção conhecidos (opcional, só exibição)
  provenance: {
    license: 'public_domain' | 'odbl_share_alike' | 'proprietary_contract' | 'internal';
    attributionRequired: boolean;
    attributionText?: string;
  };
  qualityFlags?: {                 // best-effort, não bloqueante (diferente de generationStatus)
    hasCompleteMacros: boolean;
    isGeneric: boolean;            // vs. produto de marca
  };
  searchText: string;              // texto normalizado para indexação externa (Algolia/Typesense)
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}
```

### Campos obrigatórios vs. opcionais

**Obrigatórios para qualquer entrada**: `id`, `source`, `name`, `locale`, `category`,
`nutritionPer100g` (ao menos kcal/proteína/carboidrato/gordura — fiber pode faltar),
`provenance.license`, `provenance.attributionRequired`, `createdAt`, `updatedAt`.

**Opcionais**: `aliases` (vazio é aceitável, diferente do catálogo de geração que exige revisão),
`brand`, `barcode`, `servings`, `qualityFlags`, `attributionText`.

**Usados só no diário/registro**: `barcode`, `servings`, `qualityFlags`, `provenance` completo —
nenhum desses é necessário para o Nutrition Engine.

**Necessários para geração de dieta**: nenhum campo deste catálogo é lido pelo motor de geração.
O motor continua lendo exclusivamente `nutritionFoods`. Isso preserva a separação de produto já
aprovada.

### Estratégia de ID estável

Reaproveitar o padrão já validado em `nutritionFoods`: `{prefixo}_{sourceType}_{sourceIdSaneado}_{hash16(sourceType:sourceId)}`.
- `flc_taco_...`, `flc_tbca_...`, `flc_fatsecret_...`, `flc_off_...`, `flc_manual_...`.
- Identidade = fonte + ID externo, nunca nome — já comprovado funcionar em produção no catálogo
  atual (`FOOD_ID_COLLISION` guard reaproveitável).
- Para fontes com barcode (OFF, produtos de marca da FatSecret), o barcode normalizado também
  deve ser indexado separadamente (campo `barcode`, não parte do ID) para permitir lookup direto
  por EAN sem depender do `sourceId` interno de cada provedor.

### Deduplicação / equivalência entre fontes

**Não fundir automaticamente por nome** (mesma regra já adotada para TBCA/TACO). Em vez disso:
- **Dedup por barcode**: se dois registros de fontes diferentes têm o mesmo `barcode`
  normalizado, são candidatos fortes a duplicata — marcar com um campo opcional
  `duplicateOf`/`canonicalId` resolvido por um job assíncrono, não bloqueando o import.
  (Fora do escopo de implementação da C1; citado apenas como direção de C2.)
- **Sem dedup automático por nome textual** — risco de falsos positivos (ex.: "frango" genérico
  TACO vs. "Frango" marca Sadia são produtos diferentes e devem continuar distintos).
- A UI de busca pode usar agrupamento visual por nome+categoria sem precisar de uma fusão de
  dados real — resolve a maior parte da dor do usuário sem o risco de qualidade de uma fusão
  automática.

### Por que não forçar o formato do enunciado original

O enunciado sugere `foodId, source, sourceId, name, aliases, brand, barcode, locale, category,
nutritionPer100g, servings, provenance, generationStatus`. Mantivemos quase tudo, com duas
mudanças:
- **Sem `generationStatus`** no catálogo de registro: esse campo tem semântica específica de
  "segurança para IA" no catálogo de geração (ver `01_current_state.md` §9, item 1). Reaproveitar
  o mesmo enum no catálogo de registro recriaria a mesma conflação de significados que é hoje uma
  limitação do sistema atual. Em vez disso, o catálogo de registro usa `qualityFlags` (não
  bloqueante) — todo item importado é imediatamente buscável/logável.
- **`provenance` ganhou estrutura explícita de licença** (`license`, `attributionRequired`,
  `attributionText`) porque isso é uma lacuna real identificada na auditoria (seção 9, item 9) e
  é necessário para cumprir obrigações de atribuição da OFF/FatSecret por item exibido na UI.
