import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../../i18n/resources/en/quiz.json';
import es from '../../../i18n/resources/es/quiz.json';
import ptBR from '../../../i18n/resources/pt-BR/quiz.json';

const source = readFileSync(
  new URL('../WeeklySchedulePicker.tsx', import.meta.url),
  'utf8',
);

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Every `days.*` key the picker asks `t` for. The component is bound to the
 * `quiz` namespace (`useTranslation('quiz')`), so each of these must resolve
 * against the `days` block of the quiz bundle.
 */
const requestedKeys = [
  ...new Set(
    Array.from(stripComments(source).matchAll(/'(days\.[A-Za-z.]+)'/g), (m) => m[1]),
  ),
].sort();

/**
 * Resolves a dotted key, accepting either a plain string or i18next's plural
 * pair. `t('days.selectedCount', { count })` never looks up a bare
 * `selectedCount` — it resolves `_one`/`_other` — so a bundle carrying only
 * the pair is correct, and one carrying neither is the bug.
 */
function resolve(bundle: unknown, key: string): string | null {
  const path = key.split('.');
  let node: unknown = bundle;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node === 'string') return node;

  const parent = path.slice(0, -1).reduce<unknown>(
    (acc, segment) =>
      typeof acc === 'object' && acc !== null
        ? (acc as Record<string, unknown>)[segment]
        : undefined,
    bundle,
  );
  const leaf = path[path.length - 1];
  if (typeof parent !== 'object' || parent === null) return null;
  const forms = parent as Record<string, unknown>;
  const one = forms[`${leaf}_one`];
  const other = forms[`${leaf}_other`];
  return typeof one === 'string' && typeof other === 'string' ? other : null;
}

describe('WeeklySchedulePicker translation keys', () => {
  it('asks for the keys this test knows about', () => {
    // Guards the regex itself: if the picker starts asking for a key shape
    // this list does not cover, the suite below would silently check nothing.
    expect(requestedKeys.length).toBeGreaterThanOrEqual(7);
    expect(requestedKeys).toContain('days.flexibleStatus');
  });

  /**
   * Regression guard for the raw `days.flexibleStatus` that shipped on screen
   * in the flexible-schedule mode: the strings existed, but under
   * `aj.reactions.days.*` rather than the `days.*` block this component reads,
   * so i18next fell back to printing the key itself — in all three locales.
   */
  it.each([['en', en], ['pt-BR', ptBR], ['es', es]] as const)(
    'resolves every key it asks for in %s',
    (locale, bundle) => {
      for (const key of requestedKeys) {
        expect(resolve(bundle, key), `${key} nao resolve em ${locale}`).toBeTruthy();
      }
    },
  );

  it.each([['en', en], ['pt-BR', ptBR], ['es', es]] as const)(
    'never renders a key as if it were copy in %s',
    (_locale, bundle) => {
      for (const key of requestedKeys) {
        expect(resolve(bundle, key)).not.toBe(key);
      }
    },
  );

  /**
   * The flexible status line interpolates the chosen frequency, so both
   * plural forms must carry the placeholder — a form without it would render
   * a count-less sentence for exactly one value of `count`.
   */
  it.each([['en', en], ['pt-BR', ptBR], ['es', es]] as const)(
    'keeps both plural forms of the flexible status interpolated in %s',
    (_locale, bundle) => {
      const days = (bundle as { days: Record<string, unknown> }).days;
      expect(days.flexibleStatus_one).toContain('{{count}}');
      expect(days.flexibleStatus_other).toContain('{{count}}');
    },
  );
});
