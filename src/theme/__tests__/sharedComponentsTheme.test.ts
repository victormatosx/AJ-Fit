import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const THEME_AWARE_SHARED_COMPONENTS = [
  'src/components/ui/SegBar.tsx',
  'src/components/ui/OutlineNumber.tsx',
  'src/components/ui/SettingsSection.tsx',
  'src/components/ui/ProfileAvatar.tsx',
  'src/components/ui/PasswordField.tsx',
  'src/components/ui/DateFieldsInput.tsx',
  'src/components/ui/NativeDatePickerField.tsx',
  'src/components/ui/DateWheelPicker.tsx',
  'src/components/ui/ImperialHeightInput.tsx',
  'src/components/ui/FoldableSection.tsx',
  'src/components/ui/SmartAlertsSection.tsx',
  'src/components/support/SupportScreenHeader.tsx',
  'src/components/support/SupportChip.tsx',
  'src/components/support/SupportImageField.tsx',
  'src/components/premium/PremiumRequiredSheet.tsx',
  'src/components/onboarding/InterstitialLayout.tsx',
  'src/components/onboarding/CarouselIndicators.tsx',
] as const;

const PHASE_3_THEME_AWARE_AREAS = [
  'src/components/fitness/EquipmentPicker.tsx',
  'src/components/onboarding/QuestionRenderer.tsx',
  'src/components/fitness/EvolutionLineChart.tsx',
  'src/components/fitness/EvolutionAreaChart.tsx',
  'src/components/fitness/AssessmentMetricCard.tsx',
  'src/components/fitness/AssessmentActionCard.tsx',
  'src/components/fitness/AssessmentHistoryCard.tsx',
  'src/components/fitness/AssessmentEvolutionCard.tsx',
  'src/components/fitness/PhysicalAssessmentSummaryCard.tsx',
  'src/components/fitness/BodyEvolutionView.tsx',
  'src/components/fitness/LoadsEvolutionView.tsx',
  'src/screens/WorkoutScreen.tsx',
  'src/screens/AssessmentScreen.tsx',
  'src/screens/AuthScreen.tsx',
  'src/screens/SettingsScreen.tsx',
] as const;

const PHASE_4_THEME_AWARE_AREAS = [
  'src/screens/AnalyzingScreen.tsx',
  'src/screens/PlanReadyScreen.tsx',
  'src/screens/PaywallScreen.tsx',
  'src/screens/HomeScreen.tsx',
  'src/screens/ConsistencyScreen.tsx',
  'src/screens/EditProfileScreen.tsx',
  'src/screens/SubscriptionCenterScreen.tsx',
  'src/screens/AppShell.tsx',
] as const;

const PHASE_5_THEME_AWARE_AREAS = [
  'src/screens/ProfileScreen.tsx',
  'src/screens/ProgressScreen.tsx',
  'src/screens/ProgressPhotosScreen.tsx',
  'src/screens/EmailVerificationScreen.tsx',
  'src/screens/ChangePasswordScreen.tsx',
  'src/screens/TotpChallengeScreen.tsx',
  'src/screens/TotpEnrollmentScreen.tsx',
  'src/screens/TwoFactorSettingsScreen.tsx',
  'src/screens/OnboardingScreen.tsx',
  'src/screens/OnboardingFunnelScreen.tsx',
  'src/screens/SocialProofScreen.tsx',
  'src/screens/HelpCenterScreen.tsx',
  'src/screens/HelpArticleScreen.tsx',
  'src/screens/SupportFormScreen.tsx',
  'src/screens/SupportSuccessScreen.tsx',
  'src/screens/onboarding/NameStepScreen.tsx',
  'src/screens/onboarding/WelcomeInterstitialScreen.tsx',
  'src/screens/onboarding/MethodologyInterstitialScreen.tsx',
  'src/screens/onboarding/GuidedWorkoutInterstitialScreen.tsx',
  'src/screens/onboarding/EvolutionInterstitialScreen.tsx',
  'src/screens/onboarding/AjFitProgressInterstitialScreen.tsx',
  'src/components/auth/ReauthenticationMethods.tsx',
  'src/components/ui/PhoneFrame.tsx',
  'src/components/fitness/ExerciseGif.tsx',
  'src/components/onboarding/QuestionStepScreen.tsx',
  'src/components/onboarding/GuidedWorkoutCarousel.tsx',
  'src/components/onboarding/EvolutionCarousel.tsx',
  'src/components/onboarding/AjFitProgressCarousel.tsx',
  'src/components/onboarding/TestimonialCard.tsx',
  'src/components/onboarding/BeforeAfterCard.tsx',
  'src/components/photoVault/AddPhotoSheet.tsx',
  'src/components/photoVault/PhotoCompareScreen.tsx',
  'src/components/photoVault/PhotoProgressIntro.tsx',
  'src/components/photoVault/PhotoVaultProtectedIntro.tsx',
  'src/components/photoVault/PhotoVaultLockedState.tsx',
  'src/components/photoVault/PhotoVaultFilterBar.tsx',
  'src/components/photoVault/PhotoVaultEmptyState.tsx',
  'src/components/photoVault/PhotoVaultFilterEmptyState.tsx',
  'src/components/photoVault/PhotoVaultDayRow.tsx',
] as const;

const STATIC_VISUAL_IMPORT =
  /import\s*\{[^}]*\b(?:colors|fonts)\b[^}]*\}\s*from ['"][^'"]*theme\/tokens['"]/s;

describe('Phase 2 shared component theme coverage', () => {
  it.each(THEME_AWARE_SHARED_COMPONENTS)('%s consumes ThemeProvider visual state', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('useTheme');
    expect(source).not.toMatch(STATIC_VISUAL_IMPORT);
  });

  it('keeps input roles semantic instead of reintroducing Dark literals', () => {
    const inputs = [
      'src/components/ui/PasswordField.tsx',
      'src/components/ui/DateFieldsInput.tsx',
      'src/components/ui/NativeDatePickerField.tsx',
      'src/components/ui/DateWheelPicker.tsx',
      'src/components/ui/ImperialHeightInput.tsx',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    for (const role of [
      'inputBackground',
      'inputBorder',
      'inputBorderError',
      'inputText',
      'inputPlaceholder',
      'inputIcon',
      'inputSelection',
    ]) {
      expect(inputs).toContain(`theme.colors.${role}`);
    }
  });
});

describe('Phase 3 complex control and critical shell coverage', () => {
  it.each(PHASE_3_THEME_AWARE_AREAS)('%s consumes ThemeProvider visual state', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('useTheme');
    expect(source).not.toMatch(STATIC_VISUAL_IMPORT);
  });

  it('routes structural chart colors through the shared chart contract', () => {
    const charts = [
      'src/components/fitness/EvolutionLineChart.tsx',
      'src/components/fitness/EvolutionAreaChart.tsx',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    for (const role of ['axis', 'grid', 'label', 'background', 'primaryLine', 'endpoint']) {
      expect(charts).toContain(`theme.chart.${role}`);
    }
  });

  it('keeps questionnaire and equipment selection visual state semantic', () => {
    const controls = [
      'src/components/fitness/EquipmentPicker.tsx',
      'src/components/onboarding/QuestionRenderer.tsx',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    for (const role of [
      'choiceBackground',
      'choiceSelectedBackground',
      'choiceBorder',
      'choiceSelectedBorder',
      'equipmentItemBackground',
      'equipmentItemSelectedBackground',
    ]) {
      expect(controls).toContain(`theme.colors.${role}`);
    }
  });
});

describe('Phase 4 acquisition and primary app coverage', () => {
  it.each(PHASE_4_THEME_AWARE_AREAS)('%s consumes ThemeProvider visual state', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('useTheme');
    expect(source).not.toMatch(STATIC_VISUAL_IMPORT);
  });

  it('routes consistency data colors through a dedicated visualization contract', () => {
    const consistency = readFileSync('src/screens/ConsistencyScreen.tsx', 'utf8');

    for (const role of [
      'doneBackground',
      'doneBorder',
      'todayGradient',
      'missedBackground',
      'pendingBorder',
    ]) {
      expect(consistency).toContain(`theme.chart.consistency.${role}`);
    }
  });

  it('keeps the Phase 4 critical screens free of Dark color literals', () => {
    const screens = PHASE_4_THEME_AWARE_AREAS.map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(screens).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });
});

describe('Phase 5 remaining visible UI coverage', () => {
  it.each(PHASE_5_THEME_AWARE_AREAS)('%s consumes ThemeProvider visual state', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('useTheme');
    expect(source).not.toMatch(STATIC_VISUAL_IMPORT);
  });

  it('keeps Photo Vault security/export media isolated while theming its UI chrome', () => {
    const chrome = [
      'src/screens/ProgressPhotosScreen.tsx',
      'src/components/photoVault/AddPhotoSheet.tsx',
      'src/components/photoVault/PhotoCompareScreen.tsx',
      'src/components/photoVault/PhotoVaultFilterBar.tsx',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');
    const dayRow = readFileSync('src/components/photoVault/PhotoVaultDayRow.tsx', 'utf8');
    const poster = readFileSync('src/components/photoVault/PhotoComparePoster.tsx', 'utf8');

    expect(chrome).toContain('theme.colors');
    expect(dayRow).toContain("colors={['transparent', 'rgba(2,0,16,0.7)']}");
    expect(poster).not.toContain('useTheme');
  });

  it('preserves interoperable TOTP QR contrast independently from app chrome', () => {
    const enrollment = readFileSync('src/screens/TotpEnrollmentScreen.tsx', 'utf8');

    expect(enrollment).toContain('color="#020010"');
    expect(enrollment).toContain('backgroundColor="#ffffff"');
    expect(enrollment).toContain("backgroundColor: '#ffffff'");
  });

  it('does not introduce system appearance into app or onboarding theme selection', () => {
    const sources = [
      'src/theme/ThemeProvider.tsx',
      'src/screens/OnboardingScreen.tsx',
      'src/screens/OnboardingFunnelScreen.tsx',
      'src/components/ui/NativeDatePickerField.tsx',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(sources).not.toContain('useColorScheme');
    expect(sources).not.toContain('Appearance');
  });
});

describe('theme-independent visual boundaries', () => {
  it('does not theme photo overlays or exported comparison artwork', () => {
    const attachment = readFileSync('src/components/support/SupportImageField.tsx', 'utf8');
    const poster = readFileSync('src/components/photoVault/PhotoComparePoster.tsx', 'utf8');

    expect(attachment).toContain("backgroundColor: 'rgba(2,0,16,0.55)'");
    expect(attachment).toContain("backgroundColor: 'rgba(2,0,16,0.85)'");
    expect(poster).not.toContain('useTheme');
  });

  it('keeps Photo Vault viewer and privacy chrome independent from the app theme', () => {
    const viewer = readFileSync('src/components/photoVault/PhotoVaultViewer.tsx', 'utf8');
    const privacyContext = readFileSync('src/state/PhotoVaultContext.tsx', 'utf8');

    expect(viewer).toContain("backgroundColor: '#000'");
    expect(viewer).toContain("backgroundColor: 'rgba(0,0,0,0.55)'");
    expect(privacyContext).toContain("backgroundColor: '#020010'");
  });

  it('preserves native and brand-specific Dark/invariant values for later phases', () => {
    const datePicker = readFileSync('src/components/ui/NativeDatePickerField.tsx', 'utf8');
    const icon = readFileSync('src/components/ui/Icon.tsx', 'utf8');
    const appConfig = readFileSync('app.json', 'utf8');

    expect(datePicker).toContain('themeVariant={theme.mode}');
    expect(datePicker).not.toContain('Appearance');
    expect(icon).toContain('fill="#4285F4"');
    expect(icon).toContain('fill="#34A853"');
    expect(icon).toContain('fill="#FBBC04"');
    expect(icon).toContain('fill="#EA4335"');
    // Phase 9: fixed to the product default (Dark), never "automatic" — see
    // docs/08_log_de_evolucao.md (Fase 9 do tema) for the full rationale.
    expect(appConfig).toContain('"userInterfaceStyle": "dark"');
  });

  it('preserves Phase 3 data, media and celebration colors outside UI theming', () => {
    const workout = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
    const assessment = readFileSync('src/screens/AssessmentScreen.tsx', 'utf8');
    const auth = readFileSync('src/screens/AuthScreen.tsx', 'utf8');

    expect(workout).toContain("const CONFETTI_COLORS = ['#0b70f9', '#4da3ff', '#ffffff', '#1f82ff']");
    expect(workout).toContain("backgroundColor: 'rgba(2,0,16,0.55)'");
    expect(assessment).toContain("classification: 'normal', c: '#22c55e'");
    expect(auth).toContain('<Icon name="apple" size={19} color="#fff" />');
  });
});
