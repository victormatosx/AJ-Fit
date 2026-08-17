/**
 * Opens a local profile-photo URI as React Native's native-backed Blob.
 *
 * Firebase Storage accepts a Blob directly. Reading the file through
 * `File.bytes()` first changes it into an ArrayBufferView; Firebase's upload
 * path then tries to build/slice a JS Blob from that view, which React Native
 * 0.85 does not support. Native XHR preserves the URI-backed Blob contract
 * for picker and manipulated images alike, without base64 copies.
 */
export function openProfilePhotoUploadBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.responseType = 'blob';
    request.onload = () => {
      const blob = request.response as Blob | null;
      if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
        reject(new Error('profile-photo-read-failed'));
        return;
      }
      if (!blob || typeof blob.size !== 'number' || blob.size <= 0) {
        reject(new Error('profile-photo-read-failed'));
        return;
      }
      resolve(blob);
    };
    request.onerror = () => reject(new Error('profile-photo-read-failed'));
    request.onabort = () => reject(new Error('profile-photo-read-failed'));
    try {
      request.open('GET', uri, true);
      request.send();
    } catch {
      reject(new Error('profile-photo-read-failed'));
    }
  });
}

/** Releases the native Blob resource after Firebase has finished reading it. */
export function closeProfilePhotoUploadBlob(blob: Blob | null): void {
  if (!blob) return;
  const close = (blob as Blob & { close?: () => void }).close;
  if (typeof close !== 'function') return;
  try {
    close.call(blob);
  } catch {
    // Best effort. Cleanup must not replace the controlled upload outcome.
  }
}
