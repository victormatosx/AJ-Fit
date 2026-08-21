import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('authentication enumeration boundaries', () => {
  it('routes password login through the private sign-in error mapper', () => {
    const screen = read('src/screens/AuthScreen.tsx');

    expect(screen).toContain("return t('errors.invalidLogin')");
    expect(screen).toContain("mode === 'login'");
    expect(screen).toContain('localizedSignInError(err, t)');
  });

  it('keeps reset success conditional and signup failure non-confirmatory in every locale', () => {
    const expectations = {
      en: { conditional: 'If a compatible account exists', forbidden: 'already registered' },
      es: { conditional: 'Si existe una cuenta compatible', forbidden: 'ya está registrado' },
      'pt-BR': { conditional: 'Se existir uma conta compatível', forbidden: 'já está cadastrado' },
    } as const;

    for (const [locale, expected] of Object.entries(expectations)) {
      const resource = JSON.parse(
        read(`src/i18n/resources/${locale}/auth.json`),
      ) as {
        reset: { success: string };
        errors: { emailInUse: string; invalidLogin: string };
      };

      expect(resource.reset.success).toContain(expected.conditional);
      expect(resource.errors.emailInUse.toLowerCase()).not.toContain(
        expected.forbidden,
      );
      expect(resource.errors.invalidLogin.length).toBeGreaterThan(0);
    }
  });

  it('retains the sanitized logger and the 60-second reset cooldown', () => {
    const logger = read('src/lib/logger.ts');
    const cooldown = read('src/lib/passwordResetCooldown.ts');

    expect(logger).toContain("'[redacted-email]'");
    expect(logger).toContain("if (SECRET_KEY.test(key)) return '[redacted]'" );
    expect(cooldown).toContain('PASSWORD_RESET_COOLDOWN_MS = 60_000');
  });
});
