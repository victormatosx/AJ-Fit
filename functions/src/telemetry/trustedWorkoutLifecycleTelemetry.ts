import { createHash } from 'node:crypto';

import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { db } from '../lib/firebaseAdmin';
import { logInfo, type LogContext } from '../lib/logger';

interface PersistedLifecycleEvent {
  eventId?: unknown;
  type?: unknown;
  payload?: unknown;
}

/**
 * 'new' and 'pending' both mean the sink has not yet confirmed delivery and
 * must be (re)attempted; 'delivered' means a prior attempt already reached
 * the sink and this call must be suppressed to avoid double-counting.
 */
export type TrustedTelemetryClaimStatus = 'new' | 'pending' | 'delivered';

export interface TrustedTelemetryClaimStore {
  claim(correlationHash: string, eventType: string, correlationScope?: string): Promise<TrustedTelemetryClaimStatus>;
  markDelivered(correlationHash: string, correlationScope?: string): Promise<void>;
}

export interface TrustedTelemetrySink {
  log(name: string, context: LogContext): void;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function receiptRef(correlationScope: string, correlationHash: string) {
  return db.collection('users').doc(correlationScope)
    .collection('workoutLifecycleTrustedTelemetryReceipts').doc(correlationHash);
}

export function trustedTelemetryNameForLifecycleEvent(type: string): string | null {
  switch (type) {
    case 'CYCLE_COMPLETED': return 'cycle_completed';
    case 'EVOLUTION_EARNED':
    case 'MOTIVATIONAL_RENEWAL_OFFERED': return 'evolution_eligible';
    case 'EVOLUTION_DEFERRED': return 'evolution_deferred';
    case 'EVOLUTION_ACTIVATED': return 'evolution_activated';
    case 'MOTIVATIONAL_RENEWAL_ACTIVATED': return 'motivational_renewal';
    case 'LEVEL_PROMOTED': return 'level_promoted';
    default: return null;
  }
}

const firestoreClaimStore: TrustedTelemetryClaimStore = {
  async claim(correlationHash, eventType, correlationScope) {
    if (!correlationScope) throw new Error('trusted_telemetry_correlation_scope_required');
    const ref = receiptRef(correlationScope, correlationHash);
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        tx.set(ref, {
          correlationHash,
          eventType,
          status: 'pending',
          claimedAt: new Date(),
          schemaVersion: 2,
        });
        return 'new';
      }
      return snapshot.data()?.status === 'delivered' ? 'delivered' : 'pending';
    });
  },
  async markDelivered(correlationHash, correlationScope) {
    if (!correlationScope) throw new Error('trusted_telemetry_correlation_scope_required');
    await receiptRef(correlationScope, correlationHash).set({
      status: 'delivered',
      deliveredAt: new Date(),
    }, { merge: true });
  },
};

const cloudLoggingSink: TrustedTelemetrySink = {
  log(name, context) {
    logInfo('workout-lifecycle', name, context);
  },
};

/**
 * Converts an immutable, already-persisted domain-ledger event into trusted
 * operational telemetry. The receipt is a two-phase outbox: it is claimed as
 * 'pending' before the sink is attempted, and only flipped to 'delivered'
 * after the sink call succeeds. If the sink throws, the receipt stays
 * 'pending' so a later retry/redelivery of the same event attempts the sink
 * again instead of silently dropping it — 'pending' is never treated as
 * already-delivered. The domain transition never depends on this projection.
 */
export async function emitTrustedWorkoutLifecycleTelemetry(
  value: PersistedLifecycleEvent,
  dependencies: {
    claims?: TrustedTelemetryClaimStore;
    sink?: TrustedTelemetrySink;
    /** Trusted trigger path scope; never emitted to logs. */
    correlationScope?: string;
  } = {},
): Promise<{ emitted: boolean; name: string | null }> {
  if (typeof value.eventId !== 'string' || typeof value.type !== 'string') {
    return { emitted: false, name: null };
  }
  const name = trustedTelemetryNameForLifecycleEvent(value.type);
  if (!name) return { emitted: false, name: null };
  const correlationHash = sha256(`${value.type}:${value.eventId}`);
  const claims = dependencies.claims ?? firestoreClaimStore;
  const status = await claims.claim(correlationHash, value.type, dependencies.correlationScope);
  if (status === 'delivered') return { emitted: false, name };

  const payload = plainObject(value.payload) ? value.payload : {};
  const context: LogContext = {
    trustLevel: 'TRUSTED_DOMAIN',
    correlationHash,
    domainEventType: value.type,
  };
  for (const key of ['evolutionType', 'quality', 'trigger', 'deferralCount']) {
    const item = payload[key];
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      context[key] = item;
    }
  }
  (dependencies.sink ?? cloudLoggingSink).log(name, context);
  await claims.markDelivered(correlationHash, dependencies.correlationScope);
  return { emitted: true, name };
}

export const onTrustedWorkoutLifecycleEventCreated = onDocumentCreated(
  'users/{uid}/workoutLifecycleEvents/{eventId}',
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    await emitTrustedWorkoutLifecycleTelemetry(snapshot.data(), {
      correlationScope: event.params.uid,
    });
  },
);
