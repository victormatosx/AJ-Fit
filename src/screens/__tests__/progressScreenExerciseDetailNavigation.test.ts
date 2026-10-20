import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

describe('ProgressScreen exercise detail navigation', () => {
  it('owns which exercise is open and looks it up from the real load-progress list', () => {
    expect(screen).toContain('const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null)');
    expect(screen).toContain(
      'loadExercises.find((exercise) => exercise.exerciseId === selectedExerciseId)',
    );
  });

  it('swaps the whole screen body for the detail screen, same technique as the Photos tab', () => {
    expect(screen).toContain("import { ExerciseEvolutionDetail } from '../components/fitness/ExerciseEvolutionDetail'");
    expect(screen).toContain('selectedExercise ? (');
    expect(screen).toContain('<ExerciseEvolutionDetail');
    expect(screen).toContain('onBack={() => setSelectedExerciseId(null)}');
  });

  it('passes the open handler to LoadsEvolutionView and resets it on tab switch', () => {
    expect(screen).toContain('onSelectExercise={setSelectedExerciseId}');
    expect(screen).toContain('setSelectedExerciseId(null)');
  });
});
