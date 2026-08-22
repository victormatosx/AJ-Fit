import type { AppTheme } from './theme';

export type NativeUiTarget = {
  /** Root native window/view background — see expo-system-ui. */
  backgroundColor: string;
  /**
   * Android navigation bar icon/button style. Reuses the exact
   * `theme.statusBar.style` convention ('light' content for a dark
   * surface, 'dark' content for a light surface) so both native
   * surfaces share one mapping instead of two parallel ones.
   */
  navigationBarStyle: AppTheme['statusBar']['style'];
};

/**
 * Pure theme → native-UI mapping, kept isolated from the native modules
 * (expo-system-ui, expo-navigation-bar) so it stays unit-testable without a
 * React Native runtime. `theme.mode` is the only allowed input — never the
 * device's own color mode setting.
 */
export function resolveNativeUi(theme: AppTheme): NativeUiTarget {
  return {
    backgroundColor: theme.colors.background,
    navigationBarStyle: theme.statusBar.style,
  };
}
