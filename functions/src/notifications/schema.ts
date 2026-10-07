export const NOTIFICATION_DISPATCHES_COLLECTION = 'notificationDispatches';
export const NOTIFICATION_DELIVERIES_SUBCOLLECTION = 'deliveries';

export const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_DISPATCH_ATTEMPTS = 5;

export const NOTIFICATION_TYPES = [
  'QA_TEST',
  'EVOLUTION_UNLOCKED',
  'EVOLUTION_APPROACHING',
  'PROGRAM_UPDATED',
  'BILLING_ISSUE',
  'PREMIUM_ENDED',
  'WORKOUT_DAY',
  'RECOVERY_DAY',
  'MISSED_WORKOUT',
  'RE_ENGAGEMENT_EARLY',
  'RE_ENGAGEMENT_LATE',
  'PHOTO_REMINDER',
  'ASSESSMENT_REMINDER',
  'COMPARE_PROGRESS',
  'WEEK_COMPLETED',
  'WEEK_STREAK',
  'SUPPORT_SINGLE_REPLY',
  'SUPPORT_CHAT_MESSAGE',
  'CAMPAIGN',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_DISPATCH_MODES = ['PRODUCT', 'QA_PREVIEW'] as const;
export type NotificationDispatchMode = (typeof NOTIFICATION_DISPATCH_MODES)[number];

export const NOTIFICATION_CATEGORIES = [
  'WORKOUTS_AND_REMINDERS',
  'EVOLUTION_AND_ACHIEVEMENTS',
  'PROGRESS',
  'OPERATIONAL',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const DISPATCH_STATUSES = [
  'CLAIMED',
  'RETRY_SCHEDULED',
  'PENDING_RECEIPTS',
  'CONFIRMED',
  'PARTIAL',
  'FAILED_TERMINAL',
  'FAILED_RETRY_EXHAUSTED',
  'RECEIPT_EXHAUSTED',
  'NO_ELIGIBLE_DEVICE',
  'SUPPRESSED_BY_PREFERENCE',
  'SUPPRESSED_BY_POLICY',
] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const DELIVERY_STATUSES = [
  'PENDING_RECEIPT',
  'RECEIPT_CONFIRMED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'FAILED_RETRY_EXHAUSTED',
  'INVALID_TOKEN',
  'RECEIPT_EXHAUSTED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DEVICE_EXCLUSION_REASONS = [
  'PUSH_DISABLED',
  'PERMISSION_REVOKED',
  'RELEASED',
  'LEASE_EXPIRED',
  'OWNER_MISMATCH',
  'INSTALLATION_MISMATCH',
  'NO_TOKEN',
  'TOKEN_INVALID',
] as const;
export type DeviceExclusionReason = (typeof DEVICE_EXCLUSION_REASONS)[number];

export interface NotificationDispatchRequest {
  uid: string;
  notificationId: string;
  type: NotificationType;
  category: NotificationCategory;
  sourceIdentity: string;
  title: string;
  body: string;
  intent?: string;
  data?: Record<string, string | number | boolean>;
  imageUrl?: string;
  idempotencyKey: string;
}

export type NotificationDispatchOutcome =
  | { status: 'DUPLICATE'; dispatchId: string }
  | { status: 'IDEMPOTENCY_CONFLICT'; dispatchId: string }
  | { status: 'NO_ELIGIBLE_DEVICE'; dispatchId: string }
  | { status: 'SUPPRESSED_BY_PREFERENCE'; dispatchId: string }
  | { status: 'SUPPRESSED_BY_POLICY'; dispatchId: string }
  | {
      status:
        | 'RETRY_SCHEDULED'
        | 'PENDING_RECEIPTS'
        | 'CONFIRMED'
        | 'PARTIAL'
        | 'FAILED_TERMINAL'
        | 'FAILED_RETRY_EXHAUSTED'
        | 'RECEIPT_EXHAUSTED';
      dispatchId: string;
      deviceCount: number;
      acceptedCount: number;
    };
