import { describe, expect, it } from 'vitest';

import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';

const locales = [
  ['pt-BR', ptBR.progress.photos.compare],
  ['en', en.progress.photos.compare],
  ['es', es.progress.photos.compare],
] as const;

describe('progress comparison poster copy', () => {
  it.each(locales)('%s ships every visible poster label', (_locale, compare) => {
    for (const key of [
      'posterHeadlinePrimary',
      'posterHeadlineAccent',
      'posterSubheadline',
      'posterDaySingular',
      'posterDayPlural',
      'posterFooterMethod',
      'posterFooterYou',
      'posterFooterEvolve',
      'posterHashtag',
      'before',
      'after',
    ] as const) {
      expect(compare[key].trim()).not.toBe('');
    }
  });

  it.each(locales)('%s keeps the social headline deliberately compact', (_locale, compare) => {
    expect(compare.posterHeadlinePrimary.length).toBeLessThanOrEqual(10);
    expect(compare.posterHeadlineAccent.length).toBeLessThanOrEqual(10);
    expect(compare.posterSubheadline.length).toBeLessThanOrEqual(38);
  });

  it.each(locales)('%s keeps AJ Fit as branding, not localized copy', (_locale, compare) => {
    expect(compare.posterHashtag).toBe('#AJFIT');
  });

  it('uses natural AJ Fit messaging in each language', () => {
    expect(ptBR.progress.photos.compare).toMatchObject({
      posterHeadlinePrimary: 'Evolução',
      posterHeadlineAccent: 'Real',
      posterFooterMethod: 'O método funciona.',
      posterFooterEvolve: 'evolui.',
    });
    expect(en.progress.photos.compare).toMatchObject({
      posterHeadlinePrimary: 'Real',
      posterHeadlineAccent: 'Progress',
      posterFooterMethod: 'The method works.',
      posterFooterEvolve: 'progress.',
    });
    expect(es.progress.photos.compare).toMatchObject({
      posterHeadlinePrimary: 'Evolución',
      posterHeadlineAccent: 'Real',
      posterFooterMethod: 'El método funciona.',
      posterFooterEvolve: 'evolucionas.',
    });
  });
});
