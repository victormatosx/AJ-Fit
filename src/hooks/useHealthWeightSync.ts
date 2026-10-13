import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getHealthPlatform } from '../services/healthIntegration';
import {
  readHealthIntegrationIntent,
  subscribeToHealthIntegrationIntent,
} from '../services/healthIntegrationPreferences';
import { deleteAllHealthWeightSamples } from '../services/healthWeightSamples';
import {
  isHealthWeightSyncCancellation,
  syncHealthWeightSamples,
  type HealthWeightSyncRunResult,
} from '../services/healthWeightSync';
import {
  markImportedWeightsDeleted,
  readHealthWeightSyncCheckpoint,
} from '../services/healthWeightSyncCheckpoint';
import type { HealthWeightSyncStatus } from '../types/healthWeightSync';
import { publishHealthWeightRefresh } from './healthWeightRefreshBus';

export type UseHealthWeightSyncResult = {
  status: HealthWeightSyncStatus;
  syncing: boolean;
  deleting: boolean;
  lastSuccessfulAt: Date | null;
  lastImportedCount: number;
  syncNow: () => Promise<HealthWeightSyncRunResult | null>;
  deleteImported: () => Promise<number>;
};

export function useHealthWeightSync(uid: string | null): UseHealthWeightSyncResult {
  const [status, setStatus] = useState<HealthWeightSyncStatus>('idle');
  const [deleting, setDeleting] = useState(false);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<Date | null>(null);
  const [lastImportedCount, setLastImportedCount] = useState(0);
  const epoch = useRef(0);
  const enabled = useRef(false);
  const operation = useRef<Promise<HealthWeightSyncRunResult | null> | null>(null);
  const deletingRef = useRef(false);

  const syncNow = useCallback(async (): Promise<HealthWeightSyncRunResult | null> => {
    if (!uid || deletingRef.current) return null;
    if (operation.current) return operation.current;
    const requestEpoch = epoch.current;
    const task = (async () => {
      const intent = await readHealthIntegrationIntent(uid);
      if (epoch.current !== requestEpoch || intent !== 'enabled') return null;
      enabled.current = true;
      setStatus('syncing');
      const result = await syncHealthWeightSamples(uid, {
        shouldContinue: () => epoch.current === requestEpoch && enabled.current,
      });
      if (epoch.current !== requestEpoch || !enabled.current) return null;
      setStatus(result.status);
      setLastImportedCount(result.imported);
      if (result.lastSuccessfulAt) setLastSuccessfulAt(result.lastSuccessfulAt);
      if (result.imported > 0) publishHealthWeightRefresh(uid);
      return result;
    })().catch((cause) => {
      if (epoch.current === requestEpoch && !isHealthWeightSyncCancellation(cause)) {
        setStatus('error');
      }
      return null;
    }).finally(() => {
      if (operation.current === task) operation.current = null;
    });
    operation.current = task;
    return task;
  }, [uid]);

  useEffect(() => {
    epoch.current += 1;
    const requestEpoch = epoch.current;
    enabled.current = false;
    operation.current = null;
    setStatus('idle');
    setLastSuccessfulAt(null);
    setLastImportedCount(0);
    if (!uid) return;
    const platform = getHealthPlatform();
    if (platform === 'unsupported') {
      setStatus('unavailable');
      return;
    }
    void Promise.all([
      readHealthIntegrationIntent(uid),
      readHealthWeightSyncCheckpoint(uid, platform),
    ]).then(([intent, checkpoint]) => {
      if (epoch.current !== requestEpoch) return;
      enabled.current = intent === 'enabled';
      if (checkpoint?.lastSuccessfulAtIso) {
        setLastSuccessfulAt(new Date(checkpoint.lastSuccessfulAtIso));
      }
      if (intent === 'enabled') void syncNow();
    }).catch(() => {
      if (epoch.current === requestEpoch) setStatus('error');
    });
  }, [syncNow, uid]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToHealthIntegrationIntent(uid, (intent) => {
      enabled.current = intent === 'enabled';
      if (intent !== 'enabled') {
        setStatus('idle');
      }
    });
  }, [syncNow, uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && enabled.current) void syncNow();
    });
    return () => subscription.remove();
  }, [syncNow, uid]);

  const deleteImported = useCallback(async (): Promise<number> => {
    if (!uid || deletingRef.current) return 0;
    const platform = getHealthPlatform();
    if (platform === 'unsupported') return 0;
    const requestEpoch = epoch.current;
    // A confirmation may remain open while an automatic foreground sync
    // begins. Let that single-flight finish, then honor the explicit delete;
    // never silently close the confirmation without deleting anything.
    if (operation.current) await operation.current;
    if (epoch.current !== requestEpoch) return 0;
    deletingRef.current = true;
    setDeleting(true);
    try {
      const result = await deleteAllHealthWeightSamples(uid);
      await markImportedWeightsDeleted(uid, platform);
      if (epoch.current === requestEpoch) {
        setLastImportedCount(0);
        setStatus('idle');
        publishHealthWeightRefresh(uid);
      }
      return result.deleted;
    } finally {
      deletingRef.current = false;
      if (epoch.current === requestEpoch) setDeleting(false);
    }
  }, [uid]);

  return {
    status,
    syncing: status === 'syncing',
    deleting,
    lastSuccessfulAt,
    lastImportedCount,
    syncNow,
    deleteImported,
  };
}
