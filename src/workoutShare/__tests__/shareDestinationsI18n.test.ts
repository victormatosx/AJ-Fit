import { describe, expect, it } from 'vitest';

import ptBR from '../../i18n/resources/pt-BR/workout.json';
import en from '../../i18n/resources/en/workout.json';
import es from '../../i18n/resources/es/workout.json';
import { WORKOUT_SHARE_DESTINATIONS } from '../shareDestinations';

const LOCALES = { 'pt-BR': ptBR, en, es } as const;

function readKey(resource: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, segment) => {
    if (node && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, resource);
}

describe('workout share destination i18n', () => {
  it('has a non-empty label for every destination, in every supported language', () => {
    for (const destination of WORKOUT_SHARE_DESTINATIONS) {
      for (const [locale, resource] of Object.entries(LOCALES)) {
        const value = readKey(resource, destination.labelKey);
        expect(value, `${locale} is missing ${destination.labelKey}`).toBeTypeOf('string');
        expect((value as string).length, `${locale}'s ${destination.labelKey} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('has the shareTo section title in every supported language', () => {
    for (const [locale, resource] of Object.entries(LOCALES)) {
      const value = readKey(resource, 'done.shareComposer.shareTo');
      expect(value, `${locale} is missing done.shareComposer.shareTo`).toBeTypeOf('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('has the destination-fallback message in every supported language', () => {
    for (const [locale, resource] of Object.entries(LOCALES)) {
      const value = readKey(resource, 'done.shareComposer.destinationFallback');
      expect(value, `${locale} is missing done.shareComposer.destinationFallback`).toBeTypeOf('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});
