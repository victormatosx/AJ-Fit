import React, { createContext, useContext, useState, useMemo } from 'react';

export type Quiz = {
  sex: 'm' | 'f' | null;
  /**
   * Replaces the old `age: number` field (see ageCalculator.ts /
   * docs/08_log_de_evolucao.md, migração birthDate). A stored age goes stale
   * the moment time passes; a birth date doesn't. Age is always derived via
   * `computeAge(birthDate, referenceDate)`, never stored directly again.
   */
  birthDate: Date | null;
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
  /** Etapa 4 do novo funil — distinto de `goal`: motivo emocional/contextual que trouxe o usuário, não o resultado técnico buscado. */
  motivation: string | null;
  /** Etapa 19 — até 2 grupos musculares prioritários (ver docs/onboarding_funnel_architecture.md para a justificativa do limite). */
  muscleFocus: string[];
  /** Etapa 22 — nível de compromisso declarado. Onboarding-only: não influencia nenhum algoritmo de treino hoje. */
  commitment: string | null;
};

export type TabId = 'home' | 'workout' | 'progress' | 'profile';

type Ctx = {
  quiz: Quiz;
  setQuiz: (q: Quiz) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
};

/** Exported so userProfile.ts can fall back to it when normalizing a sparse/corrupted questionnaire doc. */
export const defaultQuiz: Quiz = {
  sex: null,
  birthDate: null,
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
  motivation: null,
  muscleFocus: [],
  commitment: null,
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
