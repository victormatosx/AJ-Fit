import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { darkTheme, lightTheme, themes, type AppTheme } from '../theme';
import { lightChart, lightColors, lightGradients, lightShadows } from '../lightTokens';

type Rgb = { red: number; green: number; blue: number };

function parseHexColor(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value);

  if (!match) {
    throw new Error(`Contrast tests require an opaque six-digit hex color: ${value}`);
  }

  const encoded = Number.parseInt(match[1], 16);

  return {
    red: (encoded >> 16) & 255,
    green: (encoded >> 8) & 255,
    blue: encoded & 255,
  };
}

function relativeLuminance(value: string): number {
  const { red, green, blue } = parseHexColor(value);
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lightest = Math.max(foregroundLuminance, backgroundLuminance);
  const darkest = Math.min(foregroundLuminance, backgroundLuminance);

  return (lightest + 0.05) / (darkest + 0.05);
}

function contractShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(contractShape);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, contractShape(child)]),
    );
  }

  return typeof value;
}

describe('official Light theme', () => {
  it('implements the complete AppTheme contract with dedicated visual groups', () => {
    const completeTheme: AppTheme = lightTheme;

    expect(completeTheme.mode).toBe('light');
    expect(completeTheme.colors).toBe(lightColors);
    expect(completeTheme.chart).toBe(lightChart);
    expect(completeTheme.gradients).toBe(lightGradients);
    expect(completeTheme.shadows).toBe(lightShadows);
    expect(completeTheme.statusBar.style).toBe('dark');
    expect(themes).toEqual({ dark: darkTheme, light: lightTheme });
  });

  it('has deep structural parity with the official Dark theme', () => {
    expect(contractShape(lightTheme)).toEqual(contractShape(darkTheme));
  });

  it('shares only theme-invariant foundations with Dark', () => {
    expect(lightTheme.fonts).toBe(darkTheme.fonts);
    expect(lightTheme.typography).toBe(darkTheme.typography);
    expect(lightTheme.spacing).toBe(darkTheme.spacing);
    expect(lightTheme.radii).toBe(darkTheme.radii);
    expect(lightTheme.sizes).toBe(darkTheme.sizes);
    expect(lightTheme.opacity).toBe(darkTheme.opacity);
    expect(lightTheme.motion).toBe(darkTheme.motion);

    expect(lightTheme.colors).not.toBe(darkTheme.colors);
    expect(lightTheme.chart).not.toBe(darkTheme.chart);
    expect(lightTheme.gradients).not.toBe(darkTheme.gradients);
    expect(lightTheme.shadows).not.toBe(darkTheme.shadows);
  });

  it('keeps perceptible Light surface hierarchy', () => {
    expect(
      new Set([
        lightTheme.colors.background,
        lightTheme.colors.surface,
        lightTheme.colors.surfaceMuted,
        lightTheme.colors.surfaceQuiet,
      ]).size,
    ).toBe(4);
    expect(lightTheme.colors.background).toBe('#E7E7E7');
    expect(lightTheme.colors.bg).toBe('#E7E7E7');
    expect(lightTheme.colors.inputBackground).not.toBe(
      lightTheme.colors.background,
    );
    expect(lightTheme.colors.settingsGroupBackground).not.toBe(
      lightTheme.colors.background,
    );
  });

  it('uses the official Dark brand blue as the literal Light primary', () => {
    expect(lightTheme.colors.primary).toBe('#0b70f9');
    expect(lightTheme.colors.primary).toBe(darkTheme.colors.primary);
    expect(lightTheme.colors.accent).toBe(darkTheme.colors.primary);
    expect(lightTheme.gradients.brand).toBe(darkTheme.gradients.brand);
    expect(lightTheme.colors.primaryForeground).toBe('#ffffff');
  });

  it('meets WCAG AA contrast for critical normal-text pairs', () => {
    const pairs = [
      ['textPrimary/background', lightColors.textPrimary, lightColors.background],
      ['textPrimary/surface', lightColors.textPrimary, lightColors.surface],
      ['textSecondary/background', lightColors.textSecondary, lightColors.background],
      ['textMuted/background', lightColors.textMuted, lightColors.background],
      ['textFaint/background', lightColors.textFaint, lightColors.background],
      ['inputText/inputBackground', lightColors.inputText, lightColors.inputBackground],
      [
        'inputPlaceholder/inputBackground',
        lightColors.inputPlaceholder,
        lightColors.inputBackground,
      ],
      [
        'primaryEmphasis/background (links)',
        lightColors.primaryEmphasis,
        lightColors.background,
      ],
      [
        'selectionForeground/selectionBackground',
        lightColors.selectionForeground,
        lightColors.selectionBackground,
      ],
      [
        'feedbackErrorText/feedbackErrorBackground',
        lightColors.feedbackErrorText,
        lightColors.feedbackErrorBackground,
      ],
      [
        'feedbackCriticalText/feedbackCriticalBackground',
        lightColors.feedbackCriticalText,
        lightColors.feedbackCriticalBackground,
      ],
      [
        'dangerText/feedbackDangerBackground',
        lightColors.dangerText,
        lightColors.feedbackDangerBackground,
      ],
      [
        'statusSuccessText/statusSuccessBackground',
        lightColors.statusSuccessText,
        lightColors.statusSuccessBackground,
      ],
      [
        'statusInfoText/statusInfoBackground',
        lightColors.statusInfoText,
        lightColors.statusInfoBackground,
      ],
      [
        'statusCautionText/statusCautionBackground',
        lightColors.statusCautionText,
        lightColors.statusCautionBackground,
      ],
      [
        'tooltipText/tooltipBackground',
        lightChart.tooltipText,
        lightChart.tooltipBackground,
      ],
      ['textPrimary/toastBackground', lightColors.textPrimary, lightColors.toastBackground],
      [
        'inverseForeground/inverseSurface',
        lightColors.inverseForeground,
        lightColors.inverseSurface,
      ],
      ['chart.label/chart.background', lightChart.label, lightChart.background],
      [
        'consistency.missedText/missedBackground',
        lightChart.consistency.missedText,
        lightChart.consistency.missedBackground,
      ],
      [
        'consistency.pendingText/chart.background',
        lightChart.consistency.pendingText,
        lightChart.background,
      ],
    ] as const;

    for (const [name, foreground, background] of pairs) {
      expect(
        contrastRatio(foreground, background),
        `${name} must meet WCAG AA (4.5:1)`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('meets WCAG AA contrast for large/bold CTA label pairs', () => {
    // CtaButton labels are bold, uppercase, 17px display type, which qualifies
    // as "large text" under WCAG 2.x (AA large-text threshold is 3:1, not 4.5:1).
    const pairs = [
      ['primaryForeground/primary', lightColors.primaryForeground, lightColors.primary],
      ['primaryForeground/brandStart', lightColors.primaryForeground, lightGradients.brand[0]],
      ['primaryForeground/brandEnd', lightColors.primaryForeground, lightGradients.brand[1]],
    ] as const;

    for (const [name, foreground, background] of pairs) {
      expect(
        contrastRatio(foreground, background),
        `${name} must meet WCAG AA large text (3:1)`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('routes critical CTA contrast through the validated semantic pairs', () => {
    const ctaButton = readFileSync('src/components/ui/CtaButton.tsx', 'utf8');
    const paywall = readFileSync('src/screens/PaywallScreen.tsx', 'utf8');
    // The Paywall's purchase CTA is the acquisition design's flat accent
    // button, not the app-wide gradient `CtaButton` (see the rationale at the
    // top of `AcquisitionControls.tsx`). The guarantee is unchanged — that
    // CTA's label and fill still come from the validated primary /
    // primaryForeground pair asserted above — only the component carrying it
    // moved, so the assertion follows it there.
    const acquisitionControls = readFileSync(
      'src/components/ui/AcquisitionControls.tsx',
      'utf8',
    );
    const planReady = readFileSync('src/screens/PlanReadyScreen.tsx', 'utf8');
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    const workout = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
    const treinoTodayBlock = readFileSync('src/components/treino/TreinoTodayBlock.tsx', 'utf8');
    const advanceWorkoutButton = readFileSync('src/components/workout/AdvanceWorkoutButton.tsx', 'utf8');

    expect(ctaButton).toContain('colors={theme.gradients.brand}');
    expect(ctaButton).toContain('color: theme.colors.primaryForeground');
    expect(paywall).toContain('<AqPrimaryButton');
    expect(acquisitionControls).toContain('backgroundColor: theme.colors.primary');
    expect(acquisitionControls).toContain('color: theme.colors.primaryForeground');
    expect(planReady).toContain('backgroundColor: theme.colors.primary');
    expect(planReady).toContain('color: theme.colors.primaryForeground');
    // Home's filled CTA in the Today card is the shared
    // `AdvanceWorkoutButton`, which now wears the app-wide gradient
    // `CtaButton` itself — so its validated pair is the one asserted at the
    // top of this test, exactly as the Paywall's followed `AqPrimaryButton`.
    // It is handed a theme by prop so the Today card stays Dark-pinned; that
    // pin is asserted by the poster test below.
    expect(home).toContain('<AdvanceWorkoutButton');
    expect(advanceWorkoutButton).toContain('<CtaButton');
    expect(advanceWorkoutButton).toContain('<CtaText theme={theme}');
    expect(workout).toContain('backgroundColor: theme.colors.primary');
    expect(workout).toContain('color: theme.colors.primaryForeground');
    // Treino's start CTA is the app-wide gradient `CtaButton` itself, whose
    // validated pair is asserted at the top of this test — the guarantee
    // moved into the shared component, it did not go away.
    expect(treinoTodayBlock).toContain('<CtaButton');
    expect(treinoTodayBlock).toContain('<CtaText>{ctaLabel}</CtaText>');
  });

  it('keeps the theme-aware Treino redesign components free of hardcoded white literals', () => {
    // The Treino hub follows the live theme (unlike Home's forced-Dark
    // poster), so a semi-transparent white literal would be illegible on
    // the Light background. Every faint role must route through a token.
    const WHITE_LITERAL = /rgba\(255,\s*255,\s*255|#fff\b|#ffffff\b|'white'/i;

    const todayBlock = readFileSync('src/components/treino/TreinoTodayBlock.tsx', 'utf8');
    const weekStrip = readFileSync('src/components/treino/TreinoWeekStrip.tsx', 'utf8');
    const exerciseList = readFileSync('src/components/treino/TreinoExerciseList.tsx', 'utf8');
    const upcomingList = readFileSync('src/components/treino/TreinoUpcomingList.tsx', 'utf8');
    // Rendered by the Treino hub too (Home passes it the fixed Dark theme).
    const completedButton = readFileSync('src/components/workout/CompletedTodayButton.tsx', 'utf8');
    const advanceButton = readFileSync('src/components/workout/AdvanceWorkoutButton.tsx', 'utf8');
    const nextWorkoutRow = readFileSync('src/components/workout/NextWorkoutRow.tsx', 'utf8');

    expect(nextWorkoutRow).not.toMatch(WHITE_LITERAL);
    expect(advanceButton).not.toMatch(WHITE_LITERAL);
    expect(completedButton).not.toMatch(WHITE_LITERAL);
    expect(todayBlock).not.toMatch(WHITE_LITERAL);
    expect(weekStrip).not.toMatch(WHITE_LITERAL);
    expect(exerciseList).not.toMatch(WHITE_LITERAL);
    expect(upcomingList).not.toMatch(WHITE_LITERAL);
  });

  it('keeps the Today Workout poster on the official Dark artwork in both themes', () => {
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');

    // Flat-card redesign (2026-10-08) dropped the gradient/HUD-corner poster
    // chrome, but the card's text and CTA still route exclusively through
    // the fixed `TODAY_WORKOUT_THEME` (= darkTheme) — never the active
    // app theme — so it stays dark-only in both Light and Dark.
    expect(home).toContain('const TODAY_WORKOUT_THEME = darkTheme;');
    expect(home).toContain('color: TODAY_WORKOUT_THEME.colors.textPrimary');
    expect(home).toContain('color={TODAY_WORKOUT_THEME.colors.primaryForeground}');
    // The slot's two shared buttons (`CompletedTodayButton`,
    // `AdvanceWorkoutButton`) are themed by prop precisely so the card can
    // hand them the fixed Dark artwork while the Treino hub hands them the
    // live theme — so the pin has to hold at those call sites too.
    for (const match of home.matchAll(/<(CompletedTodayButton|AdvanceWorkoutButton|NextWorkoutRow)\b[\s\S]*?\/>/g)) {
      expect(match[0]).toContain('theme={TODAY_WORKOUT_THEME}');
    }
    expect(home).toContain('<CompletedTodayButton');
    expect(home).toContain('<AdvanceWorkoutButton');
    expect(home).toContain('<NextWorkoutRow');
  });

  it('keeps the Start Workout confirmation on the official Dark artwork in both themes', () => {
    const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');
    const confirmation = appShell.slice(
      appShell.indexOf('function StartWorkoutConfirmation'),
      appShell.indexOf('function TabBar'),
    );

    expect(confirmation).toContain('const theme = darkTheme;');
    expect(confirmation).toContain('backgroundColor: theme.colors.overlayStrong');
    expect(confirmation).toContain('colors={theme.gradients.poster}');
    expect(confirmation).toContain('<HudCorners color={theme.colors.hudCorner} />');
    expect(confirmation).toContain('color={theme.colors.textPrimary}');
    expect(confirmation).toContain('backgroundColor: theme.colors.inverseSurface');
    expect(confirmation).toContain('color={theme.colors.inverseForeground}');
  });
});

describe('Light runtime boundary', () => {
  it('uses only the explicit local preference and never device appearance', () => {
    const providerSource = readFileSync('src/theme/ThemeProvider.tsx', 'utf8');
    const runtimeSource = readFileSync('src/theme/themeRuntime.ts', 'utf8');
    const storageSource = readFileSync('src/theme/themeStorage.ts', 'utf8');

    expect(providerSource).toContain('theme: darkTheme');
    expect(providerSource).toContain('theme: themes[snapshot.mode]');
    expect(providerSource).toContain('setTheme: themeRuntime.setTheme');
    expect(storageSource).toContain("'ajfit-theme-preference'");
    expect(`${providerSource}\n${runtimeSource}\n${storageSource}`).not.toMatch(
      /Firestore|useColorScheme|Appearance/,
    );
  });
});
