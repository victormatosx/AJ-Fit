// Type surface for the platform-split module `./apple` (apple.native.ts /
// apple.web.ts). Metro resolves the platform file at bundle time; TypeScript
// resolves this declaration for types.
import type { AppleCredentialOptions, ProviderResult } from './types';

export declare function isAppleAuthAvailable(): Promise<boolean>;
export declare function getAppleCredential(
  options?: AppleCredentialOptions,
): Promise<ProviderResult>;
