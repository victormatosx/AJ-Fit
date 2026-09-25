import { describe, expect, it } from 'vitest';
import { FUNNEL_QUESTIONS } from '../questionDefs';

describe('goal question options', () => {
  it('offers exactly the five current goal intents in product order', () => {
    const goal = FUNNEL_QUESTIONS.goal;
    expect(goal?.kind).toBe('choice-large');
    if (!goal || !('options' in goal)) throw new Error('Goal question must expose options');
    expect(goal.options.map((option) => option.v)).toEqual([
      'gain_muscle',
      'lose_fat',
      'strength',
      'conditioning',
      'health',
    ]);
  });
});

describe('level question options', () => {
  it('offers exactly the three current experience levels in product order', () => {
    const level = FUNNEL_QUESTIONS.level;
    expect(level?.kind).toBe('choice-large');
    if (!level || !('options' in level)) throw new Error('Level question must expose options');
    expect(level.options.map((option) => option.v)).toEqual([
      'beginner',
      'intermediate',
      'advanced',
    ]);
  });
});

describe('weekly schedule question', () => {
  it('has one days definition and no redundant schedule questions', () => {
    expect(FUNNEL_QUESTIONS.days).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(FUNNEL_QUESTIONS, 'scheduleMode')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(FUNNEL_QUESTIONS, 'trainingDays')).toBe(false);
  });
});

describe('duration question', () => {
  it('renders the four persisted duration values as text-only large choices', () => {
    const duration = FUNNEL_QUESTIONS.duration;
    expect(duration?.kind).toBe('choice-large');
    if (!duration || !('options' in duration)) throw new Error('Duration question must expose options');
    expect(duration.options.map((option) => option.v)).toEqual(['30', '45', '60', '90']);
  });
});

describe('place question', () => {
  it('offers only gym and home while legacy both remains readable outside the new-answer UI', () => {
    const place = FUNNEL_QUESTIONS.place;
    expect(place?.kind).toBe('choice-large');
    if (!place || !('options' in place)) throw new Error('Place question must expose options');
    expect(place.options.map((option) => option.v)).toEqual(['gym', 'home']);
  });
});

describe('muscle focus question', () => {
  it('keeps the existing persisted priority ids and two-selection rule for the Body Map UI', () => {
    const muscleFocus = FUNNEL_QUESTIONS.muscleFocus;
    expect(muscleFocus?.kind).toBe('multi');
    if (!muscleFocus || muscleFocus.kind !== 'multi') throw new Error('Muscle-focus question must expose multi options');
    expect(muscleFocus.options.map((option) => option.v)).toEqual([
      'chest', 'back', 'shoulders', 'arms',
      'glutes', 'quads', 'hamstrings', 'calves',
      'none',
    ]);
    expect(muscleFocus.maxSelections).toBe(2);
    expect(muscleFocus.exclusiveOption).toBe('none');
  });
});
