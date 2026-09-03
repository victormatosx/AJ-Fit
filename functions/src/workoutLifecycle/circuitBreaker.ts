import type { Firestore } from 'firebase-admin/firestore';

/**
 * Phase 10E (docs/workout-lifecycle/v2/architecture/
 * 26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md §50): `rollout.ts` decides
 * WHO enters V2 (new V1→V2 migrations only, by design — it never gates an
 * already-migrated account). This module is deliberately the separate
 * concept: whether a specific already-migrated V2 account's mutation may
 * PROCEED right now. Rollout and circuit breaker must never be merged —
 * disabling rollout during an incident must not, by itself, do anything for
 * users already on V2; only this module does.
 *
 * Enforced exclusively here, inside `authorizeWorkoutLifecycleMutationHandler`
 * — never client-side-only. An old or modified client cannot opt out: every
 * mutation request re-evaluates this on the backend before any canonical
 * generation or grant issuance happens.
 */

const OPERATIONS_BLOCKED_WHEN_CIRCUIT_OPEN = [
  // Installs a brand-new V2 account's first content. Rollout already gates
  // whether this account gets here at all; blocking it here too gives an
  // extra incident brake for accounts that already passed the rollout
  // check before the incident started.
  'INITIALIZE',
  // Same reasoning as INITIALIZE — first-time V1→V2 content install.
  'MIGRATE',
  // Generates new pending-evolution content for an already-migrated account.
  'PREPARE',
  // Installs previously-prepared content as the new authoritative active
  // program — the exact scenario the audit brief's kill-switch scenario
  // names explicitly (PREPARE happened, then an incident, then ACTIVATE
  // attempted).
  'ACTIVATE',
  // Generates a new program from new inputs.
  'ADAPT',
] as const;

/**
 * Deliberately allowed even while the circuit is open — each one either (a)
 * never installs new prescription content, or (b) is needed to keep using
 * the account's CURRENT, already-vetted, pre-incident content without being
 * stuck. Blocking these would stop users from training or recovering safe
 * state, which the audit brief explicitly warns against ("não bloqueie
 * indiscriminadamente tudo sem analisar consequências").
 *
 * - RECOVER: pure reconciliation since Phase 10D — never installs content
 *   the canonical engine didn't already produce and seal in the past.
 * - EARN: records an already-computed eligibility fact/event ledger entry;
 *   does not change what program is active.
 * - DEFER: keeps the CURRENT program active for longer — the safe
 *   direction during an incident, not a dangerous one.
 * - FINISH_EXECUTION / COMPLETE_SCHEDULE / RESOLVE_MISSED_SESSION: normal
 *   day-to-day use of the account's current, already-active, pre-incident
 *   content. Blocking these would stop users from training at all.
 */
const OPERATIONS_ALLOWED_WHEN_CIRCUIT_OPEN = [
  'RECOVER', 'EARN', 'DEFER', 'FINISH_EXECUTION', 'COMPLETE_SCHEDULE', 'RESOLVE_MISSED_SESSION',
] as const;

export type CircuitBreakerOperation =
  | typeof OPERATIONS_BLOCKED_WHEN_CIRCUIT_OPEN[number]
  | typeof OPERATIONS_ALLOWED_WHEN_CIRCUIT_OPEN[number];

export interface WorkoutLifecycleCircuitBreakerConfig {
  schemaVersion: 1;
  /** true = circuit OPEN = block new dangerous content-producing transitions. */
  open: boolean;
}

/** Safe default when config is absent/malformed: circuit CLOSED (normal operation) — a missing ops doc is not itself an incident signal. */
export const CIRCUIT_BREAKER_FAIL_SAFE_CONFIG: WorkoutLifecycleCircuitBreakerConfig = {
  schemaVersion: 1,
  open: false,
};

export function isValidCircuitBreakerConfig(value: unknown): value is WorkoutLifecycleCircuitBreakerConfig {
  return (
    typeof value === 'object' && value !== null
    && Object.keys(value).length === 2
    && (value as { schemaVersion?: unknown }).schemaVersion === 1
    && typeof (value as { open?: unknown }).open === 'boolean'
  );
}

/** Pure classification — no I/O, unit-testable without Firestore. */
export function isOperationBlockedByCircuitBreaker(
  operation: CircuitBreakerOperation,
  config: WorkoutLifecycleCircuitBreakerConfig,
): boolean {
  if (!config.open) return false;
  return (OPERATIONS_BLOCKED_WHEN_CIRCUIT_OPEN as readonly string[]).includes(operation);
}

const CIRCUIT_BREAKER_COLLECTION = 'workoutLifecycleCircuitBreaker';
const CIRCUIT_BREAKER_DOC = 'active';

/**
 * Admin-SDK-only Firestore doc (see `firestore.rules` — no client read or
 * write path exists for this collection; only ops/Console/Admin SDK can
 * change it). Absent/malformed config fails closed to "circuit closed,
 * normal operation" — never to "block everything" — matching the same
 * fail-safe posture `rollout.ts`'s config loader already uses.
 */
export async function loadWorkoutLifecycleCircuitBreakerConfig(
  firestore: Firestore,
): Promise<WorkoutLifecycleCircuitBreakerConfig> {
  try {
    const snapshot = await firestore.collection(CIRCUIT_BREAKER_COLLECTION).doc(CIRCUIT_BREAKER_DOC).get();
    if (!snapshot.exists) return CIRCUIT_BREAKER_FAIL_SAFE_CONFIG;
    const data = snapshot.data();
    if (!isValidCircuitBreakerConfig(data)) return CIRCUIT_BREAKER_FAIL_SAFE_CONFIG;
    return data;
  } catch {
    return CIRCUIT_BREAKER_FAIL_SAFE_CONFIG;
  }
}
