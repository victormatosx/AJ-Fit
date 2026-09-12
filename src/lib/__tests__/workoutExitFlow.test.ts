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
const APP_SHELL_SRC = readFileSync(
  resolve(__dirname, '../../screens/AppShell.tsx'),
  'utf8',
);
const EVOLUTION_HOOK_SRC = readFileSync(
  resolve(__dirname, '../../workoutEvolution/useWorkoutEvolution.ts'),
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

  it('renders the exit choice as the app-standard floating dialog', () => {
    const dialogBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf('{/* EXIT DIALOG'),
      WORKOUT_SRC.indexOf('</Modal>', WORKOUT_SRC.indexOf('{/* EXIT DIALOG')),
    );
    expect(dialogBlock).toContain("backgroundColor: exitDialogTheme.colors.overlayStrong");
    expect(dialogBlock).toContain("justifyContent: 'center'");
    expect(dialogBlock).toContain('maxWidth: sizes.modalMaxWidth');
    expect(dialogBlock).toContain('borderRadius: radii.xl');
    expect(dialogBlock).toContain('<HudCorners');
    expect(dialogBlock).toContain("{t('exit.kicker').toUpperCase()}");
    expect(dialogBlock).toContain('<Display size={26}');
    expect(dialogBlock).toContain('height: 48');
    expect(dialogBlock).toContain('backgroundColor: exitDialogTheme.colors.inverseSurface');
    expect(dialogBlock).not.toContain("justifyContent: 'flex-end'");
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

describe('WorkoutScreen source — Descartar requires confirmation and bypasses finish', () => {
  it('confirmDiscard awaits onAbandon and only calls onDiscarded when the result is ok', () => {
    const confirmDiscardBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf('const confirmDiscard = () => {'),
      WORKOUT_SRC.indexOf('\n\n  // Reconciles immediately on return to foreground'),
    );
    expect(confirmDiscardBlock).toContain('await onAbandon?.()');
    expect(confirmDiscardBlock).toContain('await onDiscarded();');
    expect(confirmDiscardBlock).toContain('setAbandoning(false);');
    expect(confirmDiscardBlock).toContain('if (!result || result.ok) {');
    expect(confirmDiscardBlock.indexOf('await onAbandon?.()'))
      .toBeLessThan(confirmDiscardBlock.indexOf('await onDiscarded();'));
    expect(confirmDiscardBlock).not.toContain('onDone();');
    expect(confirmDiscardBlock).toContain('setDiscardError(true);');
    // The older bug: navigation living in an unconditional `finally`.
    expect(confirmDiscardBlock).not.toMatch(/finally\s*{\s*setAbandoning\(false\);\s*onDiscarded\(\);/);
  });

  it('AppShell gives discard a local teardown callback, never the finish callback', () => {
    const discardHandler = APP_SHELL_SRC.slice(
      APP_SHELL_SRC.indexOf('const leaveDiscardedWorkout = async () => {'),
      APP_SHELL_SRC.indexOf('\n\n  return (', APP_SHELL_SRC.indexOf('const leaveDiscardedWorkout = async () => {')),
    );
    expect(discardHandler).toContain('setWorkoutInProgress(false);');
    expect(discardHandler).toContain("setTab('home');");
    const discardFlow = APP_SHELL_SRC.slice(
      APP_SHELL_SRC.indexOf('const discardWorkout = () =>'),
      APP_SHELL_SRC.indexOf('const leaveDiscardedWorkout = async () =>'),
    );
    expect(discardFlow).toContain('runWorkoutDiscardFlow');
    expect(discardFlow).toContain('abandon: execution.abandon');
    expect(discardFlow).toContain('refreshProjection: evolution.refreshProjection');
    expect(APP_SHELL_SRC).toContain('onAbandon={discardWorkout}');
    expect(discardHandler).not.toContain('runWorkoutCompletion');
    expect(discardHandler).not.toContain('schedule.reload');
    expect(discardHandler).not.toContain('activitySnapshot.reload');
    expect(discardHandler).not.toContain('frequencyWindow.reload');
    expect(discardHandler).not.toContain('processWorkoutLifecycleAfterSession');
    expect(APP_SHELL_SRC).toContain('onDiscarded={leaveDiscardedWorkout}');
  });

  it('the explicit projection barrier propagates read failure to the safe discard orchestrator', () => {
    expect(EVOLUTION_HOOK_SRC).toContain("load({ skipReconcile: true, propagateError: true })");
    expect(EVOLUTION_HOOK_SRC).toContain('if (options?.propagateError) throw error;');
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
      WORKOUT_SRC.indexOf('\n\n  // Reconciles immediately on return to foreground'),
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
    const choiceBlock = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf("exitSheet === 'choice'"),
      WORKOUT_SRC.indexOf("exitSheet === 'discard'"),
    );
    expect(choiceBlock).toContain("accessibilityLabel={t('exit.cancel')}");
    expect(choiceBlock).toContain('onPress={() => setExitSheet(null)}');
    expect(choiceBlock).not.toContain('onAbandon');
    expect(choiceBlock).not.toContain('onDone()');
    expect(WORKOUT_SRC).toMatch(/setDiscardError\(false\);\s+setExitSheet\('choice'\);/);
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
