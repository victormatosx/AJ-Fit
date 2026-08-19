/**
 * Public surface of the provider-revocation submodule (Fase 3). Not wired
 * into `functions/src/index.ts` — no Cloud Function is registered from
 * this module (see the Fase 3 report for what remains for a later phase).
 */

export * from './types';
export * from './appleClientSecret';
export * from './appleKmsClient';
export * from './appleTokenCrypto';
export * from './appleIdentityClient';
export * from './appleIdentityConfig';
export * from './appleRevocationRepository';
export * from './appleRevocationPreparation';
export * from './appleProviderRevocation';
export * from './googleProviderRevocation';
