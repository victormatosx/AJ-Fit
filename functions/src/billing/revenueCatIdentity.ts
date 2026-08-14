import { RC_ANONYMOUS_ID_PREFIX } from './constants';
import type { RevenueCatIdentityApi } from './revenueCatApi';

const FIREBASE_UID_MAX_LENGTH = 128;

export type RevenueCatIdentityResolution =
  | {
      status: 'resolved';
      uid: string;
      source: 'direct' | 'payload' | 'revenuecat_v2';
      /** RevenueCat V2 customer profiles that proved the resolved identity. */
      customerIds: string[];
    }
  | { status: 'unresolved' }
  | { status: 'ambiguous'; candidateCount: number };

export interface RevenueCatIdentityInput {
  directAppUserId?: string | null;
  originalAppUserId?: string | null;
  aliases?: readonly string[];
  /** IDs used to find the RevenueCat customer profile(s) through API V2. */
  lookupIds?: readonly string[];
  /** TRANSFER may safely evaluate all `transferred_to` IDs as one set. */
  allowPayloadFastPath?: boolean;
}

export interface RevenueCatIdentityDependencies {
  validFirebaseUserExists(uid: string): Promise<boolean>;
  getRevenueCatIdentityApi(): RevenueCatIdentityApi;
}

function normalizeCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > FIREBASE_UID_MAX_LENGTH ||
    normalized.startsWith(RC_ANONYMOUS_ID_PREFIX)
  ) {
    return null;
  }
  return normalized;
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

async function findValidFirebaseUids(
  candidates: readonly unknown[],
  validFirebaseUserExists: (uid: string) => Promise<boolean>,
): Promise<string[]> {
  const normalized = [
    ...new Set(
      uniqueStrings(candidates)
        .map(normalizeCandidate)
        .filter((candidate): candidate is string => candidate !== null),
    ),
  ];
  const validity = await Promise.all(
    normalized.map(async (uid) => ({ uid, valid: await validFirebaseUserExists(uid) })),
  );
  return validity.filter(({ valid }) => valid).map(({ uid }) => uid);
}

/**
 * Resolves RevenueCat identity evidence to exactly one live Firebase Auth
 * user that also owns `users/{uid}`. It never selects the first alias: zero
 * valid matches is unresolved and more than one is ambiguous (fail closed).
 */
export async function resolveRevenueCatFirebaseUid(
  input: RevenueCatIdentityInput,
  dependencies: RevenueCatIdentityDependencies,
): Promise<RevenueCatIdentityResolution> {
  const directUid = normalizeCandidate(input.directAppUserId);
  if (directUid && (await dependencies.validFirebaseUserExists(directUid))) {
    return { status: 'resolved', uid: directUid, source: 'direct', customerIds: [] };
  }

  const payloadEvidence = uniqueStrings([
    input.directAppUserId,
    input.originalAppUserId,
    ...(input.aliases ?? []),
  ]);

  if (input.allowPayloadFastPath) {
    const payloadMatches = await findValidFirebaseUids(
      payloadEvidence,
      dependencies.validFirebaseUserExists,
    );
    if (payloadMatches.length === 1) {
      return { status: 'resolved', uid: payloadMatches[0], source: 'payload', customerIds: [] };
    }
    if (payloadMatches.length > 1) {
      return { status: 'ambiguous', candidateCount: payloadMatches.length };
    }
  }

  const lookupIds = uniqueStrings(input.lookupIds ?? [input.directAppUserId]);
  if (lookupIds.length === 0) return { status: 'unresolved' };

  const api = dependencies.getRevenueCatIdentityApi();
  const customerIds = new Set<string>();
  const apiAliases = new Set<string>();
  for (const lookupId of lookupIds) {
    const graph = await api.getCustomerIdentityGraph(lookupId);
    for (const customerId of graph.customerIds) customerIds.add(customerId);
    for (const alias of graph.aliases) apiAliases.add(alias);
  }

  if (customerIds.size === 0 && apiAliases.size === 0) {
    return { status: 'unresolved' };
  }

  const validMatches = await findValidFirebaseUids(
    [...payloadEvidence, ...customerIds, ...apiAliases],
    dependencies.validFirebaseUserExists,
  );
  if (validMatches.length === 0) return { status: 'unresolved' };
  if (validMatches.length > 1) {
    return { status: 'ambiguous', candidateCount: validMatches.length };
  }
  return {
    status: 'resolved',
    uid: validMatches[0],
    source: 'revenuecat_v2',
    customerIds: [...customerIds],
  };
}

/** Masks identifiers in logs without retaining a stable full-UID hash. */
export function maskRevenueCatIdentifier(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
