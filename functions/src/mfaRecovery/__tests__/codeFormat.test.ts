import { describe, expect, it } from 'vitest';

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_BITS_PER_SYMBOL,
  RECOVERY_CODE_CANONICAL_LENGTH,
  RECOVERY_CODE_GROUP_SIZE,
  RECOVERY_CODE_MIN_SECRET_BITS,
  RECOVERY_CODE_PAYLOAD_LENGTH,
  RECOVERY_CODE_PREFIX,
  RECOVERY_CODE_SECRET_BITS,
  RECOVERY_CODE_SECRET_LENGTH,
  RECOVERY_CODE_SELECTOR_BITS,
  RECOVERY_CODE_SELECTOR_LENGTH,
  formatRecoveryCodeForDisplay,
  isWellFormedRecoveryCode,
  normalizeRecoveryCode,
  parseRecoveryCode,
} from '../codeFormat';
import { RecoveryError } from '../errors';

/** A structurally valid code: 12 selector symbols + 28 secret symbols. */
const SELECTOR = '2W7K9XQF3MTB';
const SECRET = 'GHJKMNPQRSTVWXYZ0123456789AB';
const CANONICAL = `${RECOVERY_CODE_PREFIX}${SELECTOR}${SECRET}`;

describe('recovery code format — constants and entropy', () => {
  it('uses a 32-symbol alphabet with no confusable characters', () => {
    expect(RECOVERY_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(32);

    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(RECOVERY_CODE_ALPHABET).not.toContain(excluded);
    }
  });

  it('derives exactly 5 bits per symbol from the alphabet size', () => {
    expect(Math.log2(RECOVERY_CODE_ALPHABET.length)).toBe(RECOVERY_CODE_BITS_PER_SYMBOL);
    expect(Number.isInteger(Math.log2(RECOVERY_CODE_ALPHABET.length))).toBe(true);
  });

  it('meets the >= 128 bit effective secret entropy requirement', () => {
    expect(RECOVERY_CODE_SECRET_BITS).toBe(
      RECOVERY_CODE_SECRET_LENGTH * RECOVERY_CODE_BITS_PER_SYMBOL,
    );
    expect(RECOVERY_CODE_SECRET_BITS).toBe(140);
    expect(RECOVERY_CODE_SECRET_BITS).toBeGreaterThanOrEqual(RECOVERY_CODE_MIN_SECRET_BITS);
  });

  it('keeps the selector out of the secret budget', () => {
    expect(RECOVERY_CODE_PAYLOAD_LENGTH).toBe(
      RECOVERY_CODE_SELECTOR_LENGTH + RECOVERY_CODE_SECRET_LENGTH,
    );
    // The claim rests on the secret half alone, never on the payload total.
    expect(RECOVERY_CODE_SECRET_BITS).toBeLessThan(
      RECOVERY_CODE_PAYLOAD_LENGTH * RECOVERY_CODE_BITS_PER_SYMBOL,
    );
  });

  it('sizes the selector at 12 symbols / 60 bits of lookup space', () => {
    expect(RECOVERY_CODE_SELECTOR_LENGTH).toBe(12);
    expect(RECOVERY_CODE_SELECTOR_BITS).toBe(
      RECOVERY_CODE_SELECTOR_LENGTH * RECOVERY_CODE_BITS_PER_SYMBOL,
    );
    expect(RECOVERY_CODE_SELECTOR_BITS).toBe(60);
  });

  it('makes selector collisions operationally impossible at scale', () => {
    // Expected colliding pairs at an assumed 1e6 active recovery sets.
    const sets = 1e6;
    const expectedCollisions = sets ** 2 / (2 * 2 ** RECOVERY_CODE_SELECTOR_BITS);

    expect(expectedCollisions).toBeLessThan(1e-6);
    // The 8-symbol selector this replaced was ~0.45 — a real event, not noise.
    expect(sets ** 2 / (2 * 2 ** 40)).toBeGreaterThan(0.1);
  });

  it('splits the payload on a display group boundary', () => {
    expect(RECOVERY_CODE_SELECTOR_LENGTH % RECOVERY_CODE_GROUP_SIZE).toBe(0);
    expect(RECOVERY_CODE_SECRET_LENGTH % RECOVERY_CODE_GROUP_SIZE).toBe(0);
  });
});

describe('recovery code format — parsing', () => {
  it('splits a canonical code into selector and secret', () => {
    const parsed = parseRecoveryCode(CANONICAL);

    expect(parsed.canonical).toBe(CANONICAL);
    expect(parsed.selector).toBe(SELECTOR);
    expect(parsed.secret).toBe(SECRET);
    expect(parsed.canonical).toHaveLength(RECOVERY_CODE_CANONICAL_LENGTH);
  });

  it('never returns the plaintext concatenated with anything else', () => {
    const parsed = parseRecoveryCode(CANONICAL);
    expect(parsed.selector + parsed.secret).toBe(
      CANONICAL.slice(RECOVERY_CODE_PREFIX.length),
    );
  });
});

describe('recovery code format — normalization is deterministic', () => {
  const equivalentInputs = [
    CANONICAL,
    CANONICAL.toLowerCase(),
    formatRecoveryCodeForDisplay(CANONICAL),
    formatRecoveryCodeForDisplay(CANONICAL).toLowerCase(),
    `  ${CANONICAL}  `,
    CANONICAL.split('').join(' '),
    `${RECOVERY_CODE_PREFIX}-${SELECTOR}-${SECRET}`,
    `${RECOVERY_CODE_PREFIX}--${SELECTOR}---${SECRET}`,
  ];

  it.each(equivalentInputs)('canonicalizes %s to the same value', (input) => {
    expect(normalizeRecoveryCode(input)).toBe(CANONICAL);
  });

  it('is idempotent', () => {
    expect(normalizeRecoveryCode(normalizeRecoveryCode(CANONICAL))).toBe(CANONICAL);
  });

  it('maps I, L and O onto the symbols they are mistyped for', () => {
    // Selector typed with I and L where 1 was meant, and O where 0 was meant.
    const typed = `${RECOVERY_CODE_PREFIX}IL7K9XQO3MTB${SECRET}`;
    const intended = `${RECOVERY_CODE_PREFIX}117K9XQ03MTB${SECRET}`;

    expect(normalizeRecoveryCode(typed)).toBe(intended);
  });

  it('applies confusable mapping in lowercase too', () => {
    const typed = `${RECOVERY_CODE_PREFIX}il7k9xqo3mtb${SECRET}`.toLowerCase();
    const intended = `${RECOVERY_CODE_PREFIX}117K9XQ03MTB${SECRET}`;

    expect(normalizeRecoveryCode(typed)).toBe(intended);
  });

  it('cannot map one valid code onto a different valid code', () => {
    // The aliased characters are absent from the alphabet, so a fully valid
    // code contains none of them and is therefore a fixed point.
    for (const alias of ['I', 'L', 'O']) {
      expect(CANONICAL).not.toContain(alias);
    }
    expect(normalizeRecoveryCode(CANONICAL)).toBe(CANONICAL);
  });
});

describe('recovery code format — rejection', () => {
  const invalidInputs: readonly [string, unknown][] = [
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['number', 123],
    ['object', { code: CANONICAL }],
    ['wrong prefix', `XYZ${SELECTOR}${SECRET}`],
    ['no prefix', `${SELECTOR}${SECRET}`],
    ['too short', CANONICAL.slice(0, -1)],
    ['too long', `${CANONICAL}A`],
    ['contains U (not aliased)', `${RECOVERY_CODE_PREFIX}UW7K9XQF3MTB${SECRET}`],
    ['contains a symbol outside the alphabet', `${RECOVERY_CODE_PREFIX}2W7K9XQ!3MTB${SECRET}`],
    ['absurdly long input', 'A'.repeat(500)],
  ];

  it.each(invalidInputs)('rejects %s', (_label, input) => {
    expect(() => parseRecoveryCode(input)).toThrow(RecoveryError);
    expect(isWellFormedRecoveryCode(input)).toBe(false);
  });

  it('throws MALFORMED_CODE and nothing more specific', () => {
    try {
      parseRecoveryCode('nope');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RecoveryError);
      expect((err as RecoveryError).internalCode).toBe('MALFORMED_CODE');
    }
  });

  it('never truncates, pads or repairs a wrong-length code', () => {
    // A silent repair would be the dangerous behaviour: it could turn a typo
    // into somebody else's valid code.
    expect(() => parseRecoveryCode(CANONICAL.slice(0, -2))).toThrow(RecoveryError);
    expect(() => parseRecoveryCode(`${CANONICAL}ZZ`)).toThrow(RecoveryError);
  });
});

describe('recovery code format — display', () => {
  it('groups the payload without changing the canonical value', () => {
    const display = formatRecoveryCodeForDisplay(CANONICAL);

    expect(display.startsWith(`${RECOVERY_CODE_PREFIX}-`)).toBe(true);
    expect(display.replace(/-/g, '')).toBe(CANONICAL);
    expect(normalizeRecoveryCode(display)).toBe(CANONICAL);
  });

  it('emits ten groups of four payload symbols', () => {
    const [prefix, ...groups] = formatRecoveryCodeForDisplay(CANONICAL).split('-');

    expect(prefix).toBe(RECOVERY_CODE_PREFIX);
    expect(groups).toHaveLength(10);
    for (const group of groups) {
      expect(group).toHaveLength(RECOVERY_CODE_GROUP_SIZE);
    }
  });

  it('renders the selector as the first three groups', () => {
    const [, ...groups] = formatRecoveryCodeForDisplay(CANONICAL).split('-');

    expect(groups.slice(0, 3).join('')).toBe(SELECTOR);
    expect(groups.slice(3).join('')).toBe(SECRET);
  });

  it('refuses to format anything that is not a valid code', () => {
    expect(() => formatRecoveryCodeForDisplay('AJF-nope')).toThrow(RecoveryError);
  });
});
