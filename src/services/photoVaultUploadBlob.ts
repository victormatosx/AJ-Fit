import { PhotoVaultError } from '../lib/photoVaultErrors';

/**
 * Opens an already-encrypted local file as React Native's native-backed Blob.
 *
 * Firebase Storage accepts Blob, Uint8Array or ArrayBuffer. React Native 0.85
 * cannot create a Blob *from* an ArrayBufferView, which is the multipart path
 * Firebase uses for small payloads such as thumbnails. Loading the ciphertext
 * through native XHR gives Firebase a real Blob whose `slice()` stays native
 * for both multipart and resumable uploads.
 *
 * This adapter never receives plaintext and never logs the file URI.
 */
export function openEncryptedUploadBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.responseType = 'blob';
    request.onload = () => {
      const blob = request.response as Blob | null;
      if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
        reject(new PhotoVaultError('vaultFileReadFailed'));
        return;
      }
      if (!blob || typeof blob.size !== 'number' || blob.size <= 0) {
        reject(new PhotoVaultError('vaultFileReadFailed'));
        return;
      }
      resolve(blob);
    };
    request.onerror = () => reject(new PhotoVaultError('vaultFileReadFailed'));
    request.onabort = () => reject(new PhotoVaultError('vaultFileReadFailed'));
    try {
      request.open('GET', uri, true);
      request.send();
    } catch {
      reject(new PhotoVaultError('vaultFileReadFailed'));
    }
  });
}

/** React Native Blobs expose explicit native-resource cleanup. */
export function closeEncryptedUploadBlob(blob: Blob | null): void {
  if (!blob) return;
  const close = (blob as Blob & { close?: () => void }).close;
  if (typeof close === 'function') {
    try {
      close.call(blob);
    } catch {
      // Best effort. Upload outcome must never be replaced by cleanup noise.
    }
  }
}

