import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  exportConfirmedHealthWorkoutExecution,
  isHealthWorkoutExportCancellation,
  processHealthWorkoutExports,
} from '../services/healthWorkoutExport';
import { getHealthPlatform } from '../services/healthIntegration';
import {
  readHealthIntegrationIntent,
  subscribeToHealthIntegrationIntent,
} from '../services/healthIntegrationPreferences';
import {
  healthWorkoutExportLastSuccess,
  healthWorkoutExportPendingCount,
  readHealthWorkoutExportState,
  setHealthWorkoutExportIntentState,
} from '../services/healthWorkoutExportStore';
import type {
  HealthWorkoutExportRunResult,
  HealthWorkoutExportUiStatus,
} from '../types/healthWorkoutExport';

export type UseHealthWorkoutExportResult = {
  status: HealthWorkoutExportUiStatus;
  exporting: boolean;
  pendingCount: number;
  lastSuccessfulAt: Date | null;
  lastExportedCount: number;
  retryNow: () => Promise<HealthWorkoutExportRunResult | null>;
  enqueueConfirmed: (executionId: string) => Promise<HealthWorkoutExportRunResult | null>;
};

export function useHealthWorkoutExport(uid: string | null): UseHealthWorkoutExportResult {
  const [status, setStatus] = useState<HealthWorkoutExportUiStatus>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<Date | null>(null);
  const [lastExportedCount, setLastExportedCount] = useState(0);
  const epoch = useRef(0);
  const enabled = useRef(false);
  const operation = useRef<Promise<HealthWorkoutExportRunResult | null> | null>(null);

  const applyResult = useCallback((result: HealthWorkoutExportRunResult, requestEpoch: number) => {
    if (epoch.current !== requestEpoch || !enabled.current) return;
    setStatus(result.status);
    setPendingCount(result.pending);
    setLastSuccessfulAt(result.lastSuccessfulAt);
    setLastExportedCount(result.exported);
  }, []);

  const run = useCallback(async (force: boolean): Promise<HealthWorkoutExportRunResult | null> => {
    if (!uid) return null;
    if (operation.current) return operation.current;
    const requestEpoch = epoch.current;
    const task = (async () => {
      const intent = await readHealthIntegrationIntent(uid);
      if (epoch.current !== requestEpoch || intent !== 'enabled') return null;
      enabled.current = true;
      setStatus('exporting');
      const result = await processHealthWorkoutExports(uid, {
        force,
        reconcile: true,
        shouldContinue: () => epoch.current === requestEpoch && enabled.current,
      });
      applyResult(result, requestEpoch);
      return result;
    })().catch((cause) => {
      if (epoch.current === requestEpoch && !isHealthWorkoutExportCancellation(cause)) setStatus('error');
      return null;
    }).finally(() => {
      if (operation.current === task) operation.current = null;
    });
    operation.current = task;
    return task;
  }, [applyResult, uid]);

  const retryNow = useCallback(() => run(true), [run]);

  const enqueueConfirmed = useCallback(async (executionId: string): Promise<HealthWorkoutExportRunResult | null> => {
    if (!uid) return null;
    const requestEpoch = epoch.current;
    try {
      const result = await exportConfirmedHealthWorkoutExecution(uid, executionId, {
        shouldContinue: () => epoch.current === requestEpoch && enabled.current,
      });
      if (result) applyResult(result, requestEpoch);
      return result;
    } catch (cause) {
      if (epoch.current === requestEpoch && !isHealthWorkoutExportCancellation(cause)) setStatus('error');
      return null;
    }
  }, [applyResult, uid]);

  useEffect(() => {
    epoch.current += 1;
    const requestEpoch = epoch.current;
    enabled.current = false;
    operation.current = null;
    setStatus('idle');
    setPendingCount(0);
    setLastSuccessfulAt(null);
    setLastExportedCount(0);
    if (!uid) return;
    const platform = getHealthPlatform();
    if (platform === 'unsupported') {
      setStatus('unavailable');
      return;
    }
    void readHealthIntegrationIntent(uid).then(async (intent) => {
      const state = await setHealthWorkoutExportIntentState(uid, platform, intent);
      if (epoch.current !== requestEpoch) return;
      enabled.current = intent === 'enabled';
      setPendingCount(healthWorkoutExportPendingCount(state));
      setLastSuccessfulAt(healthWorkoutExportLastSuccess(state));
      if (intent === 'enabled') void run(false);
    }).catch(() => {
      if (epoch.current === requestEpoch) setStatus('error');
    });
  }, [run, uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const platform = getHealthPlatform();
    if (platform === 'unsupported') return undefined;
    return subscribeToHealthIntegrationIntent(uid, (intent) => {
      enabled.current = intent === 'enabled';
      void setHealthWorkoutExportIntentState(uid, platform, intent).then((state) => {
        setPendingCount(healthWorkoutExportPendingCount(state));
        setLastSuccessfulAt(healthWorkoutExportLastSuccess(state));
        if (intent === 'enabled') void run(false);
        else setStatus('idle');
      }).catch(() => setStatus('error'));
    });
  }, [run, uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && enabled.current) void run(false);
    });
    return () => subscription.remove();
  }, [run, uid]);

  // Refreshes UI-only persisted facts after another service invocation won a
  // single flight; it never triggers native work on its own.
  useEffect(() => {
    if (!uid || status === 'exporting') return;
    const platform = getHealthPlatform();
    if (platform === 'unsupported') return;
    void readHealthWorkoutExportState(uid, platform).then((state) => {
      setPendingCount(healthWorkoutExportPendingCount(state));
      setLastSuccessfulAt(healthWorkoutExportLastSuccess(state));
    });
  }, [status, uid]);

  return {
    status,
    exporting: status === 'exporting',
    pendingCount,
    lastSuccessfulAt,
    lastExportedCount,
    retryNow,
    enqueueConfirmed,
  };
}

