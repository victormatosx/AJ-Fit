/**
 * Opens a local support-attachment URI as React Native's native-backed Blob.
 *
 * Firebase Storage accepts a Blob directly. Reading the file through
 * `File.arrayBuffer()` first changes it into an ArrayBuffer/ArrayBufferView;
 * Firebase's upload path then tries to build/slice a JS Blob from that view,
 * which React Native does not support ("Creating blobs from 'ArrayBuffer'
 * and 'ArrayBufferView' are not supported"). Native XHR preserves the
 * URI-backed Blob contract instead, without base64 copies.
 */
export function openSupportAttachmentUploadBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.responseType = 'blob';
    request.onload = () => {
      const blob = request.response as Blob | null;
      if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
        reject(new Error('support-attachment-read-failed'));
        return;
      }
      if (!blob || typeof blob.size !== 'number' || blob.size <= 0) {
        reject(new Error('support-attachment-read-failed'));
        return;
      }
      resolve(blob);
    };
    request.onerror = () => reject(new Error('support-attachment-read-failed'));
    request.onabort = () => reject(new Error('support-attachment-read-failed'));
    try {
      request.open('GET', uri, true);
      request.send();
    } catch {
      reject(new Error('support-attachment-read-failed'));
    }
  });
}

/** Releases the native Blob resource after Firebase has finished reading it. */
export function closeSupportAttachmentUploadBlob(blob: Blob | null): void {
  if (!blob) return;
  const close = (blob as Blob & { close?: () => void }).close;
  if (typeof close !== 'function') return;
  try {
    close.call(blob);
  } catch {
    // Best effort. Cleanup must not replace the controlled upload outcome.
  }
}
