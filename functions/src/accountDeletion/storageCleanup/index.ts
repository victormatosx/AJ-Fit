/**
 * Public surface of the Storage Cleanup Engine (Fase 7). Deliberately does
 * NOT export `deletePrefixObjects` — see that file's doc comment for why
 * the generic prefix-delete primitive stays internal to this directory.
 * Not wired into `functions/src/index.ts` — no Cloud Function is
 * registered from this module.
 */

export * from './types';
export * from './resources';
export * from './engine';
