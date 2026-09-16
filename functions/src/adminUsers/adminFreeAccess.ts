import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { requireAdminUid } from '../attribution/adminAuth';
import { auth, db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { PREMIUM_ENTITLEMENT_ID } from '../billing/constants';
import {
  RevenueCatGrantError,
  grantPromotionalEntitlement,
  revokePromotionalEntitlement,
  type RevenueCatEntitlementSnapshot,
} from '../billing/revenueCatGrants';
import { isoDate, safeString } from './presentation';

/**
 * Administrative "free Premium access" surface for `ajfit-admin`
 * (adminGrantFreeAccess/adminRevokeFreeAccess). This is the ONLY path that
 * writes `adminAccessGrants/{uid}` — `firestore.rules` keeps that collection
 * `allow read, write: if false` for every client, exactly like
 * `promoCodes`/`couponRedemptions`/`subscriptionTransactions` (see
 * `attribution/promoCodeAdmin.ts` for the established pattern this mirrors).
 *
 * CRITICAL INVARIANT: this module NEVER decides Premium access. It only
 * calls RevenueCat's own promotional-entitlement endpoints
 * (billing/revenueCatGrants.ts) and records what happened, for the admin
 * panel's audit trail. The mobile app's `isPremium` continues to read
 * exclusively from `customerInfo.entitlements.active['premium']` — this
 * collection is never read by the client, by design (see `firestore.rules`).
 *
 * Concurrency / idempotency / retry (Fase 2 requirements) are handled by a
 * short-lived per-uid lock plus a state machine on `adminAccessGrants/{uid}`,
 * both mutated only inside Firestore transactions on that single document —
 * two admins racing to grant/revoke the same uid will have one transaction
 * commit first; the loser observes the already-updated state and treats its
 * own request as a duplicate rather than racing RevenueCat calls. A lock
 * older than `LOCK_TTL_MS` is treated as abandoned (a previous attempt
 * crashed between acquiring it and finalizing), so a retry can proceed
 * instead of getting stuck forever.
 */

const SCOPE = 'admin:freeAccess';
const FREE_ACCESS_COLLECTION = 'adminAccessGrants';
const EVENTS_SUBCOLLECTION = 'events';
const ENTITLEMENT_SIGNALS_COLLECTION = 'entitlementSignals';
const LOCK_TTL_MS = 60_000;
const MAX_REASON_LENGTH = 500;
const MAX_HISTORY_EVENTS = 20;

type FreeAccessOperation = 'grant' | 'revoke';
type FreeAccessState = 'granted' | 'revoked';

interface FreeAccessLock {
  operation: FreeAccessOperation;
  lockedAtMs: number;
  lockedBy: string;
}

interface FreeAccessDoc extends DocumentData {
  uid?: string;
  state?: FreeAccessState;
  lock?: FreeAccessLock | null;
  grantedAt?: Timestamp;
  grantedBy?: string;
  reason?: string;
  revokedAt?: Timestamp;
  revokedBy?: string;
  updatedAt?: Timestamp;
  revenueCat?: {
    lastOperation?: FreeAccessOperation;
    lastOperationAt?: Timestamp;
    lastStatus?: 'confirmed' | 'failed';
    lastStore?: string | null;
    lastExpiresAtMs?: number | null;
    lastError?: string | null;
  };
}

export interface AdminFreeAccessResponse {
  uid: string;
  state: FreeAccessState | 'none';
  alreadyInState: boolean;
  grantedAt: string | null;
  grantedBy: string | null;
  reason: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

function freeAccessDocPath(uid: string): string {
  return `${FREE_ACCESS_COLLECTION}/${uid}`;
}

/**
 * Minimal, non-sensitive realtime invalidation signal the mobile client is
 * allowed to read (its own uid only — see `firestore.rules`). It carries NO
 * administrative data (no `state`/`grantedBy`/`reason`/history — that stays
 * exclusively in `adminAccessGrants/{uid}`, never readable by the client)
 * and is NEVER a source of Premium authority: the client only reacts to the
 * fact that this document changed by invalidating its RevenueCat cache and
 * re-fetching `CustomerInfo` — `entitlements.active['premium']` from that
 * fetch remains the only thing that decides access.
 */
function entitlementSignalDocPath(uid: string): string {
  return `${ENTITLEMENT_SIGNALS_COLLECTION}/${uid}`;
}

const ENTITLEMENT_SIGNAL_RETRY_ATTEMPTS = 3;
const ENTITLEMENT_SIGNAL_RETRY_DELAY_MS = 200;

/**
 * Best-effort ping — never allowed to fail the admin action itself, and
 * never allowed to repeat the RevenueCat call or `finalizeOperation` (the
 * call site in `runOperation` only reaches this AFTER both already
 * succeeded — retrying transient Firestore hiccups HERE is safe precisely
 * because this write has no side effect beyond itself). Retries up to
 * `ENTITLEMENT_SIGNAL_RETRY_ATTEMPTS` times with a short linear backoff —
 * bounded and self-terminating, never a loop — before giving up. If every
 * attempt fails, the already-confirmed RevenueCat operation and
 * `adminAccessGrants` audit record are NEVER undone: the only consequence
 * is the mobile client falling back to its existing foreground/AppState
 * refresh instead of updating instantly. The final failure (only) is
 * logged via `logFunctionError` (uid masked, no secrets/PII) for
 * observability; it is never thrown.
 */
async function touchEntitlementSignal(uid: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ENTITLEMENT_SIGNAL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await db.doc(entitlementSignalDocPath(uid)).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < ENTITLEMENT_SIGNAL_RETRY_ATTEMPTS) {
        await delay(ENTITLEMENT_SIGNAL_RETRY_DELAY_MS * attempt);
      }
    }
  }
  logFunctionError(SCOPE, lastError, { uid, operation: 'touch_entitlement_signal' });
}

function invalidArgument(error: string): never {
  throw new HttpsError('invalid-argument', error);
}

function validateTargetUid(value: unknown): string {
  const uid = typeof value === 'string' ? value.trim() : '';
  if (!uid || uid.length > 128 || uid.includes('/')) invalidArgument('invalid_uid');
  return uid;
}

function validateReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason) invalidArgument('reason_required');
  if (reason.length > MAX_REASON_LENGTH) invalidArgument('reason_too_long');
  return reason;
}

async function assertTargetUserExists(uid: string): Promise<void> {
  try {
    await auth.getUser(uid);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    if (code === 'auth/user-not-found') throw new HttpsError('not-found', 'user_not_found');
    throw error;
  }
}

function toResponse(uid: string, doc: FreeAccessDoc | undefined, alreadyInState: boolean): AdminFreeAccessResponse {
  return {
    uid,
    state: doc?.state ?? 'none',
    alreadyInState,
    grantedAt: isoDate(doc?.grantedAt),
    grantedBy: safeString(doc?.grantedBy),
    reason: safeString(doc?.reason),
    revokedAt: isoDate(doc?.revokedAt),
    revokedBy: safeString(doc?.revokedBy),
  };
}

type BeginResult =
  | { alreadyInState: true; doc: FreeAccessDoc }
  | { alreadyInState: false; eventId: string };

/**
 * Acquires the per-uid lock and records a `pending` event, OR recognizes the
 * request as a no-op duplicate (already granted / already revoked) and
 * records a `skipped_duplicate` event instead — in both cases atomically,
 * inside a single Firestore transaction on `adminAccessGrants/{uid}`.
 */
async function beginOperation(params: {
  uid: string;
  operation: FreeAccessOperation;
  adminUid: string;
  reason: string | null;
}): Promise<BeginResult> {
  const ref = db.doc(freeAccessDocPath(params.uid));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as FreeAccessDoc;
    const currentState: FreeAccessState = data.state === 'granted' ? 'granted' : 'revoked';
    const lock = data.lock ?? null;
    const nowMs = Date.now();
    const eventRef = ref.collection(EVENTS_SUBCOLLECTION).doc();

    if (lock && nowMs - lock.lockedAtMs < LOCK_TTL_MS) {
      throw new HttpsError('aborted', 'operation_in_progress');
    }

    const isDuplicate =
      (params.operation === 'grant' && currentState === 'granted') ||
      (params.operation === 'revoke' && currentState === 'revoked');

    if (isDuplicate) {
      tx.set(eventRef, {
        type: params.operation,
        state: 'skipped_duplicate',
        requestedBy: params.adminUid,
        requestedAt: FieldValue.serverTimestamp(),
        reason: params.operation === 'grant' ? params.reason : null,
      });
      return { alreadyInState: true, doc: data };
    }

    tx.set(
      ref,
      {
        uid: params.uid,
        lock: { operation: params.operation, lockedAtMs: nowMs, lockedBy: params.adminUid },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(eventRef, {
      type: params.operation,
      state: 'pending',
      requestedBy: params.adminUid,
      requestedAt: FieldValue.serverTimestamp(),
      reason: params.operation === 'grant' ? params.reason : null,
    });
    return { alreadyInState: false, eventId: eventRef.id };
  });
}

type Outcome =
  | { ok: true; snapshot: RevenueCatEntitlementSnapshot }
  | { ok: false; errorKind: string };

const FINALIZE_RETRY_ATTEMPTS = 3;
const FINALIZE_RETRY_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clears the lock and records the confirmed/failed outcome, in one
 * transaction. Retried a few times on transient Firestore failures — this
 * write is the ONLY record that a `params.outcome.ok` RevenueCat call
 * (which already happened and cannot be un-done from here) was ever
 * confirmed. Losing it silently would leave `adminAccessGrants/{uid}`
 * understating reality (RevenueCat granted, Firestore still says
 * 'revoked'/'none') until a stale-lock retry happens to call RevenueCat
 * again — which is why the caller (`runOperation`) treats an
 * exhausted-retries failure here as its own distinct, loudly-logged error
 * rather than a generic one.
 */
async function finalizeOperation(params: {
  uid: string;
  eventId: string;
  operation: FreeAccessOperation;
  adminUid: string;
  reason: string | null;
  outcome: Outcome;
}): Promise<void> {
  const ref = db.doc(freeAccessDocPath(params.uid));
  const eventRef = ref.collection(EVENTS_SUBCOLLECTION).doc(params.eventId);
  const now = FieldValue.serverTimestamp();

  for (let attempt = 1; attempt <= FINALIZE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await runFinalizeTransaction();
      return;
    } catch (error) {
      if (attempt >= FINALIZE_RETRY_ATTEMPTS) throw error;
      await delay(FINALIZE_RETRY_DELAY_MS * attempt);
    }
  }

  async function runFinalizeTransaction(): Promise<void> {
    await db.runTransaction(async (tx) => {
    if (params.outcome.ok) {
      const docPatch: Record<string, unknown> = {
        uid: params.uid,
        state: params.operation === 'grant' ? 'granted' : 'revoked',
        lock: null,
        updatedAt: now,
        revenueCat: {
          lastOperation: params.operation,
          lastOperationAt: now,
          lastStatus: 'confirmed',
          lastStore: params.outcome.snapshot.store,
          lastExpiresAtMs: params.outcome.snapshot.expiresDateMs,
          lastError: null,
        },
      };
      if (params.operation === 'grant') {
        docPatch.grantedAt = now;
        docPatch.grantedBy = params.adminUid;
        docPatch.reason = params.reason;
      } else {
        docPatch.revokedAt = now;
        docPatch.revokedBy = params.adminUid;
      }
      tx.set(ref, docPatch, { merge: true });
      tx.set(
        eventRef,
        {
          state: 'confirmed',
          confirmedAt: now,
          revenueCatStore: params.outcome.snapshot.store,
          revenueCatExpiresAtMs: params.outcome.snapshot.expiresDateMs,
        },
        { merge: true },
      );
    } else {
      tx.set(
        ref,
        {
          uid: params.uid,
          lock: null,
          updatedAt: now,
          revenueCat: {
            lastOperation: params.operation,
            lastOperationAt: now,
            lastStatus: 'failed',
            lastError: params.outcome.errorKind,
          },
        },
        { merge: true },
      );
      tx.set(eventRef, { state: 'failed', failedAt: now, errorKind: params.outcome.errorKind }, { merge: true });
    }
    });
  }
}

async function runOperation(params: {
  operation: FreeAccessOperation;
  adminUid: string;
  uid: string;
  reason: string | null;
}): Promise<AdminFreeAccessResponse> {
  const begin = await beginOperation(params);
  if (begin.alreadyInState) {
    logInfo(SCOPE, `free_access.${params.operation}_skipped_duplicate`, {
      adminUid: params.adminUid,
      uid: params.uid,
    });
    return toResponse(params.uid, begin.doc, true);
  }

  let outcome: Outcome;
  try {
    const snapshot =
      params.operation === 'grant'
        ? await grantPromotionalEntitlement(params.uid, PREMIUM_ENTITLEMENT_ID)
        : await revokePromotionalEntitlement(params.uid, PREMIUM_ENTITLEMENT_ID);
    outcome = { ok: true, snapshot };
  } catch (error) {
    const errorKind = error instanceof RevenueCatGrantError ? error.kind : 'unknown';
    outcome = { ok: false, errorKind };
  }

  try {
    await finalizeOperation({
      uid: params.uid,
      eventId: begin.eventId,
      operation: params.operation,
      adminUid: params.adminUid,
      reason: params.reason,
      outcome,
    });
  } catch (finalizeError) {
    // The RevenueCat call above already happened and cannot be undone from
    // here. If it succeeded (`outcome.ok`), this is the exact "RevenueCat
    // confirma grant mas gravação de auditoria falha" scenario the
    // feature's own risk audit flagged — surfaced as its own distinct,
    // loudly-logged error (never silently swallowed) so it's searchable in
    // Cloud Logging and an operator knows manual reconciliation may be
    // needed, instead of reading as an indistinguishable generic failure.
    // The lock is left in place (finalizeOperation never cleared it) —
    // self-heals via the lock TTL, at which point a retry re-reads current
    // state and, per RevenueCat's own documented near-duplicate window,
    // is very likely to no-op rather than double-apply.
    logFunctionError(SCOPE, finalizeError, {
      adminUid: params.adminUid,
      uid: params.uid,
      operation: params.operation,
      revenueCatOutcome: outcome.ok ? 'confirmed' : 'failed',
    });
    throw new HttpsError(
      'internal',
      outcome.ok ? 'audit_write_failed_after_revenuecat_success' : 'audit_write_failed',
    );
  }

  if (!outcome.ok) {
    logFunctionError(SCOPE, new Error(`revenuecat_${params.operation}_failed`), {
      adminUid: params.adminUid,
      uid: params.uid,
      operation: params.operation,
      errorKind: outcome.errorKind,
    });
    throw new HttpsError(
      outcome.errorKind === 'temporary' ? 'unavailable' : 'internal',
      `revenuecat_${params.operation}_failed`,
    );
  }

  logInfo(SCOPE, `free_access.${params.operation === 'grant' ? 'granted' : 'revoked'}`, {
    adminUid: params.adminUid,
    uid: params.uid,
  });

  // Only reached once RevenueCat confirmed the operation (`outcome.ok`,
  // checked above) AND `adminAccessGrants/{uid}` durably recorded it
  // (`finalizeOperation` above did not throw) — never ping the client on a
  // duplicate no-op (handled earlier via `begin.alreadyInState`) or on a
  // failed/partial attempt.
  await touchEntitlementSignal(params.uid);

  const finalSnap = await db.doc(freeAccessDocPath(params.uid)).get();
  return toResponse(params.uid, finalSnap.data() as FreeAccessDoc, false);
}

export interface AdminGrantFreeAccessInput {
  uid?: unknown;
  reason?: unknown;
}

export async function adminGrantFreeAccessHandler(
  request: CallableRequest<AdminGrantFreeAccessInput>,
): Promise<AdminFreeAccessResponse> {
  const adminUid = await requireAdminUid(request);
  const uid = validateTargetUid(request.data?.uid);
  const reason = validateReason(request.data?.reason);
  await assertTargetUserExists(uid);

  return runOperation({ operation: 'grant', adminUid, uid, reason });
}

export interface AdminRevokeFreeAccessInput {
  uid?: unknown;
}

export async function adminRevokeFreeAccessHandler(
  request: CallableRequest<AdminRevokeFreeAccessInput>,
): Promise<AdminFreeAccessResponse> {
  const adminUid = await requireAdminUid(request);
  const uid = validateTargetUid(request.data?.uid);
  await assertTargetUserExists(uid);

  return runOperation({ operation: 'revoke', adminUid, uid, reason: null });
}

export interface AdminFreeAccessEventView {
  id: string;
  type: FreeAccessOperation | null;
  state: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  reason: string | null;
  confirmedAt: string | null;
  failedAt: string | null;
  errorKind: string | null;
}

export interface AdminFreeAccessView extends AdminFreeAccessResponse {
  history: AdminFreeAccessEventView[];
}

const FALLBACK_FREE_ACCESS_VIEW: Omit<AdminFreeAccessView, 'uid'> = {
  state: 'none',
  alreadyInState: false,
  grantedAt: null,
  grantedBy: null,
  reason: null,
  revokedAt: null,
  revokedBy: null,
  history: [],
};

/**
 * Read-only enrichment used by `adminGetUserHandler` (adminUsers.ts) to show
 * the current grant state + history in the panel's user detail page. Never
 * called by the mobile app; never used to compute Premium access anywhere.
 *
 * Deliberately fails soft: `adminGetUser` returns the WHOLE user detail page
 * (auth, profile, questionnaire, subscription mirror...) in one
 * `Promise.all`, and this is the newest, least-battle-tested read among
 * them. A transient Firestore hiccup reading `adminAccessGrants/{uid}`
 * (or its `events` subcollection) must not take down the entire page for
 * an admin who only wanted to look up a user's e-mail — it degrades to the
 * safe "never granted" view and logs the failure, instead of throwing.
 */
export async function readFreeAccessView(uid: string): Promise<AdminFreeAccessView> {
  try {
    const ref = db.doc(freeAccessDocPath(uid));
    const [docSnap, eventsSnap] = await Promise.all([
      ref.get(),
      ref.collection(EVENTS_SUBCOLLECTION).orderBy('requestedAt', 'desc').limit(MAX_HISTORY_EVENTS).get(),
    ]);

    const doc = (docSnap.exists ? docSnap.data() : {}) as FreeAccessDoc;
    const history: AdminFreeAccessEventView[] = eventsSnap.docs.map((eventDoc) => {
      const data = eventDoc.data() as Record<string, unknown>;
      return {
        id: eventDoc.id,
        type: typeof data.type === 'string' ? (data.type as FreeAccessOperation) : null,
        state: safeString(data.state),
        requestedBy: safeString(data.requestedBy),
        requestedAt: isoDate(data.requestedAt),
        reason: safeString(data.reason),
        confirmedAt: isoDate(data.confirmedAt),
        failedAt: isoDate(data.failedAt),
        errorKind: safeString(data.errorKind),
      };
    });

    return { ...toResponse(uid, doc, false), history };
  } catch (error) {
    logFunctionError(SCOPE, error, { uid, operation: 'read_free_access_view' });
    return { uid, ...FALLBACK_FREE_ACCESS_VIEW };
  }
}
