import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import {
  darkTheme,
  DEFAULT_THEME,
  themes,
  type AppTheme,
  type ThemeMode,
} from './theme';
import { themeRuntime } from './themeRuntime';

export type ThemeContextValue = {
  mode: ThemeMode;
  theme: AppTheme;
  hydrated: boolean;
  setTheme: (mode: ThemeMode) => Promise<void>;
};

/** Safe Dark fallback for isolated renders and recovery paths. */
const DEFAULT_THEME_CONTEXT: ThemeContextValue = {
  mode: DEFAULT_THEME,
  theme: darkTheme,
  hydrated: true,
  setTheme: async () => undefined,
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_THEME_CONTEXT);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    themeRuntime.subscribe,
    themeRuntime.getSnapshot,
    themeRuntime.getSnapshot,
  );

  useEffect(() => {
    // Visual hydration is independent from Auth/RevenueCat/Firebase. The
    // application providers mount immediately; AppContent only gates the
    // definitive screen until this local read settles.
    void themeRuntime.hydrate();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: snapshot.mode,
      theme: themes[snapshot.mode],
      hydrated: snapshot.hydrated,
      setTheme: themeRuntime.setTheme,
    }),
    [snapshot],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The context fallback remains Dark. Inside the application, `hydrated`
 * distinguishes the initial local read from the definitive runtime theme.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
