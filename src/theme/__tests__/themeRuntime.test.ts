import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

import { createThemeRuntime } from '../themeRuntime';
import { darkTheme, lightTheme, themes, type ThemeMode } from '../theme';

function runtimeWith({
  read = async () => 'dark' as const,
  write = async () => undefined,
  onError = vi.fn(),
}: {
  read?: () => Promise<ThemeMode>;
  write?: (mode: ThemeMode) => Promise<void>;
  onError?: (phase: 'hydrate' | 'write', error: unknown, mode: ThemeMode) => void;
} = {}) {
  return {
    runtime: createThemeRuntime({ read, write, onError }),
    onError,
  };
}

describe('theme runtime hydration', () => {
  it('starts safely in unhydrated Dark and resolves a stored Light preference', async () => {
    const { runtime } = runtimeWith({ read: async () => 'light' });

    expect(runtime.getSnapshot()).toEqual({ mode: 'dark', hydrated: false });

    await runtime.hydrate();

    expect(runtime.getSnapshot()).toEqual({ mode: 'light', hydrated: true });
    expect(themes[runtime.getSnapshot().mode]).toBe(lightTheme);
  });

  it('falls back to hydrated Dark if the injected read fails', async () => {
    const error = new Error('offline');
    const { runtime, onError } = runtimeWith({
      read: async () => { throw error; },
    });

    await runtime.hydrate();

    expect(runtime.getSnapshot()).toEqual({ mode: 'dark', hydrated: true });
    expect(themes[runtime.getSnapshot().mode]).toBe(darkTheme);
    expect(onError).toHaveBeenCalledWith('hydrate', error, 'dark');
  });

  it('does not let a late hydration read overwrite a newer local choice', async () => {
    let resolveRead!: (mode: ThemeMode) => void;
    const read = () => new Promise<ThemeMode>((resolve) => { resolveRead = resolve; });
    const { runtime } = runtimeWith({ read });

    const hydration = runtime.hydrate();
    const persistence = runtime.setTheme('light');
    resolveRead('dark');
    await Promise.all([hydration, persistence]);

    expect(runtime.getSnapshot()).toEqual({ mode: 'light', hydrated: true });
  });
});

describe('theme runtime selection and persistence', () => {
  it('publishes Light immediately before its AsyncStorage-equivalent write resolves', async () => {
    let resolveWrite!: () => void;
    const write = vi.fn(
      () => new Promise<void>((resolve) => { resolveWrite = resolve; }),
    );
    const listener = vi.fn();
    const { runtime } = runtimeWith({ write });
    const unsubscribe = runtime.subscribe(listener);

    const persistence = runtime.setTheme('light');

    expect(runtime.getSnapshot().mode).toBe('light');
    expect(themes[runtime.getSnapshot().mode]).toBe(lightTheme);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(write).toHaveBeenCalledWith('light');
    resolveWrite();
    await persistence;
    unsubscribe();
  });

  it('switches back to Dark through the same registry without remount state', async () => {
    const write = vi.fn(async () => undefined);
    const { runtime } = runtimeWith({ write });

    await runtime.setTheme('light');
    await runtime.setTheme('dark');

    expect(runtime.getSnapshot().mode).toBe('dark');
    expect(themes[runtime.getSnapshot().mode]).toBe(darkTheme);
    expect(write.mock.calls).toEqual([['light'], ['dark']]);
  });

  it('keeps the in-session mode when persistence fails', async () => {
    const error = new Error('disk full');
    const { runtime, onError } = runtimeWith({
      write: async () => { throw error; },
    });

    await runtime.setTheme('light');

    expect(runtime.getSnapshot().mode).toBe('light');
    expect(onError).toHaveBeenCalledWith('write', error, 'light');
  });

  it('hydrates the last durable choice after simulated process restarts', async () => {
    const storage = new Map<string, ThemeMode>();
    const dependencies = () => ({
      read: async () => storage.get('theme') ?? 'dark',
      write: async (mode: ThemeMode) => { storage.set('theme', mode); },
      onError: vi.fn(),
    });

    const firstRun = createThemeRuntime(dependencies());
    await firstRun.hydrate();
    expect(firstRun.getSnapshot().mode).toBe('dark');
    await firstRun.setTheme('light');

    const secondRun = createThemeRuntime(dependencies());
    await secondRun.hydrate();
    expect(secondRun.getSnapshot().mode).toBe('light');
    await secondRun.setTheme('dark');

    const thirdRun = createThemeRuntime(dependencies());
    await thirdRun.hydrate();
    expect(thirdRun.getSnapshot().mode).toBe('dark');
  });

  it('normalizes a dynamically invalid selection to Dark', async () => {
    const write = vi.fn(async () => undefined);
    const { runtime } = runtimeWith({ write });

    await runtime.setTheme('system' as never);

    expect(runtime.getSnapshot().mode).toBe('dark');
    expect(write).toHaveBeenCalledWith('dark');
  });
});

describe('runtime integration boundaries', () => {
  const appSource = readFileSync('App.tsx', 'utf8');
  const providerSource = readFileSync('src/theme/ThemeProvider.tsx', 'utf8');
  const runtimeSource = readFileSync('src/theme/themeRuntime.ts', 'utf8');
  const storageSource = readFileSync('src/theme/themeStorage.ts', 'utf8');
  const authSource = readFileSync('src/services/auth.ts', 'utf8');
  const datePickerSource = readFileSync(
    'src/components/ui/NativeDatePickerField.tsx',
    'utf8',
  );

  it('hydrates through the provider while only the definitive UI is gated', () => {
    expect(providerSource).toContain('void themeRuntime.hydrate();');
    expect(appSource).toContain('hydrated: themeHydrated');
    expect(appSource).toContain('themeHydrated && fontsLoaded && i18nReady');
    expect(appSource.indexOf('<AuthProvider>')).toBeLessThan(
      appSource.indexOf('themeHydrated && fontsLoaded && i18nReady'),
    );
    expect(appSource.indexOf('<SubscriptionProvider>')).toBeLessThan(
      appSource.indexOf('themeHydrated && fontsLoaded && i18nReady'),
    );
  });

  it('updates context subscriptions without keying or remounting the tree', () => {
    expect(providerSource).toContain('useSyncExternalStore');
    expect(providerSource).toContain('theme: themes[snapshot.mode]');
    expect(`${appSource}\n${providerSource}`).not.toMatch(
      /key=\{(?:theme|mode|themeMode|snapshot\.mode)/,
    );
  });

  it('keeps theme local, device-wide and untouched by logout', () => {
    expect(storageSource).not.toMatch(
      /from ['"][^'"]*(?:firebase|userProfile)|updateDoc|getFirestore|doc\(/i,
    );
    expect(runtimeSource).not.toMatch(
      /from ['"][^'"]*(?:firebase|userProfile)|updateDoc|getFirestore|doc\(/i,
    );
    expect(authSource).not.toContain('ajfit-theme-preference');
  });

  it('removes the competing dev authority instead of persisting a preview override', () => {
    expect(appSource).not.toContain('DevThemeToggle');
    expect(providerSource).not.toMatch(/devTheme|previewMode|overrideMode/i);
    expect(existsSync('src/theme/DevThemeToggle.tsx')).toBe(false);
  });

  it('drives StatusBar and iOS DatePicker from the explicit app mode', () => {
    expect(appSource).toContain('<StatusBar style={theme.statusBar.style} />');
    expect(datePickerSource).toContain('themeVariant={theme.mode}');
    expect(`${appSource}\n${datePickerSource}`).not.toMatch(/useColorScheme|Appearance/);
  });
});
