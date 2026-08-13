import { describe, it, expect } from 'vitest';
import { normalizeLanguage } from '../normalizeLanguage';

describe('normalizeLanguage', () => {
  describe('Portuguese variants → pt-BR', () => {
    it.each(['pt', 'pt-BR', 'pt-PT', 'pt-AO', 'pt-MZ', 'PT-BR', 'PT'])(
      'maps %s to pt-BR',
      (input) => {
        expect(normalizeLanguage(input)).toBe('pt-BR');
      },
    );
  });

  describe('English variants → en', () => {
    it.each(['en', 'en-US', 'en-GB', 'en-AU', 'EN-us'])(
      'maps %s to en',
      (input) => {
        expect(normalizeLanguage(input)).toBe('en');
      },
    );
  });

  describe('Spanish variants → es', () => {
    it.each(['es', 'es-ES', 'es-MX', 'es-AR', 'ES'])(
      'maps %s to es',
      (input) => {
        expect(normalizeLanguage(input)).toBe('es');
      },
    );
  });

  describe('unsupported and invalid → en', () => {
    it.each([
      ['unsupported language', 'fr-FR'],
      ['another unsupported language', 'de-DE'],
      ['single unsupported code', 'ja'],
      ['empty string', ''],
      ['whitespace only', '   '],
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['boolean', true],
      ['object', {}],
      ['array', []],
    ])('maps %s (%s) to en', (_label, input) => {
      expect(normalizeLanguage(input as unknown)).toBe('en');
    });
  });
});
