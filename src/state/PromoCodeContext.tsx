import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { validatePromoCode } from '../services/promoCodeService';
import {
  createInitialPromoCodeState,
  reducePromoCodeState,
  type PromoCodeEvent,
  type PromoCodeState,
} from '../lib/promoCodeState';
import { normalizePromoCodeInput } from '../lib/promoCodeErrors';

type PromoCodeContextValue = {
  state: PromoCodeState;
  applyCode: (rawCode: string) => Promise<void>;
};

const PromoCodeContext = createContext<PromoCodeContextValue | null>(null);

/**
 * Identity-scoped, in-memory promo state.
 *
 * The provider lives above RootNavigator, so an ordinary Paywall remount
 * cannot silently discard a backend authorization. It intentionally has no
 * persistent storage: logout/account switch resets it, and an app restart
 * requires fresh backend validation. This is the smallest lifecycle that is
 * both remount-stable and incapable of leaking authorization across UIDs.
 */
export function PromoCodeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [state, setState] = useState<PromoCodeState>(createInitialPromoCodeState);
  const stateRef = useRef(state);
  const dispatch = useCallback((event: PromoCodeEvent) => {
    setState((current) => {
      const next = reducePromoCodeState(current, event);
      stateRef.current = next;
      return next;
    });
  }, []);

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

  useEffect(() => {
    const generation = ++identityGeneration.current;
    validationSeq.current = 0;
    dispatch({ type: 'identity-changed', uid, generation });
  }, [uid, dispatch]);

  const applyCode = useCallback(
    async (rawCode: string) => {
      const attemptUid = currentUid.current;
      // `stateRef` closes the render→effect gap on an account switch: the
      // new UID cannot start work until its identity-changed event has reset
      // the previous account's state.
      if (!attemptUid || stateRef.current.uid !== attemptUid) return;

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
          iosPromotion: outcome.response.iosPromotion,
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

  // React effects run after render. Hide the prior identity synchronously
  // during that one render instead of exposing its authorization to a new
  // account while the reset effect is pending.
  const visibleState = useMemo<PromoCodeState>(() => {
    if (state.uid === uid) return state;
    return {
      uid,
      generation: identityGeneration.current + 1,
      seq: 0,
      phase: 'idle',
      applied: null,
      message: null,
    };
  }, [state, uid]);

  const value = useMemo(() => ({ state: visibleState, applyCode }), [visibleState, applyCode]);
  return <PromoCodeContext.Provider value={value}>{children}</PromoCodeContext.Provider>;
}

export function usePromoCodeContext(): PromoCodeContextValue {
  const context = useContext(PromoCodeContext);
  if (!context) throw new Error('usePromoCode outside PromoCodeProvider');
  return context;
}
