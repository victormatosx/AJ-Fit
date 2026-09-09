export type DeliveryErrorClassification = 'RETRYABLE' | 'TERMINAL' | 'INVALID_TOKEN';

const ERROR_CLASSIFICATION: Readonly<Record<string, DeliveryErrorClassification>> = {
  NETWORK_ERROR: 'RETRYABLE',
  TIMEOUT: 'RETRYABLE',
  RATE_LIMITED: 'RETRYABLE',
  SERVER_ERROR: 'RETRYABLE',
  MessageRateExceeded: 'RETRYABLE',
  DeviceNotRegistered: 'INVALID_TOKEN',
  HTTP_ERROR: 'TERMINAL',
  INVALID_RESPONSE: 'TERMINAL',
  UNKNOWN_TICKET_ERROR: 'TERMINAL',
  UNKNOWN_RECEIPT_ERROR: 'TERMINAL',
  MessageTooBig: 'TERMINAL',
  MismatchSenderId: 'TERMINAL',
  InvalidCredentials: 'TERMINAL',
};

export function classifyDeliveryError(
  errorCode: string | undefined | null,
): DeliveryErrorClassification {
  if (!errorCode) return 'TERMINAL';
  return ERROR_CLASSIFICATION[errorCode] ?? 'TERMINAL';
}

export function deliveryStatusForClassification(
  classification: DeliveryErrorClassification,
): 'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'INVALID_TOKEN' {
  if (classification === 'RETRYABLE') return 'FAILED_RETRYABLE';
  if (classification === 'INVALID_TOKEN') return 'INVALID_TOKEN';
  return 'FAILED_TERMINAL';
}

export function retryDelayMs(attemptCount: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
  const base = Math.min(60 * 60 * 1000, 30_000 * (2 ** exponent));
  return Math.floor(base * (0.75 + random() * 0.5));
}
