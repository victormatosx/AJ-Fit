/**
 * Server-side HTTP client for Apple's Sign in with Apple REST API — Fase 3.
 *
 * DOCUMENTAÇÃO OFICIAL (cross-checked during this phase; see
 * `appleClientSecret.ts`'s doc comment for the same caveat about Apple's
 * JS-rendered docs):
 *   - Token endpoint: `POST https://appleid.apple.com/auth/token`,
 *     `application/x-www-form-urlencoded` body
 *     `grant_type=authorization_code&code=<authorizationCode>&client_id=<serviceId>&client_secret=<jwt>`.
 *     Success (200) returns JSON with `access_token`, `refresh_token`,
 *     `expires_in`. An already-used or expired code fails with HTTP 400 and
 *     `{"error":"invalid_grant"}`.
 *   - Revoke endpoint: `POST https://appleid.apple.com/auth/revoke`, same
 *     auth (`client_id`/`client_secret`), body
 *     `token=<access_or_refresh_token>&token_type_hint=refresh_token|access_token`.
 *     Per RFC 7009 §2.2 (which Apple's revoke endpoint follows, confirmed by
 *     independent technical sources during this phase's research — Apple's
 *     own page could not be fetched verbatim): the endpoint responds 200 for
 *     BOTH a token that was actually revoked and a token that was already
 *     invalid — i.e. **revoke is idempotent at the HTTP layer**. This client
 *     therefore never needs a distinct "already revoked" branch: any 200 is
 *     `SUCCEEDED`.
 *
 * Mirrors `functions/src/billing/revenueCatApi.ts`'s shape: injectable
 * `fetchImpl` for tests, `AbortController`-based timeout, HTTP status
 * mapped onto the SHARED `KnownErrorCode` taxonomy
 * (`../errors.ts`) — no parallel error vocabulary.
 */

import type { KnownErrorCode } from '../errors';

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const DEFAULT_TIMEOUT_MS = 8_000;

export class AppleIdentityApiError extends Error {
  constructor(
    public readonly code: KnownErrorCode,
    public readonly httpStatus?: number,
  ) {
    super(`Apple identity API error: ${code}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    this.name = 'AppleIdentityApiError';
  }
}

export interface AppleTokenExchangeResult {
  refreshToken: string;
  accessToken: string;
  expiresInSeconds: number;
}

export interface AppleIdentityClientOptions {
  /** REST `client_id` — the Services ID, not the app bundle id. */
  clientId: string;
  /** Pre-generated ES256 JWT — see `appleClientSecret.ts`. Never generated inside this client, so the client stays independently testable from JWT signing. */
  clientSecret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  body: URLSearchParams,
  timeoutMs: number,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch {
      // Network failure OR our own abort — the remote outcome is UNKNOWN,
      // never assumed to be "did not happen" (Fase 3 §13/§32).
      throw new AppleIdentityApiError('TIMEOUT');
    }

    let json: unknown = null;
    // Apple's revoke endpoint may return an empty body on success; token
    // exchange always returns JSON. Only attempt to parse when there is a
    // body at all.
    const text = await response.text().catch(() => '');
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new AppleIdentityApiError('PROVIDER_RESPONSE_INVALID', response.status);
        }
        // A non-JSON error body from a non-200 response still carries a
        // meaningful status code; fall through to status-based mapping.
      }
    }

    return { status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function mapNonOkStatus(status: number, json: unknown): AppleIdentityApiError {
  const errorField =
    typeof json === 'object' && json !== null && 'error' in json
      ? String((json as { error: unknown }).error)
      : null;

  if (status === 400 && errorField === 'invalid_grant') {
    return new AppleIdentityApiError('PROVIDER_AUTHORIZATION_INVALID', status);
  }
  // `invalid_client` can arrive as 400 or 401 depending on the endpoint —
  // always a client_id/client_secret configuration problem, never per-attempt.
  if (status === 401 || status === 403 || errorField === 'invalid_client') {
    return new AppleIdentityApiError('MISSING_REQUIRED_CONFIGURATION', status);
  }
  if (isRetryableStatus(status)) {
    return new AppleIdentityApiError('UNAVAILABLE', status);
  }
  return new AppleIdentityApiError('PROVIDER_RESPONSE_INVALID', status);
}

export class AppleIdentityClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AppleIdentityClientOptions) {
    const clientId = options.clientId.trim();
    const clientSecret = options.clientSecret.trim();
    if (!clientId || !clientSecret) {
      throw new AppleIdentityApiError('MISSING_REQUIRED_CONFIGURATION');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Exchanges a single-use `authorizationCode` for tokens. Must be called AT
   * MOST ONCE per authorization code — see `appleTokenCrypto.ts`'s doc
   * comment for why a retry after this succeeds must never call this again
   * with the same code.
   */
  async exchangeAuthorizationCode(authorizationCode: string): Promise<AppleTokenExchangeResult> {
    const code = authorizationCode.trim();
    if (!code) throw new AppleIdentityApiError('PROVIDER_AUTHORIZATION_INVALID');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const { status, json } = await postForm(this.fetchImpl, APPLE_TOKEN_URL, body, this.timeoutMs);
    if (status < 200 || status >= 300) throw mapNonOkStatus(status, json);

    const refreshToken =
      typeof json === 'object' && json !== null && 'refresh_token' in json
        ? (json as { refresh_token: unknown }).refresh_token
        : null;
    const accessToken =
      typeof json === 'object' && json !== null && 'access_token' in json
        ? (json as { access_token: unknown }).access_token
        : null;
    const expiresIn =
      typeof json === 'object' && json !== null && 'expires_in' in json
        ? (json as { expires_in: unknown }).expires_in
        : null;

    if (
      typeof refreshToken !== 'string' ||
      !refreshToken ||
      typeof accessToken !== 'string' ||
      !accessToken ||
      typeof expiresIn !== 'number'
    ) {
      throw new AppleIdentityApiError('PROVIDER_RESPONSE_INVALID', status);
    }

    return { refreshToken, accessToken, expiresInSeconds: expiresIn };
  }

  /**
   * Revokes a token. Resolves (never throws) on ANY HTTP 200 — per RFC 7009,
   * that covers both "revoked now" and "was already invalid", so this
   * client has no separate `ALREADY_REVOKED` branch to get wrong.
   */
  async revokeToken(token: string, tokenTypeHint: 'refresh_token' | 'access_token'): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) throw new AppleIdentityApiError('PROVIDER_AUTHORIZATION_INVALID');

    const body = new URLSearchParams({
      token: trimmed,
      token_type_hint: tokenTypeHint,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const { status, json } = await postForm(this.fetchImpl, APPLE_REVOKE_URL, body, this.timeoutMs);
    if (status < 200 || status >= 300) throw mapNonOkStatus(status, json);
  }
}
