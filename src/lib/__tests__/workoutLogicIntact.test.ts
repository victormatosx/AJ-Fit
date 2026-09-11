import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Workout runtime regression guard.
 *
 * The session state machine/timers remain pinned via lightweight source
 * checks (no runtime import of React Native). Exercise identity is now
 * intentionally plan-driven; raw persisted substitutions must never bypass
 * the prescription engine's constraints.
 */
const WORKOUT_SRC = readFileSync(
  resolve(__dirname, '../../screens/WorkoutScreen.tsx'),
  'utf8',
);
// `workoutExercisesFromPlan` (plan → runtime `Exercise[]` identity, incl.
// `subs: []`) moved to a sibling pure module in Phase 2 (Part D) so it can
// be unit-tested directly (no RN import needed) — see
// `screens/__tests__/workoutScreenPlan.test.ts`. Checked here too, against
// its new home, so this guard still catches a regression in that logic.
const WORKOUT_PLAN_SRC = readFileSync(
  resolve(__dirname, '../../screens/workoutScreenPlan.ts'),
  'utf8',
);

describe('WorkoutScreen source — session state machine invariants', () => {
  it('still declares the same session state variables', () => {
    for (const symbol of [
      'const [order, setOrder]',
      'const [progress, setProgress]',
      'const [skipped, setSkipped]',
      'const [logged, setLogged]',
      'const [pending, setPending]',
      'const [regWeight, setRegWeight]',
      'const [substitutions, setSubstitutions]',
      'const [finished, setFinished]',
      'const [sessionNow, setSessionNow]',
    ]) {
      expect(WORKOUT_SRC).toContain(symbol);
    }
  });

  it('still exposes the same set of session lifecycle functions', () => {
    for (const fn of [
      'advanceAfterRest',
      'completeSet',
      'skipExercise',
      'jumpTo',
      'applySub',
    ]) {
      expect(WORKOUT_SRC).toContain(fn);
    }
  });

  it('ticks display time via setSessionNow/setRestNow — never an incrementing counter (background/lock-screen duration bug fix)', () => {
    // `elapsed` used to be `setElapsed((e) => e + 1)` — a tick counter that
    // silently stopped advancing whenever RN suspended JS in
    // background/locked-screen, undercounting real session duration. It is
    // now derived from `computeWorkoutElapsedSeconds(workoutStartedAtMs,
    // sessionNow)` — the interval only forces a re-render.
    expect(WORKOUT_SRC).not.toMatch(/setElapsed\(/);
    expect(WORKOUT_SRC).toContain('const t = setInterval(() => setSessionNow(Date.now()), 1000);');
    expect(WORKOUT_SRC).toContain(
      'const elapsed = computeWorkoutElapsedSeconds(workoutStartedAtMs ?? sessionNow, sessionNow);',
    );
    expect(WORKOUT_SRC).toContain('const tick = () => setRestNow(Date.now())');
    expect(WORKOUT_SRC).toContain('computeRemainingSeconds(rest, restNow)');
    expect(WORKOUT_SRC).not.toMatch(/setRestLeft\(\(r\)\s*=>\s*r\s*-\s*1\)/);
  });

  it('the session timer stops once finished — regression: WorkoutDone kept ticking "time" after the session ended', () => {
    const timerEffect = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf('// Session duration is'),
      WORKOUT_SRC.indexOf('const ovr = (index: number)'),
    );
    expect(timerEffect).toContain('if (finished) return;');
    expect(timerEffect).toMatch(/}, \[finished\]\);/);
  });

  it('reconciles the displayed duration immediately on AppState foreground return, without adding a manual background-time offset', () => {
    const appStateEffect = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf("AppState.addEventListener('change'") - 200,
      WORKOUT_SRC.indexOf("AppState.addEventListener('change'") + 300,
    );
    expect(appStateEffect).toContain("if (next === 'active') setSessionNow(Date.now());");
  });
});

describe('WorkoutScreen source — plan-driven IDs and constrained substitutions', () => {
  // Exercise-substitution architecture audit (Manual Substitution feature):
  // AsyncStorage is no longer the substitution store — Firestore, via the
  // `applyExerciseSubstitution` Cloud Function, is now the sole source of
  // truth (product Decision #6). This guard now protects the OPPOSITE
  // invariant: the screen must never regress back to a client-only,
  // unauthoritative substitution store.
  it('never reads/writes exercise substitutions through AsyncStorage', () => {
    // `workoutSubstitutionsStorage` (the old `ajfit-subs` AsyncStorage key)
    // must no longer be imported/used by the screen at all — a plain
    // "AsyncStorage" text ban would be too broad (cardioSessionStorage is an
    // unrelated, still-legitimate AsyncStorage use documented elsewhere in
    // this file).
    expect(WORKOUT_SRC).not.toContain('workoutSubstitutionsStorage');
    expect(WORKOUT_SRC).not.toMatch(/AsyncStorage\.(get|set)Item\(SUBS_KEY/);
    expect(WORKOUT_SRC).not.toContain("import AsyncStorage from '@react-native-async-storage/async-storage'");
  });

  it('resolves runtime identity from the final plan by default and supports an explicit effective presentation identity', () => {
    expect(WORKOUT_PLAN_SRC).toContain('export function workoutExercisesFromPlan(');
    expect(WORKOUT_PLAN_SRC).toContain('effectiveExerciseIds?.get(exerciseIndex) ?? prescribed.exerciseId');
    expect(WORKOUT_PLAN_SRC).toContain('catalogExerciseById.get(effectiveExerciseId)');
    expect(WORKOUT_PLAN_SRC).toContain('prescribedExerciseId: prescribed.exerciseId');
    expect(WORKOUT_PLAN_SRC).toContain('effectiveExerciseId,');
    expect(WORKOUT_SRC).not.toContain("id: 'supino-reto'");
    expect(WORKOUT_PLAN_SRC).not.toContain("id: 'supino-reto'");
  });

  // The screen's own `ovr()` only ever reflects a substitution the backend
  // has already confirmed (via `execution.exercises[].substitution`, seeded
  // once at mount, or a fresh `onApplySubstitution` success) — it can never
  // itself decide an id is a valid substitution. `.id` is never mutated by a
  // substitution either (see `resolve`'s doc comment) — the manual resolver
  // always re-resolves against the same fixed anchor.
  it('never applies a substitution the backend has not confirmed — no local override map keyed by exercise id', () => {
    expect(WORKOUT_SRC).toContain('const applied = substitutions[index];');
    expect(WORKOUT_SRC).not.toMatch(/const candidate = sessionSubs\[id\] \|\| permSubs\[id\]/);
    expect(WORKOUT_SRC).toContain('if (!onApplySubstitution) return;');
  });

  it('substitution eligibility is always re-validated server-side before applySub updates local state', () => {
    expect(WORKOUT_SRC).toContain('const result = await onApplySubstitution({');
    expect(WORKOUT_SRC).toContain('if (!result.ok) {\n      setSubstitutionError(true);\n      return;\n    }');
  });
});

describe('WorkoutScreen source — no unintended concatenated translations', () => {
  it('does not concatenate translated strings with runtime values via `+`', () => {
    // We look for patterns like `t('...') + '...'` or `'...' + t('...')`
    // — a common i18n anti-pattern that breaks pluralization and word order
    // across languages.
    const badPatterns = [
      /t\('[^']+'\)\s*\+/,
      /\+\s*t\('[^']+'\)/,
      /`\$\{t\([^)]+\)\}[^`]*\$\{/,
    ];
    for (const p of badPatterns) {
      const m = WORKOUT_SRC.match(p);
      // Allowed exception: single interpolation like `${t(...)} ${var}` is
      // fine when the label sits alone. This regex just makes sure `+ t(`
      // isn't used to glue phrases.
      if (m) {
        // eslint-disable-next-line no-console
        console.warn('[7A] potential translation concatenation match:', m[0]);
      }
      expect(m, `Unexpected concatenation pattern: ${p}`).toBeNull();
    }
  });
});

describe('WorkoutScreen source — 7B + 7C strings fully migrated (positive guard)', () => {
  // After Phase 7C completes the WorkoutScreen migration, every domain
  // string that used to be hardcoded PT must be gone as a raw literal.
  // Any regression that re-introduces one of these lands here immediately.
  const MUST_BE_MIGRATED = [
    // 7B baseline (locked in previous phase, kept as continued guard)
    'PRÓXIMA SÉRIE',
    'ÚLTIMA VEZ',
    'REGISTRADO',
    'DESCANSO',
    'REGISTRAR CARGA',
    'Toque no número para digitar',
    'MINIMIZAR',
    'NOVO RECORDE',
    'SEQUÊNCIA ATUALIZADA',
    ' SÉRIES',
    '× peso corporal',
    'Concluir série ${',
    'faltam 6 p/',
    '15 DIAS',
    "l: 'TEMPO'",
    "l: 'VOLUME'",
    "l: 'NOVO PR'",
    // 7C additions — substitution, badges, video bullets, queue combined,
    // exercise names and muscle groups rendered directly from the catalog.
    'TROCAR EXERCÍCIO',
    'Mesmo grupo muscular',
    "'ORIGINAL'",
    "'SUBSTITUIÇÃO'",
    "'ATUAL'",
    'APLICAR TROCA',
    'Trocar só dessa vez',
    'Trocar em todo o treino',
    "'TROCADO HOJE'",
    "'TROCADO FIXO'",
    // The three hardcoded video-modal bullets
    'Mantenha a escápula retraída',
    'Desça controlando a fase excêntrica',
    'Não trave os cotovelos no topo',
    // Old queue-item combined `${target.toUpperCase()} · ${sets.progress...}`
    '.target.toUpperCase()} ·',
    // Old raw (un-namespaced) muscle-group renderings — must always go
    // through `translateMuscleGroup`, unlike exercise names (see below).
    '{ex.target',
    '{o.target',
    '{pendingSub?.name}',
    'no lugar de',
    // Phase 2, Part G — fake WorkoutDone metrics removed (never real data):
    "'8.2t'",
    "v: '25'",
    "v: '+1'",
    'elapsed || 3480',
    "t('done.streak.updated')",
    "t('done.streak.days'",
    "t('done.streak.untilRecord'",
  ];
  for (const s of MUST_BE_MIGRATED) {
    it(`raw literal "${s}" has been removed`, () => {
      expect(WORKOUT_SRC).not.toContain(s);
    });
  }
});

describe('WorkoutScreen source — 7B + 7C migrations use i18n keys', () => {
  // Presence checks — every migrated feature must resolve via a workout:
  // key. Removing any of these in a future refactor breaks the test.
  const REQUIRED_T_CALLS = [
    // 7B (kept)
    "t('sets.progress'",
    "t('sets.next')",
    "t('sets.number'",
    "t('sets.lastTime')",
    "t('sets.registered')",
    "t('sets.current')",
    "t('sets.summaryWeighted'",
    "t('sets.summaryReps'",
    "t('reps.label')",
    'workoutLoadUnit(resolvedUnits)',
    "t('actions.completeSet'",
    "t('rest.title')",
    "t('rest.minimize')",
    "t('rest.minimizeAccessibility')",
    "t('rest.logLoad'",
    "t('rest.optional')",
    "t('rest.inputHint')",
    "t('rest.addSecondsAccessibility'",
    "t('rest.nextSet')",
    "t('record.new')",
    "t('record.previousContext'",
    "t('record.gain'",
    // `done.streak.*` intentionally removed in Phase 2 Part G — the card
    // showed a hardcoded fake streak with no real data source. See
    // `MUST_BE_MIGRATED` below, which now guards this stays removed.
    "t('queue.completedItem'",
    // 7C (new)
    "t('substitution.sheetTitle')",
    "t('substitution.sheetSubtitle')",
    "t('substitution.labels.original')",
    "t('substitution.labels.replacement')",
    "t('substitution.labels.current')",
    "t('substitution.confirmTitle')",
    "t('substitution.replaceQuestion'",
    "t('substitution.actions.once')",
    "t('substitution.actions.permanent')",
    "t('substitution.actions.cancel')",
    "t('substitution.badges.today')",
    "t('substitution.badges.permanent')",
    "t('queue.activeItem'",
    "t(`instructions.default.${key}`)",
    // Muscle group labels always go through the translate helper — `target`
    // is a canonical `MuscleId`, never display text on its own.
    'translateMuscleGroup(tLoose, ex.target)',
  ];
  for (const call of REQUIRED_T_CALLS) {
    it(`renders via ${call}`, () => {
      expect(WORKOUT_SRC).toContain(call);
    });
  }
});

describe('WorkoutScreen source — exercise names render straight from the catalog (regression: missing_exercise_translation spam)', () => {
  // Real bug: `translateExerciseName` looked exercise names up in a
  // separate, incomplete, legacy i18n map keyed by old ExerciseDB-style ids
  // — the modern catalog's kebab-case ids never matched, so this always
  // missed, logged a warning, and fell back to `ex.name` anyway (the exact
  // value already sitting on `ex`/`o`/`baseEx`, already localized by
  // `workoutExercisesFromPlan` off the real catalog). It was called from
  // ~13 call sites, several inside list `.map()`s, on a component that
  // re-renders every second (the session timer) — hence "dozens/hundreds"
  // of repeated warnings. Fix: read `.name` directly; no lookup, no
  // fallback, no warning, identical (correct) display text.
  it('the helper and its lookup namespace are gone', () => {
    expect(WORKOUT_SRC).not.toContain('function translateExerciseName');
    expect(WORKOUT_SRC).not.toContain('missing_exercise_translation');
  });

  for (const call of [
    'exName: ex.name',
    'const completedName = ex.name;',
    'nextName: nextEx.name',
    'name={ex.name}',
    '{ex.name}',
    'name={o.name}',
    '{o.name}',
    '{resolve(e, i).name}',
  ]) {
    it(`renders "${call}" directly, no translate lookup`, () => {
      expect(WORKOUT_SRC).toContain(call);
    });
  }
});

describe('WorkoutScreen source — missing_muscle_group_translation warns at most once per key (regression: per-render spam)', () => {
  it('tracks warned keys in a module-level Set instead of logging unconditionally', () => {
    expect(WORKOUT_SRC).toContain('const warnedMissingMuscleGroups = new Set<string>();');
    expect(WORKOUT_SRC).toMatch(
      /if \(__DEV__ && !warnedMissingMuscleGroups\.has\(target\)\) {\s*warnedMissingMuscleGroups\.add\(target\);\s*logWarn\('workout', 'missing_muscle_group_translation'/,
    );
  });
});

describe('WorkoutScreen source — rest overlay keyboard dismisses on outside tap', () => {
  // The weight-logging `TextInput` lives inside `RestOverlay`. Its outer
  // container is a `Pressable` (not a plain `View`) calling
  // `Keyboard.dismiss()` — RN's touch responder system only lets that fire
  // when the touch didn't land on a nested Pressable/TextInput (they claim
  // the responder first), so the +/-, +15s, and "next set" buttons — and
  // the TextInput itself — keep working; only empty space dismisses.
  it('imports Keyboard and wires it to the overlay container onPress', () => {
    expect(WORKOUT_SRC).toContain("Keyboard,");
    expect(WORKOUT_SRC).toContain('onPress={() => Keyboard.dismiss()}');
  });

  it('RestOverlay renders a Pressable (not a plain View) as its outermost element', () => {
    const restOverlayBody = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf('function RestOverlay('),
      WORKOUT_SRC.indexOf('\nfunction PROverlay('),
    );
    const returnIdx = restOverlayBody.indexOf('return (');
    const outerTagIdx = restOverlayBody.indexOf('<', returnIdx);
    expect(restOverlayBody.slice(outerTagIdx, outerTagIdx + 10)).toContain('Pressable');
    // The TextInput and every other control (+/-, +15s, next set) must
    // remain reachable — this guard fails if the overlay ever collapses
    // back into a single inert `View` with no way to dismiss the keyboard.
    expect(restOverlayBody).toContain('<TextInput');
    expect(restOverlayBody).toContain('onPress={onAdd15}');
    expect(restOverlayBody).toContain('onPress={onSkip}');
  });
});

describe('WorkoutScreen source — sub-sheet and confirm modal are never both visible', () => {
  // Regression guard: the sub-sheet ("Trocar exercício" list) and the
  // scope-confirm modal ("Somente neste treino" / "Todos os treinos") are
  // two separate native <Modal>s. Selecting a replacement used to only call
  // `setPendingSub(o)`, leaving `subSheet` true — i.e. both Modals visible
  // at once. Stacking two native Modals is what caused the confirm step to
  // never surface reliably and left the screen unresponsive to touches
  // after both were dismissed. Selecting an item must close the sub-sheet
  // in the same handler that opens (or would open) the confirm dialog.
  it('closes the sub-sheet before/alongside opening the confirm dialog on selection', () => {
    const handlerMatch = WORKOUT_SRC.match(
      /onPress=\{\(\) => \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n(\s*setSubSheet\(false\);\s*\n\s*if \(!active\) setPendingSub\(o\);\s*\n\s*)\}\}/,
    );
    expect(handlerMatch).not.toBeNull();
  });

  it('applySub still closes both modals together when a substitution is confirmed', () => {
    expect(WORKOUT_SRC).toMatch(
      /setPendingSub\(null\);\s*\n\s*setSubSheet\(false\);/,
    );
  });
});

describe('WorkoutScreen source — exercise name/target helpers do not persist translations', () => {
  it('applySub still receives the raw SubOption (with catalog PT name/target)', () => {
    // The persistence contract: sessionSubs / permSubs / AsyncStorage store
    // the catalog's PT name because it was captured before translation.
    // `applySub(option, ...)` must never receive a translated option; that
    // would leak locale-specific strings into AsyncStorage.
    expect(WORKOUT_SRC).toContain('applySub(pendingSub, ');
    // `pendingSub` is set from `setPendingSub(o)` where o comes from
    // `subOptions` — catalog data.
    expect(WORKOUT_SRC).toMatch(/setPendingSub\(o\)/);
  });
});
