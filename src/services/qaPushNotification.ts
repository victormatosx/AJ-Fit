import { httpsCallable } from 'firebase/functions';

import { functions } from '../lib/firebaseFunctions';

export type QaPushDispatchResult = {
  status: string;
  dispatchId: string;
};

/**
 * DEV-only client surface. The backend independently requires App Check,
 * authenticated admin role, fixed content and self-targeting.
 */
export async function sendQaPushNotification(): Promise<QaPushDispatchResult> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('qa_push_unavailable');
  }
  const callable = httpsCallable<Record<string, never>, QaPushDispatchResult>(
    functions,
    'dispatchTestNotification',
  );
  return (await callable({})).data;
}
