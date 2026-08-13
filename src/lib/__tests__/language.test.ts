import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
} from '../../types/language';

describe('language contract', () => {
  it('exposes exactly pt-BR, en, es as supported languages', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(['en', 'es', 'pt-BR']);
  });

  it('keeps pt-BR as the default (Phase 0 — no auto-detection yet)', () => {
    expect(DEFAULT_LANGUAGE).toBe('pt-BR');
  });

  it('recognizes every supported code as valid', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(isSupportedLanguage(lang)).toBe(true);
    }
  });

  it('rejects unsupported strings, casing variants and non-strings', () => {
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage('pt')).toBe(false);
    expect(isSupportedLanguage('pt-PT')).toBe(false);
    expect(isSupportedLanguage('EN')).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(isSupportedLanguage(123)).toBe(false);
    expect(isSupportedLanguage({})).toBe(false);
  });
});
