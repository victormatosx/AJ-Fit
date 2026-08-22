/**
 * Wire contract for the future `requestAccountDeletion` callable — Fase 1
 * report §12/§13. NOT registered as a Cloud Function in this phase (see the
 * Fase 1 report for why: this phase defines the contract only, it does not
 * stand up a callable endpoint or a worker that would make the contract
 * reachable from a real client).
 *
 * Boundary this contract encodes:
 *   - `request.auth.uid` (Firebase-verified ID token, populated by the
 *     Callable Functions runtime before the handler runs — same pattern as
 *     `functions/src/lib/auth.ts`'s `requireAuth`/`requireRecentAuth`) is
 *     the ONLY source of the uid being deleted. `request.data` carries no
 *     uid field — not "a uid field that gets ignored", no field at all, so
 *     there is nothing for a malicious payload to even attempt to override.
 *   - `request.auth.token.auth_time` (also Firebase-verified, not
 *     client-supplied) is what `requireRecentAuth` checks. This protects
 *     ONLY the creation of a new deletion record — once `REQUESTED` exists,
 *     every subsequent worker attempt authenticates as the BACKEND (Admin
 *     SDK), never as the end user, and must not re-demand recent-auth or any
 *     other end-user interaction. See Fase 1 report §12/§13 for why this
 *     split is deliberate: the user cannot be required to keep the app open
 *     or keep re-authenticating for a workflow that must survive both.
 *   - The policy applied to the new record is ALWAYS
 *     `policy.ts`'s `currentPolicy()` — never anything from `request.data`.
 *     `rejectClientSuppliedIdentityOrPolicy` below is defense-in-depth for
 *     this: even though the typed request shape has no such field, a real
 *     callable receives untyped JSON at the wire boundary, and this function
 *     is what actually refuses a payload that tries to sneak one in.
 */

/**
 * Every value the workflow needs (uid, policy, workflowVersion) is derived
 * server-side — see the module doc comment above — with exactly ONE
 * deliberate exception, added by the Fase 3/5 correction (see
 * docs/25_exclusao_de_conta_arquitetura.md's "Correção Fases 3/5" section):
 * `appleAuthorizationCode`.
 *
 * This is NOT an identity or policy field — it carries no uid, no claim
 * about who the caller is, no assertion about what already happened. It is
 * single-use, short-lived (~5 minutes) material `handleRequestAccountDeletion`
 * exchanges with Apple's OWN servers, entirely server-side, before ever
 * trusting anything it implies. Whether the caller's Firebase Auth user
 * actually has `apple.com` linked is *never* taken from this field or any
 * other client input — it comes exclusively from
 * `admin.auth().getUser(uid).providerData`, read fresh inside the handler
 * (Fase 4's existing server-side snapshot). Supplying this field for an
 * account that turns out not to have Apple linked has no effect at all
 * (never read); NOT supplying it for an account that DOES have Apple linked
 * is rejected — see `handleRequestAccountDeletion`'s doc comment for why.
 */
export interface RequestAccountDeletionRequestData {
  appleAuthorizationCode?: string;
}

/** Generous ceiling for an Apple authorization code — rejects absurd input before any exchange attempt. */
const MAX_APPLE_AUTHORIZATION_CODE_LENGTH = 2048;

export interface RequestAccountDeletionResponseData {
  deletionId: string;
  status: 'REQUESTED' | 'PROCESSING' | 'RETRY_SCHEDULED' | 'COMPLETED' | 'FAILED_TERMINAL';
  /**
   * `true` for both a brand-new request and an idempotent reuse of an
   * already-active/completed one — the caller only needs to know "this uid
   * has an accepted deletion", not which case occurred.
   */
  accepted: boolean;
  /**
   * `true` when this call reused an already-existing operation instead of
   * creating a new one (Fase 4 §15/§46/§57) — covers the duplicate-request,
   * lost-response-retry, and already-`COMPLETED` cases alike. `false` only
   * for the very first call that actually created the record.
   */
  deduplicated: boolean;
  /**
   * `true` when `status` is `FAILED_TERMINAL` — the existing operation
   * needs administrative reconciliation before any further automated
   * progress is possible (Fase 4 §16: never silently spawn a second
   * operation in this case). The client should surface this as "something
   * went wrong, contact support", never retry on its own.
   */
  requiresReconciliation: boolean;
}

/** Fields a client payload must never be allowed to set, even though the typed contract already has none of them. */
const FORBIDDEN_CLIENT_FIELDS = [
  'uid',
  'policy',
  'retentionPolicy',
  'workflowVersion',
  'requiredSteps',
  'deletionId',
] as const;

export class ForbiddenClientFieldError extends Error {
  constructor(public readonly field: string) {
    super(`Client-supplied field "${field}" is not permitted on an account deletion request`);
    this.name = 'ForbiddenClientFieldError';
  }
}

/**
 * Defense-in-depth runtime check against the untyped JSON a real callable
 * actually receives (`request.data` is `any` at the Firebase Functions
 * layer, regardless of what `RequestAccountDeletionRequestData` declares).
 * Throws on the first forbidden key found; a caller maps this to
 * `HttpsError('invalid-argument', ...)` in the future callable (Fase 2+).
 */
export function rejectClientSuppliedIdentityOrPolicy(payload: unknown): void {
  if (payload === null || typeof payload !== 'object') return;
  const record = payload as Record<string, unknown>;
  for (const key of FORBIDDEN_CLIENT_FIELDS) {
    if (key in record) throw new ForbiddenClientFieldError(key);
  }
}

export class InvalidRequestPayloadError extends Error {
  constructor(reason: string) {
    super(`Invalid requestAccountDeletion payload: ${reason}`);
    this.name = 'InvalidRequestPayloadError';
  }
}

const ALLOWED_REQUEST_KEYS = ['appleAuthorizationCode'] as const;

/**
 * The FULL, closed validator for `requestAccountDeletion` specifically
 * (Fase 4 §7/§59, extended by the Fase 3/5 correction) — stricter than
 * `rejectClientSuppliedIdentityOrPolicy`'s denylist: this callable's entire
 * contract is "no properties, except optionally `appleAuthorizationCode`"
 * (`RequestAccountDeletionRequestData`), so ANY other key at all is
 * rejected, not just the ones known to be dangerous today. A denylist only
 * catches fields someone thought to name; a closed allowlist has no such
 * gap. `null`/`undefined` (what the Callable Functions SDK sends for
 * `requestAccountDeletion()`/`requestAccountDeletion(undefined)`) and `{}`
 * both remain accepted shapes — `appleAuthorizationCode` is optional at
 * this layer; `handleRequestAccountDeletion` is what actually requires it
 * conditionally, once it knows (server-side) whether Apple is linked.
 */
export function validateRequestAccountDeletionPayload(payload: unknown): void {
  if (payload === null || payload === undefined) return;
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new InvalidRequestPayloadError('payload must be an object or omitted');
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  const unexpected = keys.filter((key) => !(ALLOWED_REQUEST_KEYS as readonly string[]).includes(key));
  if (unexpected.length > 0) {
    throw new InvalidRequestPayloadError(`unexpected field(s): ${unexpected.join(', ')}`);
  }
  if ('appleAuthorizationCode' in record) {
    const value = record.appleAuthorizationCode;
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.length > MAX_APPLE_AUTHORIZATION_CODE_LENGTH
    ) {
      throw new InvalidRequestPayloadError('appleAuthorizationCode must be a non-empty bounded string');
    }
  }
}
