export const NUTRITION_ANALYTICS_EVENTS = [
  'nutrition_opened',
  'nutrition_profile_started',
  'nutrition_profile_completed',
  'nutrition_generation_requested',
  'nutrition_generation_completed',
  'nutrition_generation_failed',
  'nutrition_plan_viewed',
  'nutrition_diary_item_added',
  'nutrition_diary_day_viewed',
  'nutrition_meal_alternative_requested',
  'nutrition_meal_alternative_completed',
  'nutrition_meal_alternative_failed',
  'nutrition_favorite_added',
  'nutrition_plan_restored',
  'nutrition_weekly_summary_viewed',
  // Fase C2 (`docs/nutrition/catalog-expansion/08_c2_implementation.md`) —
  // never carries the raw search query text (privacy: only bucketed result
  // counts and closed-vocabulary catalog/origin labels).
  'nutrition_catalog_search_performed',
  'nutrition_catalog_search_zero_results',
  'nutrition_catalog_item_selected',
  'nutrition_custom_item_created_after_search',
  // Barcode scan (round brief §8) — never carries the raw barcode digits
  // themselves, only closed-vocabulary provider/failure labels.
  'barcode_scan_started',
  'barcode_scan_resolved_local',
  'barcode_scan_resolved_external',
  'barcode_scan_materialized',
  'barcode_scan_not_found',
  'barcode_scan_failed',
] as const;

export type NutritionAnalyticsEventName = typeof NUTRITION_ANALYTICS_EVENTS[number];
export type NutritionAnalyticsOwner = 'client' | 'backend';
export type AnalyticsPrimitive = string | number | boolean;

const BACKEND_EVENTS = new Set<NutritionAnalyticsEventName>([
  'nutrition_generation_completed',
  'nutrition_generation_failed',
  'nutrition_meal_alternative_completed',
  'nutrition_meal_alternative_failed',
]);

const ALLOWED_PROPERTIES: Readonly<Record<NutritionAnalyticsEventName, readonly string[]>> = {
  nutrition_opened: ['source'],
  nutrition_profile_started: ['mode'],
  nutrition_profile_completed: ['mode', 'mealSlotCountBucket'],
  nutrition_generation_requested: ['source'],
  nutrition_generation_completed: ['durationBucket', 'retryCountBucket', 'fallbackUsed', 'mealSlotCountBucket'],
  nutrition_generation_failed: ['durationBucket', 'retryCountBucket', 'failureCode'],
  nutrition_plan_viewed: ['source'],
  nutrition_diary_item_added: ['mealSlot', 'operation'],
  nutrition_diary_day_viewed: ['source'],
  nutrition_meal_alternative_requested: ['mealSlot', 'reasonCategory'],
  nutrition_meal_alternative_completed: ['durationBucket', 'retryCountBucket', 'fallbackUsed', 'mealSlot'],
  nutrition_meal_alternative_failed: ['durationBucket', 'retryCountBucket', 'failureCode', 'mealSlot'],
  nutrition_favorite_added: ['mealSlot', 'source'],
  nutrition_plan_restored: ['source'],
  nutrition_weekly_summary_viewed: ['source', 'loggedDaysBucket', 'hasWeightTrend'],
  // `latencyBucket` added Fase C3 Part 19 ("search_latency_bucket") —
  // reuses `durationBucket()` below, same bucket vocabulary as generation.
  nutrition_catalog_search_performed: ['catalogMode', 'resultCountBucket', 'latencyBucket'],
  nutrition_catalog_search_zero_results: ['catalogMode'],
  // `source` (Fase C3 "search_source_selected") is the selected item's
  // underlying `FoodLogEntry.source.type` (taco/off/tbca/fatsecret/manual)
  // — only present for `origin: 'food_log'` selections; a closed-vocabulary
  // label, never the item's name/query.
  nutrition_catalog_item_selected: ['catalogMode', 'origin', 'source'],
  // `afterZeroResults` (Fase C3 "custom_food_created_after_zero_result")
  // — true when the most recent search before this creation had 0 results.
  nutrition_custom_item_created_after_search: ['catalogMode', 'afterZeroResults'],
  // `source`/`reason` are closed-vocabulary provider/failure labels only —
  // never the scanned barcode digits or any product identifier.
  barcode_scan_started: [],
  barcode_scan_resolved_local: [],
  barcode_scan_resolved_external: ['source'],
  barcode_scan_materialized: ['source'],
  barcode_scan_not_found: [],
  barcode_scan_failed: ['reason'],
};

const SENSITIVE_PROPERTY = /weight|height|birth|pregnan|breast|allerg|food|diary|macro|calorie|feedback|prompt|output|planContent/i;
// `+` is allowed because `countBucket()` itself produces an open-ended top
// bucket like `'5+'` — every bucket helper's own output must always be a
// valid property value, or any caller passing a `5+`-sized count (e.g. a
// catalog search with 5+ results) throws `VALUE_INVALID` from inside
// `trackNutritionEvent`, turned into a spurious UI error by whichever
// `.then()/.catch()` chain happens to call it.
const SAFE_STRING = /^[A-Za-z0-9_.:+-]{1,80}$/;

const CLOSED_STRING_VALUES: Readonly<Partial<Record<NutritionAnalyticsEventName, Readonly<Record<string, readonly string[]>>>>> = {
  nutrition_catalog_search_performed: {
    catalogMode: ['generation', 'logging'], resultCountBucket: ['0', '1-2', '3-4', '5+'],
    latencyBucket: ['unknown', 'under_5s', '5s_30s', '30s_2m', 'over_2m'],
  },
  nutrition_catalog_search_zero_results: { catalogMode: ['generation', 'logging'] },
  nutrition_catalog_item_selected: {
    catalogMode: ['generation', 'logging'], origin: ['catalog', 'custom', 'recipe', 'food_log'],
    source: ['taco', 'tbca', 'usda', 'label', 'off', 'fatsecret', 'manual'],
  },
  nutrition_custom_item_created_after_search: { catalogMode: ['generation', 'logging'] },
  barcode_scan_resolved_external: { source: ['off', 'fatsecret'] },
  barcode_scan_materialized: { source: ['off', 'fatsecret'] },
  barcode_scan_failed: { reason: ['permission_denied', 'network', 'invalid_barcode', 'unknown'] },
};

export interface NutritionAnalyticsEvent {
  name: NutritionAnalyticsEventName;
  properties?: Readonly<Record<string, AnalyticsPrimitive>>;
}

export function nutritionAnalyticsOwner(name: NutritionAnalyticsEventName): NutritionAnalyticsOwner {
  return BACKEND_EVENTS.has(name) ? 'backend' : 'client';
}

export function assertNutritionAnalyticsEvent(
  event: NutritionAnalyticsEvent,
  owner: NutritionAnalyticsOwner,
): void {
  if (!(NUTRITION_ANALYTICS_EVENTS as readonly string[]).includes(event.name)) {
    throw new Error('NUTRITION_ANALYTICS_EVENT_INVALID');
  }
  if (nutritionAnalyticsOwner(event.name) !== owner) {
    throw new Error('NUTRITION_ANALYTICS_OWNER_INVALID');
  }
  const properties = event.properties ?? {};
  const allowed = new Set(ALLOWED_PROPERTIES[event.name]);
  if (Object.keys(properties).length > allowed.size) throw new Error('NUTRITION_ANALYTICS_PROPERTIES_INVALID');
  for (const [key, value] of Object.entries(properties)) {
    if (key !== 'hasWeightTrend' && SENSITIVE_PROPERTY.test(key)) {
      throw new Error('NUTRITION_ANALYTICS_SENSITIVE_PROPERTY');
    }
    if (!allowed.has(key)) throw new Error('NUTRITION_ANALYTICS_PROPERTY_NOT_ALLOWED');
    if (typeof value === 'string' && !SAFE_STRING.test(value)) {
      throw new Error('NUTRITION_ANALYTICS_VALUE_INVALID');
    }
    const closedValues = CLOSED_STRING_VALUES[event.name]?.[key];
    if (closedValues && (typeof value !== 'string' || !closedValues.includes(value))) {
      throw new Error('NUTRITION_ANALYTICS_VALUE_INVALID');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('NUTRITION_ANALYTICS_VALUE_INVALID');
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('NUTRITION_ANALYTICS_VALUE_INVALID');
    }
  }
}

export function countBucket(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value <= 2) return '1-2';
  if (value <= 4) return '3-4';
  return '5+';
}

export function durationBucket(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'unknown';
  if (durationMs < 5_000) return 'under_5s';
  if (durationMs < 30_000) return '5s_30s';
  if (durationMs < 120_000) return '30s_2m';
  return 'over_2m';
}
