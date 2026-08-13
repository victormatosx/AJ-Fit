export type ResourceIssue = {
  locale: string;
  path: string;
  reason: 'empty' | 'extra' | 'missing' | 'non-string';
};

export function extractLeafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      extractLeafPaths(child, prefix ? `${prefix}.${index}` : String(index)),
    );
  }
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    extractLeafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function inspectShape(value: unknown, locale: string, prefix = ''): ResourceIssue[] {
  if (typeof value === 'string') {
    return value.trim() ? [] : [{ locale, path: prefix, reason: 'empty' }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      inspectShape(child, locale, prefix ? `${prefix}.${index}` : String(index)),
    );
  }
  if (value === null || typeof value !== 'object') {
    return [{ locale, path: prefix || '<root>', reason: 'non-string' }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    inspectShape(child, locale, prefix ? `${prefix}.${key}` : key),
  );
}

export function inspectResourceParity(locales: Record<string, unknown>): ResourceIssue[] {
  const localeNames = Object.keys(locales);
  if (localeNames.length < 2) {
    throw new Error(`resource parity requires at least two locales; received ${localeNames.length}`);
  }

  const [reference, ...others] = localeNames;
  const referencePaths = extractLeafPaths(locales[reference]).sort();
  const issues = localeNames.flatMap((locale) => inspectShape(locales[locale], locale));

  for (const locale of others) {
    const paths = extractLeafPaths(locales[locale]).sort();
    issues.push(
      ...referencePaths
        .filter((path) => !paths.includes(path))
        .map((path) => ({ locale, path, reason: 'missing' as const })),
      ...paths
        .filter((path) => !referencePaths.includes(path))
        .map((path) => ({ locale, path, reason: 'extra' as const })),
    );
  }
  return issues;
}

export function assertResourceParity(
  namespace: string,
  locales: Record<string, unknown>,
  allowedNonStringPaths: readonly string[] = [],
): void {
  const issues = inspectResourceParity(locales).filter(
    (issue) =>
      issue.reason !== 'non-string' || !allowedNonStringPaths.includes(issue.path),
  );
  if (!issues.length) return;
  const details = issues
    .map(({ locale, path, reason }) => `- [${locale}] ${reason}: ${path}`)
    .join('\n');
  throw new Error(`[i18n:${namespace}] resource parity failed\n${details}`);
}
