import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveNativeUi } from '../nativeUiMapping';
import { darkTheme, lightTheme } from '../theme';

describe('resolveNativeUi', () => {
  it('maps Dark to the Dark background and light navigation-bar icons', () => {
    expect(resolveNativeUi(darkTheme)).toEqual({
      backgroundColor: darkTheme.colors.background,
      navigationBarStyle: 'light',
    });
  });

  it('maps Light to the Light background and dark navigation-bar icons', () => {
    expect(resolveNativeUi(lightTheme)).toEqual({
      backgroundColor: lightTheme.colors.background,
      navigationBarStyle: 'dark',
    });
  });

  it('reuses the exact statusBar.style convention instead of a second mapping', () => {
    expect(resolveNativeUi(darkTheme).navigationBarStyle).toBe(darkTheme.statusBar.style);
    expect(resolveNativeUi(lightTheme).navigationBarStyle).toBe(lightTheme.statusBar.style);
  });
});

describe('native theme boundaries', () => {
  it('never derives native UI from Appearance/system color scheme', () => {
    const mapping = readFileSync('src/theme/nativeUiMapping.ts', 'utf8');
    const sync = readFileSync('src/theme/NativeThemeSync.tsx', 'utf8');

    expect(`${mapping}\n${sync}`).not.toMatch(/useColorScheme|Appearance/);
  });

  it('is the only module calling the native system-ui/navigation-bar APIs', () => {
    const sync = readFileSync('src/theme/NativeThemeSync.tsx', 'utf8');

    expect(sync).toContain("from 'expo-system-ui'");
    expect(sync).toContain("from 'expo-navigation-bar'");
    expect(sync).toContain('resolveNativeUi(theme)');
    expect(sync).toContain("Platform.OS === 'android'");
  });

  it('is mounted once, next to StatusBar, under ThemeProvider', () => {
    const appSource = readFileSync('App.tsx', 'utf8');

    expect(appSource).toContain('<StatusBar style={theme.statusBar.style} />');
    expect(appSource).toContain('<NativeThemeSync />');
    expect(appSource.indexOf('<StatusBar')).toBeLessThan(
      appSource.indexOf('<NativeThemeSync'),
    );
  });

  it('locks the native splash and userInterfaceStyle to the Dark baseline, never automatic', () => {
    const appConfig = readFileSync('app.json', 'utf8');
    const config = JSON.parse(appConfig) as {
      expo: { userInterfaceStyle?: string; backgroundColor?: string; plugins: unknown[] };
    };

    expect(config.expo.userInterfaceStyle).toBe('dark');
    expect(config.expo.backgroundColor).toBe('#020010');

    const splashPlugin = config.expo.plugins.find(
      (entry): entry is [string, Record<string, unknown>] =>
        Array.isArray(entry) && entry[0] === 'expo-splash-screen',
    );
    expect(splashPlugin?.[1]).toMatchObject({ backgroundColor: '#000000' });
    expect(splashPlugin?.[1]).not.toHaveProperty('dark');

    const navBarPlugin = config.expo.plugins.find(
      (entry): entry is [string, Record<string, unknown>] =>
        Array.isArray(entry) && entry[0] === 'expo-navigation-bar',
    );
    expect(navBarPlugin?.[1]).toMatchObject({ style: 'light', enforceContrast: false });

    expect(config.expo.plugins).toContain('expo-system-ui');
  });
});
