import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completedTodayNextLabel } from '../completedTodayNote';

/**
 * "Treino de hoje concluído": once today's session is done, both the Treino
 * tab and Home's Today card put a BLOCKED button where the start CTA lives,
 * plus a note naming the next workout. Both render the one shared
 * `CompletedTodayButton`, so the blocked guarantees are asserted there once.
 * Source-inspection for the screens — see appShellNavigationStructure.test.ts
 * for why this repo tests HomeScreen/TreinoScreen structurally instead of
 * with a full RN renderer.
 */

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const TREINO_SCREEN = strip(readFileSync('src/screens/TreinoScreen.tsx', 'utf8'));
const TODAY_BLOCK = strip(readFileSync('src/components/treino/TreinoTodayBlock.tsx', 'utf8'));
const HOME_SCREEN = strip(readFileSync('src/screens/HomeScreen.tsx', 'utf8'));
const COMPLETED_BUTTON = strip(readFileSync('src/components/workout/CompletedTodayButton.tsx', 'utf8'));

const ptBR = JSON.parse(readFileSync('src/i18n/resources/pt-BR/treino.json', 'utf8'));

const label = (nextWorkoutDate: string | null, todayLocalDate = '2026-10-05', locale = 'pt-BR') =>
  completedTodayNextLabel({
    nextWorkoutDate,
    todayLocalDate,
    todayLabel: locale === 'pt-BR' ? 'Hoje' : 'Today',
    tomorrowLabel: locale === 'pt-BR' ? 'Amanhã' : 'Tomorrow',
    locale,
  });

/**
 * The label finishes the sentence "O próximo treino é ___.", so it is judged
 * as speech, not as data. "qua 21" — the previous form — reads as a table
 * cell and made the sentence stilted.
 */
describe('completedTodayNextLabel', () => {
  it('names a day inside the coming week by its weekday alone', () => {
    // 2026-10-07 is the Wednesday after Monday the 5th. The day number adds
    // nothing a reader needs.
    expect(label('2026-10-07')).toBe('quarta-feira');
  });

  it('says "hoje" when the engine\'s own next date is today', () => {
    expect(label('2026-10-05')).toBe('hoje');
  });

  it('says "amanhã" rather than naming the weekday of the next day', () => {
    expect(label('2026-10-06')).toBe('amanhã');
  });

  it('adds the day and month once the weekday alone would be ambiguous', () => {
    // A week out, "quarta-feira" would read as the nearer one.
    expect(label('2026-10-14')).toBe('quarta-feira, 14 de outubro');
  });

  it('never abbreviates into "qua 07"', () => {
    for (const date of ['2026-10-06', '2026-10-07', '2026-10-11', '2026-10-14']) {
      expect(label(date)).not.toMatch(/\b\w{3} \d{2}\b/);
    }
  });

  it('follows the locale for both the words and their order', () => {
    expect(label('2026-10-06', '2026-10-05', 'en')).toBe('tomorrow');
    expect(label('2026-10-07', '2026-10-05', 'en')).toBe('wednesday');
    expect(label('2026-10-14', '2026-10-05', 'en')).toBe('wednesday, october 14');
  });

  it('names a stale past date in full instead of calling it this week\'s weekday', () => {
    expect(label('2026-10-01')).toBe('quinta-feira, 1 de outubro');
  });

  it('has nothing to name when the resolution carries no next date (flexible mode)', () => {
    expect(label(null)).toBeNull();
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

  it('puts the shared blocked button in the start CTA\'s slot, never alongside it', () => {
    const start = TODAY_BLOCK.indexOf('{!ctaVisible && completedLabel && (');
    expect(start).toBeGreaterThan(-1);
    // Bounded to this branch only — the slot's other occupants (the start CTA
    // above, "adiantar treino" below) legitimately do have press handlers.
    const block = TODAY_BLOCK.slice(start, TODAY_BLOCK.indexOf('\n      )}', start));
    expect(block).toContain('<CompletedTodayButton');
    expect(block).not.toContain('onPress');
  });
});

describe('CompletedTodayButton — the one blocked button both screens render', () => {
  it('is disabled, with no press handler at all', () => {
    expect(COMPLETED_BUTTON).toContain('accessibilityState={{ disabled: true }}');
    expect(COMPLETED_BUTTON).toContain('disabled\n');
    expect(COMPLETED_BUTTON).not.toContain('onPress');
  });

  it('announces the button text together with the note naming the next workout', () => {
    expect(COMPLETED_BUTTON).toContain('accessibilityLabel={note ? `${label}. ${note}` : label}');
  });

  it('arrives settled unless the switch happened on screen, and always under Reduce Motion', () => {
    expect(COMPLETED_BUTTON).toContain('const from = animate && !reduceMotion ? 0 : 1;');
    expect(COMPLETED_BUTTON).toContain('useReducedMotionPreference');
  });

  /**
   * Regression: the entrance fade starts at opacity 0, and this button is the
   * only thing in its slot — so every way out of the animation has to land
   * back on 1, or a finished workout shows an empty gap. Home never unmounts
   * (`PersistentScreen ... inactiveMode="materialized"`), so the armed
   * transition really does run there on the real device.
   */
  it('can never strand the button at opacity 0', () => {
    const start = COMPLETED_BUTTON.indexOf('function useSettlingEntrance');
    expect(start).toBeGreaterThan(-1);
    const hook = COMPLETED_BUTTON.slice(start, COMPLETED_BUTTON.indexOf('\n}', start));

    // Interrupted mid-flight, and on teardown/effect re-run.
    expect(hook).toContain('if (!finished) value.setValue(1);');
    expect(hook).toContain('animation.stop();');
    expect(hook).toMatch(/return \(\) => \{[\s\S]*value\.setValue\(1\);/);
  });

  it('drives the fade without a UI-thread worklet, so visibility never waits on one', () => {
    expect(COMPLETED_BUTTON).toContain("from 'react-native'");
    expect(COMPLETED_BUTTON).not.toContain('react-native-reanimated');
  });
});

describe('Home Today card — completed-today button', () => {
  it('replaces the CTA slot only for TODAY_COMPLETED (rest/recovery keep their row)', () => {
    expect(HOME_SCREEN).toContain(
      "const completedTodayResolution = !workoutInProgress && scheduleResolution?.status === 'TODAY_COMPLETED'",
    );
    expect(HOME_SCREEN).toContain('completedTodayResolution ? (');
  });

  it('renders the same shared blocked button, with no press handler at all', () => {
    const start = HOME_SCREEN.indexOf('completedTodayResolution ? (');
    const end = HOME_SCREEN.indexOf(') : canAdvanceWorkout ? (', start);
    const block = HOME_SCREEN.slice(start, end);
    expect(block).toContain('<CompletedTodayButton');
    expect(block).not.toContain('onPress');
  });

  it('keeps the card pinned to the Dark artwork for this state too', () => {
    const start = HOME_SCREEN.indexOf('completedTodayResolution ? (');
    const end = HOME_SCREEN.indexOf(') : canAdvanceWorkout ? (', start);
    expect(HOME_SCREEN.slice(start, end)).toContain('theme={TODAY_WORKOUT_THEME}');
  });
});

/**
 * The start CTA's slot resolves the same way on Home's Today card and on the
 * Treino hub: start → done today → advance offer → name the next workout.
 * Before this, a blocked day with nothing to act on informed on Home and left
 * the Treino slot empty (seen in the field on 2026-10-18, a rest day whose
 * advance opportunity had already been consumed).
 */
describe('today slot — Home/Treino parity', () => {
  const NEXT_ROW = strip(readFileSync('src/components/workout/NextWorkoutRow.tsx', 'utf8'));

  it('falls back to the same next-workout row on both screens', () => {
    expect(HOME_SCREEN).toContain('<NextWorkoutRow');
    expect(TODAY_BLOCK).toContain('<NextWorkoutRow');
    // Same copy keys, so the two can't name the next workout differently.
    expect(HOME_SCREEN).toContain("t('home:schedule.nextWorkout.label')");
    expect(TREINO_SCREEN).toContain("tHome('schedule.nextWorkout.label')");
    expect(TREINO_SCREEN).toContain("tHome('schedule.nextWorkout.value'");
  });

  it('shows it only once every actionable occupant of the slot is ruled out', () => {
    expect(TODAY_BLOCK).toContain(
      '{!ctaVisible && !completedLabel && !advanceLabel && nextWorkoutLabel && nextWorkoutValue && (',
    );
  });

  it('keeps the row read-only — it reports, it never acts', () => {
    expect(NEXT_ROW).not.toContain('onPress');
    expect(NEXT_ROW).not.toContain('Pressable');
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
