import { describe, expect, it, vi } from 'vitest';
import {
  createInitialProfileLoadState,
  isRetryableFirestoreError,
  reduceProfileLoad,
  withFirestoreRetry,
  type ProfileLoadState,
} from '../profileLoadState';

type Profile = { name: string };
type Questionnaire = { id: string };

function initial(): ProfileLoadState<Profile, Questionnaire> {
  return createInitialProfileLoadState<Profile, Questionnaire>();
}

describe('reduceProfileLoad — questionnaire resolution state machine', () => {
  it('starts as unknown, not loading — never a lie about a load that never happened', () => {
    const state = initial();
    expect(state.questionnaireResolution).toBe('unknown');
    expect(state.loading).toBe(false);
    expect(state.profile).toBeNull();
    expect(state.questionnaire).toBeNull();
  });

  it('load-started moves to loading, for a brand-new identity clears any previous data', () => {
    const loadingA = reduceProfileLoad(initial(), { type: 'load-started', uid: 'uid-A', generation: 1 });
    const foundA = reduceProfileLoad(loadingA, {
      type: 'load-succeeded',
      uid: 'uid-A',
      generation: 1,
      profile: { name: 'A' },
      questionnaire: { id: 'q-A' },
    });
    expect(foundA.questionnaireResolution).toBe('found');

    // A different account logs in — must not carry uid-A's data into uid-B's
    // loading window, even transiently.
    const startedB = reduceProfileLoad(foundA, { type: 'load-started', uid: 'uid-B', generation: 2 });
    expect(startedB.questionnaireResolution).toBe('loading');
    expect(startedB.loading).toBe(true);
    expect(startedB.profile).toBeNull();
    expect(startedB.questionnaire).toBeNull();
  });

  it('load-started for the SAME uid AFTER it already bootstrapped is a BACKGROUND refresh — loading/questionnaireResolution stay as-is, data is preserved', () => {
    const found = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      {
        type: 'load-succeeded',
        uid: 'uid-A',
        generation: 1,
        profile: { name: 'A' },
        questionnaire: { id: 'q-A' },
      },
    );
    const refreshing = reduceProfileLoad(found, {
      type: 'load-started',
      uid: 'uid-A',
      generation: 2,
    });
    // Root-cause fix: a background refresh (e.g. EditProfileScreen calling
    // refreshProfile() after the user is already inside AppShell) must
    // NEVER reintroduce either of the two conditions resolvePremiumGate
    // treats as gate-closing (`loading: true` / a non-'found' resolution) —
    // doing so used to unmount the entire AppShell tree for an in-session
    // reload that has nothing to do with identity or bootstrap.
    expect(refreshing.loading).toBe(false);
    expect(refreshing.questionnaireResolution).toBe('found');
    expect(refreshing.bootstrappedUid).toBe('uid-A');
    // Known-good data from the previous successful load survives the
    // refresh's loading window — never wiped just because a new attempt
    // started.
    expect(refreshing.profile).toEqual({ name: 'A' });
    expect(refreshing.questionnaire).toEqual({ id: 'q-A' });
  });

  it('load-started for a NEW uid is always a bootstrap load, even if a different uid was previously bootstrapped', () => {
    const foundA = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      {
        type: 'load-succeeded',
        uid: 'uid-A',
        generation: 1,
        profile: { name: 'A' },
        questionnaire: { id: 'q-A' },
      },
    );
    const startedB = reduceProfileLoad(foundA, {
      type: 'load-started',
      uid: 'uid-B',
      generation: 2,
    });
    expect(startedB.loading).toBe(true);
    expect(startedB.questionnaireResolution).toBe('loading');
    expect(startedB.profile).toBeNull();
    expect(startedB.questionnaire).toBeNull();
  });

  it('1) load-succeeded with a questionnaire → found', () => {
    const state = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      {
        type: 'load-succeeded',
        uid: 'uid-A',
        generation: 1,
        profile: { name: 'A' },
        questionnaire: { id: 'q-1' },
      },
    );
    expect(state.questionnaireResolution).toBe('found');
    expect(state.loading).toBe(false);
    expect(state.questionnaire).toEqual({ id: 'q-1' });
  });

  it('2) load-succeeded with questionnaire: null (a genuinely empty query) → not_found', () => {
    const state = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      { type: 'load-succeeded', uid: 'uid-A', generation: 1, profile: { name: 'A' }, questionnaire: null },
    );
    expect(state.questionnaireResolution).toBe('not_found');
    expect(state.questionnaire).toBeNull();
  });

  it('3) still mid-flight (only load-started dispatched) → loading, never found/not_found', () => {
    const state = reduceProfileLoad(initial(), { type: 'load-started', uid: 'uid-A', generation: 1 });
    expect(state.questionnaireResolution).toBe('loading');
  });

  it('4) load-failed (e.g. permission-denied) → error, NEVER not_found — the exact bug this file exists to prevent', () => {
    const state = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      { type: 'load-failed', uid: 'uid-A', generation: 1, error: { code: 'permission-denied' } },
    );
    expect(state.questionnaireResolution).toBe('error');
    expect(state.questionnaireResolution).not.toBe('not_found');
  });

  it('a failed load never erases a previously-committed found questionnaire (e.g. a background refresh that fails transiently)', () => {
    const found = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      {
        type: 'load-succeeded',
        uid: 'uid-A',
        generation: 1,
        profile: { name: 'A' },
        questionnaire: { id: 'q-1' },
      },
    );
    const refreshing = reduceProfileLoad(found, { type: 'load-started', uid: 'uid-A', generation: 2 });
    const failed = reduceProfileLoad(refreshing, {
      type: 'load-failed',
      uid: 'uid-A',
      generation: 2,
      error: { code: 'unavailable' },
    });
    expect(failed.questionnaireResolution).toBe('error');
    // The last KNOWN value survives — the UI/gate must decide what to do
    // with 'error', but the underlying data is not destroyed by it.
    expect(failed.questionnaire).toEqual({ id: 'q-1' });
    expect(failed.profile).toEqual({ name: 'A' });
  });

  it('9) retry manual após ERROR: a fresh load-started + load-succeeded after an error cleanly resolves found/not_found', () => {
    const errored = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      { type: 'load-failed', uid: 'uid-A', generation: 1, error: { code: 'unavailable' } },
    );
    expect(errored.questionnaireResolution).toBe('error');

    const retrying = reduceProfileLoad(errored, { type: 'load-started', uid: 'uid-A', generation: 2 });
    expect(retrying.questionnaireResolution).toBe('loading');

    const resolved = reduceProfileLoad(retrying, {
      type: 'load-succeeded',
      uid: 'uid-A',
      generation: 2,
      profile: { name: 'A' },
      questionnaire: { id: 'q-1' },
    });
    expect(resolved.questionnaireResolution).toBe('found');
    expect(resolved.error).toBeNull();
  });

  it('10) UID muda durante load → resultado antigo (uid anterior) é descartado mesmo que resolva depois', () => {
    const loadingA = reduceProfileLoad(initial(), { type: 'load-started', uid: 'uid-A', generation: 1 });
    // Login switches to uid B before A's read resolves.
    const loadingB = reduceProfileLoad(loadingA, { type: 'load-started', uid: 'uid-B', generation: 2 });

    // A's stale result finally arrives — must be a complete no-op.
    const afterStaleA = reduceProfileLoad(loadingB, {
      type: 'load-succeeded',
      uid: 'uid-A',
      generation: 1,
      profile: { name: 'A' },
      questionnaire: { id: 'q-A' },
    });
    expect(afterStaleA).toEqual(loadingB);
    expect(afterStaleA.uid).toBe('uid-B');
    expect(afterStaleA.questionnaireResolution).toBe('loading');

    // B's real result must still be able to commit normally afterwards.
    const resolvedB = reduceProfileLoad(afterStaleA, {
      type: 'load-succeeded',
      uid: 'uid-B',
      generation: 2,
      profile: { name: 'B' },
      questionnaire: null,
    });
    expect(resolvedB.uid).toBe('uid-B');
    expect(resolvedB.questionnaireResolution).toBe('not_found');
  });

  it('11) loads concorrentes: load #2 termina antes de #1 — #1 (mais antigo) nunca sobrescreve #2 ao chegar depois', () => {
    const load1Started = reduceProfileLoad(initial(), {
      type: 'load-started',
      uid: 'uid-A',
      generation: 1,
    });
    const load2Started = reduceProfileLoad(load1Started, {
      type: 'load-started',
      uid: 'uid-A',
      generation: 2,
    });

    // #2 finishes first.
    const afterLoad2 = reduceProfileLoad(load2Started, {
      type: 'load-succeeded',
      uid: 'uid-A',
      generation: 2,
      profile: { name: 'fresh' },
      questionnaire: { id: 'q-fresh' },
    });
    expect(afterLoad2.questionnaireResolution).toBe('found');

    // #1 (older, slower) resolves afterwards — must not overwrite #2's result.
    const afterLoad1Late = reduceProfileLoad(afterLoad2, {
      type: 'load-succeeded',
      uid: 'uid-A',
      generation: 1,
      profile: { name: 'stale' },
      questionnaire: null,
    });
    expect(afterLoad1Late).toEqual(afterLoad2);
    expect(afterLoad1Late.questionnaire).toEqual({ id: 'q-fresh' });
  });

  it('identity-cleared (logout) resets fully back to unknown', () => {
    const found = reduceProfileLoad(
      { ...initial(), uid: 'uid-A', generation: 1 },
      {
        type: 'load-succeeded',
        uid: 'uid-A',
        generation: 1,
        profile: { name: 'A' },
        questionnaire: { id: 'q-1' },
      },
    );
    const cleared = reduceProfileLoad(found, { type: 'identity-cleared' });
    expect(cleared).toEqual(initial());
  });
});

describe('isRetryableFirestoreError', () => {
  it('treats unavailable and deadline-exceeded as retryable', () => {
    expect(isRetryableFirestoreError({ code: 'unavailable' })).toBe(true);
    expect(isRetryableFirestoreError({ code: 'deadline-exceeded' })).toBe(true);
  });

  it('never retries permission-denied, unauthenticated, invalid-argument, or unrecognized codes', () => {
    expect(isRetryableFirestoreError({ code: 'permission-denied' })).toBe(false);
    expect(isRetryableFirestoreError({ code: 'unauthenticated' })).toBe(false);
    expect(isRetryableFirestoreError({ code: 'invalid-argument' })).toBe(false);
    expect(isRetryableFirestoreError({ code: 'some-unknown-code' })).toBe(false);
    expect(isRetryableFirestoreError(new Error('plain error, no code'))).toBe(false);
    expect(isRetryableFirestoreError(undefined)).toBe(false);
  });
});

describe('withFirestoreRetry', () => {
  function fakeSleep() {
    const calls: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      calls.push(ms);
    });
    return { sleep, calls };
  }

  it('succeeds on the first attempt — no retry, no sleep', async () => {
    const { sleep, calls } = fakeSleep();
    const load = vi.fn(async () => 'value');
    const result = await withFirestoreRetry(load, { sleep });
    expect(result).toEqual({ ok: true, value: 'value', attempts: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('5) unavailable once, then succeeds → FOUND-equivalent on the second attempt', async () => {
    const { sleep } = fakeSleep();
    let call = 0;
    const load = vi.fn(async () => {
      call += 1;
      if (call === 1) throw { code: 'unavailable' };
      return 'value';
    });
    const result = await withFirestoreRetry(load, { sleep });
    expect(result).toEqual({ ok: true, value: 'value', attempts: 2 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('6/7) unavailable on every attempt → exhausted, ok:false, retryable:true, never throws unhandled', async () => {
    const { sleep, calls } = fakeSleep();
    const load = vi.fn(async () => {
      throw { code: 'deadline-exceeded' };
    });
    const result = await withFirestoreRetry(load, { sleep, delaysMs: [10, 20] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.attempts).toBe(3); // initial + 2 retries
    }
    expect(load).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([10, 20]);
  });

  it('8) permanent error (permission-denied) stops immediately — no retry loop', async () => {
    const { sleep } = fakeSleep();
    const load = vi.fn(async () => {
      throw { code: 'permission-denied' };
    });
    const result = await withFirestoreRetry(load, { sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.attempts).toBe(1);
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reports attempt/error/retryable through onAttempt for observability', async () => {
    const { sleep } = fakeSleep();
    let call = 0;
    const load = vi.fn(async () => {
      call += 1;
      if (call === 1) throw { code: 'unavailable' };
      return 'value';
    });
    const events: Array<{ attempt: number; error?: unknown; retryable?: boolean }> = [];
    await withFirestoreRetry(load, { sleep, onAttempt: (info) => events.push(info) });
    expect(events).toEqual([
      { attempt: 1, error: { code: 'unavailable' }, retryable: true },
      { attempt: 2 },
    ]);
  });

  it('passes the 1-based attempt number through to load()', async () => {
    const { sleep } = fakeSleep();
    const seen: number[] = [];
    const load = vi.fn(async (attempt: number) => {
      seen.push(attempt);
      if (attempt < 2) throw { code: 'unavailable' };
      return 'ok';
    });
    await withFirestoreRetry(load, { sleep });
    expect(seen).toEqual([1, 2]);
  });
});
