/**
 * Reads a formatted store price as its visual parts, so the Paywall can set
 * the whole units large and the fraction small, the way the approved design
 * draws them.
 *
 * It never parses, rounds, converts or reformats. The returned pieces are
 * substrings of the input, and the function refuses to return anything unless
 * they reassemble into the input character for character (see the guard at
 * the end) — so a wrong split cannot reach the screen, only a plain one.
 *
 * A price falls through to `null` — meaning "render the whole string" — when:
 *
 * - the fraction is not exactly two digits (`¥1,000`, `1.000 Ft`);
 * - there is no fraction at all;
 * - the currency symbol sits somewhere this pattern does not describe;
 * - anything but digits and group separators sits between symbol and amount.
 *
 * The group-separator class carries NBSP (U+00A0) and narrow NBSP
 * (U+202F) because `Intl`/the stores really do emit them (`1 234,56 €` in
 * fr-FR, `1 234,56` in ru-RU), and treating one as "not a price" would send
 * perfectly valid prices down the fallback path.
 */
export function splitStorePrice(
  price: string,
): { prefix: string; whole: string; separator: string; fraction: string; suffix: string } | null {
  const trimmed = price.trim();
  const match = trimmed.match(
    /^([^\d]*?)((?:\d[\d.,\u00A0\u202F ]*)?\d)([.,])(\d{2})([^\d]*?)$/,
  );
  if (!match) return null;
  const [, prefix, whole, separator, fraction, suffix] = match;
  if (`${prefix}${whole}${separator}${fraction}${suffix}` !== trimmed) return null;
  return { prefix, whole, separator, fraction, suffix };
}
