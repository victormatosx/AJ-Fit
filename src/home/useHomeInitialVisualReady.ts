import { useCallback, useEffect, useReducer, useRef } from 'react';

import { recordPerfMark } from '../lib/perf';
import {
  INITIAL_HOME_BOOTSTRAP_STATE,
  reduceHomeBootstrapState,
} from './homeInitialReadiness';

export function useHomeInitialVisualReady(allRequiredDataSettled: boolean) {
  const [state, dispatch] = useReducer(
    reduceHomeBootstrapState,
    INITIAL_HOME_BOOTSTRAP_STATE,
  );
  const frameRequestRef = useRef<number | null>(null);
  const layoutCommittedRef = useRef(false);
  const allRequiredDataSettledRef = useRef(allRequiredDataSettled);
  allRequiredDataSettledRef.current = allRequiredDataSettled;

  useEffect(() => {
    if (state.visualReady) return;
    if (allRequiredDataSettled) {
      if (!state.dataSettled) {
        recordPerfMark('home_initial_data_settled');
        dispatch('DATA_SETTLED');
      }
      return;
    }
    if (frameRequestRef.current !== null) {
      cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    }
    layoutCommittedRef.current = false;
    if (state.dataSettled || state.layoutCommitted) dispatch('DATA_PENDING');
  }, [allRequiredDataSettled, state.dataSettled, state.layoutCommitted, state.visualReady]);

  const onInitialLayoutCommitted = useCallback(() => {
    if (!state.dataSettled || layoutCommittedRef.current) return;
    layoutCommittedRef.current = true;
    recordPerfMark('home_initial_layout_committed');
    dispatch('LAYOUT_COMMITTED');
    frameRequestRef.current = requestAnimationFrame(() => {
      frameRequestRef.current = null;
      if (!allRequiredDataSettledRef.current) {
        layoutCommittedRef.current = false;
        dispatch('DATA_PENDING');
        return;
      }
      recordPerfMark('home_initial_visual_ready');
      dispatch('FRAME_PAINTABLE');
    });
  }, [state.dataSettled]);

  useEffect(() => () => {
    if (frameRequestRef.current !== null) cancelAnimationFrame(frameRequestRef.current);
  }, []);

  useEffect(() => {
    if (state.visualReady) recordPerfMark('home_initial_overlay_hidden');
  }, [state.visualReady]);

  return {
    homeInitialDataSettled: state.dataSettled,
    homeInitialLayoutCommitted: state.layoutCommitted,
    homeInitialVisualReady: state.visualReady,
    onInitialLayoutCommitted,
  };
}
