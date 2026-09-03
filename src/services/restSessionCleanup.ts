import { restLiveActivity } from '../lib/restLiveActivity';
import { clearRestSession } from './restSessionStorage';

/**
 * Idempotent process/session boundary cleanup. Storage and native presentation
 * are independent best-effort operations so one unavailable layer never keeps
 * the other user's rest visible or persisted.
 */
export async function cleanupRestSessionArtifacts(): Promise<void> {
  await Promise.allSettled([
    clearRestSession(),
    restLiveActivity.cleanup(),
  ]);
}
