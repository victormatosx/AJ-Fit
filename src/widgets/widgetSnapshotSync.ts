import { buildWidgetSnapshot, type WidgetSnapshotBuilderInput } from './widgetSnapshot';
import {
  clearWidgetSnapshotNative,
  requestWidgetReloadNative,
  writeWidgetSnapshotNative,
} from './widgetSnapshotBridge';

/**
 * Race protection for the ONE shared native snapshot slot (there is no
 * per-uid storage on the native side — switching accounts always means
 * "replace the single slot," never "keep multiple accounts' blobs around").
 * This is why this module does NOT need `homePresentationSnapshot.ts`'s
 * per-uid `Map`/`blockedUids` machinery: that module's AsyncStorage can
 * legitimately hold several uids' cached blobs at once (keyed storage), so
 * it needs to block/unblock per key. Here there is only one key, so a
 * single global FIFO queue plus a single monotonic "session generation" is
 * sufficient and strictly simpler.
 *
 * The three races this is required to resolve (see Phase 2 report §8):
 *
 * 1. A is logged in, a resync starts, A logs out before it finishes, the
 *    stale write must never land after the clear.
 * 2. A logs out, B logs in quickly, A's delayed resync must never overwrite
 *    B's snapshot.
 * 3. A workout finalizes while a foreground reconciliation is also in
 *    flight for the SAME session — neither may let a stale result win over
 *    a newer one, but neither should spuriously invalidate the other
 *    either (they belong to the same login session).
 *
 * The mechanism: `sessionGeneration` increments ONLY on a login/logout
 * boundary (see `beginWidgetSnapshotSession`/`clearWidgetSnapshot`) — never
 * on every resync. Each `syncWidgetSnapshot` call captures the CURRENT
 * generation at call time (read, not incremented) and re-checks it
 * immediately before the native write actually happens, inside the same
 * FIFO queue every write/clear goes through. A resync whose captured
 * generation no longer matches current (a login/logout happened since it
 * started) is silently discarded instead of writing. Two resyncs from the
 * SAME session (finalize + foreground, scenario 3) never invalidate each
 * other this way — they simply serialize through the queue, and whichever
 * one is still in flight when the OTHER lands just gets overwritten by it,
 * which is the correct "latest attempt for this session wins" behavior.
 */

let sessionGeneration = 0;
let pending: Promise<void> = Promise.resolve();

function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = pending.catch(() => undefined).then(operation);
  pending = next;
  return next;
}

/**
 * Call when a NEW login session starts (a different, non-null uid than the
 * one last seen) to invalidate any still-in-flight resync from a previous
 * session. `clearWidgetSnapshot` already calls this internally for logout;
 * callers only need this directly if they can observe a login without an
 * intervening explicit logout (defense in depth — today's only integration
 * point, `AuthContext.logout()`, already covers the real flow).
 */
export function beginWidgetSnapshotSession(): void {
  sessionGeneration += 1;
}

/**
 * Builds a `WidgetSnapshotV1` from already-resolved domain inputs (see
 * `buildWidgetSnapshot` — this function adds zero business logic of its
 * own) and persists it, UNLESS a newer session has started since this call
 * began. Safe to call multiple times concurrently for the same session —
 * they serialize, never corrupt each other, and the result reflects
 * whichever call's write actually runs last.
 *
 * Deliberately requires the caller to have ALREADY confirmed success of
 * whatever triggered this (a settled login, a confirmed workout
 * finalization, a resolved schedule) — this function has no concept of
 * "optimistic," it only ever persists what it's given.
 */
export async function syncWidgetSnapshot(input: WidgetSnapshotBuilderInput): Promise<void> {
  const myGeneration = sessionGeneration;
  const snapshot = buildWidgetSnapshot(input);
  await enqueue(async () => {
    if (sessionGeneration !== myGeneration) return;
    await writeWidgetSnapshotNative(snapshot);
    await requestWidgetReloadNative();
  });
}

/**
 * Starts a new session generation (invalidating any in-flight resync from
 * the outgoing session) and clears the native slot — the "never leave the
 * previous account's data visible" requirement. Always wins over a
 * concurrently-queued stale write, by construction: the clear's own
 * generation check can only ever be defeated by an EVEN NEWER session
 * (i.e. a login that happened after this very call started), in which case
 * correctly yielding to that newer session instead of clearing under it is
 * exactly what should happen.
 */
export async function clearWidgetSnapshot(): Promise<void> {
  const myGeneration = (sessionGeneration += 1);
  await enqueue(async () => {
    if (sessionGeneration !== myGeneration) return;
    await clearWidgetSnapshotNative();
    // Clearing the shared slot must invalidate what is already visible on
    // the Home Screen immediately; otherwise WidgetKit may keep the former
    // account's last rendered entry until its next opportunistic refresh.
    await requestWidgetReloadNative();
  });
}
