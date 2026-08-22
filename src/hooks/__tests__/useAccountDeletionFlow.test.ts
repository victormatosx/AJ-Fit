import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Fase 12 — structural guarantees for `useAccountDeletionFlow.ts`. No
 * component renderer exists in this Node-only suite (vitest.config.mts,
 * same limitation documented in `usePremiumCapabilities.test.ts`) — the
 * REAL behavioral coverage for
 * every piece this hook composes already exists and is exhaustive:
 *   - `accountDeletionReauth.test.ts` — password/Google/Apple reauth.
 *   - `accountDeletionOrchestrator.test.ts` — Google→Apple→commit sequencing.
 *   - `accountDeletionShutdown.test.ts` — local cleanup + logout.
 * This file only asserts the hook stays a thin, correct composition of
 * those — never a second implementation of any of them.
 */

const SOURCE = readFileSync('src/hooks/useAccountDeletionFlow.ts', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('useAccountDeletionFlow — composition, not reimplementation', () => {
  it('reuses accountDeletionReauth.ts for every reauthentication concern', () => {
    expect(SOURCE).toContain("from '../services/accountDeletionReauth'");
    for (const symbol of [
      'needsAccountDeletionReauthentication',
      'startAccountDeletionReauthentication',
    ]) {
      expect(CODE).toContain(`${symbol}(`);
    }
  });

  it('is the ONLY caller of requestAccountDeletionWithProviderPreparation — never calls httpsCallable/requestAccountDeletion directly', () => {
    expect(SOURCE).toContain("from '../services/accountDeletionOrchestrator'");
    expect(CODE).toContain('requestAccountDeletionWithProviderPreparation(preparedAppleAuthorizationCode)');
    expect(CODE).not.toContain('httpsCallable');
    expect(CODE).not.toContain("'requestAccountDeletion'");
  });

  it('reuses finalizeAccountDeletionClientShutdown (Fase 5/11) instead of a second cleanup routine', () => {
    expect(SOURCE).toContain("from '../services/accountDeletionShutdown'");
    expect(CODE).toContain('finalizeAccountDeletionClientShutdown(');
    // No parallel cleanup — never touches AsyncStorage/SecureStore/FileSystem itself.
    for (const forbidden of ['AsyncStorage', 'SecureStore', 'expo-file-system']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('derives reauthentication providers via the shared lib/authProviders helper, never invents its own list', () => {
    expect(SOURCE).toContain("from '../lib/authProviders'");
    expect(CODE).toContain('getReauthenticationProviders(user)');
  });
});

describe('useAccountDeletionFlow — double-tap protection (Fase 12 §18)', () => {
  it('confirmDeletion is guarded by operationLock and cannot run concurrently', () => {
    const body = CODE.slice(
      CODE.indexOf('const confirmDeletion = useCallback(async () => {'),
      CODE.indexOf('}, [logout, user]);'),
    );
    expect(body).toContain('if (operationLock.current) return;');
    expect(body).toContain('operationLock.current = true;');
    expect(body).toContain('operationLock.current = false;');
  });

  it('submitReauth is guarded by operationLock', () => {
    const body = CODE.slice(
      CODE.indexOf('const submitReauth = useCallback('),
      CODE.indexOf('[reauthPassword, resetSensitiveState],'),
    );
    expect(body).toContain('if (operationLock.current) return;');
    expect(body).toContain('operationLock.current = true;');
  });

});

describe('useAccountDeletionFlow — accepted request never calls the callable again', () => {
  it('the accepted branch never re-invokes requestAccountDeletionWithProviderPreparation or creates a second operation', () => {
    const acceptedBranch = CODE.slice(
      CODE.indexOf("case 'accepted': {"),
      CODE.indexOf("case 'identity-changed':"),
    );
    expect(acceptedBranch).not.toContain('requestAccountDeletionWithProviderPreparation(');
    expect(acceptedBranch).toContain('finalizeAccountDeletionClientShutdown(');
  });

  it('a shutdown failure is caught and never rejects/rethrows — the backend remains authoritative regardless (Fase 12 §25)', () => {
    const acceptedBranch = CODE.slice(
      CODE.indexOf("case 'accepted': {"),
      CODE.indexOf("case 'identity-changed':"),
    );
    expect(acceptedBranch).toMatch(/finalizeAccountDeletionClientShutdown\([^)]*\)\.catch\(/);
  });

  it('requiresReconciliation is surfaced as an issue, never silently swallowed (Fase 12 §35)', () => {
    const acceptedBranch = CODE.slice(
      CODE.indexOf("case 'accepted': {"),
      CODE.indexOf("case 'identity-changed':"),
    );
    expect(acceptedBranch).toContain('result.requiresReconciliation');
    expect(acceptedBranch).toContain("setIssue('reconciliationRequired')");
  });
});

describe('useAccountDeletionFlow — orchestrator failure statuses never silently succeed', () => {
  for (const status of [
    'identity-changed',
    'google-revocation-failed',
    'apple-material-missing',
    'request-failed',
  ]) {
    it(`handles "${status}" explicitly (not just a default/fallthrough)`, () => {
      expect(CODE).toContain(`case '${status}':`);
    });
  }

  it('a stale session (failed-precondition/unauthenticated) sends the user back to reauth, never a dead end', () => {
    const requestFailedBranch = CODE.slice(
      CODE.indexOf("case 'request-failed':"),
      CODE.indexOf("case 'request-failed':") + 700,
    );
    expect(requestFailedBranch).toContain("'failed-precondition'");
    expect(requestFailedBranch).toContain("setStepState('reauth')");
  });

  it('Fase 16: apple-material-missing sends the user back to reauth — the orchestrator never opens Apple itself to recover', () => {
    const branch = CODE.slice(
      CODE.indexOf("case 'apple-material-missing':"),
      CODE.indexOf("case 'apple-material-missing':") + 400,
    );
    expect(branch).toContain("setIssue('applePreparationUnavailable')");
    expect(branch).toContain("setStepState('reauth')");
  });

  it('Fase 16: an Apple validation failure (aborted) sends the user back to reauth — the material was already consumed and Apple codes are single-use', () => {
    const requestFailedBranch = CODE.slice(
      CODE.indexOf("case 'request-failed':"),
      CODE.indexOf("case 'request-failed':") + 1600,
    );
    const abortedIndex = requestFailedBranch.indexOf("'aborted'");
    expect(abortedIndex).toBeGreaterThan(-1);
    const abortedBlock = requestFailedBranch.slice(abortedIndex, abortedIndex + 600);
    expect(abortedBlock).toContain("setIssue('appleValidationFailed')");
    expect(abortedBlock).toContain("setStepState('reauth')");
  });
});

describe('useAccountDeletionFlow — Fase 16: Apple material lifecycle (single-use, memory-only)', () => {
  it('confirmDeletion reads and clears appleAuthorizationCodeRef BEFORE calling the orchestrator — consume-and-clear, never resent on retry', () => {
    const body = CODE.slice(
      CODE.indexOf('const confirmDeletion = useCallback(async () => {'),
      CODE.indexOf('requestAccountDeletionWithProviderPreparation(preparedAppleAuthorizationCode)'),
    );
    expect(body).toContain('appleAuthorizationCodeRef.current');
    expect(body).toContain('appleAuthorizationCodeRef.current = null');
  });

  it('reset() wipes appleAuthorizationCodeRef — abandoning the flow discards any captured material', () => {
    const resetBody = CODE.slice(
      CODE.indexOf('const reset = useCallback(() => {'),
      CODE.indexOf('}, [resetSensitiveState]);'),
    );
    expect(resetBody).toContain('appleAuthorizationCodeRef.current = null');
  });

  it('submitReauth stores appleAuthorizationCode from a completed outcome (undefined for password/Google clears any stale material)', () => {
    const body = CODE.slice(CODE.indexOf('const submitReauth = useCallback('), CODE.indexOf('const confirmDeletion'));
    expect(body).toContain('appleAuthorizationCodeRef.current = outcome.appleAuthorizationCode');
  });

  it('appleAuthorizationCodeRef is never spread into AsyncStorage/SecureStore/Firestore/logs — this hook has no such call at all', () => {
    for (const forbidden of ['AsyncStorage', 'SecureStore', 'setDoc', 'console.log', 'logInfo', 'logWarn']) {
      expect(CODE).not.toContain(forbidden);
    }
  });
});

describe('useAccountDeletionFlow — sensitive-state cleanup', () => {
  it('reset() clears sensitive reauthentication state', () => {
    const resetBody = CODE.slice(
      CODE.indexOf('const reset = useCallback(() => {'),
      CODE.indexOf('}, [resetSensitiveState]);'),
    );
    expect(resetBody).toContain('resetSensitiveState()');
  });

  it('resetSensitiveState clears every sensitive field this hook holds', () => {
    const body = CODE.slice(
      CODE.indexOf('const resetSensitiveState = useCallback(() => {'),
      CODE.indexOf('}, []);'),
    );
    expect(body).toContain('setReauthPasswordState(');
    expect(body).toContain('setReauthProvider(');
  });

  it('never logs the password', () => {
    for (const forbidden of ['console.log', 'logInfo', 'logError']) {
      expect(CODE).not.toContain(forbidden);
    }
  });
});
