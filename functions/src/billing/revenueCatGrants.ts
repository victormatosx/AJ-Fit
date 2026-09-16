import { defineSecret } from 'firebase-functions/params';
import { logWarn } from '../lib/logger';

/**
 * Server-side client for RevenueCat's REST API v1 promotional-entitlement
 * endpoints (docs.revenuecat.com/reference/grant-a-promotional-entitlement,
 * .../revoke-promotional-entitlements — verified live against the official
 * reference on the date this module was written). This is a DIFFERENT API
 * surface than `RevenueCatV2Client` (billing/revenueCatApi.ts): v1 operates
 * directly on the App User ID (our Firebase UID) via
 * `/v1/subscribers/{app_user_id}/entitlements/{entitlement_id}/...`, with no
 * RevenueCat-internal `customer_id`/`project_id` indirection.
 *
 * RevenueCat's v2 REST API also exposes an equivalent action
 * (`POST /v2/projects/{project_id}/customers/{customer_id}/actions/grant_entitlement`
 * and `.../revoke_granted_entitlement`, confirmed to exist via the v2
 * "Customer" resource endpoint listing), but its exact request/response
 * schema could not be retrieved from the live reference during this
 * implementation (the individual reference sub-pages 404'd). Per the task's
 * instruction to never invent unverified behavior, this module deliberately
 * uses the fully-verified v1 endpoints instead. Migrating to v2 is a
 * documented open item (see the final report), not a silent choice.
 *
 * Credential: dedicated secret `REVENUECAT_ADMIN_GRANTS_API_KEY`, bound to a
 * Secret API Key created in the RevenueCat dashboard with API Version = V1
 * ("AJ Fit Administrative Grants"). This is DELIBERATELY separate from
 * `REVENUECAT_API_SECRET_KEY` (billing/revenueCatApi.ts) — that key is a V2
 * key already relied on by other backend integrations (`RevenueCatV2Client`,
 * the webhook handler's TRANSFER reconciliation); reusing it here would mix
 * two independent credentials/blast radii for no benefit, and its
 * permission scope was never verified against the v1 promotional-entitlement
 * endpoints. Only `adminGrantFreeAccess`/`adminRevokeFreeAccess`
 * (adminUsers/adminFreeAccess.ts, bound in index.ts) depend on this secret.
 */
export const REVENUECAT_ADMIN_GRANTS_API_KEY = defineSecret('REVENUECAT_ADMIN_GRANTS_API_KEY');

const REVENUECAT_V1_BASE_URL = 'https://api.revenuecat.com/v1';
const DEFAULT_TIMEOUT_MS = 8_000;
const SCOPE = 'billing:revenuecat-grants';

/**
 * "Indefinite until manually revoked" — the v1 `duration` and `start_time_ms`
 * body fields are documented as Deprecated; `end_time_ms` (an explicit Unix
 * epoch millisecond) is the current, non-deprecated way to express an
 * expiration. 100 years is used as a practical stand-in for "no expiration"
 * (RevenueCat does not offer a literal "never expires" value for promotional
 * grants) — long enough that it never lapses on its own, an administrative
 * revoke is always what actually ends this access.
 */
export const ADMINISTRATIVE_GRANT_DURATION_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export type RevenueCatGrantErrorKind =
  | 'temporary'
  | 'authentication'
  | 'not_found'
  | 'invalid_response'
  | 'configuration';

/** Sanitized error: never retains response bodies, headers, or the API key. */
export class RevenueCatGrantError extends Error {
  constructor(
    public readonly kind: RevenueCatGrantErrorKind,
    public readonly statusCode?: number,
  ) {
    super(`RevenueCat promotional-entitlement request failed (${kind})`);
    this.name = 'RevenueCatGrantError';
  }
}

export interface RevenueCatEntitlementSnapshot {
  store: string | null;
  expiresDateMs: number | null;
}

function classifyHttpFailure(status: number): RevenueCatGrantErrorKind {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 423 || status === 429 || status >= 500) return 'temporary';
  return 'configuration';
}

/**
 * Best-effort, defensive extraction of the granted entitlement's resulting
 * `store`/`expires_date` from the v1 Subscriber envelope RevenueCat returns
 * on both grant (201) and revoke (200). Never throws on an unexpected shape
 * — the operation itself already succeeded per the HTTP status; this is only
 * used to enrich the audit trail, never to decide success/failure.
 */
function extractEntitlementSnapshot(
  body: unknown,
  entitlementId: string,
): RevenueCatEntitlementSnapshot {
  try {
    const subscriber = (body as Record<string, unknown> | undefined)?.subscriber as
      | Record<string, unknown>
      | undefined;
    const entitlements = subscriber?.entitlements as Record<string, unknown> | undefined;
    const entitlement = entitlements?.[entitlementId] as Record<string, unknown> | undefined;
    const expiresDate = entitlement?.expires_date;
    const expiresDateMs =
      typeof expiresDate === 'string' && expiresDate.length > 0
        ? Date.parse(expiresDate)
        : null;
    const store = typeof entitlement?.store === 'string' ? entitlement.store : null;
    return {
      store,
      expiresDateMs: Number.isFinite(expiresDateMs) ? expiresDateMs : null,
    };
  } catch {
    return { store: null, expiresDateMs: null };
  }
}

async function postV1<T>(path: string, body: T | undefined): Promise<unknown> {
  const apiKey = REVENUECAT_ADMIN_GRANTS_API_KEY.value().trim();
  if (!apiKey) throw new RevenueCatGrantError('configuration');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${REVENUECAT_V1_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new RevenueCatGrantError('temporary');
    }

    if (!response.ok) {
      const kind = classifyHttpFailure(response.status);
      logWarn(SCOPE, 'revenuecat_v1_request_failed', { httpStatus: response.status, kind });
      throw new RevenueCatGrantError(kind, response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new RevenueCatGrantError('invalid_response', response.status);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Grants (or, per RevenueCat's own de-duplication window, re-confirms) a
 * promotional entitlement for `appUserId` (the Firebase UID — RevenueCat's
 * App User ID for this project). Idempotency against OUR retries is handled
 * by the caller (adminUsers/adminFreeAccess.ts) via the Firestore lock/state
 * machine — this function makes exactly one HTTP call per invocation.
 */
export async function grantPromotionalEntitlement(
  appUserId: string,
  entitlementId: string,
  nowMs: number = Date.now(),
): Promise<RevenueCatEntitlementSnapshot> {
  const path = `/subscribers/${encodeURIComponent(appUserId)}/entitlements/${encodeURIComponent(entitlementId)}/promotional`;
  const body = await postV1(path, { end_time_ms: nowMs + ADMINISTRATIVE_GRANT_DURATION_MS });
  return extractEntitlementSnapshot(body, entitlementId);
}

/**
 * Revokes ONLY promotional grants of `entitlementId` for `appUserId`. Per
 * RevenueCat's documented endpoint semantics (`revoke_promotionals` is
 * scoped to promotional-sourced access; a store subscription or active
 * trial on the same entitlement is a separate source the endpoint's name
 * and the grant endpoint's own "does not override or defer a store
 * transaction" description both point to as unaffected) — this has not been
 * independently verified against a live sandbox customer with both a
 * promotional grant AND a paid subscription active simultaneously; see the
 * final report's documented limitation.
 */
export async function revokePromotionalEntitlement(
  appUserId: string,
  entitlementId: string,
): Promise<RevenueCatEntitlementSnapshot> {
  const path = `/subscribers/${encodeURIComponent(appUserId)}/entitlements/${encodeURIComponent(entitlementId)}/revoke_promotionals`;
  const body = await postV1(path, undefined);
  return extractEntitlementSnapshot(body, entitlementId);
}
