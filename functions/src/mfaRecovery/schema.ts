import {
  RECOVERY_DIGEST_ALGORITHM,
  RECOVERY_DIGEST_VERSION,
  isWellFormedRecoveryDigest,
} from './digest';
import type {
  RecoveryCodeState,
  RecoveryOperationState,
  RecoverySetStatus,
} from './stateMachine';

/**
 * MFA Recovery — data contract for the backend-only recovery set document.
 *
 * Firestore path: _mfaRecovery/{recoverySetId}
 *
 *
 * WHY A TOP-LEVEL COLLECTION AND NOT users/{uid}/...
 * --------------------------------------------------
 * Two independent reasons, either of which would be sufficient.
 *
 * 1. Lookup direction. The recovery endpoint is reached by a caller who has
 *    passed the first factor but has NOT completed MFA, so there is no
 *    verified uid to path with. The set has to be findable from the code
 *    alone. Its document id is the code's selector (codeFormat.ts), so
 *    verification is a single `.doc(selector).get()` — the client never sends
 *    an email or a uid, which is what stops the endpoint from becoming an
 *    account-enumeration oracle.
 *
 * 2. Blast radius. Everything under `users/{uid}` sits in a subtree whose
 *    rules already grant the owner broad access, and where a future rule
 *    written for some unrelated feature could widen access by accident.
 *    Recovery material must not be one careless `match` away from being
 *    readable by the account it protects — precisely because the threat model
 *    includes a compromised first factor. A separate top-level collection with
 *    its own `allow read, write: if false` cannot inherit anything.
 *
 * The uid is a FIELD here, not the document id, so the collection also cannot
 * be probed by guessing uids.
 *
 *
 * WHY THIS SCHEMA LIVES IN TYPESCRIPT
 * -----------------------------------
 * Same reasoning as photoVault/schema.ts: the client is denied all access, so
 * the only writer is the Admin SDK, which bypasses Security Rules entirely. A
 * schema expressed in firestore.rules would never execute. This module is the
 * enforceable contract — every future backend write must call
 * `assertValidRecoverySet` first.
 *
 *
 * NO PLAINTEXT, STRUCTURALLY
 * --------------------------
 * A recovery code exists in plaintext exactly twice: in memory during
 * generation, and in memory during verification. It is shown to the user once
 * and is never persisted in any form other than its keyed digest. The closed
 * schema below enforces that by construction — any field that is not on the
 * allow-list is a validation error, so a plaintext field cannot be added
 * without failing this check — and `FORBIDDEN_PLAINTEXT_FIELDS` additionally
 * names the specific mistakes worth catching with a clear message.
 *
 *
 * PHASE 1 SCOPE: shapes and validators only. Nothing in this module performs
 * I/O, and no repository exists yet.
 */

/** Version of this document format. */
export const RECOVERY_SCHEMA_VERSION = 1;

/** Top-level, backend-only collection. Denied to every client (firestore.rules). */
export const MFA_RECOVERY_COLLECTION = '_mfaRecovery';

/**
 * How many codes a set holds. Declared here so the exhaustion rule and the
 * Phase 3 reveal screen agree on one number.
 */
export const RECOVERY_CODES_PER_SET = 10;

/**
 * Field names that must never appear on a persisted document.
 *
 * Redundant with the closed-schema check (all of these are already "unexpected
 * fields"), and kept anyway: this list is the thing a reviewer reads to
 * confirm the no-plaintext rule, and it produces a specific message instead of
 * a generic one if someone ever reintroduces one of them.
 */
export const FORBIDDEN_PLAINTEXT_FIELDS: readonly string[] = [
  'code',
  'codes_plaintext',
  'plaintext',
  'plainCode',
  'rawCode',
  'recoveryCode',
  'secret',
  'pepper',
];

export interface RecoveryCodeRecord {
  /**
   * Stable identifier for this code WITHIN its set. Not derived from the code
   * and not secret — it exists so an operation can reference the code it
   * reserved without storing anything sensitive, and so array reordering can
   * never repoint a reservation.
   */
  id: string;
  /** base64 HMAC-SHA-256 of the canonical code. The ONLY stored form. */
  digest: string;
  state: RecoveryCodeState;
  createdAt: Date;
  /** Set when the code moves to `reserved`; never cleared. */
  reservedAt: Date | null;
  /** Set when the code moves to `consumed`; never cleared. */
  consumedAt: Date | null;
  /**
   * The operation that reserved this code. Written together with `reserved`
   * and never reassigned — reassignment is what "a different operationId must
   * not silently adopt an existing reservation" forbids.
   */
  operationId: string | null;
}

/**
 * Per-set attempt accounting.
 *
 * PHASE 1 SCOPE: schema only. No limiter reads or enforces these fields yet.
 *
 * Deliberately keyed to the recovery SET, not to an IP: IPs are shared by
 * carrier NAT and trivially rotated, so an IP-only limiter both punishes
 * innocent users and fails to stop a determined attacker.
 *
 * OPEN FOR PHASE 2: this shape only bounds guessing against a set that has
 * already been located, i.e. an attacker who holds a valid selector. It does
 * nothing about someone spraying random selectors that match no document —
 * there is no per-set counter to increment when no set is found. That probe
 * limiter has to live somewhere else and is an explicit Phase 2 design item.
 */
export interface RecoveryRateLimitState {
  attempts: number;
  windowStartedAt: Date | null;
  lastAttemptAt: Date | null;
  blockedUntil: Date | null;
}

export interface RecoveryOperation {
  /** Idempotency key. Server-generated; see idempotency.ts. */
  operationId: string;
  state: RecoveryOperationState;
  /** `RecoveryCodeRecord.id` this operation reserved. Never changes. */
  codeId: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Sanitized `RecoveryInternalCode` when the operation failed, else null.
   * A fixed constant by construction, so it can never carry a code or a uid.
   */
  internalCode: string | null;
}

export interface RecoverySetDocument {
  schemaVersion: number;
  /** Equals the code's selector and the Firestore document id. */
  recoverySetId: string;
  /** Owner. A field, never the document id. */
  uid: string;
  /** Rotation generation, starting at 1. Increments with each new set. */
  version: number;
  /** Which Secret Manager pepper version produced the digests below. */
  pepperVersion: number;
  digestVersion: number;
  digestAlgorithm: typeof RECOVERY_DIGEST_ALGORITHM;
  status: RecoverySetStatus;
  createdAt: Date;
  /** Set when this set moves to `rotated`. */
  rotatedAt: Date | null;
  codes: RecoveryCodeRecord[];
  rateLimit: RecoveryRateLimitState;
  /** At most ONE in-flight or last-finished operation. See idempotency.ts. */
  activeOperation: RecoveryOperation | null;
}

const SET_KEYS: readonly (keyof RecoverySetDocument)[] = [
  'schemaVersion',
  'recoverySetId',
  'uid',
  'version',
  'pepperVersion',
  'digestVersion',
  'digestAlgorithm',
  'status',
  'createdAt',
  'rotatedAt',
  'codes',
  'rateLimit',
  'activeOperation',
];

const CODE_KEYS: readonly (keyof RecoveryCodeRecord)[] = [
  'id',
  'digest',
  'state',
  'createdAt',
  'reservedAt',
  'consumedAt',
  'operationId',
];

const RATE_LIMIT_KEYS: readonly (keyof RecoveryRateLimitState)[] = [
  'attempts',
  'windowStartedAt',
  'lastAttemptAt',
  'blockedUntil',
];

const OPERATION_KEYS: readonly (keyof RecoveryOperation)[] = [
  'operationId',
  'state',
  'codeId',
  'createdAt',
  'updatedAt',
  'internalCode',
];

const SET_STATUSES: readonly RecoverySetStatus[] = ['active', 'rotated', 'exhausted'];
const CODE_STATES: readonly RecoveryCodeState[] = ['available', 'reserved', 'consumed'];
const OPERATION_STATES: readonly RecoveryOperationState[] = [
  'reserved',
  'resetting',
  'completed',
  'failed',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isNullableDate(value: unknown): boolean {
  return value === null || isDate(value);
}

/** Reports closed-schema violations for `keys`, plus any forbidden field name. */
function checkKeys(
  doc: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  problems: string[],
): void {
  for (const key of keys) {
    if (!(key in doc)) {
      problems.push(`${label}: missing required field: ${key}`);
    }
  }
  for (const key of Object.keys(doc)) {
    if (FORBIDDEN_PLAINTEXT_FIELDS.includes(key)) {
      problems.push(`${label}: forbidden plaintext field: ${key}`);
      continue;
    }
    if (!keys.includes(key)) {
      problems.push(`${label}: unexpected field: ${key}`);
    }
  }
}

function validateCode(candidate: unknown, index: number, problems: string[]): void {
  const label = `codes[${index}]`;
  if (!isPlainObject(candidate)) {
    problems.push(`${label} must be an object`);
    return;
  }

  checkKeys(candidate, CODE_KEYS as readonly string[], label, problems);

  if ('id' in candidate && !isNonEmptyString(candidate.id)) {
    problems.push(`${label}.id must be a non-empty string`);
  }
  // Only the SHAPE of the digest is checked. Its value is never compared here
  // and never logged — see digest.ts for the constant-time comparison.
  if ('digest' in candidate && !isWellFormedRecoveryDigest(candidate.digest)) {
    problems.push(`${label}.digest must be a base64 HMAC-SHA-256 digest`);
  }
  if ('state' in candidate && !CODE_STATES.includes(candidate.state as RecoveryCodeState)) {
    problems.push(`${label}.state must be one of: ${CODE_STATES.join(', ')}`);
  }
  if ('createdAt' in candidate && !isDate(candidate.createdAt)) {
    problems.push(`${label}.createdAt must be a Date`);
  }
  if ('reservedAt' in candidate && !isNullableDate(candidate.reservedAt)) {
    problems.push(`${label}.reservedAt must be a Date or null`);
  }
  if ('consumedAt' in candidate && !isNullableDate(candidate.consumedAt)) {
    problems.push(`${label}.consumedAt must be a Date or null`);
  }
  if (
    'operationId' in candidate &&
    candidate.operationId !== null &&
    !isNonEmptyString(candidate.operationId)
  ) {
    problems.push(`${label}.operationId must be a non-empty string or null`);
  }

  // Cross-field consistency: a state and its evidence must agree, otherwise a
  // partially-applied write could leave a code that reads as reserved but
  // belongs to no operation — which is exactly the silent inconsistency the
  // operation model exists to prevent.
  const state = candidate.state as RecoveryCodeState | undefined;
  if (state === 'available') {
    if (candidate.operationId !== null) {
      problems.push(`${label}: available code must not reference an operation`);
    }
    if (candidate.reservedAt !== null || candidate.consumedAt !== null) {
      problems.push(`${label}: available code must not carry reserve/consume timestamps`);
    }
  }
  if (state === 'reserved') {
    if (!isNonEmptyString(candidate.operationId)) {
      problems.push(`${label}: reserved code must reference an operation`);
    }
    if (!isDate(candidate.reservedAt)) {
      problems.push(`${label}: reserved code must carry reservedAt`);
    }
    if (candidate.consumedAt !== null) {
      problems.push(`${label}: reserved code must not carry consumedAt`);
    }
  }
  if (state === 'consumed') {
    if (!isNonEmptyString(candidate.operationId)) {
      problems.push(`${label}: consumed code must reference an operation`);
    }
    if (!isDate(candidate.reservedAt)) {
      problems.push(`${label}: consumed code must retain reservedAt`);
    }
    if (!isDate(candidate.consumedAt)) {
      problems.push(`${label}: consumed code must carry consumedAt`);
    }
  }
}

function validateRateLimit(candidate: unknown, problems: string[]): void {
  const label = 'rateLimit';
  if (!isPlainObject(candidate)) {
    problems.push(`${label} must be an object`);
    return;
  }

  checkKeys(candidate, RATE_LIMIT_KEYS as readonly string[], label, problems);

  if ('attempts' in candidate && !isNonNegativeInteger(candidate.attempts)) {
    problems.push(`${label}.attempts must be an integer >= 0`);
  }
  for (const key of ['windowStartedAt', 'lastAttemptAt', 'blockedUntil'] as const) {
    if (key in candidate && !isNullableDate(candidate[key])) {
      problems.push(`${label}.${key} must be a Date or null`);
    }
  }
}

function validateOperation(candidate: unknown, problems: string[]): void {
  const label = 'activeOperation';
  if (!isPlainObject(candidate)) {
    problems.push(`${label} must be an object or null`);
    return;
  }

  checkKeys(candidate, OPERATION_KEYS as readonly string[], label, problems);

  if ('operationId' in candidate && !isNonEmptyString(candidate.operationId)) {
    problems.push(`${label}.operationId must be a non-empty string`);
  }
  if ('codeId' in candidate && !isNonEmptyString(candidate.codeId)) {
    problems.push(`${label}.codeId must be a non-empty string`);
  }
  if (
    'state' in candidate &&
    !OPERATION_STATES.includes(candidate.state as RecoveryOperationState)
  ) {
    problems.push(`${label}.state must be one of: ${OPERATION_STATES.join(', ')}`);
  }
  if ('createdAt' in candidate && !isDate(candidate.createdAt)) {
    problems.push(`${label}.createdAt must be a Date`);
  }
  if ('updatedAt' in candidate && !isDate(candidate.updatedAt)) {
    problems.push(`${label}.updatedAt must be a Date`);
  }
  if (
    'internalCode' in candidate &&
    candidate.internalCode !== null &&
    !isNonEmptyString(candidate.internalCode)
  ) {
    problems.push(`${label}.internalCode must be a sanitized string or null`);
  }
}

/**
 * Validates a candidate recovery set against the closed schema.
 *
 * Returns human-readable problems — empty means valid. Like photoVault's
 * validator this reports rather than throws so callers can log a summary, and
 * the reasons never include field VALUES: no digest, no uid and no code ever
 * reaches a problem string.
 */
export function validateRecoverySet(candidate: unknown): string[] {
  if (!isPlainObject(candidate)) {
    return ['document must be an object'];
  }

  const problems: string[] = [];
  checkKeys(candidate, SET_KEYS as readonly string[], 'recoverySet', problems);

  if ('schemaVersion' in candidate && !isPositiveInteger(candidate.schemaVersion)) {
    problems.push('schemaVersion must be an integer >= 1');
  }
  if ('recoverySetId' in candidate && !isNonEmptyString(candidate.recoverySetId)) {
    problems.push('recoverySetId must be a non-empty string');
  }
  if ('uid' in candidate && !isNonEmptyString(candidate.uid)) {
    problems.push('uid must be a non-empty string');
  }
  if ('version' in candidate && !isPositiveInteger(candidate.version)) {
    problems.push('version must be an integer >= 1');
  }
  if ('pepperVersion' in candidate && !isPositiveInteger(candidate.pepperVersion)) {
    problems.push('pepperVersion must be an integer >= 1');
  }
  if ('digestVersion' in candidate && candidate.digestVersion !== RECOVERY_DIGEST_VERSION) {
    problems.push(`digestVersion must be ${RECOVERY_DIGEST_VERSION}`);
  }
  if (
    'digestAlgorithm' in candidate &&
    candidate.digestAlgorithm !== RECOVERY_DIGEST_ALGORITHM
  ) {
    problems.push(`digestAlgorithm must be ${RECOVERY_DIGEST_ALGORITHM}`);
  }
  if ('status' in candidate && !SET_STATUSES.includes(candidate.status as RecoverySetStatus)) {
    problems.push(`status must be one of: ${SET_STATUSES.join(', ')}`);
  }
  if ('createdAt' in candidate && !isDate(candidate.createdAt)) {
    problems.push('createdAt must be a Date');
  }
  if ('rotatedAt' in candidate && !isNullableDate(candidate.rotatedAt)) {
    problems.push('rotatedAt must be a Date or null');
  }

  if ('codes' in candidate) {
    if (!Array.isArray(candidate.codes) || candidate.codes.length === 0) {
      problems.push('codes must be a non-empty array');
    } else {
      candidate.codes.forEach((code, index) => validateCode(code, index, problems));

      const ids = candidate.codes
        .map((code) => (isPlainObject(code) ? code.id : undefined))
        .filter((id): id is string => typeof id === 'string');
      if (new Set(ids).size !== ids.length) {
        problems.push('codes must have unique ids');
      }

      // Digests must be distinct: two identical digests would mean two codes
      // that a single plaintext unlocks, which quietly halves the set.
      const digests = candidate.codes
        .map((code) => (isPlainObject(code) ? code.digest : undefined))
        .filter((digest): digest is string => typeof digest === 'string');
      if (new Set(digests).size !== digests.length) {
        problems.push('codes must have unique digests');
      }
    }
  }

  if ('rateLimit' in candidate) {
    validateRateLimit(candidate.rateLimit, problems);
  }

  if ('activeOperation' in candidate && candidate.activeOperation !== null) {
    validateOperation(candidate.activeOperation, problems);
  }

  // A set marked `exhausted` must actually be exhausted, and an `active` set
  // must not be: the materialized status is only useful if it cannot drift.
  if (Array.isArray(candidate.codes) && candidate.codes.length > 0) {
    const allConsumed = candidate.codes.every(
      (code) => isPlainObject(code) && code.state === 'consumed',
    );
    if (candidate.status === 'exhausted' && !allConsumed) {
      problems.push('exhausted set must have every code consumed');
    }
    if (candidate.status === 'active' && allConsumed) {
      problems.push('active set cannot have every code consumed');
    }
  }

  return problems;
}

/**
 * Throws unless `candidate` satisfies the closed schema. Every future backend
 * write of `_mfaRecovery/{recoverySetId}` must call this first.
 */
export function assertValidRecoverySet(
  candidate: unknown,
): asserts candidate is RecoverySetDocument {
  const problems = validateRecoverySet(candidate);
  if (problems.length > 0) {
    throw new Error(`Invalid recovery set: ${problems.join('; ')}`);
  }
}
