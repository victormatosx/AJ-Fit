import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppleClientSecretConfigurationError } from '../appleClientSecret';
import { createAppleIdentityClient, resolveAppleClientId } from '../appleIdentityConfig';

/**
 * Fase 15 incident fix: proves `createAppleIdentityClient`/`resolveAppleClientId`
 * resolve DISTINCT, never-mixed identifiers for the native (Bundle ID) vs.
 * services (Services ID) Apple flows — see `appleIdentityConfig.ts`'s doc
 * comment for the full incident. `firebase-functions/params`'s
 * `SecretParam.value()` reads straight from `process.env`, so these tests
 * set/restore env vars directly rather than mocking the module.
 */

const ENV_KEYS = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_NATIVE_CLIENT_ID', 'APPLE_SERVICES_CLIENT_ID', 'APPLE_PRIVATE_KEY'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
}

function generateTestPrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey as unknown as string;
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
  process.env.APPLE_TEAM_ID = 'TEAMID1234';
  process.env.APPLE_KEY_ID = 'KEYID12345';
  process.env.APPLE_NATIVE_CLIENT_ID = 'com.ajfit.app';
  process.env.APPLE_SERVICES_CLIENT_ID = 'com.ajfit.app.service';
  process.env.APPLE_PRIVATE_KEY = generateTestPrivateKeyPem();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

describe('resolveAppleClientId', () => {
  it("'native' resolves to the Bundle ID — never the Services ID", () => {
    expect(resolveAppleClientId('native')).toBe('com.ajfit.app');
  });

  it("'services' resolves to the Services ID — never the Bundle ID (abstraction still supports both, distinctly)", () => {
    expect(resolveAppleClientId('services')).toBe('com.ajfit.app.service');
  });
});

describe('createAppleIdentityClient — native flow (the only flow this app uses today)', () => {
  it('the client_secret JWT sub is the Bundle ID, matching what a native authorizationCode was minted for', () => {
    const client = createAppleIdentityClient('native');
    const jwt = (client as unknown as { clientSecret: string }).clientSecret;
    const payload = decodeJwtPayload(jwt);
    expect(payload.sub).toBe('com.ajfit.app');
    expect(payload.sub).not.toBe('com.ajfit.app.service');
    expect(payload.iss).toBe('TEAMID1234');
    expect(payload.aud).toBe('https://appleid.apple.com');
  });

  it('the client_id used for /auth/token and /auth/revoke is the Bundle ID', () => {
    const client = createAppleIdentityClient('native');
    expect((client as unknown as { clientId: string }).clientId).toBe('com.ajfit.app');
  });

  it('defaults to native when no source is given — every current call site passes it explicitly anyway', () => {
    const client = createAppleIdentityClient();
    expect((client as unknown as { clientId: string }).clientId).toBe('com.ajfit.app');
  });

  it('missing APPLE_NATIVE_CLIENT_ID: throws a clear configuration error, never silently proceeds with an empty client_id', () => {
    delete process.env.APPLE_NATIVE_CLIENT_ID;
    expect(() => createAppleIdentityClient('native')).toThrow(AppleClientSecretConfigurationError);
  });
});

describe('createAppleIdentityClient — services flow (unused today, kept for a future web Sign in with Apple flow)', () => {
  it('the client_secret JWT sub is the Services ID, never the Bundle ID', () => {
    const client = createAppleIdentityClient('services');
    const jwt = (client as unknown as { clientSecret: string }).clientSecret;
    const payload = decodeJwtPayload(jwt);
    expect(payload.sub).toBe('com.ajfit.app.service');
    expect(payload.sub).not.toBe('com.ajfit.app');
  });

  it('the client_id used for REST calls is the Services ID', () => {
    const client = createAppleIdentityClient('services');
    expect((client as unknown as { clientId: string }).clientId).toBe('com.ajfit.app.service');
  });
});
