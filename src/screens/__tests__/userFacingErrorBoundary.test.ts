import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('user-facing error boundaries', () => {
  it('does not pass raw provider messages from subscription or auth flows', () => {
    for (const path of [
      'services/revenueCatService.ts',
      'state/SubscriptionContext.tsx',
      'screens/PaywallScreen.tsx',
      'screens/AuthScreen.tsx',
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/(?:outcome|error|err)\.message/);
    }
  });

  it('keeps technical auth configuration details out of localized copy', () => {
    const source = read('screens/AuthScreen.tsx');
    expect(source).not.toMatch(/\.env|SHA-1|OAuth Client ID|client ID|Firebase rules/i);
  });
});
