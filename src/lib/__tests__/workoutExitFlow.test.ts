import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * X-button exit flow regression guard (docs/workout-lifecycle/ P0 follow-up,
 * 2026-09 audit). Before this fix, the X abandoned the execution immediately
 * and always navigated away in a `finally`, even when the abandon Firestore
 * transaction failed silently — the screen closed as if the treino had been
 * discarded while it stayed IN_PROGRESS server-side. These are lightweight
 * source checks (no RN runtime import), same convention as
 * `workoutLogicIntact.test.ts`.
 */
const WORKOUT_SRC = readFileSync(
  resolve(__dirname, '../../screens/WorkoutScreen.tsx'),
  'utf8',
);
const HOOK_SRC = readFileSync(
  resolve(__dirname, '../../workoutExecution/useWorkoutExecution.ts'),
  'utf8',
);

describe('WorkoutScreen source — X opens a choice sheet, never abandons directly', () => {
  it('the header close Pressable only opens the exit sheet — no onAbandon/abandon call in its onPress', () => {
    const headerBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf("accessibilityLabel={t('header.accessibility.close')}") - 100,
      WORKOUT_SRC.indexOf("<Icon name=\"x\""),
    );
    expect(headerBlock).toContain("setExitSheet('choice')");
    expect(headerBlock).not.toContain('onAbandon');
    expect(headerBlock).not.toContain('onDone()');
  });

  it('declares the exit sheet state and a discard-error flag', () => {
    expect(WORKOUT_SRC).toContain("useState<'choice' | 'discard' | null>(null)");
    expect(WORKOUT_SRC).toContain('const [discardError, setDiscardError] = useState(false);');
  });
});

describe('WorkoutScreen source — Minimizar performs zero domain mutation', () => {
  it('the choice sheet\'s minimize action only closes the sheet and calls onMinimize', () => {
    const choiceBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf("exitSheet === 'choice'"),
      WORKOUT_SRC.indexOf("exitSheet === 'discard'"),
    );
    expect(choiceBlock).toContain('onMinimize?.()');
    expect(choiceBlock).not.toContain('onAbandon');
    expect(choiceBlock).not.toContain('abandonWorkoutExecution');
    expect(choiceBlock).not.toContain('finishWorkoutExecution');
    expect(choiceBlock).not.toContain('adoptExecution');
  });
});

describe('WorkoutScreen source — Descartar requires confirmation and gates onDone on success', () => {
  it('confirmDiscard awaits onAbandon and only calls onDone when the result is ok', () => {
    const confirmDiscardBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf('const confirmDiscard = () => {'),
      WORKOUT_SRC.indexOf('return (\n    <ScreenBg>'),
    );
    expect(confirmDiscardBlock).toContain('await onAbandon?.()');
    expect(confirmDiscardBlock).toContain('setAbandoning(false);');
    expect(confirmDiscardBlock).toContain('if (!result || result.ok) {');
    expect(confirmDiscardBlock).toContain('onDone();');
    expect(confirmDiscardBlock).toContain('setDiscardError(true);');
    // The bug this replaces: onDone() living in an unconditional `finally`.
    expect(confirmDiscardBlock).not.toMatch(/finally\s*{\s*setAbandoning\(false\);\s*onDone\(\);/);
  });

  it('the discard confirm sheet renders the error and never auto-navigates on failure', () => {
    const discardBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf("exitSheet === 'discard'"),
      WORKOUT_SRC.indexOf("</SafeAreaView>\n    </ScreenBg>\n  );\n}\n\nfunction Badge"),
    );
    expect(discardBlock).toContain('discardError &&');
    expect(discardBlock).toContain("t('exit.discardError')");
    expect(discardBlock).toContain('onPress={confirmDiscard}');
  });

  it('re-tapping discard while a previous attempt is pending is a no-op (guards double tap/race)', () => {
    const confirmDiscardBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf('const confirmDiscard = () => {'),
      WORKOUT_SRC.indexOf('return (\n    <ScreenBg>'),
    );
    expect(confirmDiscardBlock).toContain('if (abandoning) return;');
  });

  it('the destructive confirm button is disabled while abandoning', () => {
    const discardBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf("exitSheet === 'discard'"),
      WORKOUT_SRC.indexOf("</SafeAreaView>\n    </ScreenBg>\n  );\n}\n\nfunction Badge"),
    );
    expect(discardBlock).toContain('disabled={abandoning}');
  });
});

describe('WorkoutScreen source — Cancelar paths never mutate', () => {
  it('closing the choice sheet or backing out of the discard sheet never calls onAbandon/onDone', () => {
    const cancelChoice = "onPress={() => setExitSheet(null)} accessibilityLabel={t('exit.cancel')}";
    const backDiscard = "setDiscardError(false);\n                        setExitSheet('choice');";
    expect(WORKOUT_SRC).toContain(cancelChoice);
    expect(WORKOUT_SRC).toContain(backDiscard);
  });
});

describe('useWorkoutExecution source — abandon() has a typed success/failure contract', () => {
  it('returns { ok: true } on success and { ok: false, error } on failure — never a bare void', () => {
    const abandonBlock = HOOK_SRC.slice(
      HOOK_SRC.indexOf('const abandon = useCallback'),
      HOOK_SRC.indexOf('const abandonExecutionById'),
    );
    expect(abandonBlock).toContain('return { ok: true };');
    expect(abandonBlock).toContain('return { ok: false, error };');
    expect(abandonBlock).not.toMatch(/catch \(error\) {\s*logWarn\([^)]*\);\s*}\s*}, \[uid, execution\]\);/);
  });

  it('the controller interface declares the typed result, not Promise<void>', () => {
    expect(HOOK_SRC).toContain("abandon: () => Promise<{ ok: true } | { ok: false; error: unknown }>;");
  });
});
