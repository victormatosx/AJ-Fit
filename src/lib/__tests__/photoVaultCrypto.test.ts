import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The expo-crypto AES module is native, so it is replaced here by a double
 * backed by Node's own AES-256-GCM. That keeps the tests meaningful: real
 * authenticated encryption, so tamper detection and wrong-key failures are
 * genuine cipher behaviour rather than a mock returning what we asked for.
 *
 * What this cannot cover is the native module's own quirks on device (the
 * project already documented Android issues with `combined()`/base64 in
 * lib/secureAuthStorage.ts) — that still needs a device build.
 */
vi.mock('expo-crypto', async () => {
  const nodeCrypto = await import('node:crypto');

  class AESEncryptionKey {
    constructor(
      readonly raw: Buffer,
      readonly size: number,
    ) {}

    static async import(value: string, encoding: 'base64' | 'hex') {
      const raw = Buffer.from(value, encoding);
      if (![16, 24, 32].includes(raw.length)) throw new Error('bad key size');
      return new AESEncryptionKey(raw, raw.length * 8);
    }
  }

  class AESSealedData {
    constructor(
      private readonly _iv: Uint8Array,
      private readonly _ciphertext: Uint8Array,
      private readonly _tag: Uint8Array,
    ) {}

    static fromParts(iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array) {
      return new AESSealedData(iv, ciphertext, tag);
    }

    async iv() {
      return this._iv;
    }
    async tag() {
      return this._tag;
    }
    async ciphertext() {
      return this._ciphertext;
    }
  }

  return {
    AESKeySize: { AES128: 128, AES192: 192, AES256: 256 },
    AESEncryptionKey,
    AESSealedData,
    async aesEncryptAsync(plaintext: Uint8Array, key: AESEncryptionKey) {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key.raw, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return new AESSealedData(iv, ciphertext, cipher.getAuthTag());
    },
    async aesDecryptAsync(sealed: AESSealedData, key: AESEncryptionKey) {
      const decipher = nodeCrypto.createDecipheriv(
        'aes-256-gcm',
        key.raw,
        await sealed.iv(),
      );
      decipher.setAuthTag(Buffer.from(await sealed.tag()));
      // Throws on tag mismatch — the behaviour these tests rely on.
      return new Uint8Array(
        Buffer.concat([decipher.update(Buffer.from(await sealed.ciphertext())), decipher.final()]),
      );
    },
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
  };
});

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { randomBytes } from 'node:crypto';

import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_VERSION,
  HEADER_BYTES,
  IV_BYTES,
  TAG_BYTES,
  decryptBytes,
  encryptBytes,
  parseEnvelope,
} from '../photoVaultCrypto';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

/** Stand-in for photo bytes. */
function photo(size = 4096): Uint8Array {
  return new Uint8Array(randomBytes(size));
}

function issueOf(err: unknown): string {
  return (err as { issue?: string }).issue ?? 'none';
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Constants ──────────────────────────────────────────────────────────────

describe('format constants', () => {
  it('uses AES-256-GCM with a 96-bit nonce and a 128-bit tag', () => {
    expect(ENCRYPTION_ALGORITHM).toBe('AES-256-GCM');
    expect(IV_BYTES).toBe(12);
    expect(TAG_BYTES).toBe(16);
  });

  it('starts at encryption version 1', () => {
    expect(ENCRYPTION_VERSION).toBe(1);
  });

  it('has a 36-byte header', () => {
    expect(HEADER_BYTES).toBe(36);
  });
});

// ── Round trip ─────────────────────────────────────────────────────────────

describe('encrypt/decrypt round trip', () => {
  it('reproduces the original bytes exactly', async () => {
    const original = photo();

    const { bytes } = await encryptBytes(original, KEY);
    const restored = await decryptBytes(bytes, KEY);

    expect(Buffer.from(restored)).toEqual(Buffer.from(original));
  });

  it.each([1, 15, 16, 17, 1024, 65_536])('round-trips %i bytes', async (size) => {
    const original = photo(size);

    const restored = await decryptBytes((await encryptBytes(original, KEY)).bytes, KEY);

    expect(Buffer.from(restored)).toEqual(Buffer.from(original));
  });

  it('produces a file larger than the plaintext by exactly the header', async () => {
    const original = photo(1000);

    const { bytes } = await encryptBytes(original, KEY);

    expect(bytes.length).toBe(1000 + HEADER_BYTES);
  });

  it('never leaves the plaintext visible in the envelope', async () => {
    const original = photo(2048);

    const { bytes } = await encryptBytes(original, KEY);

    expect(Buffer.from(bytes).includes(Buffer.from(original))).toBe(false);
  });
});

// ── Nonce uniqueness ───────────────────────────────────────────────────────

describe('nonce', () => {
  it('is different on every encryption', async () => {
    const original = photo(256);
    const ivs = new Set<string>();

    for (let i = 0; i < 25; i += 1) {
      ivs.add((await encryptBytes(original, KEY)).iv);
    }

    // Catches a constant IV, an IV derived from the key/plaintext, or an RNG
    // that was mocked into determinism.
    expect(ivs.size).toBe(25);
  });

  it('makes identical plaintext produce different ciphertext', async () => {
    const original = photo(512);

    const first = await encryptBytes(original, KEY);
    const second = await encryptBytes(original, KEY);

    expect(Buffer.from(first.bytes)).not.toEqual(Buffer.from(second.bytes));
  });

  it('reports the same nonce that is framed in the file', async () => {
    const { bytes, iv } = await encryptBytes(photo(128), KEY);

    // One source of truth: the Firestore metadata cannot drift from the file.
    const framed = Buffer.from(bytes.slice(8, 8 + IV_BYTES)).toString('base64');
    expect(iv).toBe(framed);
  });

  it('is 12 bytes once decoded', async () => {
    const { iv } = await encryptBytes(photo(128), KEY);

    expect(Buffer.from(iv, 'base64')).toHaveLength(IV_BYTES);
  });
});

// ── Key handling ───────────────────────────────────────────────────────────

describe('vault key validation', () => {
  it.each([
    ['a 16-byte key', randomBytes(16).toString('base64')],
    ['a 48-byte key', randomBytes(48).toString('base64')],
    ['an empty string', ''],
    ['invalid base64', '!!!!'],
  ])('rejects %s', async (_label, key) => {
    const err = await encryptBytes(photo(64), key).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultCryptoInvalidKey');
  });

  it.each([null, undefined, 42, {}])('rejects a non-string key: %s', async (key) => {
    const err = await encryptBytes(photo(64), key as never).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultCryptoInvalidKey');
  });

  it('fails to decrypt with the wrong key', async () => {
    const { bytes } = await encryptBytes(photo(1024), KEY);

    const err = await decryptBytes(bytes, OTHER_KEY).catch((e: unknown) => e);

    // Never returns garbage as if it were a valid image.
    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
  });

  it('rejects an invalid key before touching the envelope', async () => {
    const err = await decryptBytes(new Uint8Array(10), 'short').catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultCryptoInvalidFile');
  });
});

// ── Tampering ──────────────────────────────────────────────────────────────

describe('tamper detection', () => {
  async function tampered(mutate: (bytes: Uint8Array) => void): Promise<unknown> {
    const { bytes } = await encryptBytes(photo(2048), KEY);
    mutate(bytes);
    return decryptBytes(bytes, KEY).catch((e: unknown) => e);
  }

  it('rejects a flipped ciphertext byte', async () => {
    const err = await tampered((b) => {
      b[HEADER_BYTES + 10] ^= 0xff;
    });

    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
  });

  it('rejects a flipped tag byte', async () => {
    const err = await tampered((b) => {
      b[20] ^= 0xff;
    });

    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
  });

  it('rejects a flipped nonce byte', async () => {
    const err = await tampered((b) => {
      b[8] ^= 0xff;
    });

    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
  });

  it('rejects a flipped magic byte', async () => {
    const err = await tampered((b) => {
      b[0] ^= 0xff;
    });

    expect(issueOf(err)).toBe('vaultCryptoInvalidFile');
  });

  it('rejects a bumped version', async () => {
    const err = await tampered((b) => {
      b[4] = 2;
    });

    // Never guess how a future format is laid out.
    expect(issueOf(err)).toBe('vaultCryptoUnsupportedVersion');
  });

  it('rejects a tampered declared iv length', async () => {
    const err = await tampered((b) => {
      b[5] = 16;
    });

    expect(issueOf(err)).toBe('vaultCryptoInvalidFile');
  });

  it('rejects a tampered declared tag length', async () => {
    const err = await tampered((b) => {
      b[6] = 12;
    });

    expect(issueOf(err)).toBe('vaultCryptoInvalidFile');
  });

  it('rejects appended trailing bytes', async () => {
    const { bytes } = await encryptBytes(photo(512), KEY);
    const extended = new Uint8Array(bytes.length + 4);
    extended.set(bytes);

    const err = await decryptBytes(extended, KEY).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
  });

  it('rejects a truncated file', async () => {
    const { bytes } = await encryptBytes(photo(512), KEY);

    const err = await decryptBytes(bytes.slice(0, bytes.length - 5), KEY).catch(
      (e: unknown) => e,
    );

    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
  });
});

// ── Envelope parser ────────────────────────────────────────────────────────

describe('parseEnvelope', () => {
  it('extracts the three parts at the documented offsets', async () => {
    const { bytes } = await encryptBytes(photo(300), KEY);

    const parsed = parseEnvelope(bytes);

    expect(parsed.iv).toHaveLength(IV_BYTES);
    expect(parsed.tag).toHaveLength(TAG_BYTES);
    expect(parsed.ciphertext).toHaveLength(300);
  });

  it.each([
    ['an empty buffer', new Uint8Array(0)],
    ['a buffer shorter than the header', new Uint8Array(HEADER_BYTES - 1)],
    ['a header with no ciphertext', new Uint8Array(HEADER_BYTES)],
    ['random noise', new Uint8Array(randomBytes(64))],
  ])('rejects %s', (_label, bytes) => {
    expect(() => parseEnvelope(bytes)).toThrowError(
      expect.objectContaining({ issue: expect.stringContaining('vaultCrypto') }),
    );
  });

  it('rejects a valid header followed by nothing', () => {
    const header = new Uint8Array(HEADER_BYTES);
    header.set([0x41, 0x4a, 0x46, 0x56]);
    header[4] = 1;
    header[5] = IV_BYTES;
    header[6] = TAG_BYTES;

    expect(() => parseEnvelope(header)).toThrowError(
      expect.objectContaining({ issue: 'vaultCryptoInvalidFile' }),
    );
  });

  it.each([null, undefined, 'string', 42])('rejects a non-buffer input: %s', (input) => {
    expect(() => parseEnvelope(input as never)).toThrowError(
      expect.objectContaining({ issue: 'vaultCryptoInvalidFile' }),
    );
  });
});

// ── Empty plaintext ────────────────────────────────────────────────────────

describe('empty plaintext', () => {
  it('produces a header-only envelope that the parser refuses', async () => {
    // Encryption itself succeeds (GCM allows empty plaintext), but a photo
    // with no bytes is not a photo, so the parser rejects it on the way back.
    const { bytes } = await encryptBytes(new Uint8Array(0), KEY);
    expect(bytes.length).toBe(HEADER_BYTES);

    const err = await decryptBytes(bytes, KEY).catch((e: unknown) => e);
    expect(issueOf(err)).toBe('vaultCryptoInvalidFile');
  });
});

// ── No secrets in errors ───────────────────────────────────────────────────

describe('errors carry no secrets', () => {
  it('never includes the key or plaintext in the message', async () => {
    const original = photo(128);
    const { bytes } = await encryptBytes(original, KEY);
    bytes[HEADER_BYTES] ^= 0xff;

    const err = (await decryptBytes(bytes, KEY).catch((e: unknown) => e)) as Error;

    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain(Buffer.from(original).toString('base64'));
    expect(err.message).toBe('vaultCryptoIntegrityFailed');
  });
});
