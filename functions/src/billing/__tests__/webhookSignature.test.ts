import * as crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { isValidWebhookSignature } from '../revenuecat';

const SECRET = 'test-signing-secret';

function sign(timestampSeconds: number, body: string, secret = SECRET): string {
  const signedPayload = Buffer.concat([Buffer.from(`${timestampSeconds}.`, 'utf8'), Buffer.from(body)]);
  const hex = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestampSeconds},v1=${hex}`;
}

describe('isValidWebhookSignature', () => {
  const body = JSON.stringify({ api_version: '1.0', event: { id: 'evt_1', type: 'RENEWAL' } });
  const rawBody = Buffer.from(body);

  it('accepts a correctly signed, fresh request', () => {
    const header = sign(Math.floor(Date.now() / 1000), body);
    expect(isValidWebhookSignature(rawBody, header, SECRET)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const header = sign(Math.floor(Date.now() / 1000), body, 'wrong-secret');
    expect(isValidWebhookSignature(rawBody, header, SECRET)).toBe(false);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const header = sign(Math.floor(Date.now() / 1000), body);
    const tamperedBody = Buffer.from(body.replace('RENEWAL', 'CANCELLATION'));
    expect(isValidWebhookSignature(tamperedBody, header, SECRET)).toBe(false);
  });

  it('rejects a stale timestamp (older than the 5-minute tolerance)', () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 10 * 60;
    const header = sign(staleTimestamp, body);
    expect(isValidWebhookSignature(rawBody, header, SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isValidWebhookSignature(rawBody, undefined, SECRET)).toBe(false);
  });

  it('rejects a malformed header (missing v1)', () => {
    expect(isValidWebhookSignature(rawBody, `t=${Math.floor(Date.now() / 1000)}`, SECRET)).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    const header = sign(Math.floor(Date.now() / 1000), body);
    expect(isValidWebhookSignature(rawBody, header, '')).toBe(false);
  });
});
