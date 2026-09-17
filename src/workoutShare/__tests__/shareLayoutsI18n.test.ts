import { describe, expect, it } from 'vitest';

import ptBR from '../../i18n/resources/pt-BR/workout.json';
import en from '../../i18n/resources/en/workout.json';
import es from '../../i18n/resources/es/workout.json';
import { WORKOUT_SHARE_LAYOUTS } from '../layouts';

const LOCALES = { 'pt-BR': ptBR, en, es } as const;

function readKey(resource: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, segment) => {
    if (node && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, resource);
}

describe('workout share layout i18n', () => {
  it('has a non-empty label for every layout, in every supported language', () => {
    for (const layout of WORKOUT_SHARE_LAYOUTS) {
      for (const [locale, resource] of Object.entries(LOCALES)) {
        const value = readKey(resource, layout.labelKey);
        expect(value, `${locale} is missing ${layout.labelKey}`).toBeTypeOf('string');
        expect((value as string).length, `${locale}'s ${layout.labelKey} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every layout a distinct label within each language', () => {
    for (const [locale, resource] of Object.entries(LOCALES)) {
      const labels = WORKOUT_SHARE_LAYOUTS.map((layout) => readKey(resource, layout.labelKey));
      expect(new Set(labels).size, `${locale} has duplicate layout labels`).toBe(labels.length);
    }
  });
});
