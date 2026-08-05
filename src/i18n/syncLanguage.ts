import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import i18n from './index';
import { writeStoredLanguage } from './languageStorage';
import { normalizeLanguage } from './normalizeLanguage';
import {
  readPendingLanguageSync,
  writePendingLanguageSync,
  clearPendingLanguageSync,
  type PendingLanguageSync,
} from './pendingLanguageSync';
import { isSupportedLanguage, type SupportedLanguage } from '../types/language';
import { logError } from '../lib/logError';

/**
 * Owner of every path that mixes local i18n state with Firestore writes —
 * SettingsScreen and RootNavigator call into here and never talk to
 * Firestore themselves.
 *
 * Offline contract (this is a subtle but critical point of the Firebase JS
 * SDK): `updateDoc`'s Promise only resolves when the write is acknowledged
 * by the backend. When the device is offline it stays PENDING indefinitely
 * — until the network returns and the server responds or rejects. Awaiting
 * it directly from the UI would freeze the language picker forever offline.
 * Therefore this module always separates two phases:
 *
 *   1. Local apply + pending write   → awaited by the caller (fast).
 *   2. Remote push                   → fire-and-track: returned as a
 *                                       `remote` promise that never rejects
 *                                       (resolves to a tagged outcome).
 *
 * The UI closes its sheet as soon as (1) resolves and optionally observes
 * (2) for a rolled-back notification. No dedicated `onSnapshot` — the
 * outcome comes from the resolution of `updateDoc` itself when it finally
 * lands.
 *
 * Firestore writes are ALWAYS via dotted-path `preferences.language` so
 * `preferences.theme` / `preferences.units` are structurally impossible to
 * touch. Combined with the Phase 0 rules, a bug that tries to write the
 * whole preferences map would be rejected by the server with
 * `permission-denied` and rolled back below.
 *
 * Zero coupling to AuthContext: callers pass `uid` explicitly.
 */

type RemoteErrorKind = 'permanent' | 'recoverable';

/**
 * Firestore JS SDK error codes:
 *   • permission-denied  — rules refused the write (bad language, stale UID)
 *   • invalid-argument   — payload violates a validator (never happens in
 *                          normal flow because we validate ourselves first)
 *   • unauthenticated    — user's ID token expired mid-flight
 *   • unavailable / deadline-exceeded / network — retryable transport
 *
 * Everything unknown is treated as RECOVERABLE — worst case we keep the
 * user's choice and try again on next reconciliation, which is far less
 * annoying than rolling back a legitimate language switch.
 */
export function classifyRemoteError(err: unknown): RemoteErrorKind {
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

async function pushRemoteLanguage(
  uid: string,
  value: SupportedLanguage,
): Promise<void> {
  // `metadata.updatedAt: request.time` is REQUIRED by the current update
  // rule (firestore.rules — same invariant enforced on every path except
  // legacyMigrationValid). Without it the write is rejected with
  // permission-denied even when everything else is valid. We deliberately
  // touch only `metadata.updatedAt` — the other metadata fields are still
  // pinned by `metadata.diff(...).affectedKeys().hasOnly(['updatedAt'])`.
  await updateDoc(doc(db, 'users', uid), {
    'preferences.language': value,
    'metadata.updatedAt': serverTimestamp(),
  });
}

async function applyLocal(next: SupportedLanguage): Promise<void> {
  if (normalizeLanguage(i18n.language) !== next) {
    await i18n.changeLanguage(next);
  }
  await writeStoredLanguage(next);
}

/**
 * Outcome of the background remote push. Never a rejection — the promise
 * always resolves with one of these three shapes so callers can subscribe
 * with `.then` (no `.catch` needed).
 */
export type RemoteSyncOutcome =
  | { status: 'synced' }
  /** Recoverable failure — local + pending kept, next reconciliation retries. */
  | { status: 'pending'; reason: 'recoverable'; error: unknown }
  /** Server permanently rejected — local rolled back, pending cleared. */
  | { status: 'rolled-back'; reason: 'permanent'; error: unknown };

export type ChangeLanguageForUserResult = {
  /**
   * Background sync handle. Resolves when the remote push lands. Callers may
   * ignore it (no unhandled rejection because it never rejects). Useful for
   * observability (log a rollback) and for tests that need to assert on the
   * eventual outcome. DO NOT await this from the UI thread — offline holds
   * it pending indefinitely by design.
   */
  remote: Promise<RemoteSyncOutcome>;
};

/**
 * Authenticated flow. Awaited part is fast (i18n + AsyncStorage + pending
 * write); the returned `remote` promise carries the eventual server verdict.
 *
 * Throws ONLY for local errors detected before the remote push starts:
 *   • unsupported language (validation);
 *   • i18n.changeLanguage rejecting;
 *   • local storage rejecting the language OR the pending write.
 * These are the errors the UI must surface as "couldn't save".
 */
export async function changeLanguageForUser(args: {
  uid: string;
  next: SupportedLanguage;
}): Promise<ChangeLanguageForUserResult> {
  if (!isSupportedLanguage(args.next)) {
    throw new Error(
      `[syncLanguage] refuse: ${String(args.next)} is not a supported language`,
    );
  }

  const previous = normalizeLanguage(i18n.language);
  if (previous === args.next) {
    return { remote: Promise.resolve({ status: 'synced' }) };
  }

  await applyLocal(args.next);
  await writePendingLanguageSync({
    uid: args.uid,
    value: args.next,
    createdAt: Date.now(),
    attempts: 1,
  });

  // IIFE captures `previous` in closure and runs asynchronously. Attaching
  // a `.catch` inside guarantees this promise never rejects — even a bug in
  // `applyLocal(previous)` during rollback resolves cleanly to `rolled-back`.
  const remote = (async (): Promise<RemoteSyncOutcome> => {
    try {
      await pushRemoteLanguage(args.uid, args.next);
      await clearPendingLanguageSync();
      return { status: 'synced' };
    } catch (err) {
      const kind = classifyRemoteError(err);
      if (kind === 'permanent') {
        try {
          await applyLocal(previous);
        } catch (rollbackErr) {
          logError('syncLanguage:rollback-after-permanent', rollbackErr, {
            uid: args.uid,
            previous,
            attempted: args.next,
          });
        }
        await clearPendingLanguageSync();
        logError('syncLanguage:remote-push-permanent', err, {
          uid: args.uid,
          value: args.next,
        });
        return { status: 'rolled-back', reason: 'permanent', error: err };
      }
      // Recoverable: keep local + pending, next reconciliation will retry.
      logError('syncLanguage:remote-push-recoverable', err, {
        uid: args.uid,
        value: args.next,
      });
      return { status: 'pending', reason: 'recoverable', error: err };
    }
  })();

  return { remote };
}

/** What reconciliation applied *locally* before returning. Remote outcome is
 *  asynchronous (see `remote` below). */
export type ReconcileApplied = 'pending-value' | 'remote-value' | 'local-value';

export type ReconcileResult = {
  applied: ReconcileApplied;
  /** Present only when reconciliation kicked a background remote push. */
  remote?: Promise<RemoteSyncOutcome>;
};

/**
 * Called by RootNavigator on every profileLoading→false transition. Runs at
 * most once per profile-load cycle by construction (the caller wires it to
 * a state transition) — no timers, no polling, no automatic re-firing.
 *
 * Local ops are awaited (i18n + AsyncStorage — fast). The remote push, when
 * fired (Case A), runs in background and is exposed via `remote` for tests
 * and observability. App.tsx ignores it because the gate can open as soon
 * as local is done.
 *
 * Precedence:
 *   A) pending same UID          → apply pending, push in background
 *   B) no pending / other UID    → apply validated remote profile language
 *   C) pending of another UID    → discard it, then fall through to (B)
 *   D) no valid remote language  → leave local i18n untouched, log for obs
 */
export async function reconcileLanguageOnLoad(args: {
  uid: string;
  remoteLanguage: string | null | undefined;
}): Promise<ReconcileResult> {
  const remoteValid = isSupportedLanguage(args.remoteLanguage)
    ? (args.remoteLanguage as SupportedLanguage)
    : null;

  const pending = await readPendingLanguageSync();

  if (pending && pending.uid === args.uid) {
    // Case A — pending belongs to this user; it wins over remote until sync
    // completes or a permanent server error forces us to defer to remote.
    await applyLocal(pending.value);

    const withAttempt: PendingLanguageSync = {
      ...pending,
      attempts: pending.attempts + 1,
    };
    await writePendingLanguageSync(withAttempt);

    const remote = (async (): Promise<RemoteSyncOutcome> => {
      try {
        await pushRemoteLanguage(args.uid, pending.value);
        await clearPendingLanguageSync();
        return { status: 'synced' };
      } catch (err) {
        const kind = classifyRemoteError(err);
        if (kind === 'permanent') {
          // Server rejects the pending outright — no way it will ever
          // succeed. Fall back to remote if it's valid, otherwise leave
          // i18n on pending.value; either way, clear the record so we stop
          // trying.
          if (remoteValid && remoteValid !== pending.value) {
            try {
              await applyLocal(remoteValid);
            } catch (applyErr) {
              logError(
                'syncLanguage:reconcile-apply-remote-after-permanent',
                applyErr,
                { uid: args.uid },
              );
            }
          }
          await clearPendingLanguageSync();
          logError('syncLanguage:reconcile-permanent-drop', err, {
            uid: args.uid,
            value: pending.value,
          });
          return { status: 'rolled-back', reason: 'permanent', error: err };
        }
        // Recoverable: leave pending as-is (with incremented attempts) so
        // the next profile-load cycle can retry.
        logError('syncLanguage:reconcile-recoverable', err, {
          uid: args.uid,
          attempts: withAttempt.attempts,
        });
        return { status: 'pending', reason: 'recoverable', error: err };
      }
    })();

    return { applied: 'pending-value', remote };
  }

  if (pending && pending.uid !== args.uid) {
    // Case C — pending was written for a different account (previous
    // sign-in on this device). Never push another user's pending choice
    // to this account; drop it and fall through to remote.
    await clearPendingLanguageSync();
  }

  if (remoteValid) {
    // Case B — remote is authoritative.
    await applyLocal(remoteValid);
    return { applied: 'remote-value' };
  }

  // Case D — nothing usable remotely; keep local as-is. Spec forbids
  // auto-writing a default here.
  logError(
    'syncLanguage:reconcile-no-remote',
    new Error('profile has no valid preferences.language'),
    { uid: args.uid, remoteLanguage: args.remoteLanguage ?? null },
  );
  return { applied: 'local-value' };
}
