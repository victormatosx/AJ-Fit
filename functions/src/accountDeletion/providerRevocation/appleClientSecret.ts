/**
 * Apple `client_secret` generation for the Sign in with Apple REST API
 * (`/auth/token`, `/auth/revoke`) — Fase 3.
 *
 * DOCUMENTAÇÃO OFICIAL (Apple Developer, "Generate and validate tokens" /
 * "Revoke tokens", confirmed via web research during this phase — Apple's
 * docs are JS-rendered and could not be fetched verbatim, so this is
 * cross-checked against multiple independent technical sources plus this
 * module's own generated-keypair tests, not copy-pasted from a single page):
 *   - Apple does not accept a static client secret string. It requires a JWT,
 *     signed with the ES256 algorithm (ECDSA over the P-256 curve, SHA-256
 *     digest), acting as the client secret on every `/auth/token` and
 *     `/auth/revoke` call.
 *   - JWT header: `alg: "ES256"`, `kid: <10-char Key ID>` (the id of the
 *     private key generated in the Apple Developer portal for Sign in with
 *     Apple — downloadable only once).
 *   - JWT payload: `iss` = 10-character Team ID, `iat` = issued-at,
 *     `exp` = expiration, `aud` = the fixed string
 *     `"https://appleid.apple.com"`, `sub` = the Services ID (the `client_id`
 *     used for the REST calls — NOT the app's bundle id).
 *   - `exp - iat` must not exceed 15,777,000 seconds (6 months) — Apple
 *     rejects a longer-lived secret outright.
 *
 * This module never reads or embeds Apple's actual private key — it is a
 * PURE function of whatever key material is handed to it. The real key
 * material is a backend secret provisioned later (Fase 3 report §"secrets
 * necessários") and is never present in this repository, in `.env`, or in
 * any `EXPO_PUBLIC_*` variable.
 */

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

export const APPLE_CLIENT_SECRET_MAX_TTL_SECONDS = 15_777_000; // Apple's documented 6-month ceiling
/**
 * Deliberately much shorter than the 6-month ceiling: this secret is
 * generated FRESH for each token-exchange/revoke attempt (cheap — one
 * signature operation, no caching/expiry-tracking state to get wrong) rather
 * than cached for its full allowed lifetime. A short TTL bounds the damage
 * of a secret captured in a log/crash dump to minutes, not months, at
 * negligible cost.
 */
export const APPLE_CLIENT_SECRET_DEFAULT_TTL_SECONDS = 5 * 60;

export class AppleClientSecretConfigurationError extends Error {
  constructor(reason: string) {
    super(`Apple client secret configuration invalid: ${reason}`);
    this.name = 'AppleClientSecretConfigurationError';
  }
}

export interface AppleClientSecretConfig {
  /** 10-character Apple Developer Team ID. Not secret by itself, but kept alongside the key for cohesion. */
  teamId: string;
  /** 10-character identifier of the ES256 private key registered for Sign in with Apple. */
  keyId: string;
  /** The Services ID (`client_id`) these REST calls authenticate as — distinct from the app's bundle id. */
  clientId: string;
  /** PEM-encoded EC (P-256) private key (the `.p8` file Apple issues once). BACKEND-ONLY — see module doc comment. */
  privateKeyPem: string;
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

/**
 * Signs one ES256 JWT to use as `client_secret`. Uses Node's built-in
 * `crypto.sign` with `dsaEncoding: 'ieee-p1363'` — the option that makes
 * Node emit the raw `R || S` signature JOSE/JWT requires directly, instead
 * of the DER encoding `crypto.sign` produces by default (which would need
 * manual ASN.1 parsing to convert). No third-party JWT library dependency
 * was added for this — the format is a handful of fields signed once.
 */
export function generateAppleClientSecret(
  config: AppleClientSecretConfig,
  options: { nowSeconds?: number; ttlSeconds?: number } = {},
): string {
  const teamId = config.teamId.trim();
  const keyId = config.keyId.trim();
  const clientId = config.clientId.trim();
  if (!teamId || !keyId || !clientId || !config.privateKeyPem.trim()) {
    throw new AppleClientSecretConfigurationError('teamId/keyId/clientId/privateKeyPem must be non-empty');
  }

  const ttlSeconds = options.ttlSeconds ?? APPLE_CLIENT_SECRET_DEFAULT_TTL_SECONDS;
  if (ttlSeconds <= 0 || ttlSeconds > APPLE_CLIENT_SECRET_MAX_TTL_SECONDS) {
    throw new AppleClientSecretConfigurationError(
      `ttlSeconds must be in (0, ${APPLE_CLIENT_SECRET_MAX_TTL_SECONDS}]`,
    );
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(config.privateKeyPem);
  } catch {
    // The key material itself must never appear in an error message.
    throw new AppleClientSecretConfigurationError('privateKeyPem is not a valid PEM private key');
  }
  if (privateKey.asymmetricKeyType !== 'ec') {
    throw new AppleClientSecretConfigurationError('privateKeyPem must be an EC (P-256) key');
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const header = { alg: 'ES256', kid: keyId };
  const payload = {
    iss: teamId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  };

  const signingInput =
    `${base64url(Buffer.from(JSON.stringify(header)))}.` +
    `${base64url(Buffer.from(JSON.stringify(payload)))}`;

  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64url(signature)}`;
}
