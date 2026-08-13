import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const resourcesRoot = path.join(root, 'src/i18n/resources');
const locales = ['pt-BR', 'en', 'es'];
const sourceExtensions = new Set(['.ts', '.tsx']);
const auditAllowlist = JSON.parse(
  fs.readFileSync(path.join(root, 'src/i18n/resource-audit-allowlist.json'), 'utf8'),
);

function walk(directory, accept) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(file, accept));
    else if (accept(file)) result.push(file);
  }
  return result;
}

function flatten(value, prefix = '', entries = new Map(), errors = []) {
  if (typeof value === 'string') {
    entries.set(prefix, value);
    if (!value.trim()) errors.push(`empty value at ${prefix}`);
    return { entries, errors };
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => flatten(child, prefix ? `${prefix}.${index}` : String(index), entries, errors));
    return { entries, errors };
  }
  if (value === null || typeof value !== 'object') {
    errors.push(`non-string leaf at ${prefix || '<root>'}`);
    return { entries, errors };
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, entries, errors);
  }
  return { entries, errors };
}

function namespaceFiles(locale) {
  return fs.readdirSync(path.join(resourcesRoot, locale))
    .filter((file) => file.endsWith('.json'))
    .sort();
}

const failures = [];
const referenceFiles = namespaceFiles(locales[0]);
const catalog = new Map();

for (const locale of locales) {
  const files = namespaceFiles(locale);
  if (JSON.stringify(files) !== JSON.stringify(referenceFiles)) {
    failures.push(`[${locale}] namespace files differ from pt-BR`);
  }
}

console.log('i18n resource audit');
console.log(`locales: ${locales.join(', ')}`);
console.log(`namespaces: ${referenceFiles.length}`);

for (const file of referenceFiles) {
  const namespace = path.basename(file, '.json');
  const localeEntries = new Map();
  for (const locale of locales) {
    const resourcePath = path.join(resourcesRoot, locale, file);
    const parsed = JSON.parse(fs.readFileSync(resourcePath, 'utf8'));
    const { entries, errors } = flatten(parsed);
    localeEntries.set(locale, entries);
    for (const error of errors) {
      const nonStringPrefix = 'non-string leaf at ';
      const allowlisted = error.startsWith(nonStringPrefix) &&
        auditAllowlist.nonStringLeaves.includes(`${namespace}:${error.slice(nonStringPrefix.length)}`);
      if (!allowlisted) failures.push(`[${locale}:${namespace}] ${error}`);
    }
  }

  const referenceKeys = [...localeEntries.get('pt-BR').keys()].sort();
  for (const locale of locales.slice(1)) {
    const keys = [...localeEntries.get(locale).keys()].sort();
    for (const key of referenceKeys.filter((candidate) => !keys.includes(candidate))) {
      failures.push(`[${locale}:${namespace}] missing ${key}`);
    }
    for (const key of keys.filter((candidate) => !referenceKeys.includes(candidate))) {
      failures.push(`[${locale}:${namespace}] extra ${key}`);
    }
  }
  catalog.set(namespace, new Set(referenceKeys));
  console.log(`- ${namespace}: ${referenceKeys.length} keys`);
}

const sourceFiles = walk(path.join(root, 'src'), (file) =>
  sourceExtensions.has(path.extname(file)) && !file.includes(`${path.sep}__tests__${path.sep}`),
);
const stripComments = (value) => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const source = sourceFiles.map((file) => stripComments(fs.readFileSync(file, 'utf8'))).join('\n');
const fullKeyPattern = /\bt\(\s*['"]([\w-]+):([\w.-]+)['"]/g;
for (const match of source.matchAll(fullKeyPattern)) {
  const [, namespace, key] = match;
  if (!catalog.has(namespace)) failures.push(`[consumer] unknown namespace ${namespace}`);
  else if (
    !catalog.get(namespace).has(key) &&
    !catalog.get(namespace).has(`${key}_one`) &&
    ![...catalog.get(namespace)].some((candidate) => candidate.startsWith(`${key}.`))
  ) failures.push(`[consumer] missing ${namespace}:${key}`);
}

const universal = /^(?:AJ(?:\s+[A-Z]+)?|—|%|kg|cm|mm|kcal|lb|in|\d+(?:[.,]\d+)?(?:\s*[%x])?)$/i;
const suspicious = [];
for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.tsx'))) {
  const relative = path.relative(root, file);
  const raw = fs.readFileSync(file, 'utf8');
  const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const lines = withoutComments.split('\n');
  lines.forEach((line, index) => {
    const values = [];
    if (/<(?:Text|MonoLabel|Display|Slash)\b/.test(line)) {
      for (const match of line.matchAll(/>\s*([^<>{][^<>{]*[A-Za-zÀ-ÿ][^<>{]*)\s*</g)) values.push(match[1].trim());
    }
    for (const match of line.matchAll(/\b(?:accessibilityLabel|accessibilityHint|label|placeholder|title|subtitle|description)=['"]([^'"]*[A-Za-zÀ-ÿ][^'"]*)['"]/g)) values.push(match[1].trim());
    for (const value of values) {
      if (!universal.test(value)) suspicious.push(`${relative}:${index + 1} ${JSON.stringify(value)}`);
    }
  });
}

console.log(`suspected visible hardcodes: ${suspicious.length}`);
suspicious.slice(0, 80).forEach((item) => console.log(`  ${item}`));
if (suspicious.length > 80) console.log(`  ... ${suspicious.length - 80} more`);

if (failures.length) {
  console.error(`\n${failures.length} blocking i18n issue(s):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log('blocking issues: 0');
}
