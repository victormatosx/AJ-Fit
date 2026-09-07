import { createHash } from 'node:crypto';

import type { SupportedRevenueCatWebhookEventType } from '../billing/constants';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  buildBillingIssueNotification,
  buildPremiumEndedNotification,
} from './contentPolicy';
import type { NotificationDispatchOutcome } from './schema';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.revenueCat';

export type RevenueCatNotificationSuppressionReason =
  | 'EVENT_TYPE_NOT_ELIGIBLE'
  | 'NON_PREMIUM_ENTITLEMENT'
  | 'ENTITLEMENT_STILL_ACTIVE';

export type RevenueCatNotificationResult =
  | NotificationDispatchOutcome
  | { status: 'IGNORED'; reason: RevenueCatNotificationSuppressionReason }
  | { status: 'FAILED' };

export interface RevenueCatNotificationDependencies {
  dispatchCandidate: typeof dispatchUserNotificationCandidate;
}

const defaultDependencies: RevenueCatNotificationDependencies = {
  dispatchCandidate: dispatchUserNotificationCandidate,
};

function sourceEventHash(eventId: string): string {
  return createHash('sha256').update(eventId, 'utf8').digest('hex');
}

export async function dispatchRevenueCatNotification(
  input: {
    uid: string;
    eventId: string;
    eventType: SupportedRevenueCatWebhookEventType;
    concernsPremium: boolean;
    entitlementActive: boolean;
  },
  dependencies: RevenueCatNotificationDependencies = defaultDependencies,
): Promise<RevenueCatNotificationResult> {
  const eventHash = sourceEventHash(input.eventId);
  try {
    if (!input.concernsPremium) {
      logInfo(SCOPE, 'candidate_suppressed', {
        sourceEventHash: eventHash,
        sourceEventType: input.eventType,
        reason: 'NON_PREMIUM_ENTITLEMENT',
      });
      return { status: 'IGNORED', reason: 'NON_PREMIUM_ENTITLEMENT' };
    }

    if (input.eventType === 'BILLING_ISSUE') {
      return await dependencies.dispatchCandidate({
        uid: input.uid,
        category: 'OPERATIONAL',
        build: (locale) => buildBillingIssueNotification({
          uid: input.uid,
          revenueCatEventId: input.eventId,
          locale,
        }),
      });
    }

    if (input.eventType === 'EXPIRATION') {
      if (input.entitlementActive) {
        logInfo(SCOPE, 'candidate_suppressed', {
          sourceEventHash: eventHash,
          sourceEventType: input.eventType,
          reason: 'ENTITLEMENT_STILL_ACTIVE',
        });
        return { status: 'IGNORED', reason: 'ENTITLEMENT_STILL_ACTIVE' };
      }
      return await dependencies.dispatchCandidate({
        uid: input.uid,
        category: 'OPERATIONAL',
        build: (locale) => buildPremiumEndedNotification({
          uid: input.uid,
          revenueCatEventId: input.eventId,
          locale,
        }),
      });
    }

    logInfo(SCOPE, 'candidate_suppressed', {
      sourceEventHash: eventHash,
      sourceEventType: input.eventType,
      reason: 'EVENT_TYPE_NOT_ELIGIBLE',
    });
    return { status: 'IGNORED', reason: 'EVENT_TYPE_NOT_ELIGIBLE' };
  } catch (error) {
    logFunctionError(SCOPE, error, {
      sourceEventHash: eventHash,
      sourceEventType: input.eventType,
      operation: 'dispatch_product_notification',
    });
    return { status: 'FAILED' };
  }
}
