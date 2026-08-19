import { createElement } from 'react';
import { readFileSync } from 'node:fs';
// react-dom is already an application dependency; its package does not ship
// TypeScript declarations in this project, so this test keeps the exception
// local instead of adding a test-only renderer dependency.
// @ts-expect-error Missing optional @types/react-dom declarations.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ThemeProvider, useTheme } from '../ThemeProvider';
import {
  DEFAULT_THEME,
  THEME_MODES,
  darkTheme,
  isThemeMode,
  resolveThemeMode,
  type AppTheme,
  type ThemeMode,
} from '../theme';
import { chart, colors, gradients } from '../tokens';

describe('theme domain', () => {
  it('uses Dark as the explicit product default', () => {
    expect(DEFAULT_THEME).toBe('dark');
  });

  it('accepts exactly the two supported modes', () => {
    const supportedModes: ThemeMode[] = ['dark', 'light'];

    expect(THEME_MODES).toEqual(supportedModes);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('system')).toBe(false);
    expect(isThemeMode('automatic')).toBe(false);
    expect(isThemeMode('auto')).toBe(false);
  });

  it('falls back safely to Dark for missing, invalid or legacy values', () => {
    expect(resolveThemeMode(undefined)).toBe('dark');
    expect(resolveThemeMode(null)).toBe('dark');
    expect(resolveThemeMode('system')).toBe('dark');
    expect(resolveThemeMode('corrupted')).toBe('dark');
  });
});

describe('official Dark theme', () => {
  it('is composed from the existing token objects without copying values', () => {
    expect(darkTheme.mode).toBe('dark');
    expect(darkTheme.colors).toBe(colors);
    expect(darkTheme.chart).toBe(chart);
    expect(darkTheme.gradients).toBe(gradients);
  });

  it('preserves the critical Dark baseline values and legacy aliases', () => {
    expect(darkTheme.colors).toMatchObject({
      bg: '#020010',
      bg2: '#060220',
      bgGradTop: '#0a0530',
      bgGradBottom: '#051236',
      surface: 'rgba(255,255,255,0.03)',
      surfaceRaised: 'rgba(255,255,255,0.05)',
      surfacePressed: 'rgba(255,255,255,0.06)',
      surfaceSelected: 'rgba(11,112,249,0.12)',
      accent: '#0b70f9',
      accentHi: '#4da3ff',
      accentSoft: 'rgba(11,112,249,0.16)',
      text: '#ffffff',
      textSecondary: 'rgba(255,255,255,0.65)',
      mute: 'rgba(255,255,255,0.55)',
      faint: 'rgba(255,255,255,0.32)',
      disabled: 'rgba(255,255,255,0.32)',
      hair: 'rgba(255,255,255,0.08)',
      border: 'rgba(255,255,255,0.07)',
      borderStrong: 'rgba(255,255,255,0.12)',
      focus: '#4da3ff',
      success: '#22c55e',
      warning: '#ffa840',
      danger: '#f0563f',
      dangerText: '#ff9a9a',
      overlay: 'rgba(0,0,0,0.55)',
      overlayStrong: 'rgba(0,0,0,0.84)',
      cardBg: 'rgba(255,255,255,0.03)',
      cardBgHi: 'rgba(255,255,255,0.05)',
      cardBorder: 'rgba(255,255,255,0.07)',
    });
    expect(darkTheme.gradients).toEqual({
      brand: ['#1f82ff', '#0b70f9'],
      progress: ['#0b70f9', '#4da3ff'],
      background: ['#0a0530', '#051236'],
      poster: ['#0a1a55', '#051042', '#04021c'],
      glass: ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.015)'],
      accentWash: ['rgba(11,112,249,0.24)', 'rgba(11,112,249,0.04)'],
      sheetAccent: ['rgba(11,112,249,0.30)', 'rgba(11,112,249,0.08)'],
      accentState: ['rgba(11,112,249,0.28)', 'rgba(11,112,249,0.05)'],
      accentSummary: ['rgba(11,112,249,0.22)', 'rgba(11,112,249,0.04)'],
      subscriptionStatus: [
        'rgba(11,112,249,0.18)',
        'rgba(11,112,249,0.03)',
        'rgba(255,255,255,0.015)',
      ],
    });
    expect(darkTheme.colors.bg).toBe(darkTheme.colors.background);
    expect(darkTheme.colors.text).toBe(darkTheme.colors.textPrimary);
    expect(darkTheme.colors.accent).toBe(darkTheme.colors.primary);
  });

  it('preserves the Phase 2 component-state values in semantic roles', () => {
    expect(darkTheme.colors).toMatchObject({
      controlBackground: 'rgba(255,255,255,0.05)',
      controlBorder: 'rgba(255,255,255,0.09)',
      inputBackground: 'rgba(255,255,255,0.05)',
      inputBackgroundSubtle: 'rgba(255,255,255,0.04)',
      inputBorder: 'rgba(255,255,255,0.12)',
      inputBorderSubtle: 'rgba(255,255,255,0.09)',
      inputBorderError: '#f0563f',
      inputText: '#ffffff',
      inputPlaceholder: 'rgba(255,255,255,0.32)',
      inputLabel: 'rgba(255,255,255,0.65)',
      inputIcon: 'rgba(255,255,255,0.32)',
      inputSelection: 'rgba(255,255,255,0.08)',
      settingsGroupBackground: 'rgba(255,255,255,0.03)',
      settingsGroupBorder: 'rgba(255,255,255,0.06)',
      settingsDivider: 'rgba(255,255,255,0.05)',
      selectionBackground: 'rgba(11,112,249,0.18)',
      selectionBorder: '#4da3ff',
      selectionForeground: '#ffffff',
      uploadBackground: 'rgba(11,112,249,0.07)',
      uploadBackgroundPressed: 'rgba(11,112,249,0.14)',
      uploadBorder: 'rgba(77,163,255,0.45)',
      uploadBorderPressed: '#4da3ff',
      progressTrack: 'rgba(255,255,255,0.09)',
      progressHighlight: '#ffffff',
      decorativeOutline: 'rgba(255,255,255,0.28)',
      modalBackdrop: 'rgba(0,0,0,0.65)',
    });
    expect(darkTheme.opacity.inputDisabled).toBe(0.45);
  });

  it('preserves the Phase 3 control and shell values in semantic roles', () => {
    expect(darkTheme.colors).toMatchObject({
      sheetBackdrop: 'rgba(0,0,0,0.55)',
      sheetBackground: '#0a0620',
      sheetBorder: 'rgba(255,255,255,0.09)',
      choiceBackground: 'rgba(255,255,255,0.035)',
      choiceSelectedBackground: 'rgba(11,112,249,0.16)',
      choiceBorder: 'rgba(255,255,255,0.07)',
      choiceSelectedBorder: '#0b70f9',
      equipmentIcon: '#cfe0ff',
      equipmentIconSelected: '#7db4ff',
      inputPlaceholderSubtle: 'rgba(255,255,255,0.30)',
      authInputBackground: 'rgba(255,255,255,0.045)',
      authInputBorder: 'rgba(255,255,255,0.09)',
      feedbackErrorBackground: 'rgba(255,86,86,0.10)',
      feedbackErrorBorder: 'rgba(255,86,86,0.32)',
      workoutSheetBackground: '#05031e',
      workoutDialogBackground: '#080522',
      workoutOverlay: 'rgba(2,0,16,0.95)',
      workoutOverlayStrong: 'rgba(2,0,16,0.96)',
      primaryBorderMuted: 'rgba(11,112,249,0.40)',
      toastWarning: '#f5a623',
    });
    expect(darkTheme.chart).toEqual({
      axis: 'rgba(255,255,255,0.08)',
      grid: 'rgba(255,255,255,0.08)',
      label: 'rgba(255,255,255,0.32)',
      background: '#020010',
      primaryLine: '#4da3ff',
      primaryAreaStart: '#4da3ff',
      primaryAreaEnd: '#0b70f9',
      endpoint: '#ffffff',
      tooltipBackground: 'rgba(255,255,255,0.05)',
      tooltipText: '#ffffff',
      consistency: {
        doneBackground: 'rgba(11,112,249,0.28)',
        doneBorder: 'rgba(11,112,249,0.50)',
        doneMarker: '#7db4ff',
        todayGradient: ['#1f82ff', '#0b70f9'],
        todayBorder: '#7db4ff',
        missedBackground: 'rgba(255,80,80,0.10)',
        missedBorder: 'rgba(255,90,90,0.40)',
        missedText: '#ff9a9a',
        pendingBorder: 'rgba(11,112,249,0.55)',
        pendingText: '#7db4ff',
      },
    });
  });

  it('preserves the Phase 4 funnel, profile and subscription values in semantic roles', () => {
    expect(darkTheme.colors).toMatchObject({
      surfaceMuted: 'rgba(255,255,255,0.04)',
      surfaceQuiet: 'rgba(255,255,255,0.025)',
      textInactive: 'rgba(255,255,255,0.50)',
      textSecondaryStrong: 'rgba(255,255,255,0.62)',
      inverseSurface: '#ffffff',
      inverseForeground: '#020010',
      primarySurfaceSelected: 'rgba(11,112,249,0.13)',
      primarySurfaceActive: 'rgba(11,112,249,0.20)',
      primaryBorderQuiet: 'rgba(11,112,249,0.30)',
      primaryBorderSoft: 'rgba(77,163,255,0.20)',
      primaryBorderHighlight: 'rgba(77,163,255,0.22)',
      primaryBorderActive: 'rgba(77,163,255,0.75)',
      inputBackgroundQuiet: 'rgba(255,255,255,0.035)',
      inputBackgroundFocused: 'rgba(11,112,249,0.08)',
      inputBackgroundReadOnly: 'rgba(255,255,255,0.018)',
      inputBorderFocusStrong: 'rgba(77,163,255,0.72)',
      inputBorderErrorStrong: 'rgba(240,86,63,0.65)',
      inputBorderReadOnly: 'rgba(255,255,255,0.055)',
      feedbackErrorBackgroundSubtle: 'rgba(255,118,118,0.08)',
      feedbackErrorBorderSubtle: 'rgba(255,118,118,0.30)',
      feedbackErrorBorderMuted: 'rgba(255,118,118,0.28)',
      feedbackCriticalBackground: 'rgba(240,86,63,0.07)',
      feedbackCriticalBackgroundSoft: 'rgba(240,86,63,0.08)',
      feedbackCriticalBorder: 'rgba(240,86,63,0.30)',
      feedbackCriticalText: '#ffb0b0',
      statusSuccessText: '#60d99a',
      statusSuccessBackground: 'rgba(34,197,94,0.12)',
      statusCautionText: '#ffa840',
      statusAttentionText: '#ff9a9a',
      statusOffBackground: 'rgba(255,255,255,0.06)',
    });
  });

  it('keeps the official theme assignable to the shared structural contract', () => {
    const officialDarkContract: AppTheme = darkTheme;

    expect(officialDarkContract.mode).toBe('dark');
  });
});

describe('theme architecture boundaries', () => {
  const themeSource = readFileSync('src/theme/theme.ts', 'utf8');
  const providerSource = readFileSync('src/theme/ThemeProvider.tsx', 'utf8');
  const appSource = readFileSync('App.tsx', 'utf8');

  it('does not derive the product theme from the device appearance', () => {
    expect(`${themeSource}\n${providerSource}`).not.toMatch(/useColorScheme|Appearance/);
  });

  it('wraps the application without keying or remounting its business tree', () => {
    expect(appSource).toContain('<ThemeProvider>');
    expect(appSource).toContain('<AppContent />');
    expect(`${appSource}\n${providerSource}`).not.toMatch(/key=\{(?:theme|mode|themeMode)/);
  });
});

describe('ThemeProvider', () => {
  it('provides the official Dark theme through useTheme', () => {
    const observed: ReturnType<typeof useTheme>[] = [];

    function Probe() {
      observed.push(useTheme());
      return null;
    }

    renderToStaticMarkup(
      createElement(ThemeProvider, { children: createElement(Probe) }),
    );

    expect(observed).toHaveLength(1);
    expect(observed[0]?.mode).toBe('dark');
    expect(observed[0]?.theme).toBe(darkTheme);
    expect(observed[0]?.hydrated).toBe(false);
    expect(observed[0]?.setTheme).toBeTypeOf('function');
  });

  it('keeps the safe Dark fallback outside the application provider', () => {
    const observed: ReturnType<typeof useTheme>[] = [];

    function IsolatedProbe() {
      observed.push(useTheme());
      return null;
    }

    renderToStaticMarkup(createElement(IsolatedProbe));

    expect(observed[0]?.mode).toBe('dark');
    expect(observed[0]?.theme).toBe(darkTheme);
    expect(observed[0]?.hydrated).toBe(true);
    expect(observed[0]?.setTheme).toBeTypeOf('function');
  });
});
