import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { validatePromoCode } from '../services/promoCodeService';
import {
  createInitialPromoCodeState,
  reducePromoCodeState,
  type PromoCodeEvent,
  type PromoCodeState,
} from '../lib/promoCodeState';
import { normalizePromoCodeInput } from '../lib/promoCodeErrors';

/**
 * Promo-code validation flow for the Paywall (Fase 4C.2). Reads identity
 * from `useAuth()` directly — deliberately NOT from `SubscriptionContext`
 * (out of scope to alter this Sprint) — and maintains its own, independent
 * identity/attempt scoping, exactly mirroring `SubscriptionContext.tsx`'s
 * `identityGeneration`/`currentUid` pattern (`subscriptionLifecycle.ts`)
 * but as a fully separate instance: this hook's `generation` counter has
 * no relationship to `SubscriptionContext`'s internal one.
 *
 * State lives LOCALLY to whatever component calls this hook (the Paywall)
 * — not in a Provider — so unmounting the Paywall discards it entirely.
 * Combined with the Fase 4C audit's decision not to restore promo state on
 * cold start (§15/§20), this means there is deliberately no persistence
 * layer here at all: the only source of truth for "what's currently
 * applied" is this hook's in-memory state for the current screen instance.
 */
export function usePromoCode() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [state, setState] = useState<PromoCodeState>(createInitialPromoCodeState);
  const dispatch = useCallback((event: PromoCodeEvent) => {
    setState((current) => reducePromoCodeState(current, event));
  }, []);

  // Mirrors SubscriptionContext.tsx's `currentUid`/`identityGeneration`
  // refs: updated synchronously during render (never inside an effect) so
  // an async validation started just before an identity change can never
  // observe the OLD uid as still current.
  const currentUid = useRef<string | null>(uid);
  currentUid.current = uid;

  const identityGeneration = useRef(0);
  const validationSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Fase 4C.2 §8/§9: any uid change (login, logout, account switch)
  // invalidates the promo state unconditionally, before anything else can
  // run for the new identity.
  useEffect(() => {
    const generation = ++identityGeneration.current;
    validationSeq.current = 0;
    dispatch({ type: 'identity-changed', uid, generation });
  }, [uid, dispatch]);

  const applyCode = useCallback(
    async (rawCode: string) => {
      const attemptUid = currentUid.current;
      if (!attemptUid) return; // No identity yet — nothing to validate against.

      const generation = identityGeneration.current;
      const seq = ++validationSeq.current;

      dispatch({ type: 'validation-started', uid: attemptUid, generation, seq });

      const normalized = normalizePromoCodeInput(rawCode);
      const outcome = await validatePromoCode(normalized);

      if (
        !mounted.current ||
        attemptUid !== currentUid.current ||
        generation !== identityGeneration.current ||
        seq !== validationSeq.current
      ) {
        // Stale by the time it resolved (identity changed, or a newer
        // validation attempt — e.g. ARNALDO → HELLLEN — already started).
        // The reducer would discard this anyway (belt-and-suspenders, same
        // multi-layer style as SubscriptionContext.tsx), so this is purely
        // an optimization to skip dispatching at all.
        return;
      }

      if (outcome.status === 'applied') {
        dispatch({
          type: 'validation-applied',
          uid: attemptUid,
          generation,
          seq,
          code: outcome.response.code,
          benefit: outcome.response.benefit,
          androidStoreConfig: outcome.response.storeConfig.android,
        });
        return;
      }

      if (outcome.reason === 'unauthenticated') {
        dispatch({ type: 'unauthenticated', uid: attemptUid, generation, seq });
        return;
      }

      if (outcome.reason === 'locked') {
        dispatch({
          type: 'validation-locked',
          uid: attemptUid,
          generation,
          seq,
          message: outcome.message,
        });
        return;
      }

      if (outcome.reason === 'invalid_code' || outcome.reason === 'unavailable') {
        dispatch({
          type: 'validation-unavailable',
          uid: attemptUid,
          generation,
          seq,
          message: outcome.message,
        });
        return;
      }

      dispatch({
        type: 'validation-error',
        uid: attemptUid,
        generation,
        seq,
        message: outcome.message,
      });
    },
    [dispatch],
  );

  return { state, applyCode };
}
