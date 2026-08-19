import { describe, expect, it, vi } from 'vitest';

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_CANONICAL_LENGTH,
  RECOVERY_CODE_PREFIX,
  RECOVERY_CODE_SECRET_BITS,
  RECOVERY_CODE_SECRET_LENGTH,
  RECOVERY_CODE_SELECTOR_BITS,
  RECOVERY_CODE_SELECTOR_LENGTH,
  formatRecoveryCodeForDisplay,
  normalizeRecoveryCode,
  parseRecoveryCode,
} from '../codeFormat';
import {
  RecoveryGenerationError,
  generateRecoveryCode,
  generateRecoveryCodeSet,
  generateRecoverySecret,
  generateRecoverySelector,
  randomRecoverySymbols,
} from '../codeGenerator';
import { RECOVERY_CODES_PER_SET } from '../schema';

const ALPHABET_SET = new Set(RECOVERY_CODE_ALPHABET);

describe('CSPRNG symbol drawing', () => {
  it('emits only alphabet symbols', () => {
    for (const symbol of randomRecoverySymbols(512)) {
      expect(ALPHABET_SET.has(symbol)).toBe(true);
    }
  });

  it('emits exactly the requested length', () => {
    for (const count of [1, 7, 12, 28, 40]) {
      expect(randomRecoverySymbols(count)).toHaveLength(count);
    }
  });

  it('rejects a non-positive or fractional count', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(() => randomRecoverySymbols(count)).toThrow(RecoveryGenerationError);
    }
  });

  it('introduces no modulo bias: all 256 byte values map 8-to-1 onto 32 symbols', async () => {
    // The uniformity argument in codeGenerator.ts, checked rather than
    // asserted: feed every possible byte exactly once and count the symbols.
    const everyByte = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

    vi.resetModules();
    vi.doMock('node:crypto', async () => {
      const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
      return { ...actual, randomBytes: () => everyByte };
    });

    const { randomRecoverySymbols: drawWithEveryByte } = await import('../codeGenerator');
    const symbols = drawWithEveryByte(256);

    const histogram = new Map<string, number>();
    for (const symbol of symbols) {
      histogram.set(symbol, (histogram.get(symbol) ?? 0) + 1);
    }

    expect(histogram.size).toBe(32);
    for (const symbol of RECOVERY_CODE_ALPHABET) {
      // 256 / 32 = 8, exactly. Any symbol appearing 7 or 9 times would be bias.
      expect(histogram.get(symbol)).toBe(8);
    }

    vi.doUnmock('node:crypto');
    vi.resetModules();
  });

  it('does not repeat itself across draws', () => {
    // Not a randomness test — a wiring test. A constant or a seeded PRNG
    // reused per call would collide immediately at this size.
    const draws = new Set(Array.from({ length: 50 }, () => randomRecoverySymbols(28)));
    expect(draws.size).toBe(50);
  });
});

describe('selector generation', () => {
  it('produces 12 symbols / 60 bits', () => {
    const selector = generateRecoverySelector();

    expect(selector).toHaveLength(RECOVERY_CODE_SELECTOR_LENGTH);
    expect(selector).toHaveLength(12);
    expect(RECOVERY_CODE_SELECTOR_BITS).toBe(60);
  });

  it('uses only alphabet symbols', () => {
    for (const symbol of generateRecoverySelector()) {
      expect(ALPHABET_SET.has(symbol)).toBe(true);
    }
  });

  it('carries no account information', () => {
    // Structural: a selector is drawn from the CSPRNG alone, so distinct
    // calls cannot correlate. Two selectors sharing a prefix would suggest a
    // derived (uid/timestamp) construction.
    const selectors = Array.from({ length: 200 }, () => generateRecoverySelector());

    expect(new Set(selectors).size).toBe(200);
    expect(new Set(selectors.map((selector) => selector.slice(0, 4))).size).toBeGreaterThan(150);
  });
});

describe('secret generation', () => {
  it('produces 28 symbols / 140 bits', () => {
    expect(generateRecoverySecret()).toHaveLength(RECOVERY_CODE_SECRET_LENGTH);
    expect(RECOVERY_CODE_SECRET_BITS).toBe(140);
    expect(RECOVERY_CODE_SECRET_BITS).toBeGreaterThanOrEqual(128);
  });
});

describe('single code assembly', () => {
  const selector = 'ABCDEFGH0123';

  it('carries the requested selector and a fresh secret', () => {
    const code = generateRecoveryCode(selector);
    const parsed = parseRecoveryCode(code);

    expect(parsed.selector).toBe(selector);
    expect(parsed.secret).toHaveLength(RECOVERY_CODE_SECRET_LENGTH);
    expect(code).toHaveLength(RECOVERY_CODE_CANONICAL_LENGTH);
    expect(code.startsWith(RECOVERY_CODE_PREFIX)).toBe(true);
  });

  it('round-trips through canonicalization unchanged', () => {
    const code = generateRecoveryCode(selector);

    expect(normalizeRecoveryCode(code)).toBe(code);
    expect(normalizeRecoveryCode(formatRecoveryCodeForDisplay(code))).toBe(code);
  });

  it('rejects a malformed selector instead of minting an unreadable code', () => {
    for (const bad of ['', 'SHORT', 'TOOLONGSELECTOR1', 'ABCDEFGH012!']) {
      expect(() => generateRecoveryCode(bad)).toThrow();
    }
  });
});

describe('set generation', () => {
  it('mints exactly 10 codes by default', () => {
    const { codes } = generateRecoveryCodeSet();

    expect(codes).toHaveLength(10);
    expect(codes).toHaveLength(RECOVERY_CODES_PER_SET);
  });

  it('shares one selector across every code in the set', () => {
    const { selector, codes } = generateRecoveryCodeSet();

    expect(selector).toHaveLength(12);
    for (const code of codes) {
      expect(parseRecoveryCode(code).selector).toBe(selector);
    }
  });

  it('guarantees every code in a set is unique', () => {
    const { codes } = generateRecoveryCodeSet();

    expect(new Set(codes).size).toBe(codes.length);
    // Secrets, not just full codes — the selector is shared by construction.
    expect(new Set(codes.map((code) => parseRecoveryCode(code).secret)).size).toBe(codes.length);
  });

  it('produces a different selector and different codes on every call', () => {
    const first = generateRecoveryCodeSet();
    const second = generateRecoveryCodeSet();

    expect(first.selector).not.toBe(second.selector);
    expect(first.codes.some((code) => second.codes.includes(code))).toBe(false);
  });

  it('regenerates rather than accepting a duplicate secret', async () => {
    // A degraded RNG that returns the same bytes twice, then varies. The set
    // must still come out with unique codes.
    let call = 0;
    vi.resetModules();
    vi.doMock('node:crypto', async () => {
      const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
      return {
        ...actual,
        randomBytes: (size: number) => {
          call += 1;
          // Calls 2 and 3 are the first two secrets — force them identical.
          const fill = call === 3 ? 2 : call;
          return Buffer.alloc(size, fill);
        },
      };
    });

    const { generateRecoveryCodeSet: degraded } = await import('../codeGenerator');
    const { codes } = degraded(3);

    expect(new Set(codes).size).toBe(3);

    vi.doUnmock('node:crypto');
    vi.resetModules();
  });

  it('fails loudly instead of looping when the RNG cannot produce variety', async () => {
    vi.resetModules();
    vi.doMock('node:crypto', async () => {
      const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
      return { ...actual, randomBytes: (size: number) => Buffer.alloc(size, 7) };
    });

    const { generateRecoveryCodeSet: broken, RecoveryGenerationError: BrokenError } =
      await import('../codeGenerator');

    expect(() => broken(2)).toThrow(BrokenError);

    vi.doUnmock('node:crypto');
    vi.resetModules();
  });

  it('rejects a non-positive count', () => {
    for (const count of [0, -3, 2.5]) {
      expect(() => generateRecoveryCodeSet(count)).toThrow(RecoveryGenerationError);
    }
  });
});
