import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  APPLE_CLIENT_SECRET_MAX_TTL_SECONDS,
  AppleClientSecretConfigurationError,
  generateAppleClientSecret,
} from '../appleClientSecret';

// A locally-generated EC P-256 test keypair — NEVER Apple's real key. This is
// exactly what Fase 3 §34 asked for: "client secret generation testável sem
// expor private key" — the private key here is disposable, generated fresh
// by the test, and proves the JWT format/signature logic is correct without
// any real secret ever existing in this repository.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('generateAppleClientSecret', () => {
  const config = {
    teamId: 'TEAMID1234',
    keyId: 'KEYID56789',
    clientId: 'com.ajfit.service',
    privateKeyPem: PRIVATE_KEY_PEM,
  };

  it('produces a three-part JWT with the exact header/payload Apple requires', () => {
    const jwt = generateAppleClientSecret(config, { nowSeconds: 1_700_000_000, ttlSeconds: 300 });
    const [headerB64, payloadB64] = jwt.split('.');

    expect(decodeSegment(headerB64)).toEqual({ alg: 'ES256', kid: 'KEYID56789' });
    expect(decodeSegment(payloadB64)).toEqual({
      iss: 'TEAMID1234',
      iat: 1_700_000_000,
      exp: 1_700_000_300,
      aud: 'https://appleid.apple.com',
      sub: 'com.ajfit.service',
    });
  });

  it('produces a signature that verifies against the matching public key (ES256/IEEE-P1363)', () => {
    const jwt = generateAppleClientSecret(config, { nowSeconds: 1_700_000_000, ttlSeconds: 300 });
    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(signatureB64, 'base64url');

    const isValid = cryptoVerify(
      'sha256',
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    expect(isValid).toBe(true);
  });

  it('a signature does NOT verify against a different keypair (sanity check the test itself is meaningful)', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwt = generateAppleClientSecret(config, { nowSeconds: 1_700_000_000, ttlSeconds: 300 });
    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    const isValid = cryptoVerify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: other.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64, 'base64url'),
    );
    expect(isValid).toBe(false);
  });

  it('defaults to a short TTL, well under the 6-month ceiling', () => {
    const jwt = generateAppleClientSecret(config, { nowSeconds: 1_000 });
    const payload = decodeSegment(jwt.split('.')[1]);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(600);
  });

  it('rejects a ttlSeconds beyond Apple’s documented 6-month ceiling', () => {
    expect(() =>
      generateAppleClientSecret(config, { ttlSeconds: APPLE_CLIENT_SECRET_MAX_TTL_SECONDS + 1 }),
    ).toThrow(AppleClientSecretConfigurationError);
  });

  it('accepts a ttlSeconds exactly at the ceiling', () => {
    expect(() =>
      generateAppleClientSecret(config, { ttlSeconds: APPLE_CLIENT_SECRET_MAX_TTL_SECONDS }),
    ).not.toThrow();
  });

  it('rejects a non-positive ttlSeconds', () => {
    expect(() => generateAppleClientSecret(config, { ttlSeconds: 0 })).toThrow(
      AppleClientSecretConfigurationError,
    );
    expect(() => generateAppleClientSecret(config, { ttlSeconds: -1 })).toThrow(
      AppleClientSecretConfigurationError,
    );
  });

  it('rejects missing teamId/keyId/clientId', () => {
    expect(() => generateAppleClientSecret({ ...config, teamId: '' })).toThrow(
      AppleClientSecretConfigurationError,
    );
    expect(() => generateAppleClientSecret({ ...config, keyId: '  ' })).toThrow(
      AppleClientSecretConfigurationError,
    );
    expect(() => generateAppleClientSecret({ ...config, clientId: '' })).toThrow(
      AppleClientSecretConfigurationError,
    );
  });

  it('rejects a malformed private key without ever including it in the error', () => {
    let caught: unknown;
    try {
      generateAppleClientSecret({ ...config, privateKeyPem: 'not-a-real-key' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppleClientSecretConfigurationError);
    expect(String(caught)).not.toContain('not-a-real-key');
  });

  it('rejects a non-EC private key (e.g. RSA)', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => generateAppleClientSecret({ ...config, privateKeyPem: rsaPem })).toThrow(
      AppleClientSecretConfigurationError,
    );
  });
});
