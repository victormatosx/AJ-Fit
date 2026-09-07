import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from '../lib/logger';
import { isDevSubscriptionOverrideAllowed } from './subscriptionOverride';

/** Legacy device-wide key used by the old persistent implementation. */
export const DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY = 'ajfit-dev-subscription-override';

/**
 * One-way migration cleanup. The new override is session-scoped and never
 * reads or writes a selected state. Removing the old key prevents a stale
 * Premium simulation from surviving an app update, while keeping all storage
 * access behind the same development-only allow gate.
 */
export async function clearLegacyStoredDevSubscriptionOverride(): Promise<void> {
  if (!isDevSubscriptionOverrideAllowed()) return;
  try {
    await AsyncStorage.removeItem(DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY);
  } catch (err) {
    logError('devSubscriptionOverrideStorage:clearLegacy', err);
  }
}
