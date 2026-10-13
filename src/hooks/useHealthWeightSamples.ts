import { useCallback, useEffect, useRef, useState } from 'react';

import { listHealthWeightSamples } from '../services/healthWeightSamples';
import type { HealthWeightSampleDoc } from '../types/healthWeightSync';
import { subscribeToHealthWeightRefresh } from './healthWeightRefreshBus';

export function useHealthWeightSamples(uid: string | null) {
  const [samples, setSamples] = useState<HealthWeightSampleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [resolvedUid, setResolvedUid] = useState<string | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!uid) {
      setSamples([]);
      setError(null);
      setResolvedUid(null);
      setLoading(false);
      return;
    }
    if (resolvedUid !== uid) setLoading(true);
    try {
      const next = await listHealthWeightSamples(uid);
      if (sequence.current !== request) return;
      setSamples(next);
      setError(null);
    } catch (cause) {
      if (sequence.current !== request) return;
      setError(cause instanceof Error ? cause : new Error('Failed to load imported weights'));
    } finally {
      if (sequence.current === request) {
        setResolvedUid(uid);
        setLoading(false);
      }
    }
  }, [resolvedUid, uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToHealthWeightRefresh(uid, refresh);
  }, [refresh, uid]);

  const current = resolvedUid === uid;
  return {
    samples: current ? samples : [],
    loading: !current || loading,
    error: current ? error : null,
    refresh,
  };
}
