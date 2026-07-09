import type { ProviderResult } from './types';

/**
 * Web stub — native Sign in with Apple is not available in the web bundle.
 * Social login is a native (iOS) feature.
 */
export async function isAppleAuthAvailable(): Promise<boolean> {
  return false;
}

export async function getAppleCredential(): Promise<ProviderResult> {
  throw new Error('Login com Apple está disponível apenas no app iOS.');
}
