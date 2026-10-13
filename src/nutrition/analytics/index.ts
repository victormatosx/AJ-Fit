import {
  assertNutritionAnalyticsEvent,
  type NutritionAnalyticsEvent,
} from './contract';

export interface NutritionAnalyticsProvider {
  track(event: NutritionAnalyticsEvent): void | Promise<void>;
}

let provider: NutritionAnalyticsProvider | null = null;

export function configureNutritionAnalytics(next: NutritionAnalyticsProvider | null): void {
  provider = next;
}

/** Validates every event even when no external analytics provider is configured. */
export function trackNutritionEvent(event: NutritionAnalyticsEvent): void {
  assertNutritionAnalyticsEvent(event, 'client');
  if (provider) void Promise.resolve(provider.track(event)).catch(() => undefined);
}

export * from './contract';
