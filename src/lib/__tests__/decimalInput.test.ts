import { describe, expect, it } from 'vitest';
import { normalizeDecimalInput, parseDecimalInput } from '../decimalInput';

describe('decimal input', () => {
  it.each([
    ['80', '80'],
    ['80,', '80,'],
    ['80,2', '80,2'],
    ['80,25', '80,25'],
    ['80,256', '80,25'],
    ['80.25', '80.25'],
    [',5', '0,5'],
    ['80kg,25', '80,25'],
    ['80,2.5', '80,25'],
  ])('normalizes %s to %s with at most two decimal places', (input, expected) => {
    expect(normalizeDecimalInput(input, 2)).toBe(expected);
  });

  it('parses comma and dot decimals without losing the fractional part', () => {
    expect(parseDecimalInput('80,25')).toBe(80.25);
    expect(parseDecimalInput('80.25')).toBe(80.25);
  });

  it('preserves a trailing comma while the user continues typing a fractional load', () => {
    const withSeparator = normalizeDecimalInput('80,', 2);
    expect(withSeparator).toBe('80,');
    expect(parseDecimalInput(withSeparator)).toBe(80);

    const withFraction = normalizeDecimalInput(`${withSeparator}5`, 2);
    expect(withFraction).toBe('80,5');
    expect(parseDecimalInput(withFraction)).toBe(80.5);
  });
});
