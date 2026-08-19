// Type surface for the platform-split module `./apple` (apple.native.ts /
// apple.web.ts). Metro resolves the platform file at bundle time; TypeScript
// resolves this declaration for types.
import type { AppleCredentialOptions, ProviderResult } from './types';

export declare function isAppleAuthAvailable(): Promise<boolean>;
export declare function getAppleCredential(
  options?: AppleCredentialOptions,
): Promise<ProviderResult>;

/** Fase 3 — account deletion provider revocation. See apple.native.ts for the full contract. */
export type AppleCredentialForAccountDeletionResult = ProviderResult & {
  authorizationCode: string;
};
export declare function getAppleCredentialForAccountDeletion(): Promise<AppleCredentialForAccountDeletionResult>;
