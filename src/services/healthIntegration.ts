/**
 * Apple Health (iOS) / Health Connect (Android) platform abstraction — Fase 1.
 *
 * Scope is frozen to the MVP data matrix: body weight (read) and completed
 * workouts (write). Do not add record types here without also updating the
 * Android permissions declared in `app.json` and `src/types/healthIntegration.ts`.
 *
 * Both native libraries are reached through platform-gated dynamic
 * `import()`, never a static top-level import. `react-native-health-connect`
 * resolves its native module via `TurboModuleRegistry.getEnforcing(...)` at
 * module-evaluation time — a static import would throw immediately on iOS,
 * where that native module does not exist. The Fase 0 spike proved this
 * exact pattern works on both platforms in a real build; keep it.
 */
import { Linking, Platform } from 'react-native';

import { logError, logInfo } from '../lib/logger';
import {
  HealthIntegrationError,
  type HealthAuthorizationSnapshot,
  type HealthAvailability,
  type HealthPermissionDescriptor,
  type HealthPlatform,
} from '../types/healthIntegration';

const LOG_SCOPE = 'healthIntegration';

/** The only permissions this integration ever requests on Android — mirrors `app.json`'s android.permissions. */
const MVP_ANDROID_PERMISSIONS: readonly HealthPermissionDescriptor[] = [
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'write', recordType: 'ExerciseSession' },
];

/** Narrows Health Connect's broad permission union down to this integration's MVP scope — see the module doc comment for why this matters. */
function scopeToMvpPermissions(permissions: readonly { accessType: 'read' | 'write'; recordType: string }[]): HealthPermissionDescriptor[] {
  return permissions.filter((permission): permission is HealthPermissionDescriptor =>
    MVP_ANDROID_PERMISSIONS.some(
      (mvp) => mvp.accessType === permission.accessType && mvp.recordType === permission.recordType,
    ));
}

export function getHealthPlatform(): HealthPlatform | 'unsupported' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'unsupported';
}

/** Health Connect's `SdkAvailabilityStatus` constants (androidx.health.connect.client.HealthConnectClient). */
function mapHealthConnectSdkStatus(status: number): HealthAvailability {
  switch (status) {
    case 3:
      return { status: 'available' };
    case 1:
      return { status: 'unavailable', reason: 'provider_missing' };
    case 2:
      return { status: 'unavailable', reason: 'provider_update_required' };
    default:
      return { status: 'unavailable', reason: 'check_failed', message: `sdk status ${status}` };
  }
}

export async function checkHealthAvailability(): Promise<HealthAvailability> {
  const platform = getHealthPlatform();
  if (platform === 'unsupported') return { status: 'unsupported' };

  try {
    if (platform === 'ios') {
      const HealthKit = await import('@kingstinct/react-native-healthkit');
      const available = HealthKit.isHealthDataAvailable();
      logInfo(LOG_SCOPE, 'availability_checked', { platform, available });
      return available ? { status: 'available' } : { status: 'unavailable', reason: 'provider_missing' };
    }
    const HealthConnect = await import('react-native-health-connect');
    const sdkStatus = await HealthConnect.getSdkStatus();
    const availability = mapHealthConnectSdkStatus(sdkStatus);
    logInfo(LOG_SCOPE, 'availability_checked', { platform, sdkStatus });
    return availability;
  } catch (cause) {
    logError(LOG_SCOPE, cause, { operation: 'check_availability', platform });
    return { status: 'unavailable', reason: 'check_failed' };
  }
}

/**
 * Single-flight guard: two callers that both tap "Conectar" before the first
 * native dialog resolves share the same in-flight request instead of
 * triggering the OS prompt twice (which Health Connect in particular
 * handles poorly — a second concurrent `requestPermission` call can throw).
 */
let permissionRequestInFlight: Promise<HealthAuthorizationSnapshot> | null = null;

export async function requestHealthPermissions(): Promise<HealthAuthorizationSnapshot> {
  if (permissionRequestInFlight) {
    logInfo(LOG_SCOPE, 'permission_request_deduped');
    return permissionRequestInFlight;
  }

  const platform = getHealthPlatform();
  if (platform === 'unsupported') return { platform: 'unsupported' };

  const request = (async (): Promise<HealthAuthorizationSnapshot> => {
    if (platform === 'ios') {
      const HealthKit = await import('@kingstinct/react-native-healthkit');
      // `requested` only confirms the dialog was shown and resolved without
      // throwing. HealthKit never reports which individual read permissions
      // the user granted or denied — do not infer "connected" from this.
      const requested = await HealthKit.requestAuthorization({
        toRead: ['HKQuantityTypeIdentifierBodyMass'],
        toShare: ['HKWorkoutTypeIdentifier'],
      });
      logInfo(LOG_SCOPE, 'ios_permission_dialog_resolved', { requested });
      return { platform: 'ios', permissionsRequested: requested };
    }

    const HealthConnect = await import('react-native-health-connect');
    const initialized = await HealthConnect.initialize();
    if (!initialized) {
      throw new HealthIntegrationError(
        'provider_not_installed',
        'Health Connect não está disponível neste dispositivo.',
      );
    }
    const granted = scopeToMvpPermissions(await HealthConnect.requestPermission([...MVP_ANDROID_PERMISSIONS]));
    logInfo(LOG_SCOPE, 'android_permissions_requested', { grantedCount: granted.length });
    return { platform: 'android', granted };
  })();

  permissionRequestInFlight = request.catch((cause) => {
    if (cause instanceof HealthIntegrationError) throw cause;
    logError(LOG_SCOPE, cause, { operation: 'request_permissions', platform });
    throw new HealthIntegrationError(
      'permission_request_failed',
      'Falha ao solicitar permissões de saúde.',
      cause,
    );
  });

  try {
    return await permissionRequestInFlight;
  } finally {
    permissionRequestInFlight = null;
  }
}

/**
 * Best-effort query of what the OS currently reports as granted.
 *
 * Android: authoritative and granular — Health Connect tracks this
 * per-record-type independently of when `requestHealthPermissions` last ran.
 *
 * iOS: HealthKit has no such API for read permissions. The returned
 * `permissionsRequested: false` carries no information about actual grants —
 * it exists only so callers can branch on `platform` without a separate code
 * path. UI must never render this as "authorized" or "denied" for iOS; the
 * only honest signal on iOS is the user's own stored `intent` (see
 * `healthIntegrationPreferences.ts`).
 */
export async function getGrantedHealthPermissions(): Promise<HealthAuthorizationSnapshot> {
  const platform = getHealthPlatform();
  if (platform === 'unsupported') return { platform: 'unsupported' };
  if (platform === 'ios') return { platform: 'ios', permissionsRequested: false };

  try {
    const HealthConnect = await import('react-native-health-connect');
    // Health Connect persists grants per package name across reinstalls, so
    // this can legitimately include permissions from an earlier build (see
    // Fase 0 report) that this app never declares anymore. Scope defensively
    // to exactly what this integration still asks for.
    const scoped = scopeToMvpPermissions(await HealthConnect.getGrantedPermissions());
    return { platform: 'android', granted: scoped };
  } catch (cause) {
    logError(LOG_SCOPE, cause, { operation: 'get_granted_permissions' });
    return { platform: 'android', granted: [] };
  }
}

/**
 * Best-effort deep link into the OS surface for managing this app's health
 * permissions. Neither platform guarantees landing exactly on the per-app
 * permission screen:
 * - iOS: `x-apple-health://` opens the Health app itself (undocumented but
 *   stable scheme); there is no reliable deep link to the
 *   Health app → Sharing → Apps → AJ Fit sub-screen. Falls back to this
 *   app's page in system Settings if the Health app can't be opened.
 * - Android: `openHealthConnectSettings()` opens the Health Connect app's
 *   own settings, where the user finds per-app permissions.
 */
export async function openNativeHealthSettings(): Promise<void> {
  const platform = getHealthPlatform();
  try {
    if (platform === 'ios') {
      const canOpenHealthApp = await Linking.canOpenURL('x-apple-health://');
      if (canOpenHealthApp) {
        await Linking.openURL('x-apple-health://');
        return;
      }
      await Linking.openSettings();
      return;
    }
    if (platform === 'android') {
      const HealthConnect = await import('react-native-health-connect');
      HealthConnect.openHealthConnectSettings();
      return;
    }
  } catch (cause) {
    logError(LOG_SCOPE, cause, { operation: 'open_native_settings', platform });
  }
}
