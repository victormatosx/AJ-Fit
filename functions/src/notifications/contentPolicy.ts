import type {
  NotificationCategory,
  NotificationDispatchRequest,
  NotificationType,
} from './schema';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 240;
const MAX_ID_LENGTH = 160;
const MAX_IDEMPOTENCY_KEY_LENGTH = 300;
const MAX_DATA_KEYS = 8;
const MAX_DATA_KEY_LENGTH = 40;
const MAX_DATA_VALUE_LENGTH = 160;
const MAX_DATA_SERIALIZED_BYTES = 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

interface TypePolicy {
  category: NotificationCategory;
  allowedDataKeys: readonly string[];
  allowedIntents: readonly string[];
}

const TYPE_POLICIES: Readonly<Record<NotificationType, TypePolicy>> = {
  QA_TEST: {
    category: 'OPERATIONAL',
    allowedDataKeys: [],
    allowedIntents: [],
  },
};

export class NotificationContentPolicyError extends Error {
  constructor(public readonly reason: string) {
    super(`notification_content_policy_violation:${reason}`);
    this.name = 'NotificationContentPolicyError';
  }
}

function fail(reason: string): never {
  throw new NotificationContentPolicyError(reason);
}

function assertSafeId(value: unknown, field: string, maxLength = MAX_ID_LENGTH): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail(`${field}_length`);
  }
  if (!SAFE_ID_PATTERN.test(value)) fail(`${field}_charset`);
}

function assertDisplayString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    fail(field);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) fail(`${field}_control_character`);
}

function assertAllowedData(
  data: unknown,
  allowedKeys: readonly string[],
): asserts data is Record<string, string | number | boolean> | undefined {
  if (data === undefined) return;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail('data_type');

  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > MAX_DATA_KEYS) fail('data_too_many_keys');
  if (!keys.every((key) => allowedKeys.includes(key))) fail('data_key_not_allowed');

  for (const [key, value] of Object.entries(record)) {
    if (key.length === 0 || key.length > MAX_DATA_KEY_LENGTH || !SAFE_ID_PATTERN.test(key)) {
      fail('data_key_invalid');
    }
    if (typeof value === 'string') {
      if (value.length > MAX_DATA_VALUE_LENGTH || CONTROL_CHARACTER_PATTERN.test(value)) {
        fail('data_value_invalid');
      }
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('data_number_non_finite');
      continue;
    }
    if (typeof value !== 'boolean') fail('data_value_must_be_primitive');
  }

  const serialized = JSON.stringify(record);
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_DATA_SERIALIZED_BYTES) {
    fail('data_serialized_too_large');
  }
}

export function assertValidDispatchRequest(
  request: NotificationDispatchRequest,
): void {
  assertSafeId(request.uid, 'uid', 128);
  assertSafeId(request.notificationId, 'notificationId');
  assertSafeId(request.sourceIdentity, 'sourceIdentity');
  assertSafeId(request.idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);

  const policy = TYPE_POLICIES[request.type];
  if (!policy) fail('type_not_registered');
  if (request.category !== policy.category) fail('category_mismatch');

  assertDisplayString(request.title, 'title', MAX_TITLE_LENGTH);
  assertDisplayString(request.body, 'body', MAX_BODY_LENGTH);

  if (request.intent !== undefined && !policy.allowedIntents.includes(request.intent)) {
    fail('intent_not_allowed');
  }
  assertAllowedData(request.data, policy.allowedDataKeys);
}

/**
 * The sole Phase-1 content builder. Copy, category and payload are fixed;
 * callers provide only identities used for ownership and idempotency.
 */
export function buildQaTestNotification(params: {
  uid: string;
  notificationId: string;
  sourceIdentity: string;
  idempotencyKey: string;
}): NotificationDispatchRequest {
  const request: NotificationDispatchRequest = {
    ...params,
    type: 'QA_TEST',
    category: 'OPERATIONAL',
    title: 'AJ Fit — teste de push',
    body: 'A infraestrutura de notificações está funcionando.',
    data: {},
  };
  assertValidDispatchRequest(request);
  return request;
}
