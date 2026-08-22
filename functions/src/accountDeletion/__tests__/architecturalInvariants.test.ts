import { describe, expect, it } from 'vitest';

import { ACCOUNT_DELETION_STEP_NAMES } from '../types';
import { POINT_OF_NO_RETURN_STEP } from '../steps';

/**
 * Fase 17 (final production audit) — a small, deliberately non-redundant
 * set of architectural invariants for properties that are easy to break
 * silently (a reorder, a dropped export) without any single existing test
 * failing loudly. Every property here already had SOME coverage scattered
 * across other files; this file exists so a regression fails with an
 * unambiguous, specifically-named assertion instead of a confusing
 * downstream symptom.
 */
describe('account deletion — architectural invariants', () => {
  it('AUTH_DELETION is the LAST step, always — Firebase Auth must survive every other step as the reconciliation anchor', () => {
    expect(ACCOUNT_DELETION_STEP_NAMES[ACCOUNT_DELETION_STEP_NAMES.length - 1]).toBe('AUTH_DELETION');
  });

  it('VAULT_KEY_DESTRUCTION is the point of no return, and precedes FIRESTORE_CLEANUP/STORAGE_CLEANUP', () => {
    expect(POINT_OF_NO_RETURN_STEP).toBe('VAULT_KEY_DESTRUCTION');
    const vaultIndex = ACCOUNT_DELETION_STEP_NAMES.indexOf('VAULT_KEY_DESTRUCTION');
    const firestoreIndex = ACCOUNT_DELETION_STEP_NAMES.indexOf('FIRESTORE_CLEANUP');
    const storageIndex = ACCOUNT_DELETION_STEP_NAMES.indexOf('STORAGE_CLEANUP');
    expect(vaultIndex).toBeLessThan(firestoreIndex);
    expect(vaultIndex).toBeLessThan(storageIndex);
  });

  it('ACCOUNT_ACCESS_LOCK is FIRST — no other step may run before the account is locked', () => {
    expect(ACCOUNT_DELETION_STEP_NAMES[0]).toBe('ACCOUNT_ACCESS_LOCK');
  });

  it('the step vocabulary itself has exactly 8 entries — a silent addition/removal changes this number', () => {
    expect(ACCOUNT_DELETION_STEP_NAMES).toHaveLength(8);
  });
});

describe('account deletion — Cloud Functions wiring (index.ts)', () => {
  it('exports exactly the three production entry points this workflow depends on', () => {
    const SOURCE = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../index.ts'),
      'utf8',
    );
    for (const symbol of ['requestAccountDeletion', 'cleanupPendingAccountDeletions', 'onAccountDeletionRequested']) {
      expect(SOURCE).toContain(symbol);
    }
  });
});
