/**
 * Keeps a decimal input editable while restricting it to one separator and
 * the requested number of fractional digits. Both comma and dot are accepted
 * and the separator the user typed stays visible in the field.
 */
export function normalizeDecimalInput(value: string, maxFractionDigits: number): string {
  const cleaned = value.replace(/[^0-9.,]/g, '');
  const separatorIndex = cleaned.search(/[.,]/);

  if (separatorIndex === -1) return cleaned;

  const whole = cleaned.slice(0, separatorIndex);
  const separator = cleaned[separatorIndex];
  const fraction = cleaned
    .slice(separatorIndex + 1)
    .replace(/[.,]/g, '')
    .slice(0, maxFractionDigits);

  return `${whole || '0'}${separator}${fraction}`;
}

/** Parses the comma or dot representation accepted by normalizeDecimalInput. */
export function parseDecimalInput(value: string): number {
  return Number.parseFloat(value.replace(',', '.'));
}
