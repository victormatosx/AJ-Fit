import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authScreen = readFileSync(new URL('../AuthScreen.tsx', import.meta.url), 'utf8');

describe('AuthScreen legal acceptance feedback', () => {
  it('clears the acceptance warning as soon as the checkbox is accepted', () => {
    expect(authScreen).toContain('onPress={handleLegalAcceptanceToggle}');
    expect(authScreen).toMatch(
      /if \(nextAccepted\) \{\s+setError\(\(currentError\) =>\s+currentError === t\('validation\.legalAcceptanceRequired'\) \? null : currentError,/,
    );
  });
});
