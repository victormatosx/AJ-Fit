/**
 * Public surface of the Firestore Cleanup Engine (Fase 6). Not wired into
 * `functions/src/index.ts` — no Cloud Function is registered from this
 * module; it exists to be called by a future worker (Fase 8+, not built
 * yet — see the Fase 6 report for the exact boundary).
 */

export * from './types';
export * from './deleteCollectionDocuments';
export * from './resources';
export * from './engine';
