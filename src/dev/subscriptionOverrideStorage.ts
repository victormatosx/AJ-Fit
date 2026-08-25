import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from '../lib/logger';
import {
  isDevSubscriptionOverrideAllowed,
  isDevSubscriptionOverrideState,
  type DevSubscriptionOverrideState,
} from './subscriptionOverride';

/** Local-only, device-wide. Never written to Firestore, RevenueCat, or any backend. */
export const DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY = 'ajfit-dev-subscription-override';

/**
 * Never touches AsyncStorage when overrides are not allowed — a value
 * written by a past development build left on the device, or a value
 * tampered with directly in a production install, is never even read, let
 * alone applied. This is what makes "storage = PREMIUM_ANNUAL" mean nothing
 * in a build where overrides are disallowed.
 */
export async function readStoredDevSubscriptionOverride(): Promise<DevSubscriptionOverrideState> {
  if (!isDevSubscriptionOverrideAllowed()) return 'REAL';
  try {
    const raw = await AsyncStorage.getItem(DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY);
    return isDevSubscriptionOverrideState(raw) ? raw : 'REAL';
  } catch (err) {
    logError('devSubscriptionOverrideStorage:read', err);
    return 'REAL';
  }
}

export async function writeStoredDevSubscriptionOverride(
  state: DevSubscriptionOverrideState,
): Promise<void> {
  if (!isDevSubscriptionOverrideAllowed()) return;
  if (!isDevSubscriptionOverrideState(state)) {
    throw new Error(
      `[devSubscriptionOverrideStorage] refuse to persist invalid override: ${String(state)}`,
    );
  }
  await AsyncStorage.setItem(DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY, state);
}
