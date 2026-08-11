import { describe, expect, it, vi } from 'vitest';
import type { RevenueCatCustomerIdentityGraph, RevenueCatIdentityApi } from '../revenueCatApi';
import { resolveRevenueCatFirebaseUid } from '../revenueCatIdentity';

function dependencies(
  validUids: readonly string[],
  graph: RevenueCatCustomerIdentityGraph = { customerIds: [], aliases: [] },
) {
  const validSet = new Set(validUids);
  const api: RevenueCatIdentityApi = {
    getCustomerIdentityGraph: vi.fn().mockResolvedValue(graph),
  };
  return {
    api,
    validFirebaseUserExists: vi.fn(async (uid: string) => validSet.has(uid)),
    getRevenueCatIdentityApi: vi.fn(() => api),
  };
}

describe('resolveRevenueCatFirebaseUid', () => {
  it('A: uses the direct valid Firebase uid without constructing the V2 client', async () => {
    const deps = dependencies(['firebase-current']);

    const result = await resolveRevenueCatFirebaseUid(
      { directAppUserId: 'firebase-current' },
      deps,
    );

    expect(result).toEqual({
      status: 'resolved',
      uid: 'firebase-current',
      source: 'direct',
      customerIds: [],
    });
    expect(deps.getRevenueCatIdentityApi).not.toHaveBeenCalled();
  });

  it('B/K: resolves a deleted historical id to exactly one live alias proved by V2', async () => {
    const deps = dependencies(['firebase-current'], {
      customerIds: ['rc-customer-internal'],
      aliases: ['$RCAnonymousID:technical', 'firebase-historical', 'firebase-current'],
    });

    const result = await resolveRevenueCatFirebaseUid(
      {
        directAppUserId: 'firebase-historical',
        originalAppUserId: '$RCAnonymousID:technical',
        aliases: ['firebase-historical'],
      },
      deps,
    );

    expect(result).toEqual({
      status: 'resolved',
      uid: 'firebase-current',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-internal'],
    });
    expect(deps.api.getCustomerIdentityGraph).toHaveBeenCalledWith('firebase-historical');
  });

  it('C: returns unresolved when the V2 graph contains no valid Firebase candidate', async () => {
    const deps = dependencies([], {
      customerIds: ['rc-customer-internal'],
      aliases: ['firebase-deleted'],
    });

    const result = await resolveRevenueCatFirebaseUid(
      { directAppUserId: 'firebase-historical' },
      deps,
    );

    expect(result).toEqual({ status: 'unresolved' });
  });

  it('D/L: returns ambiguous instead of choosing between two valid aliases', async () => {
    const deps = dependencies(['firebase-one', 'firebase-two'], {
      customerIds: ['rc-customer-internal'],
      aliases: ['firebase-one', 'firebase-two'],
    });

    const result = await resolveRevenueCatFirebaseUid(
      { directAppUserId: 'firebase-historical' },
      deps,
    );

    expect(result).toEqual({ status: 'ambiguous', candidateCount: 2 });
  });

  it('considers original_app_user_id only after the V2 customer relationship is found', async () => {
    const deps = dependencies(['firebase-original'], {
      customerIds: ['rc-customer-internal'],
      aliases: ['firebase-historical'],
    });

    const result = await resolveRevenueCatFirebaseUid(
      {
        directAppUserId: 'firebase-historical',
        originalAppUserId: 'firebase-original',
      },
      deps,
    );

    expect(result).toEqual({
      status: 'resolved',
      uid: 'firebase-original',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-internal'],
    });
  });

  it('E: never submits a RevenueCat anonymous alias as a Firebase uid candidate', async () => {
    const deps = dependencies(['$RCAnonymousID:must-not-win'], {
      customerIds: [],
      aliases: ['$RCAnonymousID:must-not-win'],
    });

    const result = await resolveRevenueCatFirebaseUid(
      { directAppUserId: '$RCAnonymousID:must-not-win' },
      deps,
    );

    expect(result).toEqual({ status: 'unresolved' });
    expect(deps.validFirebaseUserExists).not.toHaveBeenCalledWith('$RCAnonymousID:must-not-win');
  });

  it('N: resolves exactly one valid transferred_to candidate from the signed payload', async () => {
    const deps = dependencies(['firebase-destination']);

    const result = await resolveRevenueCatFirebaseUid(
      {
        aliases: ['$RCAnonymousID:old', 'firebase-destination'],
        lookupIds: ['$RCAnonymousID:old', 'firebase-destination'],
        allowPayloadFastPath: true,
      },
      deps,
    );

    expect(result).toEqual({
      status: 'resolved',
      uid: 'firebase-destination',
      source: 'payload',
      customerIds: [],
    });
    expect(deps.getRevenueCatIdentityApi).not.toHaveBeenCalled();
  });

  it('O: fails closed when transferred_to contains two valid Firebase users', async () => {
    const deps = dependencies(['firebase-one', 'firebase-two']);

    const result = await resolveRevenueCatFirebaseUid(
      {
        aliases: ['firebase-one', 'firebase-two'],
        lookupIds: ['firebase-one', 'firebase-two'],
        allowPayloadFastPath: true,
      },
      deps,
    );

    expect(result).toEqual({ status: 'ambiguous', candidateCount: 2 });
    expect(deps.getRevenueCatIdentityApi).not.toHaveBeenCalled();
  });
});
