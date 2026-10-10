import { describe, expect, it, vi } from 'vitest';

import {
  assertNutritionAnalyticsEvent,
  configureNutritionAnalytics,
  trackNutritionEvent,
} from '..';

describe('nutrition analytics contract', () => {
  it('accepts allowlisted client events and works without a provider', () => {
    configureNutritionAnalytics(null);
    expect(() => trackNutritionEvent({
      name: 'nutrition_weekly_summary_viewed',
      properties: { source: 'home', loggedDaysBucket: '3-4', hasWeightTrend: true },
    })).not.toThrow();
  });

  it('rejects unknown and sensitive properties', () => {
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_opened', properties: { weightKg: 70 },
    }, 'client')).toThrow('SENSITIVE_PROPERTY');
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_opened', properties: { arbitrary: 'value' },
    }, 'client')).toThrow('PROPERTY_NOT_ALLOWED');
  });

  it('accepts the Fase C2 catalog-search events, never a raw query string property', () => {
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_search_performed', properties: { catalogMode: 'logging', resultCountBucket: '5+' },
    }, 'client')).not.toThrow();
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_search_zero_results', properties: { catalogMode: 'generation' },
    }, 'client')).not.toThrow();
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_item_selected', properties: { catalogMode: 'logging', origin: 'food_log' },
    }, 'client')).not.toThrow();
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_custom_item_created_after_search', properties: { catalogMode: 'logging' },
    }, 'client')).not.toThrow();
    // No event in the catalog accepts a free-text query property at all — the whitelist itself is the guard.
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_search_performed', properties: { catalogMode: 'logging', query: 'peito de frango' },
    }, 'client')).toThrow('PROPERTY_NOT_ALLOWED');
  });

  it('accepts the Fase C3 additions — latencyBucket, source, afterZeroResults — still no free text', () => {
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_search_performed',
      properties: { catalogMode: 'logging', resultCountBucket: '1-2', latencyBucket: 'under_5s' },
    }, 'client')).not.toThrow();
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_item_selected',
      properties: { catalogMode: 'logging', origin: 'food_log', source: 'peito_de_frango' },
    }, 'client')).toThrow('VALUE_INVALID');
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_search_performed',
      properties: { catalogMode: 'logging', resultCountBucket: '5+', latencyBucket: 'food_query' },
    }, 'client')).toThrow('VALUE_INVALID');
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_catalog_item_selected', properties: { catalogMode: 'logging', origin: 'food_log', source: 'taco' },
    }, 'client')).not.toThrow();
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_custom_item_created_after_search', properties: { catalogMode: 'logging', afterZeroResults: true },
    }, 'client')).not.toThrow();
  });

  it('enforces client/backend authority and forwards only after validation', () => {
    expect(() => assertNutritionAnalyticsEvent({
      name: 'nutrition_generation_completed', properties: {},
    }, 'client')).toThrow('OWNER_INVALID');
    const track = vi.fn();
    configureNutritionAnalytics({ track });
    trackNutritionEvent({ name: 'nutrition_plan_viewed', properties: { source: 'home' } });
    expect(track).toHaveBeenCalledOnce();
    configureNutritionAnalytics(null);
  });
});
