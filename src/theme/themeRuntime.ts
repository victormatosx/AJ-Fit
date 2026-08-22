import { logError } from '../lib/logger';
import {
  readStoredThemePreference,
  writeStoredThemePreference,
} from './themeStorage';
import { DEFAULT_THEME, resolveThemeMode, type ThemeMode } from './theme';

export type ThemeRuntimeSnapshot = {
  mode: ThemeMode;
  hydrated: boolean;
};

type ThemeRuntimeDependencies = {
  read: () => Promise<ThemeMode>;
  write: (mode: ThemeMode) => Promise<void>;
  onError: (phase: 'hydrate' | 'write', error: unknown, mode: ThemeMode) => void;
};

export type ThemeRuntime = {
  getSnapshot: () => ThemeRuntimeSnapshot;
  subscribe: (listener: () => void) => () => void;
  hydrate: () => Promise<void>;
  setTheme: (mode: ThemeMode) => Promise<void>;
};

const DEFAULT_DEPENDENCIES: ThemeRuntimeDependencies = {
  read: readStoredThemePreference,
  write: writeStoredThemePreference,
  onError: (phase, error, mode) => {
    logError(`themeRuntime:${phase}`, error, { mode });
  },
};

/**
 * Single runtime authority for the device preference.
 *
 * Kept independent from React so hydration, write ordering and failure
 * behavior can be tested without mounting the application tree. React only
 * subscribes to the stable snapshot through ThemeProvider.
 */
export function createThemeRuntime(
  dependencies: ThemeRuntimeDependencies = DEFAULT_DEPENDENCIES,
): ThemeRuntime {
  let snapshot: ThemeRuntimeSnapshot = {
    mode: DEFAULT_THEME,
    hydrated: false,
  };
  let hydrationPromise: Promise<void> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  let localSelectionRevision = 0;
  const listeners = new Set<() => void>();

  const publish = (next: ThemeRuntimeSnapshot) => {
    if (next.mode === snapshot.mode && next.hydrated === snapshot.hydrated) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const getSnapshot = () => snapshot;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const hydrate = async () => {
    if (snapshot.hydrated) return;
    if (hydrationPromise) return hydrationPromise;

    const revisionAtStart = localSelectionRevision;
    hydrationPromise = (async () => {
      let storedMode = DEFAULT_THEME;
      try {
        storedMode = resolveThemeMode(await dependencies.read());
      } catch (err) {
        dependencies.onError('hydrate', err, DEFAULT_THEME);
      }

      // A programmatic selection made while the read was pending wins over
      // stale disk data. Normal UI cannot reach Settings before hydration,
      // but this makes the runtime race-safe for tests and future entry points.
      publish({
        mode:
          revisionAtStart === localSelectionRevision
            ? storedMode
            : snapshot.mode,
        hydrated: true,
      });
    })();

    return hydrationPromise;
  };

  const setTheme = (nextMode: ThemeMode): Promise<void> => {
    const resolvedMode = resolveThemeMode(nextMode);
    localSelectionRevision += 1;

    // Runtime updates synchronously; storage never sits in the visual path.
    publish({ ...snapshot, mode: resolvedMode });

    // Serialize quick consecutive choices so the last visible choice is also
    // the last value written to disk, regardless of native IO timing.
    const persistence = writeQueue
      .then(() => dependencies.write(resolvedMode))
      .catch((err) => {
        // Keep the in-session selection. The next cold start falls back to
        // the last durable value (or Dark) if this write did not reach disk.
        dependencies.onError('write', err, resolvedMode);
      });
    writeQueue = persistence;
    return persistence;
  };

  return { getSnapshot, subscribe, hydrate, setTheme };
}

export const themeRuntime = createThemeRuntime();
