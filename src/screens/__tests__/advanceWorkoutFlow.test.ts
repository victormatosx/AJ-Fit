import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');
const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
const treino = readFileSync('src/screens/TreinoScreen.tsx', 'utf8');
const todayBlock = readFileSync('src/components/treino/TreinoTodayBlock.tsx', 'utf8');
const advanceButton = readFileSync('src/components/workout/AdvanceWorkoutButton.tsx', 'utf8');

describe('advance next workout UI flow', () => {
  it('uses a separate request/confirmation/start path without weakening normal SESSION_READY', () => {
    expect(appShell).toContain('const requestAdvanceWorkout = useCallback(() => {');
    expect(appShell).toContain('const startAdvancedWorkout = async () => {');
    expect(appShell).toContain('await execution.startAdvanced(schedule.resolution)');
    expect(appShell).toContain("if (schedule.resolution.status !== 'SESSION_READY') {");
    expect(appShell).toContain('visible={showAdvanceWorkoutConfirmation && advanceTarget !== null && !workoutInProgress}');
  });

  it('renders the CTA and required helper only when AppShell supplies an eligible target', () => {
    expect(home).toContain("scheduleResolution?.status === 'REST_DAY'");
    expect(home).toContain('advanceWorkoutTarget != null');
    expect(home).toContain("t('home:schedule.advance.helper')");
    expect(home).toContain("t('home:schedule.advance.cta', { weekday: advanceWeekday })");
    expect(home).toContain('onPress={onAdvanceWorkout}');
  });

  /**
   * The Treino hub puts the very same affordance in the very same slot as
   * Home's Today card, so a rest day never offers "adiantar treino" on one
   * screen and an empty gap on the other.
   */
  it('offers the same CTA on the Treino hub, from the same target and intent', () => {
    expect(appShell).toContain('advanceWorkoutTarget={advanceTarget}');
    expect(appShell).toContain('onAdvanceWorkout={requestAdvanceWorkout}');
    // Both screens, one shared look.
    expect(home).toContain('<AdvanceWorkoutButton');
    expect(todayBlock).toContain('<AdvanceWorkoutButton');
    // Identical gate to Home's, asserted above for Home itself.
    expect(treino).toContain("resolution.status === 'REST_DAY'");
    expect(treino).toContain('advanceWorkoutTarget != null');
    expect(treino).toContain('onAdvanceWorkout != null');
    expect(treino).toContain("tHome('schedule.advance.cta'");
  });

  it('never shows it beside the start CTA or the completed-today button', () => {
    expect(todayBlock).toContain('{!ctaVisible && !completedLabel && advanceLabel && onPressAdvance && (');
  });

  /**
   * "Adiantar treino" is the same kind of action as "INICIAR TREINO" and sits
   * in the very same slot, so it wears the app-wide `CtaButton` itself rather
   * than a lookalike — one definition of what a primary CTA looks like, on
   * both Home and the Treino hub.
   */
  it('wears the shared CtaButton, not a second primary-CTA look', () => {
    expect(advanceButton).toContain('<CtaButton');
    expect(advanceButton).toContain('<CtaText theme={theme}');
    // No private copy of the gradient/fill/glow.
    expect(advanceButton).not.toContain('backgroundColor');
    expect(advanceButton).not.toContain('shadowRadius');
    expect(advanceButton).not.toContain('borderRadius');
  });

  it('keeps the advance CTA decision in AppShell — the button only forwards it', () => {
    expect(advanceButton).not.toContain('REST_DAY');
    // Themed by prop, never from the active theme — Home hands it the fixed
    // Dark artwork, the Treino hub hands it the live one.
    expect(advanceButton).not.toMatch(/^import .*\buseTheme\b/m);
    expect(advanceButton).toContain('onPress={onPress}');
  });

  it.each(['pt-BR', 'en', 'es'])('has complete %s copy', (locale) => {
    const resource = JSON.parse(readFileSync(`src/i18n/resources/${locale}/home.json`, 'utf8'));
    expect(resource.schedule.advance).toMatchObject({
      cta: expect.any(String),
      helper: expect.any(String),
      confirmTitle: expect.any(String),
      confirmBody: expect.any(String),
      cancel: expect.any(String),
      confirm: expect.any(String),
    });
  });
});
