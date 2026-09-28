import { createContext, useContext, type ReactNode } from 'react';

import { useLoadProgress } from '../hooks/useLoadProgress';

export type LoadProgressState = ReturnType<typeof useLoadProgress>;

const LoadProgressContext = createContext<LoadProgressState | null>(null);

/**
 * Shares Evolution's existing workout-execution projection with the active
 * workout. This is an in-memory read model only; Firestore workoutExecutions
 * remains the sole persisted source of load history.
 */
export function LoadProgressProvider({ uid, children }: { uid: string | null; children: ReactNode }) {
  const state = useLoadProgress(uid);
  return <LoadProgressContext.Provider value={state}>{children}</LoadProgressContext.Provider>;
}

export function useLoadProgressState(): LoadProgressState {
  const state = useContext(LoadProgressContext);
  if (!state) throw new Error('useLoadProgressState must be used within LoadProgressProvider');
  return state;
}
