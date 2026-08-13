import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeEncryptedUploadBlob,
  openEncryptedUploadBlob,
} from '../photoVaultUploadBlob';

let nextResponse: unknown;
let nextStatus: number;
let nextEvent: 'load' | 'error' | 'abort';

class FakeXmlHttpRequest {
  responseType = '';
  response: unknown = null;
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();

  send(): void {
    this.response = nextResponse;
    this.status = nextStatus;
    if (nextEvent === 'load') this.onload?.();
    if (nextEvent === 'error') this.onerror?.();
    if (nextEvent === 'abort') this.onabort?.();
  }
}

function issueOf(error: unknown): string {
  return (error as { issue?: string }).issue ?? 'none';
}

beforeEach(() => {
  nextResponse = { size: 128, type: 'application/octet-stream' };
  nextStatus = 0;
  nextEvent = 'load';
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encrypted upload Blob adapter', () => {
  it('returns the native-backed Blob without converting it to an ArrayBufferView', async () => {
    const blob = await openEncryptedUploadBlob('file:///cache/photo-vault/enc/photo.enc');

    expect(blob).toBe(nextResponse);
    expect(blob.size).toBe(128);
    expect(ArrayBuffer.isView(blob)).toBe(false);
  });

  it.each(['error', 'abort'] as const)('sanitizes an XHR %s failure', async (event) => {
    nextEvent = event;

    const error = await openEncryptedUploadBlob('file:///private/path.enc').catch(
      (caught) => caught,
    );

    expect(issueOf(error)).toBe('vaultFileReadFailed');
    expect(String(error)).not.toContain('private/path.enc');
  });

  it('rejects empty and unsuccessful file responses', async () => {
    nextResponse = { size: 0 };
    expect(
      issueOf(await openEncryptedUploadBlob('file:///empty.enc').catch((caught) => caught)),
    ).toBe('vaultFileReadFailed');

    nextResponse = { size: 128 };
    nextStatus = 404;
    expect(
      issueOf(await openEncryptedUploadBlob('file:///missing.enc').catch((caught) => caught)),
    ).toBe('vaultFileReadFailed');
  });

  it('releases a native Blob resource best-effort', () => {
    const close = vi.fn();
    closeEncryptedUploadBlob({ size: 128, close } as unknown as Blob);
    expect(close).toHaveBeenCalledOnce();

    expect(() =>
      closeEncryptedUploadBlob({
        size: 128,
        close: () => {
          throw new Error('already closed');
        },
      } as unknown as Blob),
    ).not.toThrow();
  });
});
