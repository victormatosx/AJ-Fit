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
      /signUp: \(email, password, name, answers, legalAccepted, prepared\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toContain(
      'signIn: (email, password) => identityOperationFlight.run',
    );
    expect(authContext).toMatch(
      /signInWithProvider: \(provider, answers, name, legalAccepted, prepared\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toMatch(
      /completeLinkingWithPassword: \(email, password, answers, name, legalAccepted\) =>\s+identityOperationFlight\.run/,
    );
    expect(authContext).toMatch(
      /completeLinkingWithProvider: \(provider, answers, name, legalAccepted\) =>\s+identityOperationFlight\.run/,
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

  // Phase 3.1: a delayed Firestore response for a UID that already logged
  // out must never reach committed state, the presentation cache state, or
  // disk. That guard lives here (generation counter), not in
  // profilePresentationCache.ts — see profilePresentationCache.test.ts for
  // what the primitive itself guarantees (disk-level UID isolation).
  it('discards a superseded generation before it can commit state or write the presentation cache', () => {
    const start = authContext.indexOf('const loadUserState = useCallback');
    const end = authContext.indexOf('\n  }, []);', start);
    const loadUserState = authContext.slice(start, end);

    const supersededCheckIndex = loadUserState.indexOf('if (superseded) {');
    const dispatchSucceededIndex = loadUserState.indexOf("type: 'load-succeeded'");
    const setCachedPresentationIndex = loadUserState.indexOf('setCachedPresentation({');
    const writeCacheIndex = loadUserState.indexOf('writeProfilePresentationCache(uid, nextProfile');

    expect(supersededCheckIndex).toBeGreaterThan(-1);
    expect(dispatchSucceededIndex).toBeGreaterThan(-1);
    expect(setCachedPresentationIndex).toBeGreaterThan(-1);
    expect(writeCacheIndex).toBeGreaterThan(-1);

    // The superseded check must return before any of these run for a stale
    // generation — otherwise a late response from a logged-out UID could
    // commit its profile/questionnaire or overwrite the cache after another
    // UID has already logged in.
    expect(supersededCheckIndex).toBeLessThan(dispatchSucceededIndex);
    expect(supersededCheckIndex).toBeLessThan(setCachedPresentationIndex);
    expect(supersededCheckIndex).toBeLessThan(writeCacheIndex);
  });

  it('bumps the generation counter synchronously on logout, before any await can let a stale response through', () => {
    const logoutStart = authContext.lastIndexOf('logout: () =>');
    const logout = authContext.slice(
      logoutStart,
      authContext.indexOf('refreshEmailVerification:', logoutStart),
    );
    const clearUserStateIndex = logout.indexOf('clearUserState()');
    const firstAwaitIndex = logout.indexOf('await ');
    expect(clearUserStateIndex).toBeGreaterThan(-1);
    expect(firstAwaitIndex).toBeGreaterThan(-1);
    expect(clearUserStateIndex).toBeLessThan(firstAwaitIndex);

    const clearUserStateBody = authContext.slice(
      authContext.indexOf('const clearUserState = useCallback'),
      authContext.indexOf('}, []);', authContext.indexOf('const clearUserState = useCallback')),
    );
    expect(clearUserStateBody).toContain('generationRef.current += 1');
  });
});
