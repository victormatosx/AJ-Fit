import { describe, expect, it } from 'vitest';

// Plain CommonJS module (mirrors plugins/rest-activity/index.js) —
// require() works fine from a Vitest/Node test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../../plugins/app-check-debug-token/index.js');

describe('app-check-debug-token config plugin', () => {
  describe('resolveLocalDebugToken', () => {
    it('resolves the token from AJFIT_APP_CHECK_DEBUG_TOKEN when set and non-blank', () => {
      expect(plugin.resolveLocalDebugToken({ AJFIT_APP_CHECK_DEBUG_TOKEN: 'abc-123' })).toBe(
        'abc-123',
      );
    });

    it('trims surrounding whitespace', () => {
      expect(plugin.resolveLocalDebugToken({ AJFIT_APP_CHECK_DEBUG_TOKEN: '  abc-123  ' })).toBe(
        'abc-123',
      );
    });

    it('treats a missing variable as unconfigured (undefined), never a fabricated default', () => {
      expect(plugin.resolveLocalDebugToken({})).toBeUndefined();
      expect(plugin.resolveLocalDebugToken(undefined as never)).toBeUndefined();
    });

    it('treats a blank/whitespace-only value as unconfigured', () => {
      expect(plugin.resolveLocalDebugToken({ AJFIT_APP_CHECK_DEBUG_TOKEN: '   ' })).toBeUndefined();
      expect(plugin.resolveLocalDebugToken({ AJFIT_APP_CHECK_DEBUG_TOKEN: '' })).toBeUndefined();
    });
  });

  it('exposes the exact env var and generated file names used by the native module', () => {
    expect(plugin.ENV_VAR_NAME).toBe('AJFIT_APP_CHECK_DEBUG_TOKEN');
    expect(plugin.GENERATED_FILE_NAME).toBe('AJFitAppCheckDebugTokenLocal.swift');
  });

  describe('generatedSwiftSource', () => {
    it('wraps its ENTIRE content — including the value — in #if DEBUG ... #endif', () => {
      const source = plugin.generatedSwiftSource('some-token-value');
      const lines = source.trim().split('\n');

      expect(lines[0]).not.toBe('#if DEBUG'); // header comment comes first
      expect(source).toMatch(/^\/\/.*\n(\/\/.*\n)*#if DEBUG\n/);
      expect(source.trim().endsWith('#endif')).toBe(true);

      // Nothing meaningful exists in the file outside the #if DEBUG block:
      // the only lines before `#if DEBUG` are `//`-prefixed comments, and
      // the only line after the value is `#endif`.
      const debugIndex = lines.indexOf('#if DEBUG');
      const endifIndex = lines.indexOf('#endif');
      expect(debugIndex).toBeGreaterThan(-1);
      expect(endifIndex).toBe(lines.length - 1);
      for (let i = 0; i < debugIndex; i++) {
        expect(lines[i].startsWith('//')).toBe(true);
      }
    });

    it('embeds the resolved value as a Swift string literal constant', () => {
      const source = plugin.generatedSwiftSource('some-token-value');
      expect(source).toContain(
        'let ajfitPinnedAppCheckDebugToken: String? = "some-token-value"',
      );
    });

    it('emits `nil` — never an empty string or fabricated value — when unset', () => {
      const source = plugin.generatedSwiftSource(undefined);
      expect(source).toContain('let ajfitPinnedAppCheckDebugToken: String? = nil');
    });

    it('escapes an embedded quote or backslash safely (defensive; token is expected to be a plain UUID)', () => {
      const source = plugin.generatedSwiftSource('weird"value\\here');
      expect(source).toContain(
        String.raw`let ajfitPinnedAppCheckDebugToken: String? = "weird\"value\\here"`,
      );
    });
  });
});
