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
      /signUp: \(email, password, name, answers, prepared\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toContain(
      'signIn: (email, password) => identityOperationFlight.run',
    );
    expect(authContext).toMatch(
      /signInWithProvider: \(provider, answers, name\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toMatch(
      /completeLinkingWithPassword: \(email, password, answers, name\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toMatch(
      /completeLinkingWithProvider: \(provider, answers, name\) =>\s+identityOperationFlight\.run/,
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

  it('skips the auth-state listener\'s own load while an identity operation owns this uid (Phase 1, Part A — signup flicker fix)', () => {
    const listenerBody = authContext.slice(
      authContext.indexOf('subscribeToAuthState(async (nextUser)'),
      authContext.indexOf('return unsubscribe;'),
    );
    const guardIndex = listenerBody.indexOf('identityOperationFlight.isRunning()');
    const loadCallIndex = listenerBody.indexOf('loadUserState(nextUser.uid)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(loadCallIndex).toBeGreaterThan(-1);
    // The guard must be checked BEFORE the listener's own load, not after.
    expect(guardIndex).toBeLessThan(loadCallIndex);
  });

  it('also closes the pre-render gap synchronously across AuthScreen handlers', () => {
    expect(authScreen).toContain('const operationLock = useRef(false)');
    expect(authScreen.match(/operationLock\.current = true/g)).toHaveLength(4);
    expect(authScreen.match(/operationLock\.current = false/g)).toHaveLength(4);
    expect(authScreen.match(/operationLock\.current \|\| busy/g)).toHaveLength(4);
  });
});
