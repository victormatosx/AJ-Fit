import { describe, expect, it } from 'vitest';
import { resolveCardioFinisherPresentation } from '../cardioPresentation';
import type { FinalCardioFinisher } from '../types';

const finisher: FinalCardioFinisher = {
  mode: 'Caminhada ou Bicicleta Ergométrica',
  exerciseOptions: ['walking', 'stationary-bike'],
  duration: '10-20 min',
  intensity: 'leve a moderada',
  required: false,
};

function t(key: string, opts?: Record<string, unknown>) {
  const values: Record<string, string> = {
    'workout:cardioFinisher.options.walking': 'Walking',
    'workout:cardioFinisher.options.stationary-bike': 'Stationary bike',
    'workout:cardioFinisher.optionSeparator': ' or ',
    'workout:cardioFinisher.intensities.lightModerate': 'Light to moderate',
  };
  return values[key] ?? String(opts?.defaultValue ?? key);
}

describe('cardio finisher presentation', () => {
  it('localizes semantic option IDs and intensity instead of rendering authored Portuguese mode', () => {
    expect(resolveCardioFinisherPresentation(t, finisher)).toEqual({
      mode: 'Walking or Stationary bike',
      duration: '10-20 min',
      intensity: 'Light to moderate',
      optional: true,
    });
  });
});
