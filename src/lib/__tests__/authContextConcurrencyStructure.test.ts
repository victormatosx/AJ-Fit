import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authContext = readFileSync(
  new URL('../../state/AuthContext.tsx', import.meta.url),
  'utf8',
);
const authScreen = readFileSync(
  new URL('../../screens/AuthScreen.tsx', import.meta.url),
  'utf8',
);

describe('AuthContext concurrency wiring', () => {
  it('guards every complete identity-changing workflow with one shared flight', () => {
    expect(authContext.match(/identityOperationFlight\.run/g)).toHaveLength(6);
    expect(authContext).toMatch(
      /signUp: \(email, password, name, answers\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toContain(
      'signIn: (email, password) => identityOperationFlight.run',
    );
    expect(authContext).toMatch(
      /signInWithProvider: \(provider, answers\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toMatch(
      /completeLinkingWithPassword: \(email, password, answers\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toMatch(
      /completeLinkingWithProvider: \(provider, answers\) =>\s+identityOperationFlight\.run/,
    );
    const logoutStart = authContext.lastIndexOf('logout: () =>');
    const logout = authContext.slice(
      logoutStart,
      authContext.indexOf('refreshEmailVerification:', logoutStart),
    );
    expect(logout).toContain('identityOperationFlight.run(async () =>');
    expect(logout.indexOf('await cleanupRestSessionArtifacts()')).toBeLessThan(
      logout.indexOf('await signOutUser()'),
    );
  });

  it('keeps reset independent while guarding the complete reset operation', () => {
    expect(authContext).toContain(
      'reset: (email) => resetOperationFlight.run(() => resetPassword(email))',
    );
  });

  it('also closes the pre-render gap synchronously across AuthScreen handlers', () => {
    expect(authScreen).toContain('const operationLock = useRef(false)');
    expect(authScreen.match(/operationLock\.current = true/g)).toHaveLength(4);
    expect(authScreen.match(/operationLock\.current = false/g)).toHaveLength(4);
    expect(authScreen.match(/operationLock\.current \|\| busy/g)).toHaveLength(4);
  });
});
