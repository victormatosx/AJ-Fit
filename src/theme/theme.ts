import {
  chart,
  colors,
  fonts,
  gradients,
  motion,
  opacity,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
} from './tokens';
import { lightChart, lightColors, lightGradients, lightShadows } from './lightTokens';

export const THEME_MODES = ['dark', 'light'] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_THEME: ThemeMode = 'dark';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

/** Invalid, missing or legacy preference values always return the product default. */
export function resolveThemeMode(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : DEFAULT_THEME;
}

/**
 * The official Dark theme is composed directly from the existing AJ Fit
 * tokens. No visual value is transformed here: this object only gives the
 * current baseline a typed, contextual home.
 */
export const darkTheme = {
  mode: DEFAULT_THEME,
  colors,
  chart,
  gradients,
  fonts,
  typography,
  spacing,
  radii,
  sizes,
  opacity,
  shadows,
  motion,
  statusBar: {
    style: 'light' as const,
  },
  navigation: {
    barBackground: 'rgba(7, 3, 26, 0.92)',
    border: colors.border,
    active: colors.primaryEmphasis,
    activeBackground: colors.primarySoft,
    inactiveIcon: 'rgba(255,255,255,0.45)',
    inactiveLabel: 'rgba(255,255,255,0.4)',
  },
} as const;

type WidenThemeValues<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends (...args: never[]) => unknown
        ? T
        : T extends readonly unknown[]
          ? { readonly [Key in keyof T]: WidenThemeValues<T[Key]> }
          : T extends object
            ? { readonly [Key in keyof T]: WidenThemeValues<T[Key]> }
            : T;

type DarkThemeContract = WidenThemeValues<typeof darkTheme>;

/**
 * Structural contract a future Light palette must satisfy. String and
 * numeric token values are widened while object keys and gradient tuple
 * shapes remain exact, preventing drift between theme variants.
 */
export type AppTheme = Omit<DarkThemeContract, 'mode' | 'statusBar'> & {
  readonly mode: ThemeMode;
  readonly statusBar: {
    readonly style: 'light' | 'dark';
  };
};

/**
 * Complete Light implementation of the AppTheme contract. Dark remains the
 * official default; Light is selected only by an explicit local preference.
 */
export const lightTheme: AppTheme = {
  ...darkTheme,
  mode: 'light',
  colors: lightColors,
  chart: lightChart,
  gradients: lightGradients,
  shadows: lightShadows,
  statusBar: {
    style: 'dark',
  },
  navigation: {
    barBackground: 'rgba(255,255,255,0.94)',
    border: lightColors.border,
    active: lightColors.primaryEmphasis,
    activeBackground: lightColors.primarySoft,
    inactiveIcon: lightColors.iconMuted,
    inactiveLabel: lightColors.textMuted,
  },
};

/** Typed registry used by the local runtime preference flow. */
export const themes = {
  dark: darkTheme,
  light: lightTheme,
} as const satisfies Readonly<Record<ThemeMode, AppTheme>>;
