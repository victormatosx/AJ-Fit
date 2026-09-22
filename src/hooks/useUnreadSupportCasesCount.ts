import { useEffect, useRef, useState } from 'react';

import { countUnreadSupportCases } from '../lib/unreadSupportCasesCount';
import { observeOwnSupportCases } from '../services/supportCases';
import { recordPerfMark } from '../lib/perf';
import type { InitialSectionStatus } from '../home/homeInitialReadiness';

export interface UnreadSupportCasesState {
  count: number;
  initialStatus: InitialSectionStatus;
}

/**
 * Total unread ADMIN messages across the caller's support cases, derived
 * live from Firestore's `unreadByUserCount` on each case via
 * `countUnreadSupportCases` (see that module — this is never a locally
 * incremented/decremented counter). Recomputed from the latest
 * `observeOwnSupportCases` snapshot on every update, so it can only change
 * when Firestore's real state changes (e.g. a new ADMIN message, or
 * `markSupportMessageRead` clearing one).
 */
export function useUnreadSupportCasesCount(uid: string | null | undefined): UnreadSupportCasesState {
  const [count, setCount] = useState(0);
  const [initialStatus, setInitialStatus] = useState<InitialSectionStatus>(uid ? 'PENDING' : 'NOT_APPLICABLE');
  const settledMarkFiredRef = useRef(false);

  useEffect(() => {
    if (!uid) {
      setCount(0);
      setInitialStatus('NOT_APPLICABLE');
      return undefined;
    }
    setInitialStatus('PENDING');
    settledMarkFiredRef.current = false;
    recordPerfMark('home_support_inbox_listener_start');
    return observeOwnSupportCases(
      uid,
      (cases) => {
        setCount(countUnreadSupportCases(cases));
        setInitialStatus('SUCCESS');
        if (!settledMarkFiredRef.current) {
          settledMarkFiredRef.current = true;
          recordPerfMark('home_support_inbox_settled');
        }
      },
      () => {
        setCount(0);
        setInitialStatus('ERROR');
        if (!settledMarkFiredRef.current) {
          settledMarkFiredRef.current = true;
          recordPerfMark('home_support_inbox_settled');
        }
      },
    );
  }, [uid]);

  return { count, initialStatus };
}
