import {
  assertNutritionAnalyticsEvent,
  type NutritionAnalyticsEvent,
} from './shared/nutrition/analytics/contract';

export interface NutritionBackendAnalyticsProvider {
  track(event: NutritionAnalyticsEvent): void | Promise<void>;
}

let provider: NutritionBackendAnalyticsProvider | null = null;

export function configureNutritionBackendAnalytics(
  next: NutritionBackendAnalyticsProvider | null,
): void {
  provider = next;
}

/** Backend facts are validated now; external delivery remains explicitly unconfigured. */
export async function trackNutritionBackendEvent(event: NutritionAnalyticsEvent): Promise<void> {
  assertNutritionAnalyticsEvent(event, 'backend');
  if (provider) {
    try { await provider.track(event); }
    catch { /* Analytics must never change an authoritative nutrition result. */ }
  }
}
