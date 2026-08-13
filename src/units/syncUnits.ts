import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logError } from '../lib/logError';
import {
  DEFAULT_UNITS_PREFERENCE,
  isUnitsPreference,
  type UnitsPreference,
} from '../types/units';
import {
  clearPendingUnitsSync,
  readPendingUnitsSync,
  writePendingUnitsSync,
  type PendingUnitsSync,
} from './pendingUnitsSync';
import {
  readStoredUnitsPreference,
  writeStoredUnitsPreference,
} from './unitsStorage';

type RemoteErrorKind = 'permanent' | 'recoverable';

function classifyRemoteError(err: unknown): RemoteErrorKind {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code: unknown }).code);
    if (
      code === 'permission-denied' ||
      code === 'invalid-argument' ||
      code === 'unauthenticated'
    ) {
      return 'permanent';
    }
  }
  return 'recoverable';
}

async function pushRemoteUnits(uid: string, value: UnitsPreference): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    'preferences.units': value,
    'metadata.updatedAt': serverTimestamp(),
  });
}

export type UnitsRemoteSyncOutcome =
  | { status: 'synced' }
  | { status: 'pending'; reason: 'recoverable'; error: unknown }
  | { status: 'rolled-back'; reason: 'permanent'; error: unknown };

export type ChangeUnitsForUserResult = {
  /** Do not await from UI: Firestore writes can remain pending while offline. */
  remote: Promise<UnitsRemoteSyncOutcome>;
};

/** Applies immediately to local storage and pushes the account preference in background. */
export async function changeUnitsForUser(args: {
  uid: string;
  next: UnitsPreference;
}): Promise<ChangeUnitsForUserResult> {
  if (!isUnitsPreference(args.next)) {
    throw new Error(
      `[syncUnits] refuse: ${String(args.next)} is not a valid units preference`,
    );
  }

  const previous =
    (await readStoredUnitsPreference()) ?? DEFAULT_UNITS_PREFERENCE;
  await writeStoredUnitsPreference(args.next);
  await writePendingUnitsSync({
    uid: args.uid,
    value: args.next,
    createdAt: Date.now(),
    attempts: 1,
  });

  const remote = (async (): Promise<UnitsRemoteSyncOutcome> => {
    try {
      await pushRemoteUnits(args.uid, args.next);
      await clearPendingUnitsSync();
      return { status: 'synced' };
    } catch (err) {
      if (classifyRemoteError(err) === 'permanent') {
        try {
          await writeStoredUnitsPreference(previous);
        } catch (rollbackErr) {
          logError('syncUnits:rollback-after-permanent', rollbackErr, {
            uid: args.uid,
            previous,
            attempted: args.next,
          });
        }
        await clearPendingUnitsSync();
        logError('syncUnits:remote-push-permanent', err, {
          uid: args.uid,
          value: args.next,
        });
        return { status: 'rolled-back', reason: 'permanent', error: err };
      }

      logError('syncUnits:remote-push-recoverable', err, {
        uid: args.uid,
        value: args.next,
      });
      return { status: 'pending', reason: 'recoverable', error: err };
    }
  })();

  return { remote };
}

export type ReconcileUnitsResult = {
  applied: 'pending-value' | 'remote-value' | 'system-default';
  preference: UnitsPreference;
  remote?: Promise<UnitsRemoteSyncOutcome>;
};

/**
 * Reconciles account and device state on login/profile reload.
 * A same-account pending value is retained for offline durability. Otherwise
 * a valid remote value wins; a missing/invalid remote value becomes `system`.
 */
export async function reconcileUnitsOnLoad(args: {
  uid: string;
  remoteUnits: unknown;
}): Promise<ReconcileUnitsResult> {
  const remoteValid = isUnitsPreference(args.remoteUnits)
    ? args.remoteUnits
    : null;
  const pending = await readPendingUnitsSync();

  if (pending && pending.uid === args.uid) {
    await writeStoredUnitsPreference(pending.value);

    const withAttempt: PendingUnitsSync = {
      ...pending,
      attempts: pending.attempts + 1,
    };
    await writePendingUnitsSync(withAttempt);

    const remote = (async (): Promise<UnitsRemoteSyncOutcome> => {
      try {
        await pushRemoteUnits(args.uid, pending.value);
        await clearPendingUnitsSync();
        return { status: 'synced' };
      } catch (err) {
        if (classifyRemoteError(err) === 'permanent') {
          const fallback = remoteValid ?? DEFAULT_UNITS_PREFERENCE;
          try {
            await writeStoredUnitsPreference(fallback);
          } catch (applyErr) {
            logError('syncUnits:reconcile-fallback-after-permanent', applyErr, {
              uid: args.uid,
              fallback,
            });
          }
          await clearPendingUnitsSync();
          return { status: 'rolled-back', reason: 'permanent', error: err };
        }

        logError('syncUnits:reconcile-recoverable', err, {
          uid: args.uid,
          attempts: withAttempt.attempts,
        });
        return { status: 'pending', reason: 'recoverable', error: err };
      }
    })();

    return {
      applied: 'pending-value',
      preference: pending.value,
      remote,
    };
  }

  if (pending) await clearPendingUnitsSync();

  const preference = remoteValid ?? DEFAULT_UNITS_PREFERENCE;
  await writeStoredUnitsPreference(preference);

  return {
    applied: remoteValid ? 'remote-value' : 'system-default',
    preference,
  };
}
