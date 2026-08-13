import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocales } from 'expo-localization';
import {
  DEFAULT_UNITS_PREFERENCE,
  type ResolvedUnits,
  type UnitsPreference,
} from '../types/units';
import { resolveUnits } from '../units/resolveUnits';
import {
  readStoredUnitsPreference,
  subscribeStoredUnitsPreference,
} from '../units/unitsStorage';

type UnitsContextValue = {
  preference: UnitsPreference;
  resolvedUnits: ResolvedUnits;
};

const UnitsContext = createContext<UnitsContextValue | null>(null);

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<UnitsPreference>(
    DEFAULT_UNITS_PREFERENCE,
  );
  const locales = useLocales();
  const locale = locales[0];

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeStoredUnitsPreference(setPreference);
    readStoredUnitsPreference().then((stored) => {
      if (active && stored) setPreference(stored);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const resolvedUnits = resolveUnits({
    preference,
    regionCode: locale?.regionCode ?? null,
    languageTag: locale?.languageTag ?? null,
  });

  const value = useMemo(
    () => ({ preference, resolvedUnits }),
    [preference, resolvedUnits],
  );

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const context = useContext(UnitsContext);
  if (!context) throw new Error('useUnits outside UnitsProvider');
  return context;
}
