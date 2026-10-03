import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deriveLoadProgress,
  type LoadProgressExecution,
} from '../loadProgress/loadProgress';
import {
  subscribeToWorkoutLoadRefresh,
} from '../loadProgress/workoutLoadRefreshBus';
import {
  listWorkoutExecutionsForLoadProgress,
  loadWorkoutExecution,
  type PersistedWorkoutExecution,
} from '../services/workoutExecutions';

function deviceLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useLoadProgress(uid: string | null) {
  const [executions, setExecutions] = useState<PersistedWorkoutExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [resolvedUid, setResolvedUid] = useState<string | null>(null);
  const resolvedUidRef = useRef<string | null>(null);
  const fullFetchSeq = useRef(0);
  const incrementalFetchSeq = useRef(0);
  const incrementalVersion = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++fullFetchSeq.current;
    const versionAtStart = incrementalVersion.current;
    if (!uid) {
      setExecutions([]);
      setError(null);
      setResolvedUid(null);
      resolvedUidRef.current = null;
      setLoading(false);
      return;
    }
    if (resolvedUidRef.current !== uid) {
      setExecutions([]);
      setError(null);
      setLoading(true);
    }
    try {
      const next = await listWorkoutExecutionsForLoadProgress(uid);
      if (seq !== fullFetchSeq.current) return;
      setExecutions((current) => {
        if (incrementalVersion.current === versionAtStart) return next;
        // A set may have been confirmed while this full read was in flight.
        // Preserve that execution's fresher incremental snapshot.
        const merged = new Map(next.map((item) => [item.executionId, item]));
        current.forEach((item) => merged.set(item.executionId, item));
        return Array.from(merged.values());
      });
      setError(null);
    } catch (cause) {
      if (seq !== fullFetchSeq.current) return;
      setError(cause instanceof Error ? cause : new Error('Failed to load workout loads'));
    } finally {
      if (seq === fullFetchSeq.current) {
        resolvedUidRef.current = uid;
        setResolvedUid(uid);
        setLoading(false);
      }
    }
  }, [uid]);

  const refreshExecution = useCallback(async (executionId: string) => {
    if (!uid) return;
    const seq = ++incrementalFetchSeq.current;
    incrementalVersion.current += 1;
    try {
      const fresh = await loadWorkoutExecution(uid, executionId);
      if (seq !== incrementalFetchSeq.current || !fresh) return;
      setExecutions((current) => {
        const index = current.findIndex((item) => item.executionId === executionId);
        if (index < 0) return [...current, fresh];
        const next = current.slice();
        next[index] = fresh;
        return next;
      });
      setError(null);
    } catch {
      // A background incremental refresh must not blank already-valid data.
      // Focus/retry still performs the authoritative full query.
    }
  }, [uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToWorkoutLoadRefresh(uid, ({ executionId }) => refreshExecution(executionId));
  }, [refreshExecution, uid]);

  const hasResolvedCurrentUid = resolvedUid === uid;
  const todayLocalDate = deviceLocalDate();
  const progress = useMemo(
    () => deriveLoadProgress(
      (hasResolvedCurrentUid ? executions : []) as LoadProgressExecution[],
      todayLocalDate,
    ),
    [executions, hasResolvedCurrentUid, todayLocalDate],
  );

  return {
    ...progress,
    /**
     * The raw, bounded execution list this hook already fetched
     * (`listWorkoutExecutionsForLoadProgress`) — exposed so consumers that
     * need a different in-memory projection over the SAME data (e.g. the
     * post-workout summary's "previous equivalent session" lookup,
     * `findPreviousEquivalentExecution`) never issue a second Firestore
     * query for it.
     */
    executions: hasResolvedCurrentUid ? executions : [],
    todayLocalDate,
    loading: !hasResolvedCurrentUid || loading,
    error: hasResolvedCurrentUid ? error : null,
    refresh,
  };
}
