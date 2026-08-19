// Type surface for the platform-split module `./google` (google.native.ts /
// google.web.ts). Metro resolves the platform file at bundle time; TypeScript
// resolves this declaration for types.
import type { ProviderResult } from './types';

export declare function isGoogleSigninAvailable(): Promise<boolean>;
export declare function getGoogleCredential(): Promise<ProviderResult>;

/** Fase 3 — account deletion provider revocation. See google.native.ts for the full contract. */
export type GoogleRevokeAccessOutcome = 'revoked' | 'unavailable' | 'failed';
export declare function revokeGoogleAccess(): Promise<GoogleRevokeAccessOutcome>;
