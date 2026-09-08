export const PUSH_INSTALLATIONS_COLLECTION = 'pushInstallations';
export const PUSH_TOKEN_OWNERS_COLLECTION = 'pushTokenOwners';
export const USER_DEVICES_COLLECTION = 'devices';
export const RELEASED_INSTALLATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const PUSH_PERMISSION_STATUSES = [
  'granted',
  'denied',
  'not-determined',
] as const;

export type PushPermissionStatus = (typeof PUSH_PERMISSION_STATUSES)[number];
export type PushPlatform = 'ios' | 'android';

export interface NativePushTokenInput {
  type: PushPlatform;
  data: string;
}

export interface SyncPushDeviceInput {
  installationId: string;
  installationSecret: string;
  sessionBindingId: string;
  /** Compare-and-swap fence; zero means the client has not observed a binding. */
  expectedOwnershipVersion: number;
  platform: PushPlatform;
  permissionStatus: PushPermissionStatus;
  /** Canonical IANA timezone observed by the authenticated foreground app. */
  timezone?: string;
  expoPushToken?: string;
  nativePushToken?: NativePushTokenInput;
}

export interface ReleasePushDeviceInput {
  installationId: string;
  installationSecret: string;
  ownerUid: string;
  /**
   * Fencing value returned by sync. A delayed release from account A cannot
   * mutate an installation which has since been rebound to account B.
   */
  ownershipVersion: number;
}

export interface PushDeviceMutationResponse {
  installationId: string;
  ownershipVersion: number;
  ownerChanged: boolean;
  pushEnabled: boolean;
  status: 'synced' | 'stale-sync' | 'released' | 'already-released' | 'stale-release';
  tokenChanged: boolean;
}
