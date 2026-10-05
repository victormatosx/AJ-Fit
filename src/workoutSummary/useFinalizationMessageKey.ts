import { useEffect, useRef, useState } from 'react';

import {
  FINALIZATION_MESSAGE_SCHEDULE,
  finalizationMessageScheduleDelaysMs,
  type FinalizationMessageKey,
} from './finalizationVisualProgress';

/**
 * Schedules the waiting-window narrative message key as a fixed set of
 * timeouts from the moment `active` first turns true — not a ticking
 * interval, so this never re-renders more than once per message. `active`'s
 * rising edge is what a fresh finalization attempt (first run or a retry)
 * looks like from the outside; its falling edge (committed or failed)
 * cancels anything still pending.
 */
export function useFinalizationMessageKey(active: boolean): FinalizationMessageKey {
  const [key, setKey] = useState<FinalizationMessageKey>(FINALIZATION_MESSAGE_SCHEDULE[0].key);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false;
      return undefined;
    }
    const startedNewAttempt = !wasActiveRef.current;
    wasActiveRef.current = true;
    if (!startedNewAttempt) return undefined;

    setKey(FINALIZATION_MESSAGE_SCHEDULE[0].key);
    const timers = finalizationMessageScheduleDelaysMs().map(({ key: scheduledKey, delayMs }) =>
      setTimeout(() => setKey(scheduledKey), delayMs));
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return key;
}
