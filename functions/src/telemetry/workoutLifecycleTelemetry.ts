import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { requireAuth } from '../lib/auth';
import { logInfo, type LogContext } from '../lib/logger';

type Primitive = string | number | boolean;
type Validator = (value: unknown) => value is Primitive;

const oneOf = <T extends string>(...values: T[]): Validator =>
  (value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
const finiteInteger: Validator = (value): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
const booleanValue: Validator = (value): value is boolean => typeof value === 'boolean';
const category: Validator = (value): value is string =>
  typeof value === 'string' && /^[A-Z0-9_:/.-]{1,64}$/i.test(value);

const clientDiagnosticSchemas: Record<string, Record<string, Validator>> = {
  lifecycle_rollout_decision: {
    decision: oneOf('ENROLLED', 'NOT_ROLLED_OUT'), bucket: finiteInteger, percentage: finiteInteger,
  },
  lifecycle_rollout_config_failed: { reason: oneOf('MISSING', 'MALFORMED', 'UNAVAILABLE') },
  migration_failed: { errorCategory: category, retryable: booleanValue },
  lifecycle_reconcile_started: { trigger: oneOf('POST_WORKOUT', 'COLD_START', 'RECOVERY', 'FOREGROUND') },
  lifecycle_reconcile_completed: {
    trigger: oneOf('POST_WORKOUT', 'COLD_START', 'RECOVERY', 'FOREGROUND'),
    outcome: oneOf('NO_LIFECYCLE', 'NO_ACTION', 'PREPARED', 'AUTO_ACTIVATED', 'STALE_REPREPARED'),
  },
  lifecycle_reconcile_failed: {
    trigger: oneOf('POST_WORKOUT', 'COLD_START', 'RECOVERY', 'FOREGROUND'), errorCategory: category, retryable: booleanValue,
  },
  lifecycle_stale_prepare_rejected: {
    reason: oneOf('PROGRAM_INSTANCE', 'CYCLE', 'INPUT_SNAPSHOT', 'CONCURRENT_WRITE'),
  },
  lifecycle_partial_state_recovered: { classification: category },
  progression_failed: {
    stage: oneOf('MIGRATION', 'EVALUATION', 'PREPARATION', 'ACTIVATION', 'DEFERRAL', 'ADAPTATION', 'RECONCILIATION'),
    errorCategory: category,
    retryable: booleanValue,
  },
};

export const TRUSTED_DOMAIN_EVENT_NAMES = new Set([
  'progression_evaluated',
  'evolution_eligible',
  'evolution_prepared',
  'evolution_deferred',
  'evolution_activated',
  'motivational_renewal',
  'level_promoted',
  'cycle_completed',
  'migration_completed',
]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateWorkoutLifecycleTelemetryEvent(value: unknown): {
  name: string;
  payload: LogContext;
} {
  if (!plainObject(value) || typeof value.name !== 'string') {
    throw new HttpsError('invalid-argument', 'invalid_telemetry_event');
  }
  if (TRUSTED_DOMAIN_EVENT_NAMES.has(value.name)) {
    throw new HttpsError('permission-denied', 'trusted_domain_event_requires_backend_authority');
  }
  const schema = clientDiagnosticSchemas[value.name];
  if (!schema) throw new HttpsError('invalid-argument', 'invalid_telemetry_event_name');
  const expectedKeys = ['name', ...Object.keys(schema)].sort();
  const actualKeys = Object.keys(value).sort();
  if (expectedKeys.length !== actualKeys.length
    || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new HttpsError('invalid-argument', 'invalid_telemetry_event_fields');
  }
  const payload: LogContext = {};
  for (const [key, validator] of Object.entries(schema)) {
    if (!validator(value[key])) throw new HttpsError('invalid-argument', 'invalid_telemetry_event_value');
    payload[key] = value[key] as Primitive;
  }
  return { name: value.name, payload };
}

export async function recordWorkoutLifecycleTelemetryHandler(
  request: CallableRequest,
): Promise<{ accepted: true; trustLevel: 'CLIENT_DIAGNOSTIC' }> {
  requireAuth(request);
  if (!plainObject(request.data) || Object.keys(request.data).length !== 1 || !('event' in request.data)) {
    throw new HttpsError('invalid-argument', 'invalid_telemetry_request');
  }
  const event = validateWorkoutLifecycleTelemetryEvent(request.data.event);
  // Deliberately omit request.auth.uid: aggregate operational health does not
  // need a persistent user identifier.
  logInfo('workout-lifecycle', event.name, {
    ...event.payload,
    trustLevel: 'CLIENT_DIAGNOSTIC',
  });
  return { accepted: true, trustLevel: 'CLIENT_DIAGNOSTIC' };
}
