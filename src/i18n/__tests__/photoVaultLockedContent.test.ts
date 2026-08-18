import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function lockedTitle(locale: 'pt-BR' | 'en' | 'es'): string {
  const resource = JSON.parse(
    readFileSync(`src/i18n/resources/${locale}/home.json`, 'utf8'),
  ) as {
    progress: { photos: { locked: { title: string } } };
  };
  return resource.progress.photos.locked.title;
}

describe('Photo Vault protected locked title', () => {
  it('reuses the existing localized copy in pt-BR, en and es', () => {
    expect(lockedTitle('pt-BR')).toBe('Suas fotos estão protegidas');
    expect(lockedTitle('en')).toBe('Your photos are protected');
    expect(lockedTitle('es')).toBe('Tus fotos están protegidas');
  });
});
