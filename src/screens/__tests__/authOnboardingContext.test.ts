import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const authScreen = read('screens/AuthScreen.tsx');

/**
 * Regression guard for Fase G (docs/onboarding_funnel_architecture.md
 * §Auth): the funnel's `entryContext` must stay copy-only. This locks two
 * things — the prop exists and picks the initial mode/name, and it never
 * appears anywhere near the sensitive auth operations.
 */
describe('AuthScreen entryContext boundary', () => {
  it('accepts an optional, copy-only entryContext prop', () => {
    expect(authScreen).toContain('entryContext?: OnboardingAuthContext | null');
    expect(authScreen).toContain("entryContext?.origin === 'directLogin' ? 'login' : 'signup'");
    expect(authScreen).toContain('entryContext?.name ?? ');
  });

  it('keeps every sensitive auth operation untouched by entryContext', () => {
    for (const sensitiveOp of [
      'await signUp(email, password, name, quiz, preparedWorkoutProgram)',
      'await signIn(email, password)',
      '() => reset(email)',
      'await signInWithProvider(provider, quiz, name)',
      'await completeLinkingWithPassword(linking.email, linkPassword, quiz, name)',
      'await completeLinkingWithProvider(existing, quiz, name)',
    ]) {
      expect(authScreen).toContain(sensitiveOp);
    }
    // None of the operation call sites reference entryContext directly —
    // only the two initial-state lines above may mention it.
    const opLines = authScreen
      .split('\n')
      .filter((line) => /signUp\(|signIn\(|reset\(|signInWithProvider\(|completeLinkingWith/.test(line));
    for (const line of opLines) {
      expect(line).not.toContain('entryContext');
    }
  });
});
