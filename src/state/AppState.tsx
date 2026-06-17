import React, { createContext, useContext, useState, useMemo } from 'react';

export type Quiz = {
  sex: 'm' | 'f' | null;
  age: number;
  height: number;
  weight: number;
  goal: 'hyper' | 'cut' | 'perf' | 'def' | 'recon' | null;
  frequency: string | null;
  level: 'beg' | 'int' | 'adv' | 'elite' | null;
  limits: string[];
  duration: '30' | '45' | '60' | '90' | null;
  days: number;
  place: 'gym' | 'home' | 'both' | null;
  equipment: string[];
  style: string[];
};

export type TabId = 'home' | 'workout' | 'progress' | 'profile';

type Ctx = {
  quiz: Quiz;
  setQuiz: (q: Quiz) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
};

const defaultQuiz: Quiz = {
  sex: null,
  age: 28,
  height: 178,
  weight: 78,
  goal: null,
  frequency: null,
  level: null,
  limits: [],
  duration: null,
  days: 4,
  place: null,
  equipment: [],
  style: [],
};

const AppStateContext = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [quiz, setQuiz] = useState<Quiz>(defaultQuiz);
  const [tab, setTab] = useState<TabId>('home');
  const value = useMemo(() => ({ quiz, setQuiz, tab, setTab }), [quiz, tab]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState outside provider');
  return ctx;
}
