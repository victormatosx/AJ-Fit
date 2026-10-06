import { describe, expect, it } from 'vitest';

import ptBR from '../../i18n/resources/pt-BR/workout.json';
import en from '../../i18n/resources/en/workout.json';
import es from '../../i18n/resources/es/workout.json';
import { WORKOUT_SHARE_ART_LAYOUTS } from '../artLayouts';

const LOCALES = { 'pt-BR': ptBR, en, es } as const;

const EXTRA_KEYS = [
  'done.shareComposer.modeSelector.photo',
  'done.shareComposer.modeSelector.art',
  'done.shareComposer.artActions.copy',
  'done.shareComposer.artActions.save',
  'done.shareComposer.artCopied',
  'done.shareComposer.artCopyUnsupported',
  'done.shareComposer.artCopyFailed',
  'done.shareComposer.artSaved',
  'done.shareComposer.artSaveFailed',
  'done.shareComposer.artPrNewRecord',
  'done.shareComposer.artPerformanceVolume',
  'done.shareComposer.artPerformanceReps',
];

function readKey(resource: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, segment) => {
    if (node && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, resource);
}

describe('workout share ARTE i18n', () => {
  it('has a non-empty label for every ARTE layout, in every supported language', () => {
    for (const layout of WORKOUT_SHARE_ART_LAYOUTS) {
      for (const [locale, resource] of Object.entries(LOCALES)) {
        const value = readKey(resource, layout.labelKey);
        expect(value, `${locale} is missing ${layout.labelKey}`).toBeTypeOf('string');
        expect((value as string).length, `${locale}'s ${layout.labelKey} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every ARTE layout a distinct label within each language', () => {
    for (const [locale, resource] of Object.entries(LOCALES)) {
      const labels = WORKOUT_SHARE_ART_LAYOUTS.map((layout) => readKey(resource, layout.labelKey));
      expect(new Set(labels).size, `${locale} has duplicate ARTE layout labels`).toBe(labels.length);
    }
  });

  it('has every ARTE composer string in every supported language', () => {
    for (const key of EXTRA_KEYS) {
      for (const [locale, resource] of Object.entries(LOCALES)) {
        const value = readKey(resource, key);
        expect(value, `${locale} is missing ${key}`).toBeTypeOf('string');
        expect((value as string).length, `${locale}'s ${key} is empty`).toBeGreaterThan(0);
      }
    }
  });
});
