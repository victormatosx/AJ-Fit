import { useEffect, useState } from 'react';

import { countUnreadSupportCases } from '../lib/unreadSupportCasesCount';
import { observeOwnSupportCases } from '../services/supportCases';

/**
 * Total unread ADMIN messages across the caller's support cases, derived
 * live from Firestore's `unreadByUserCount` on each case via
 * `countUnreadSupportCases` (see that module — this is never a locally
 * incremented/decremented counter). Recomputed from the latest
 * `observeOwnSupportCases` snapshot on every update, so it can only change
 * when Firestore's real state changes (e.g. a new ADMIN message, or
 * `markSupportMessageRead` clearing one).
 */
export function useUnreadSupportCasesCount(uid: string | null | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid) {
      setCount(0);
      return undefined;
    }
    return observeOwnSupportCases(
      uid,
      (cases) => setCount(countUnreadSupportCases(cases)),
      () => setCount(0),
    );
  }, [uid]);

  return count;
}
