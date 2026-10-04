import { describe, expect, it } from 'vitest';
import { defaultQuiz } from '../../state/AppState';
import { getBodyMuscleMapAnatomy } from '../../data/bodyMuscleMapAnatomy';
import { getMusclePartIds } from '../../lib/muscleMapRegions';
import {
  MUSCLE_FOCUS_IDS,
  MUSCLE_FOCUS_TO_MAP_MUSCLES,
  MUSCLE_FOCUS_VISUAL_GROUPS,
  SELECTABLE_MUSCLE_FOCUS_MAP_MUSCLES,
  mapMusclesForVisualGroups,
  muscleFocusForMapMuscle,
  muscleFocusValuesForVisualGroups,
  toggleMuscleFocusVisualGroup,
  visualGroupForMapMuscle,
  visualGroupsForMuscleFocusValues,
} from '../muscleFocusBodyMap';

describe('muscleFocus Body Map interaction', () => {
  it('starts with no selected muscles', () => {
    expect(defaultQuiz.muscleFocus).toEqual([]);
    expect(muscleFocusValuesForVisualGroups([])).toEqual([]);
  });

  it('keeps every existing persisted priority value addressable from the map', () => {
    expect(Object.keys(MUSCLE_FOCUS_TO_MAP_MUSCLES)).toEqual([...MUSCLE_FOCUS_IDS]);
    for (const focus of MUSCLE_FOCUS_IDS) {
      expect(MUSCLE_FOCUS_TO_MAP_MUSCLES[focus].length).toBeGreaterThan(0);
    }
  });

  it('uses the former card groups, splitting only the old arms card into its named regions', () => {
    expect(MUSCLE_FOCUS_VISUAL_GROUPS).toEqual([
      'chest', 'back', 'shoulders', 'biceps', 'triceps',
      'forearms', 'glutes', 'quads', 'hamstrings', 'calves',
    ]);
  });

  it('maps posterior arm regions such as triceps to a precise visual group and legacy arms value', () => {
    expect(SELECTABLE_MUSCLE_FOCUS_MAP_MUSCLES).toContain('triceps');
    for (const sex of ['m', 'f'] as const) {
      const backPartIds = new Set(getBodyMuscleMapAnatomy(sex).back.muscles.map((part) => part.id));
      expect(getMusclePartIds('triceps').some((partId) => backPartIds.has(partId))).toBe(true);
    }
    expect(visualGroupForMapMuscle('triceps')).toBe('triceps');
    expect(muscleFocusForMapMuscle('triceps')).toBe('arms');
    expect(mapMusclesForVisualGroups(['triceps'])).toEqual(['triceps']);
    expect(muscleFocusValuesForVisualGroups(['triceps'])).toEqual(['arms']);
  });

  it('selects and highlights shoulders and back as whole visual groups', () => {
    expect(visualGroupForMapMuscle('front_deltoid')).toBe('shoulders');
    expect(visualGroupForMapMuscle('rear_deltoid')).toBe('shoulders');
    expect(mapMusclesForVisualGroups(['shoulders'])).toEqual([
      'front_deltoid', 'side_deltoid', 'rear_deltoid',
    ]);
    expect(visualGroupForMapMuscle('lats')).toBe('back');
    expect(visualGroupForMapMuscle('lower_back')).toBe('back');
    expect(mapMusclesForVisualGroups(['back'])).toEqual([
      'lats', 'upper_back', 'traps', 'lower_back',
    ]);
  });

  it('preserves the two-priority limit and toggles any anatomy within a group together', () => {
    expect(toggleMuscleFocusVisualGroup([], 'front_deltoid', 2)).toEqual(['shoulders']);
    expect(toggleMuscleFocusVisualGroup(['shoulders'], 'rear_deltoid', 2)).toEqual([]);
    expect(toggleMuscleFocusVisualGroup(['triceps'], 'biceps', 2)).toEqual(['triceps', 'biceps']);
    expect(toggleMuscleFocusVisualGroup(['triceps', 'biceps'], 'forearms', 2)).toEqual(['triceps', 'biceps']);
  });

  it('collapses the three visual arm groups only when creating persisted values', () => {
    expect(muscleFocusValuesForVisualGroups(['triceps', 'biceps'])).toEqual(['arms']);
    expect(muscleFocusValuesForVisualGroups(['triceps', 'chest'])).toEqual(['arms', 'chest']);
    expect(muscleFocusValuesForVisualGroups(['back', 'shoulders'])).toEqual(['back', 'shoulders']);
  });

  it('does not make unsupported anatomical regions selectable', () => {
    expect(muscleFocusForMapMuscle('abs')).toBeNull();
    expect(visualGroupForMapMuscle('abs')).toBeNull();
    expect(toggleMuscleFocusVisualGroup(['chest'], 'abs', 2)).toEqual(['chest']);
  });

  it('reconstructs a visual selection from a resumed draft, collapsing arms to one representative region', () => {
    expect(visualGroupsForMuscleFocusValues([])).toEqual([]);
    expect(visualGroupsForMuscleFocusValues(['chest', 'back'])).toEqual(['chest', 'back']);
    expect(visualGroupsForMuscleFocusValues(['arms'])).toEqual(['biceps']);
    expect(visualGroupsForMuscleFocusValues(['arms', 'chest'])).toEqual(['biceps', 'chest']);
    expect(visualGroupsForMuscleFocusValues(['none', 'bogus'])).toEqual([]);
  });
});
