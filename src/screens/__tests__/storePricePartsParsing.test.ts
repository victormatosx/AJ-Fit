import { describe, expect, it } from 'vitest';
import { splitStorePrice } from '../paywall/storePriceParts';

/**
 * The approved Paywall design sets a price's whole units at 50pt and its
 * fraction at 19pt, which means the formatted store string has to be read in
 * pieces. The risk that buys is obvious — a mis-split price is a wrong price
 * — so the contract is not "splits correctly for the locales we thought of"
 * but "never returns pieces that are not the original string".
 *
 * These cases are real store/`Intl` output, not invented formats.
 */
describe('splitStorePrice — lossless or nothing', () => {
  it.each([
    ['R$ 66,65', { prefix: 'R$ ', whole: '66', separator: ',', fraction: '65', suffix: '' }],
    ['R$ 799,90', { prefix: 'R$ ', whole: '799', separator: ',', fraction: '90', suffix: '' }],
    ['$9.99', { prefix: '$', whole: '9', separator: '.', fraction: '99', suffix: '' }],
    ['US$ 1,199.80', { prefix: 'US$ ', whole: '1,199', separator: '.', fraction: '80', suffix: '' }],
    ['R$ 1.199,80', { prefix: 'R$ ', whole: '1.199', separator: ',', fraction: '80', suffix: '' }],
    ['9,99 €', { prefix: '', whole: '9', separator: ',', fraction: '99', suffix: ' €' }],
    ['1 234,56 €', { prefix: '', whole: '1 234', separator: ',', fraction: '56', suffix: ' €' }],
  ])('%s splits into the design\'s parts', (price, expected) => {
    expect(splitStorePrice(price)).toEqual(expected);
  });

  it.each([
    'R$ 66,65',
    'R$ 799,90',
    '$9.99',
    'US$ 1,199.80',
    'R$ 1.199,80',
    '9,99 €',
    '1 234,56 €',
  ])('%s reassembles into exactly itself', (price) => {
    const parts = splitStorePrice(price);
    expect(parts).not.toBeNull();
    const { prefix, whole, separator, fraction, suffix } = parts!;
    expect(`${prefix}${whole}${separator}${fraction}${suffix}`).toBe(price.trim());
  });

  it.each([
    // No fraction at all, or not two digits — the screen renders the whole
    // string rather than guessing which digits are cents.
    ['¥1,000'],
    ['1.000 Ft'],
    ['₩12,000'],
    ['R$ 66,6'],
    ['R$ 66,655'],
    ['Free'],
    [''],
  ])('%s falls through to the whole string', (price) => {
    expect(splitStorePrice(price)).toBeNull();
  });

  it('accepts the non-breaking group separators the stores actually emit', () => {
    expect(splitStorePrice('1 234,56 €')).toEqual({
      prefix: '',
      whole: '1 234',
      separator: ',',
      fraction: '56',
      suffix: ' €',
    });
    expect(splitStorePrice('1 234,56')).toEqual({
      prefix: '',
      whole: '1 234',
      separator: ',',
      fraction: '56',
      suffix: '',
    });
  });

  it('never invents, rounds or reorders digits', () => {
    const parts = splitStorePrice('R$ 1.199,80');
    expect(parts?.whole).toBe('1.199');
    expect(parts?.fraction).toBe('80');
    // The separator is reported as found, never normalized to a dot.
    expect(parts?.separator).toBe(',');
  });
});
