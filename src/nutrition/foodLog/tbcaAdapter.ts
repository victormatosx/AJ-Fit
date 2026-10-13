import type { RawFoodLogRecord } from './normalize';

/**
 * Fase C3 Part 9 — TBCA mapping SCAFFOLD only. No real TBCA data is
 * fetched, scraped, or persisted anywhere in this repo — the license
 * matrix (`docs/nutrition/catalog-expansion/05_licensing_and_storage.md`)
 * marks commercial use as requiring explicit written authorization from
 * USP/FoRC (`tbca.contato@usp.br`), which has not been obtained. This
 * file exists so that, IF that authorization is granted, importing TBCA
 * data is "write a parser for whatever format USP provides, feed it into
 * `mapTbcaRecordToFoodLog`" rather than designing the integration from
 * scratch under time pressure.
 *
 * `RawTbcaRecord`'s shape is inferred from TBCA's own publicly documented
 * category list (name, food group, the ~34 published nutrient columns —
 * `docs/nutrition/catalog-expansion/02_sources_comparison.md`), not from
 * any actual downloaded dataset. Treat every field name here as
 * PROVISIONAL until validated against whatever real export format USP
 * actually provides.
 */
export interface RawTbcaRecord {
  tbcaId: string;
  name: string;
  foodGroup?: string;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  lipidsG: number;
  fiberG?: number | null;
  tbcaVersion: string;
}

const ATTRIBUTION_TEXT = 'Tabela Brasileira de Composicao de Alimentos (TBCA). Universidade de Sao Paulo (USP). '
  + 'Centro de Pesquisa em Alimentos (FoRC). Uso requer autorizacao da USP/FoRC para fins comerciais.';

/**
 * Maps one TBCA record into the same `RawFoodLogRecord` shape every other
 * source normalizes through (`normalizeFoodLogRecord`) — reuses the exact
 * category/nutrition validation every TACO/OFF record goes through, no
 * separate code path. `license: 'proprietary_contract'` and
 * `attributionRequired: true` are hardcoded per the C1 licensing
 * conclusion — this is not configurable per-call, so a future caller
 * cannot accidentally import TBCA data under a weaker license than what
 * was actually negotiated.
 */
export function mapTbcaRecordToFoodLog(raw: RawTbcaRecord): RawFoodLogRecord {
  return {
    source: { type: 'tbca', sourceId: raw.tbcaId, sourceName: 'TBCA - Tabela Brasileira de Composicao de Alimentos (USP/FoRC)', sourceVersion: raw.tbcaVersion },
    name: raw.name,
    category: 'other', // TBCA's own food-group taxonomy still needs an explicit mapping table once the real format is known — deliberately not guessed here.
    nutritionPer100g: { kcal: raw.energyKcal, proteinG: raw.proteinG, carbsG: raw.carbsG, fatG: raw.lipidsG, fiberG: raw.fiberG ?? null },
    locale: 'pt-BR',
    status: 'active',
    provenance: { license: 'proprietary_contract', attributionRequired: true, attributionText: ATTRIBUTION_TEXT },
  };
}
