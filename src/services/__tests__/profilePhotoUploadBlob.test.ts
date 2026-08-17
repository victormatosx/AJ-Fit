import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeProfilePhotoUploadBlob,
  openProfilePhotoUploadBlob,
} from '../profilePhotoUploadBlob';

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

beforeEach(() => {
  nextResponse = { size: 256, type: 'image/jpeg' };
  nextStatus = 0;
  nextEvent = 'load';
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('profile-photo native Blob adapter', () => {
  it('preserves a native-backed Blob without creating an ArrayBufferView', async () => {
    const blob = await openProfilePhotoUploadBlob('file:///cache/edited.jpg');

    expect(blob).toBe(nextResponse);
    expect(ArrayBuffer.isView(blob)).toBe(false);
  });

  it.each(['error', 'abort'] as const)('maps XHR %s to a closed read error', async (event) => {
    nextEvent = event;

    const error = await openProfilePhotoUploadBlob('file:///private/profile.jpg').catch(
      (caught) => caught,
    );

    expect(error).toEqual(expect.objectContaining({ message: 'profile-photo-read-failed' }));
    expect(String(error)).not.toContain('private/profile.jpg');
  });

  it('rejects empty and unsuccessful local responses', async () => {
    nextResponse = { size: 0 };
    await expect(openProfilePhotoUploadBlob('file:///empty.jpg')).rejects.toThrow(
      'profile-photo-read-failed',
    );

    nextResponse = { size: 256 };
    nextStatus = 404;
    await expect(openProfilePhotoUploadBlob('file:///missing.jpg')).rejects.toThrow(
      'profile-photo-read-failed',
    );
  });

  it('closes native resources best-effort', () => {
    const close = vi.fn();
    closeProfilePhotoUploadBlob({ size: 256, close } as unknown as Blob);
    expect(close).toHaveBeenCalledOnce();

    expect(() =>
      closeProfilePhotoUploadBlob({
        size: 256,
        close: () => { throw new Error('already closed'); },
      } as unknown as Blob),
    ).not.toThrow();
  });
});
