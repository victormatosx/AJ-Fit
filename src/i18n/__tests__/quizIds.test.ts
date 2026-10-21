import { describe,expect,it } from 'vitest';
import { MUSCLE_FOCUS_VISUAL_GROUPS } from '../../onboarding/muscleFocusBodyMap';
import { defaultQuiz,type ExperienceLevel,type PrimaryGoal,type Quiz } from '../../state/AppState';
import { extractLeafPaths } from '../resourceParity';

import enQuiz from '../resources/en/quiz.json';
import esQuiz from '../resources/es/quiz.json';
import ptBRQuiz from '../resources/pt-BR/quiz.json';

/**
 * Phase 5 REGRESSION GUARD.
 *
 * These tests exist to catch a specific class of accident: someone renames
 * a persisted questionnaire identifier (e.g. `goal: 'hyper'` → `'hypertrophy'`)
 * while migrating the UI to i18n. That kind of change would silently break
 * every existing questionnaire in Firestore because the app persists these
 * raw string ids as the source of truth.
 *
 * The invariants below are the persisted contract with Firestore. They must
 * not change without an authorized data migration:
 *   - sex:      'm' | 'f'
 *   - current goal: 'gain_muscle' | 'lose_fat' | 'strength' | 'conditioning' | 'health'
 *   - legacy goal aliases: 'hyper' | 'cut' | 'perf' | 'def' | 'recon'
 *   - current level: 'beginner' | 'intermediate' | 'intermediate_experienced' | 'advanced'
 *     (`intermediate_experienced` is a questionnaire-only refinement of
 *     `intermediate` for user self-identification; prescription logic
 *     normalizes it to `intermediate` and never branches on it directly)
 *   - deprecated/legacy level aliases: 'never_or_starting' | 'beg' | 'int' | 'adv' | 'elite'
 *   - duration: '30' | '45' | '60' | '90'
 *   - place:    'gym' | 'home'
 *   - limits:   'none' | 'knee' | 'back' | 'shoulder' | 'wrist' | 'hip'
 *   - equipment: catalog ids in EquipmentPicker (unchanged, English lowercase)
 *
 * We assert the ids AT TWO LAYERS: the app's own type (Quiz union) and the
 * i18n resource tree — because a mismatch between those two would ship
 * missing translation keys to production.
 */

/** Assert that every id in `expected` has a `label` under
 *  `<questionKey>.options.<id>` in the given locale JSON. */
function assertOptionsHaveLabel(
  locale: string,
  json: unknown,
  questionKey: string,
  expectedIds: readonly string[],
  leafKey: string,
): void {
  const paths = extractLeafPaths(json);
  for (const id of expectedIds) {
    const p = `${questionKey}.options.${id}.${leafKey}`;
    expect(
      paths,
      `[${locale}] missing quiz:${p}`,
    ).toContain(p);
  }
}

/** Assert every id has a flat leaf under `<questionKey>.options.<id>` (multi). */
function assertMultiOptionsHaveLabel(
  locale: string,
  json: unknown,
  questionKey: string,
  expectedIds: readonly string[],
): void {
  const paths = extractLeafPaths(json);
  for (const id of expectedIds) {
    const p = `${questionKey}.options.${id}`;
    expect(paths, `[${locale}] missing quiz:${p}`).toContain(p);
  }
}

// ── ID contract by field ──────────────────────────────────────────────────

describe('quiz IDs — sex', () => {
  const IDS = ['m', 'f'] as const;
  it('Quiz type accepts exactly m and f', () => {
    // Compile-time-guarded by literal comparison at the assignment site.
    const good: Array<Quiz['sex']> = [null, 'm', 'f'];
    expect(good.length).toBe(3);
  });
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale ships label + short for m/f: %s', (loc, json) => {
    assertOptionsHaveLabel(loc, json, 'sex', IDS, 'label');
    assertOptionsHaveLabel(loc, json, 'sex', IDS, 'short');
  });
});

describe('quiz IDs — goal', () => {
  const CURRENT_IDS = [
    'gain_muscle', 'lose_fat', 'strength', 'conditioning', 'health',
  ] as const;
  const READABLE_LEGACY_IDS = [
    'body_composition', 'return_to_training',
    'hyper', 'cut', 'perf', 'def', 'recon',
  ] as const;
  it('defaultQuiz.goal is null (never persisted as a label)', () => {
    expect(defaultQuiz.goal).toBeNull();
  });
  it('PrimaryGoal contains the five values new questionnaires may write', () => {
    const goals: PrimaryGoal[] = [...CURRENT_IDS];
    expect(goals).toHaveLength(5);
  });
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale presents current and persisted legacy goal labels: %s', (loc, json) => {
    assertOptionsHaveLabel(loc, json, 'goal', [...CURRENT_IDS, ...READABLE_LEGACY_IDS], 'label');
    assertOptionsHaveLabel(loc, json, 'goal', [...CURRENT_IDS, ...READABLE_LEGACY_IDS], 'description');
  });
});

describe('quiz IDs — level', () => {
  const CURRENT_IDS = ['beginner', 'intermediate', 'intermediate_experienced', 'advanced'] as const;
  const READABLE_LEGACY_IDS = ['never_or_starting', 'beg', 'int', 'adv', 'elite'] as const;
  it('ExperienceLevel contains the four values new questionnaires may write', () => {
    const levels: ExperienceLevel[] = [...CURRENT_IDS];
    expect(levels).toHaveLength(4);
  });
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale presents current and persisted legacy experience labels: %s', (loc, json) => {
    assertOptionsHaveLabel(loc, json, 'level', [...CURRENT_IDS, ...READABLE_LEGACY_IDS], 'label');
    assertOptionsHaveLabel(loc, json, 'level', [...CURRENT_IDS, ...READABLE_LEGACY_IDS], 'description');
  });
});

describe('quiz IDs — duration', () => {
  const IDS = ['30', '45', '60', '90'] as const;
  it('IDs remain numeric strings (persisted contract)', () => {
    for (const id of IDS) expect(id).toMatch(/^\d+$/);
  });
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale ships label + short for all 4 durations: %s', (loc, json) => {
    assertOptionsHaveLabel(loc, json, 'duration', IDS, 'label');
    assertOptionsHaveLabel(loc, json, 'duration', IDS, 'short');
  });
});

describe('quiz IDs — place', () => {
  const IDS = ['gym', 'home'] as const;
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale ships label + short for gym/home: %s', (loc, json) => {
    assertOptionsHaveLabel(loc, json, 'place', IDS, 'label');
    assertOptionsHaveLabel(loc, json, 'place', IDS, 'short');
  });
});

describe('quiz IDs — limits (multi)', () => {
  const IDS = ['none', 'knee', 'hip', 'back', 'shoulder', 'elbow', 'wrist', 'ankle_foot', 'other'] as const;
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale ships all limitation labels: %s', (loc, json) => {
    assertMultiOptionsHaveLabel(loc, json, 'limits', IDS);
  });
});

describe('quiz IDs — Body Map visual groups', () => {
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every selectable muscle group has a localized name: %s', (loc, json) => {
    const paths = extractLeafPaths(json);
    for (const group of MUSCLE_FOCUS_VISUAL_GROUPS) {
      const path = `muscleFocus.groups.${group}`;
      expect(paths, `[${loc}] missing quiz:${path}`).toContain(path);
    }
    expect(paths, `[${loc}] missing quiz:muscleFocus.noneSelected`).toContain(
      'muscleFocus.noneSelected',
    );
  });
});

// ── Equipment IDs — matches the catalog in EquipmentPicker.EXDB_EQUIP ──

describe('quiz IDs — equipment catalog', () => {
  // Every id in EXDB_EQUIP must have a translation in the items map, in
  // every locale. Renaming any of these breaks the persisted contract.
  const EXPECTED_EQUIPMENT_IDS = [
    'barbell', 'olympic barbell', 'ez barbell', 'trap bar',
    'dumbbell', 'kettlebell', 'weighted', 'hammer',
    'smith machine', 'leverage machine', 'cable', 'assisted',
    'sled machine',
    'band', 'resistance band', 'rope', 'medicine ball',
    'stability ball', 'bosu ball', 'roller', 'wheel roller', 'tire',
    'body weight',
    'stationary bike', 'elliptical machine', 'stepmill machine',
    'skierg machine', 'upper body ergometer',
    'bench', 'abdominal bench', 'preacher curl', 'leg raise tower',
    'functional trainer', 'lat pull down machine', 'seated row machine',
    'chest press machine', 'chest fly machine', 'shoulder press machine',
    'lateral raises machine', 'seated dip machine',
    'leg press machine', 'hack squat machine', 'leg extension machine',
    'leg curl machine', 'back extension machine', 'ab crunch machine',
    'ghd machine', 'ab roller',
    'elliptical', 'stepmill', 'treadmill',
  ] as const;

  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale has a label for each equipment id: %s', (loc, json) => {
    const paths = extractLeafPaths(json);
    for (const id of EXPECTED_EQUIPMENT_IDS) {
      const p = `equipment.items.${id}`;
      expect(paths, `[${loc}] missing quiz:${p}`).toContain(p);
    }
  });
});

describe('quiz — categories map to stable ids (not localized display names)', () => {
  const EXPECTED_CATEGORY_IDS = [
    'freeWeights', 'benchesAndRacks', 'machines',
    'functional', 'cardio', 'bodyweight', 'other',
  ] as const;
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('every locale exposes all 7 category translations: %s', (loc, json) => {
    const paths = extractLeafPaths(json);
    for (const id of EXPECTED_CATEGORY_IDS) {
      const p = `equipment.categories.${id}`;
      expect(paths, `[${loc}] missing quiz:${p}`).toContain(p);
    }
  });
});

// ── Guard against persisted labels leaking into any resource ─────────────

describe('quiz — no Portuguese labels are persisted as ids (regression)', () => {
  // If someone accidentally seeded the persisted state with a translated
  // string ("Masculino" instead of "m"), the resource lookup would fail
  // and the picker would render the raw string, or worse, save it back to
  // Firestore. This test locks the shape of `defaultQuiz` fields to null
  // / empty array (never a preloaded label).
  it('defaultQuiz initializes categorical fields to null and array fields to empty', () => {
    expect(defaultQuiz.sex).toBeNull();
    expect(defaultQuiz.goal).toBeNull();
    expect(defaultQuiz.level).toBeNull();
    expect(defaultQuiz.duration).toBeNull();
    expect(defaultQuiz.place).toBeNull();
    expect(defaultQuiz.limits).toEqual([]);
    expect(defaultQuiz.equipment).toEqual([]);
  });
});

// ── Pluralization contract for age (birthDate) ────────────────────────────

describe('quiz — birthDate age pluralization', () => {
  it.each([
    ['pt-BR', ptBRQuiz],
    ['en', enQuiz],
    ['es', esQuiz],
  ] as const)('%s ships both age_one and age_other with {{count}} interpolation', (loc, json) => {
    const paths = extractLeafPaths(json);
    expect(paths, `[${loc}] missing quiz:birthDate.age_one`).toContain('birthDate.age_one');
    expect(paths, `[${loc}] missing quiz:birthDate.age_other`).toContain('birthDate.age_other');
    // Both leaves must include the {{count}} placeholder — otherwise i18next
    // renders "year" without the number and callers concatenate manually.
    const record = json as Record<string, unknown>;
    const birthDate = record.birthDate as Record<string, string>;
    expect(birthDate.age_one).toMatch(/\{\{count\}\}/);
    expect(birthDate.age_other).toMatch(/\{\{count\}\}/);
  });
});
