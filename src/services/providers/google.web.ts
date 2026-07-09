import type { ProviderResult } from './types';

/**
 * Web stub — native Google sign-in is not available in the web bundle. This
 * file exists so Metro can resolve `./google` on web without pulling in the
 * native module. Social login is a native (iOS/Android) feature.
 */
export async function isGoogleSigninAvailable(): Promise<boolean> {
  return false;
}

export async function getGoogleCredential(): Promise<ProviderResult> {
  throw new Error('Login com Google está disponível apenas no app iOS/Android.');
}
