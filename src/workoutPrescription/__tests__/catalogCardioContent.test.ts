import { describe, it, expect } from 'vitest';
import { WORKOUT_TEMPLATES } from '../catalog';

/**
 * Regression for a catalog-authoring bug (Device QA Scenario 8): every
 * `strength`-goal template's cardio finisher used the SAME leg-day-specific
 * note ("Em treino pesado de pernas...") verbatim on every session,
 * including upper-body-only sessions (Bench, Upper Press, Upper Pull /
 * técnico, Upper A, Upper B) where it made no sense — a copy/paste, not a
 * prescription bug (Composition/Selection/Frequency/Safety never touch this
 * text). This audits the whole catalog, not just the one template a real
 * user happened to hit.
 *
 * Genuinely leg-heavy sessions (Squat, Lower A/B, Lower secundário,
 * Recuperação ativa) and the mixed/ambiguous sessions (Hinge/Pull, Força
 * A/B/C — combine leg hinge work with upper pulling in the same block) are
 * deliberately OUT of scope here; classifying those is a content/product
 * decision, not something this test should silently encode.
 */
const LEG_SPECIFIC_NOTE = 'Em treino pesado de pernas, preferir o limite inferior e baixa intensidade.';
const NEUTRAL_STRENGTH_NOTE = 'Após treinos de força, mantenha intensidade leve a moderada e priorize o limite inferior de duração.';
const UPPER_ONLY_SESSION_NAMES = new Set(['Bench', 'Upper Press', 'Upper Pull / técnico', 'Upper A', 'Upper B']);

describe('catalog content — strength cardio finisher notes', () => {
  it('uses typed cycle doses for every interval bike block, never localized text in sets', () => {
    const intervalBikeSlots = WORKOUT_TEMPLATES.flatMap((template) =>
      template.sessions.flatMap((session) => session.exercises.map((exercise) => ({ template, session, exercise }))))
      .filter(({ exercise }) => exercise.exercise_id === 'stationary-bike'
        && exercise.duration === '30-45 s forte + 60-90 s leve');

    expect(intervalBikeSlots).toHaveLength(24);
    for (const { template, session, exercise } of intervalBikeSlots) {
      expect(exercise.sets, `${template.id}:${session.name}`).toBeUndefined();
      expect(exercise.cycles, `${template.id}:${session.name}`).toBe(8);
    }
  });

  it('no upper-only session (0% leg exercises) in the strength catalog uses the leg-specific cardio note', () => {
    const offenders: string[] = [];
    for (const template of WORKOUT_TEMPLATES) {
      if (template.profile.primary_goal !== 'strength') continue;
      for (const session of template.sessions) {
        if (!UPPER_ONLY_SESSION_NAMES.has(session.name)) continue;
        if (session.cardio_finisher?.notes === LEG_SPECIFIC_NOTE) {
          offenders.push(`${template.id}:${session.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every upper-only strength session with a cardio finisher uses the neutral strength note', () => {
    let checked = 0;
    for (const template of WORKOUT_TEMPLATES) {
      if (template.profile.primary_goal !== 'strength') continue;
      for (const session of template.sessions) {
        if (!UPPER_ONLY_SESSION_NAMES.has(session.name)) continue;
        if (!session.cardio_finisher) continue;
        checked += 1;
        expect(session.cardio_finisher.notes).toBe(NEUTRAL_STRENGTH_NOTE);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('leg-heavy strength sessions keep the leg-specific note untouched', () => {
    const legHeavyNames = new Set(['Squat', 'Lower A', 'Lower B', 'Lower secundário']);
    let checked = 0;
    for (const template of WORKOUT_TEMPLATES) {
      if (template.profile.primary_goal !== 'strength') continue;
      for (const session of template.sessions) {
        if (!legHeavyNames.has(session.name)) continue;
        if (!session.cardio_finisher) continue;
        checked += 1;
        expect(session.cardio_finisher.notes).toBe(LEG_SPECIFIC_NOTE);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('deliberately ambiguous sessions (Hinge/Pull, Força A/B/C) are left untouched by this fix', () => {
    const ambiguousNames = new Set(['Hinge/Pull', 'Força A', 'Força B', 'Força C']);
    let checked = 0;
    for (const template of WORKOUT_TEMPLATES) {
      if (template.profile.primary_goal !== 'strength') continue;
      for (const session of template.sessions) {
        if (!ambiguousNames.has(session.name)) continue;
        if (!session.cardio_finisher) continue;
        checked += 1;
        expect(session.cardio_finisher.notes).toBe(LEG_SPECIFIC_NOTE);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('T028 regression (the originally reported Scenario 8 template): Bench and Upper Press now use the neutral note', () => {
    const t028 = WORKOUT_TEMPLATES.find((t) => t.id === 'T028');
    expect(t028).toBeDefined();
    const bench = t028!.sessions.find((s) => s.name === 'Bench');
    const upperPress = t028!.sessions.find((s) => s.name === 'Upper Press');
    expect(bench?.cardio_finisher?.notes).toBe(NEUTRAL_STRENGTH_NOTE);
    expect(upperPress?.cardio_finisher?.notes).toBe(NEUTRAL_STRENGTH_NOTE);
  });
});
