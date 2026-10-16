import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completedTodayNextLabel } from '../completedTodayNote';

/**
 * "Treino de hoje concluído": once today's session is done, both the Treino
 * tab and Home's Today card put a BLOCKED button where the start CTA lives,
 * plus a note naming the next workout. Source-inspection for the screens —
 * see appShellNavigationStructure.test.ts for why this repo tests
 * HomeScreen/TreinoScreen structurally instead of with a full RN renderer.
 */

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const TREINO_SCREEN = strip(readFileSync('src/screens/TreinoScreen.tsx', 'utf8'));
const TODAY_BLOCK = strip(readFileSync('src/components/treino/TreinoTodayBlock.tsx', 'utf8'));
const HOME_SCREEN = strip(readFileSync('src/screens/HomeScreen.tsx', 'utf8'));

const ptBR = JSON.parse(readFileSync('src/i18n/resources/pt-BR/treino.json', 'utf8'));

const weekdayLabel = (weekday: string) => ({
  MON: 'SEG', TUE: 'TER', WED: 'QUA', THU: 'QUI', FRI: 'SEX', SAT: 'SÁB', SUN: 'DOM',
}[weekday] ?? weekday);

describe('completedTodayNextLabel', () => {
  it('names the next workout with the short weekday + day of month, lowercased', () => {
    expect(completedTodayNextLabel({
      nextWorkoutDate: '2026-10-07',
      todayLocalDate: '2026-10-05',
      todayLabel: 'Hoje',
      weekdayLabel,
      locale: 'pt-BR',
    })).toBe('qua 07');
  });

  it('says "hoje" when the engine\'s own next date is today', () => {
    expect(completedTodayNextLabel({
      nextWorkoutDate: '2026-10-05',
      todayLocalDate: '2026-10-05',
      todayLabel: 'Hoje',
      weekdayLabel,
      locale: 'pt-BR',
    })).toBe('hoje');
  });

  it('has nothing to name when the resolution carries no next date (flexible mode)', () => {
    expect(completedTodayNextLabel({
      nextWorkoutDate: null,
      todayLocalDate: '2026-10-05',
      todayLabel: 'Hoje',
      weekdayLabel,
      locale: 'pt-BR',
    })).toBeNull();
  });
});

describe('TREINO tab — completed-today button', () => {
  it('shows it only for TODAY_COMPLETED, and never alongside the start CTA', () => {
    expect(TREINO_SCREEN).toContain(
      "const showCompletedToday = !canStartNow && resolution.status === 'TODAY_COMPLETED';",
    );
  });

  it('falls back to the short note when there is no next date', () => {
    expect(TREINO_SCREEN).toContain("t('completed.note', { when: completedNextLabel })");
    expect(TREINO_SCREEN).toContain("t('completed.noteNoNext')");
  });

  it('renders the button disabled, with no press handler at all', () => {
    const start = TODAY_BLOCK.indexOf('{!ctaVisible && completedLabel && (');
    expect(start).toBeGreaterThan(-1);
    const block = TODAY_BLOCK.slice(start);
    expect(block).toContain('accessibilityState={{ disabled: true }}');
    expect(block).toContain('disabled\n');
    expect(block).not.toContain('onPress');
  });
});

describe('Home Today card — completed-today button', () => {
  it('replaces the CTA slot only for TODAY_COMPLETED (rest/recovery keep their row)', () => {
    expect(HOME_SCREEN).toContain(
      "const completedTodayResolution = !workoutInProgress && scheduleResolution?.status === 'TODAY_COMPLETED'",
    );
    expect(HOME_SCREEN).toContain('completedTodayResolution ? (');
  });

  it('renders the button disabled, with no press handler at all', () => {
    const start = HOME_SCREEN.indexOf('completedTodayResolution ? (');
    const end = HOME_SCREEN.indexOf(') : canAdvanceWorkout ? (', start);
    const block = HOME_SCREEN.slice(start, end);
    expect(block).toContain('accessibilityState={{ disabled: true }}');
    expect(block).toContain('disabled\n');
    expect(block).not.toContain('onPress');
  });
});

describe('completed-today copy', () => {
  it('goes through i18n, never a hardcoded string in the screens', () => {
    expect(ptBR.completed.button).toBe('Treino de hoje concluído');
    expect(ptBR.completed.note).toContain('{{when}}');
    for (const source of [TREINO_SCREEN, TODAY_BLOCK, HOME_SCREEN]) {
      expect(source).not.toContain('Treino de hoje concluído');
      expect(source).not.toContain('Você já treinou hoje');
    }
  });
});
