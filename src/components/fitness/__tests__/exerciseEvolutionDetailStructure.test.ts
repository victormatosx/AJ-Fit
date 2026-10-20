import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/fitness/ExerciseEvolutionDetail.tsx', 'utf8');

describe('ExerciseEvolutionDetail', () => {
  it('accepts exercise/todayLocalDate/onBack and renders no extra header chrome', () => {
    expect(source).toContain('exercise: ExerciseLoadProgress');
    expect(source).toContain('todayLocalDate: string');
    expect(source).toContain('onBack: () => void');
  });

  it('renders a back button using the shared common:actions.back label, not a title bar', () => {
    expect(source).toContain("useTranslation(['home', 'common'])");
    expect(source).toContain("t('common:actions.back')");
    expect(source).toContain('<Icon name="arrow-left"');
    expect(source).toContain('onPress={onBack}');
  });

  it('reuses the exact chart/period-selector pattern the Cargas panel uses', () => {
    expect(source).toContain('<EvolutionAreaChart');
    expect(source).toContain('LOAD_PROGRESS_PERIODS.map');
    expect(source).toContain("useState<LoadProgressPeriod>(90)");
    expect(source).toContain('loadHistoryForPeriod(exercise.history, period, todayLocalDate)');
  });

  it('consumes ThemeProvider visual state like every other fitness component', () => {
    expect(source).toContain('useTheme');
  });
});
