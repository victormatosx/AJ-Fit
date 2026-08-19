import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import * as NavigationBar from 'expo-navigation-bar';

import { useTheme } from './ThemeProvider';
import { resolveNativeUi } from './nativeUiMapping';
import { logError } from '../lib/logger';

/**
 * Keeps the native root background and the Android navigation bar in sync
 * with `theme.mode` on every mount, hydration and runtime switch. This is
 * the only place that talks to expo-system-ui/expo-navigation-bar so the
 * rest of the app only ever depends on ThemeProvider.
 *
 * Deliberately never reads the device's own color mode setting — native
 * chrome must follow the same explicit AJ Fit preference as the rest of
 * the UI, nothing else.
 */
export function NativeThemeSync() {
  const { theme, hydrated } = useTheme();

  useEffect(() => {
    // Pre-hydration renders use the Dark fallback context, which already
    // matches the statically baked native defaults (app.json). Waiting for
    // `hydrated` avoids a redundant native call on every cold start.
    if (!hydrated) return;

    const target = resolveNativeUi(theme);

    SystemUI.setBackgroundColorAsync(target.backgroundColor).catch((err) => {
      logError('nativeThemeSync:systemUi', err, { mode: theme.mode });
    });

    if (Platform.OS === 'android') {
      try {
        NavigationBar.setStyle(target.navigationBarStyle);
      } catch (err) {
        logError('nativeThemeSync:navigationBar', err, { mode: theme.mode });
      }
    }
  }, [theme, hydrated]);

  return null;
}
