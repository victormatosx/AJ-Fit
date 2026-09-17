import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');
const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');

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
