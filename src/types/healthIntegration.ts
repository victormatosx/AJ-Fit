/**
 * Shared types for the Apple Health / Health Connect integration (Fase 1).
 *
 * Scope is deliberately frozen to the approved MVP data matrix: body weight
 * (read-only) and completed workouts (write-only). Adding a new data type
 * here without updating `HEALTH_READ_RECORD_TYPES` /
 * `HEALTH_WRITE_RECORD_TYPES` — and the matching Android permissions in
 * `app.json` — is how the Fase 0 "excess permission" mismatch happened; keep
 * this file as the single source of truth for what this integration ever
 * asks for.
 */

export type HealthPlatform = 'ios' | 'android';

/** Health Connect record types this integration ever reads. iOS has no equivalent enum — `HKQuantityTypeIdentifierBodyMass` is the iOS counterpart for `Weight`. */
export const HEALTH_READ_RECORD_TYPES = ['Weight'] as const;
/** Health Connect record types this integration ever writes. iOS counterpart is `HKWorkoutTypeIdentifier`. */
export const HEALTH_WRITE_RECORD_TYPES = ['ExerciseSession'] as const;

export type HealthAvailabilityStatus =
  | 'unknown'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'unsupported';

export type HealthUnavailableReason =
  | 'platform_unsupported'
  | 'provider_missing'
  | 'provider_update_required'
  | 'check_failed';

export type HealthAvailability =
  | { status: 'unknown' | 'checking' }
  | { status: 'available' }
  | { status: 'unsupported' }
  | { status: 'unavailable'; reason: HealthUnavailableReason; message?: string };

/**
 * The user's *intent* — what they asked the app to do. This is never
 * confused with OS-level authorization (see `HealthAuthorizationSnapshot`):
 * a user can have `intent: 'enabled'` while HealthKit quietly denied every
 * read permission, because iOS never tells the app which ones were denied.
 */
export type HealthConnectionIntent = 'not_configured' | 'enabled' | 'disabled';

export type HealthPermissionDescriptor = {
  accessType: 'read' | 'write';
  recordType: (typeof HEALTH_READ_RECORD_TYPES)[number] | (typeof HEALTH_WRITE_RECORD_TYPES)[number];
};

/**
 * What the OS will actually tell us.
 *
 * iOS: HealthKit never reveals which read permissions were granted or denied
 * (Apple's own privacy design — see Fase 0 report). `permissionsRequested`
 * only means "the request dialog was shown and resolved without throwing",
 * never "granted". Do not render this as "connected" in any UI copy.
 *
 * Android: Health Connect's `getGrantedPermissions()` is authoritative and
 * granular per record type.
 */
export type HealthAuthorizationSnapshot =
  | { platform: 'ios'; permissionsRequested: boolean }
  | { platform: 'android'; granted: HealthPermissionDescriptor[] }
  | { platform: 'unsupported' };

export type HealthIntegrationErrorCode =
  | 'unavailable'
  | 'permission_request_failed'
  | 'provider_not_installed'
  | 'unknown';

export class HealthIntegrationError extends Error {
  readonly code: HealthIntegrationErrorCode;
  readonly cause?: unknown;

  constructor(code: HealthIntegrationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'HealthIntegrationError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Single guard shared by `connect()`/`disconnect()` in `useHealthIntegration`
 * — pulled out as a pure function (rather than inlined per-callback) so it
 * has one real, renderer-free unit test (this project's Vitest suite has no
 * React component/hook renderer — see `usePremiumCapabilities.test.ts`) that
 * double-tapping either action, or tapping one while the other is already in
 * flight, is actually blocked.
 */
export function isHealthIntegrationActionBusy(state: {
  requestingPermissions: boolean;
  disconnecting: boolean;
}): boolean {
  return state.requestingPermissions || state.disconnecting;
}
