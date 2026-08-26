import { describe, expect, it } from 'vitest';
import { createSingleFlight } from '../../lib/singleFlight';
import { createInitialProfileLoadState, reduceProfileLoad, type ProfileLoadState } from '../../lib/profileLoadState';

/**
 * Simulates the exact orchestration `AuthContext.tsx` uses — a real
 * `onAuthStateChanged` listener racing an explicit `signUp()`/`signIn()`
 * flow that owns `identityOperationFlight` — using the same two pure,
 * already-isolated pieces (`createSingleFlight`, `reduceProfileLoad`)
 * `AuthContext.tsx` itself is built from. This cannot render
 * `AuthContext.tsx` directly (no React test renderer in this project — see
 * `authContextConcurrencyStructure.test.ts` for the existing convention of
 * testing this file's wiring via structural assertions instead), but it
 * exercises the REAL race timing with controlled promise resolution order,
 * not just a string match on the source.
 */
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type Questionnaire = { id: string } | null;

function makeHarness() {
  const identityOperationFlight = createSingleFlight<void>();
  let state: ProfileLoadState<{ uid: string }, Questionnaire> = createInitialProfileLoadState();
  let generation = 0;
  const loadUserStateCalls: string[] = [];
  const listenerLoadStateCalls: string[] = [];

  /** Mirrors `AuthContext.tsx`'s `loadUserState` — dispatches load-started then load-succeeded. */
  async function loadUserState(uid: string, readQuestionnaire: () => Promise<Questionnaire>, caller: 'listener' | 'explicit') {
    const gen = ++generation;
    (caller === 'listener' ? listenerLoadStateCalls : loadUserStateCalls).push(uid);
    state = reduceProfileLoad(state, { type: 'load-started', uid, generation: gen });
    const questionnaire = await readQuestionnaire();
    state = reduceProfileLoad(state, {
      type: 'load-succeeded', uid, generation: gen, profile: { uid }, questionnaire,
    });
  }

  /** Mirrors the fixed `onAuthStateChanged` listener: skips its own load while an identity operation owns this uid. */
  async function onAuthStateChangedListener(uid: string, readQuestionnaire: () => Promise<Questionnaire>) {
    if (identityOperationFlight.isRunning()) return;
    await loadUserState(uid, readQuestionnaire, 'listener');
  }

  /** Mirrors `signUp()`: provisions, THEN calls its own authoritative load. */
  function signUp(uid: string, provision: () => Promise<void>, readQuestionnaire: () => Promise<Questionnaire>) {
    return identityOperationFlight.run(async () => {
      await provision();
      await loadUserState(uid, readQuestionnaire, 'explicit');
    });
  }

  function resolutionHistory(): QuestionnaireResolutionSnapshot {
    return { current: state.questionnaireResolution };
  }

  return { identityOperationFlight, onAuthStateChangedListener, signUp, resolutionHistory, loadUserStateCalls, listenerLoadStateCalls, getState: () => state };
}

type QuestionnaireResolutionSnapshot = { current: string };

describe('AuthContext signup/listener race (Phase 1, Part A)', () => {
  it('(1) signup in flight: the listener firing mid-provisioning never commits not_found — only the explicit post-provisioning load resolves it', async () => {
    const h = makeHarness();
    const provisionGate = deferred<void>();
    const uid = 'new-user';

    // signUp() starts; provisioning is still pending (not yet written).
    const signUpPromise = h.signUp(uid, () => provisionGate.promise, async () => ({ id: 'q1' }));

    // The Firebase Auth listener fires "at the same time" — BEFORE provisioning resolves.
    // Genuinely wrong to answer right now: the questionnaire doc doesn't exist YET.
    await h.onAuthStateChangedListener(uid, async () => null);

    // The listener must not have touched anything — identityOperationFlight owns this uid.
    expect(h.listenerLoadStateCalls).toHaveLength(0);
    // Never observed as not_found while signUp is still provisioning.
    expect(h.resolutionHistory().current).not.toBe('not_found');

    provisionGate.resolve();
    await signUpPromise;

    // Only the explicit, authoritative, post-provisioning load ran.
    expect(h.loadUserStateCalls).toEqual([uid]);
    expect(h.resolutionHistory().current).toBe('found');
  });

  it('(2) a genuinely questionnaire-less user (e.g. social sign-in with no answers) still resolves not_found — via the explicit flow, never masked', async () => {
    const h = makeHarness();
    const uid = 'social-user-no-quiz';

    await h.signUp(uid, async () => {}, async () => null);

    expect(h.resolutionHistory().current).toBe('not_found');
    expect(h.loadUserStateCalls).toEqual([uid]);
  });

  it('(3) an existing user reopening the app (no identity operation in flight) loads normally through the listener', async () => {
    const h = makeHarness();
    const uid = 'returning-user';

    // No signUp/signIn call at all — this is a cold start restoring a persisted session.
    expect(h.identityOperationFlight.isRunning()).toBe(false);
    await h.onAuthStateChangedListener(uid, async () => ({ id: 'q-existing' }));

    expect(h.listenerLoadStateCalls).toEqual([uid]);
    expect(h.resolutionHistory().current).toBe('found');
  });

  it('the listener never regresses an already-found resolution back to not_found while a LATER identity operation (e.g. re-auth) is in flight for the same uid', async () => {
    const h = makeHarness();
    const uid = 'user-a';
    await h.onAuthStateChangedListener(uid, async () => ({ id: 'q1' }));
    expect(h.resolutionHistory().current).toBe('found');

    const provisionGate = deferred<void>();
    const signInPromise = h.signUp(uid, () => provisionGate.promise, async () => ({ id: 'q1' }));
    await h.onAuthStateChangedListener(uid, async () => null); // would wrongly regress if not guarded
    expect(h.resolutionHistory().current).toBe('found'); // untouched — listener skipped

    provisionGate.resolve();
    await signInPromise;
    expect(h.resolutionHistory().current).toBe('found');
  });
});
