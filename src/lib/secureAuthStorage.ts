import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AESEncryptionKey,
  AESSealedData,
  aesEncryptAsync,
  aesDecryptAsync,
} from 'expo-crypto';
import { logError } from './logger';

/**
 * AsyncStorage-compatible backend for Firebase's `getReactNativePersistence`
 * (see `../lib/firebase.ts`).
 *
 * AsyncStorage itself is unencrypted, and Firebase's persisted session blob
 * contains id/refresh tokens and user profile data, which
 * docs/12_seguranca_geral_do_app.md §16 requires to be stored through a
 * secure platform mechanism. Every value is sealed with AES-256-GCM before
 * it reaches disk — only ciphertext is ever written to AsyncStorage. The
 * encryption key itself lives in the OS Keychain/Keystore via
 * expo-secure-store, never in AsyncStorage.
 */

const ENCRYPTION_KEY_ID = 'ajfit_session_enc_key_v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let cachedKeyPromise: Promise<AESEncryptionKey> | null = null;

async function loadOrCreateKey(): Promise<AESEncryptionKey> {
  const stored = await SecureStore.getItemAsync(ENCRYPTION_KEY_ID);
  if (stored) {
    try {
      return await AESEncryptionKey.import(stored, 'base64');
    } catch (err) {
      // Key is corrupted/unreadable: any session encrypted with it is lost
      // anyway, so drop it and start fresh (equivalent to a forced logout).
      logError('secureAuthStorage:key-import', err);
      await SecureStore.deleteItemAsync(ENCRYPTION_KEY_ID);
    }
  }

  const key = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(ENCRYPTION_KEY_ID, await key.encoded('base64'));
  return key;
}

async function getEncryptionKey(): Promise<AESEncryptionKey> {
  if (!cachedKeyPromise) cachedKeyPromise = loadOrCreateKey();
  try {
    return await cachedKeyPromise;
  } catch (err) {
    // Don't let a transient failure (e.g. Keystore not ready yet) poison the
    // cache forever — clear it so the next call can retry from scratch.
    cachedKeyPromise = null;
    throw err;
  }
}

/**
 * Sealed data is stored as its three GCM parts (iv/ciphertext/tag), each as a
 * plain number array, instead of via `sealed.combined()` /
 * `AESSealedData.fromCombined()` or the 'base64' string encoding options —
 * both failed to round-trip correctly on Android. Raw byte arrays are the
 * most basic path through the native module and avoid any string encoding
 * done on the native side.
 */
type StoredEnvelope = { iv: number[]; ciphertext: number[]; tag: number[] };

function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as StoredEnvelope).iv) &&
    Array.isArray((value as StoredEnvelope).ciphertext) &&
    Array.isArray((value as StoredEnvelope).tag)
  );
}

export const secureAuthStorage = {
  async setItem(key: string, value: string): Promise<void> {
    try {
      const encKey = await getEncryptionKey();
      const sealed = await aesEncryptAsync(encoder.encode(value), encKey);
      const envelope: StoredEnvelope = {
        iv: Array.from(await sealed.iv('bytes')),
        ciphertext: Array.from(
          await sealed.ciphertext({ includeTag: false, encoding: 'bytes' }),
        ),
        tag: Array.from(await sealed.tag('bytes')),
      };
      await AsyncStorage.setItem(key, JSON.stringify(envelope));
    } catch (err) {
      logError('secureAuthStorage:setItem', err);
      throw err;
    }
  },

  async getItem(key: string): Promise<string | null> {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;

    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch (err) {
      logError('secureAuthStorage:parse', err);
      await AsyncStorage.removeItem(key);
      return null;
    }
    if (!isStoredEnvelope(envelope)) {
      logError('secureAuthStorage:shape', new Error('stored value has unexpected shape'));
      await AsyncStorage.removeItem(key);
      return null;
    }

    let encKey: AESEncryptionKey;
    try {
      encKey = await getEncryptionKey();
    } catch (err) {
      // Key infra unavailable right now: don't touch the stored ciphertext,
      // it may still be readable on a later attempt.
      logError('secureAuthStorage:key-unavailable', err);
      return null;
    }

    try {
      const sealed = AESSealedData.fromParts(
        Uint8Array.from(envelope.iv),
        Uint8Array.from(envelope.ciphertext),
        Uint8Array.from(envelope.tag),
      );
      const plainBytes = await aesDecryptAsync(sealed, encKey, { output: 'bytes' });
      return decoder.decode(plainBytes as Uint8Array);
    } catch (err) {
      // Ciphertext itself is unreadable (corrupted, or truly a different
      // key): treat as no session instead of crashing the app on startup.
      logError('secureAuthStorage:decrypt', err);
      await AsyncStorage.removeItem(key);
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },
};

/**
 * Rotates out the encryption key so any encrypted session blob left behind
 * becomes permanently unreadable. Called on logout as defense-in-depth on
 * top of Firebase's own persistence cleanup.
 */
export async function clearSecureAuthSession(): Promise<void> {
  cachedKeyPromise = null;
  await SecureStore.deleteItemAsync(ENCRYPTION_KEY_ID);
}
