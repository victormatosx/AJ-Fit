import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type Locale = 'pt-BR' | 'en' | 'es';

function lockedContent(locale: Locale) {
  const resource = JSON.parse(
    readFileSync(`src/i18n/resources/${locale}/home.json`, 'utf8'),
  ) as {
    progress: { photos: { locked: { title: string; addPhotosHint: string } } };
  };
  return resource.progress.photos.locked;
}

describe('Photo Vault protected locked title', () => {
  it('reuses the existing localized copy in pt-BR, en and es', () => {
    expect(lockedContent('pt-BR').title).toBe('Suas fotos estão protegidas');
    expect(lockedContent('en').title).toBe('Your photos are protected');
    expect(lockedContent('es').title).toBe('Tus fotos están protegidas');
  });
});

describe('the locked empty-gallery hint copy', () => {
  it('exists as a natural-case string in pt-BR, en and es, ready for the component to uppercase', () => {
    for (const locale of ['pt-BR', 'en', 'es'] as const) {
      const hint = lockedContent(locale).addPhotosHint;
      expect(typeof hint).toBe('string');
      expect(hint.length).toBeGreaterThan(0);
      // Same capitalization convention as `title`/`badge` in this same
      // section: stored naturally, uppercased by the component.
      expect(hint).not.toBe(hint.toUpperCase());
    }
  });

  it('reuses the exact approved pt-BR copy', () => {
    expect(lockedContent('pt-BR').addPhotosHint).toBe('Adicione suas fotos de evolução aqui');
  });
});
