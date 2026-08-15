import { logInfo } from '../lib/logger';
import type { OnboardingStepId } from './steps';

/**
 * Event surface for the onboarding funnel. No real analytics provider is
 * wired up in this codebase today (see docs/onboarding_funnel_architecture.md)
 * — `logOnboardingEvent` currently only mirrors into the structured app
 * logger (visible in dev/log tooling), never a third-party SDK. Swap
 * `setOnboardingAnalyticsLogger` for a real implementation once a provider
 * is chosen; callers never need to change.
 *
 * Never include PII: no name, email, password, full birth date, or health
 * data in any event payload.
 */
export type OnboardingAnalyticsEvent =
  | { name: 'onboarding_started' }
  | { name: 'onboarding_step_viewed'; stepId: OnboardingStepId }
  | { name: 'onboarding_step_completed'; stepId: OnboardingStepId }
  | { name: 'onboarding_resumed'; stepId: OnboardingStepId }
  | { name: 'quiz_answered'; stepId: OnboardingStepId }
  | { name: 'value_screen_viewed'; stepId: OnboardingStepId }
  | { name: 'social_proof_viewed' }
  | { name: 'analyzing_started' }
  | { name: 'analyzing_completed' }
  | { name: 'plan_ready_viewed' }
  | { name: 'plan_ready_cta_pressed' }
  | { name: 'auth_started'; origin: 'onboarding' | 'directLogin' }
  | { name: 'auth_completed' }
  | { name: 'paywall_viewed' }
  | { name: 'paywall_cta_pressed' }
  | { name: 'purchase_completed' }
  | { name: 'app_entered' };

export interface OnboardingAnalyticsLogger {
  log(event: OnboardingAnalyticsEvent): void;
}

export const noopOnboardingAnalyticsLogger: OnboardingAnalyticsLogger = {
  log() {
    // Intentionally inert — see module doc comment.
  },
};

const structuredLoggerBridge: OnboardingAnalyticsLogger = {
  log(event) {
    const { name, ...rest } = event;
    logInfo('onboardingAnalytics', name, rest);
  },
};

let activeLogger: OnboardingAnalyticsLogger = structuredLoggerBridge;

export function setOnboardingAnalyticsLogger(logger: OnboardingAnalyticsLogger): void {
  activeLogger = logger;
}

export function logOnboardingEvent(event: OnboardingAnalyticsEvent): void {
  activeLogger.log(event);
}
