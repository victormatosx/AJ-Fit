import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase 7A REGRESSION GUARD.
 *
 * 7A migrates only structural copy — session logic (state machine, timers,
 * substitution, weight logging, AsyncStorage, exercise catalog) must remain
 * byte-for-byte identical because 7B and 7C will build on it. This suite
 * pins the invariants that the migration MUST NOT have touched, checked
 * via lightweight string presence in the source file (no runtime imports
 * of React Native components).
 *
 * If any of these assertions fail after a diff, the 7A migration crossed
 * a boundary — stop and review.
 */
const WORKOUT_SRC = readFileSync(
  resolve(__dirname, '../../screens/WorkoutScreen.tsx'),
  'utf8',
);
const REST_TIMER_SRC = readFileSync(resolve(__dirname, '../restTimer.ts'), 'utf8');
const REST_CONTEXT_SRC = readFileSync(
  resolve(__dirname, '../../state/RestSessionContext.tsx'),
  'utf8',
);
const REST_CONTEXT_CODE = REST_CONTEXT_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('WorkoutScreen source — session state machine invariants', () => {
  it('still declares the same session state variables', () => {
    for (const symbol of [
      'const [order, setOrder]',
      'const [progress, setProgress]',
      'const [skipped, setSkipped]',
      'const [logged, setLogged]',
      'const [pending, setPending]',
      'const [regWeight, setRegWeight]',
      'const [permSubs, setPermSubs]',
      'const [sessionSubs, setSessionSubs]',
      'const [finished, setFinished]',
      'const [elapsed, setElapsed]',
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

  it('keeps the elapsed timer, but derives rest time from an absolute endsAt', () => {
    expect(WORKOUT_SRC).toMatch(/setElapsed\(\(e\)\s*=>\s*e\s*\+\s*1\)/);
    expect(WORKOUT_SRC).not.toMatch(/setRestLeft\(\(r\)\s*=>\s*r\s*-\s*1\)/);
    expect(WORKOUT_SRC).toContain('computeRemainingSeconds(rest, restNow)');
    expect(REST_TIMER_SRC).toContain('endsAt: input.startedAt + input.durationSeconds * 1000');
    expect(REST_TIMER_SRC).toContain('Math.ceil((rest.endsAt - now) / 1000)');
  });

  it('keeps advanceAfterRest as the sole workout transition after expiry or skip', () => {
    expect(WORKOUT_SRC).toContain('if (consumeExpiration(rest.restId)) advanceAfterRest();');
    expect(WORKOUT_SRC).toContain('if (cancelRest(rest.restId)) advanceAfterRest();');
    expect(REST_CONTEXT_CODE).not.toContain('advanceAfterRest');
  });

  it('does not start a rest for the final set of the workout', () => {
    const completeSet = WORKOUT_SRC.slice(
      WORKOUT_SRC.indexOf('const completeSet = () => {'),
      WORKOUT_SRC.indexOf('const skipRest = () => {'),
    );
    expect(completeSet.indexOf('if (isLastOverall)')).toBeLessThan(
      completeSet.indexOf('startRest({'),
    );
    expect(completeSet).toMatch(/if \(isLastOverall\) \{[\s\S]*?setFinished\(true\);[\s\S]*?return;/);
  });
});

describe('WorkoutScreen source — persistence and IDs untouched', () => {
  it('still reads/writes AsyncStorage under the same key', () => {
    // Fase 11 audit fix: the key constant moved to a shared module
    // (`workoutSubstitutionsStorage.ts`) so the account-deletion shutdown
    // routine can clear it too — same literal key value, same AsyncStorage
    // calls in the screen, just a single source of truth for the key.
    expect(WORKOUT_SRC).toContain(
      "import { WORKOUT_SUBSTITUTIONS_STORAGE_KEY as SUBS_KEY } from '../services/workoutSubstitutionsStorage'",
    );
    expect(WORKOUT_SRC).toContain('AsyncStorage.getItem(SUBS_KEY)');
    expect(WORKOUT_SRC).toContain('AsyncStorage.setItem(SUBS_KEY');
  });

  it('exercise IDs and DB pointers remain unchanged', () => {
    // Sampling a few — full catalog check is out of scope; these six
    // cover the union so a rename would immediately break the test.
    for (const id of [
      "id: 'supino-reto'",
      "id: 'supino-incl'",
      "id: 'crucifixo'",
      "id: 'militar'",
      "id: 'lateral'",
      "id: 'paralelas'",
    ]) {
      expect(WORKOUT_SRC).toContain(id);
    }
  });

  it('substitution mechanic still resolves through ovr → permSubs → sessionSubs', () => {
    expect(WORKOUT_SRC).toMatch(
      /const ovr = \(id: string\): SubOption \| null => sessionSubs\[id\] \|\| permSubs\[id\] \|\| null;/,
    );
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
    // Old direct renderings of catalog data (now go through translate helpers)
    '{ex.name}',
    '{ex.target',
    'name={ex.name}',
    '{resolve(e).name}',
    '{o.name}',
    '{o.target',
    '{pendingSub?.name}',
    '{baseEx.name}',
    'no lugar de',
    'exName: ex.name',
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
    "t('sets.summaryBodyweight'",
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
    "t('done.streak.updated')",
    "t('done.streak.days'",
    "t('done.streak.untilRecord'",
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
    // Helpers wire exercise/target translations
    'translateExerciseName(tLoose, ex.db, ex.name)',
    'translateMuscleGroup(tLoose, ex.target)',
  ];
  for (const call of REQUIRED_T_CALLS) {
    it(`renders via ${call}`, () => {
      expect(WORKOUT_SRC).toContain(call);
    });
  }
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
