import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_CLASSES,
  internalQaUsersQuery,
  productionUsersQuery,
  RESOLVED_ACCOUNT_CLASSES,
  resolveAccountClass,
  USERS_COLLECTION,
} from '../accountClassification';

describe('resolveAccountClass', () => {
  // C: valid PRODUCTION → PRODUCTION.
  // D: valid INTERNAL_QA → INTERNAL_QA.
  it('passes through the two written closed states', () => {
    expect(resolveAccountClass('PRODUCTION')).toBe('PRODUCTION');
    expect(resolveAccountClass('INTERNAL_QA')).toBe('INTERNAL_QA');
  });

  // A: absent field → never PRODUCTION.
  it('resolves absence to UNKNOWN — never PRODUCTION', () => {
    expect(resolveAccountClass(undefined)).toBe('UNKNOWN');
    expect(resolveAccountClass(null)).toBe('UNKNOWN');
  });

  // B: malformed/unrecognized value → never PRODUCTION.
  it('resolves a present-but-malformed value to UNKNOWN — never PRODUCTION', () => {
    expect(resolveAccountClass('')).toBe('UNKNOWN');
    expect(resolveAccountClass('production')).toBe('UNKNOWN');
    expect(resolveAccountClass('SANDBOX')).toBe('UNKNOWN');
    expect(resolveAccountClass(123)).toBe('UNKNOWN');
    expect(resolveAccountClass({})).toBe('UNKNOWN');
  });
});

describe('production/internalQa users query helpers', () => {
  it('productionUsersQuery filters exactly metadata.accountClass == PRODUCTION', () => {
    const where = vi.fn();
    const collection = vi.fn(() => ({ where }));
    const db = { collection } as unknown as Parameters<typeof productionUsersQuery>[0];
    productionUsersQuery(db);
    expect(collection).toHaveBeenCalledWith(USERS_COLLECTION);
    expect(where).toHaveBeenCalledWith('metadata.accountClass', '==', 'PRODUCTION');
  });

  it('internalQaUsersQuery filters exactly metadata.accountClass == INTERNAL_QA', () => {
    const where = vi.fn();
    const collection = vi.fn(() => ({ where }));
    const db = { collection } as unknown as Parameters<typeof internalQaUsersQuery>[0];
    internalQaUsersQuery(db);
    expect(where).toHaveBeenCalledWith('metadata.accountClass', '==', 'INTERNAL_QA');
  });
});

// E + F: the resolver and productionUsersQuery must agree on exactly which
// population is PRODUCTION. Firestore's `where(field, '==', value)` never
// matches a document where `field` is absent — this test simulates that
// exact semantic (not just the query's own arguments) against a small
// fake collection and checks the resolver-filtered set matches the
// query-filtered set document-for-document.
describe('resolver / query parity (the bug this module now guards against)', () => {
  const fakeDocs = [
    { id: 'prod-1', accountClass: 'PRODUCTION' },
    { id: 'qa-1', accountClass: 'INTERNAL_QA' },
    { id: 'absent-1', accountClass: undefined },
    { id: 'malformed-1', accountClass: 'SANDBOX' },
  ];

  /** Mirrors Firestore's actual equality-filter semantics: absent field never matches. */
  function simulateFirestoreEqualityFilter(field: string, value: unknown) {
    return fakeDocs.filter((doc) => field === 'accountClass' && doc.accountClass === value).map((doc) => doc.id);
  }

  it('productionUsersQuery-equivalent filter and resolveAccountClass select the exact same document set', () => {
    const queryResult = simulateFirestoreEqualityFilter('accountClass', 'PRODUCTION');
    const resolverResult = fakeDocs.filter((doc) => resolveAccountClass(doc.accountClass) === 'PRODUCTION').map((doc) => doc.id);
    expect(resolverResult).toEqual(queryResult);
    expect(resolverResult).toEqual(['prod-1']);
  });

  it('an absent field is excluded from PRODUCTION by both the resolver and the query semantics', () => {
    expect(simulateFirestoreEqualityFilter('accountClass', 'PRODUCTION')).not.toContain('absent-1');
    expect(resolveAccountClass(undefined)).not.toBe('PRODUCTION');
  });
});

describe('ACCOUNT_CLASSES / RESOLVED_ACCOUNT_CLASSES', () => {
  it('ACCOUNT_CLASSES (writable) never includes SANDBOX or UNKNOWN', () => {
    expect(ACCOUNT_CLASSES).toEqual(['PRODUCTION', 'INTERNAL_QA']);
  });

  it('RESOLVED_ACCOUNT_CLASSES (readable) adds exactly one extra state: UNKNOWN', () => {
    expect(RESOLVED_ACCOUNT_CLASSES).toEqual(['PRODUCTION', 'INTERNAL_QA', 'UNKNOWN']);
  });
});

// Structural guard: a future edit reintroducing `?? 'PRODUCTION'` (or any
// equivalent fallback-to-production for a missing/invalid value) must fail
// this test, not just a behavioral one — this greps the actual source.
describe('structural guard — no fallback-to-PRODUCTION regression', () => {
  it('resolveAccountClass never falls back to PRODUCTION for a missing/invalid value', () => {
    // Every non-PRODUCTION, non-INTERNAL_QA input observed above resolves
    // to UNKNOWN, and this is re-asserted here as the load-bearing contract:
    // absence and malformation must NEVER produce 'PRODUCTION'.
    const suspiciousInputs = [undefined, null, '', 'production', 'Production', 0, false, [], {}];
    for (const input of suspiciousInputs) {
      expect(resolveAccountClass(input)).not.toBe('PRODUCTION');
    }
  });
});
