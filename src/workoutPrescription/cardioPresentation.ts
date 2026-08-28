import type { FinalCardioFinisher } from './types';
import type { LooseTranslate } from './sessionPresentation';

const INTENSITY_KEYS: Record<string, string> = {
  'leve a moderada': 'lightModerate',
  'leve a moderada, confortável': 'comfortableLightModerate',
  moderada: 'moderate',
};

export interface CardioFinisherPresentation {
  mode: string;
  duration: string;
  intensity: string;
  optional: boolean;
}

export function resolveCardioFinisherPresentation(
  t: LooseTranslate,
  finisher: FinalCardioFinisher,
): CardioFinisherPresentation {
  const options = finisher.exerciseOptions.map((option) => {
    const key = `workout:cardioFinisher.options.${option}`;
    const translated = t(key, { defaultValue: '' });
    return translated && translated !== key ? translated : option;
  });
  const separator = t('workout:cardioFinisher.optionSeparator', { defaultValue: ' / ' });
  const intensitySlug = INTENSITY_KEYS[finisher.intensity];
  const intensityKey = intensitySlug ? `workout:cardioFinisher.intensities.${intensitySlug}` : '';
  const translatedIntensity = intensityKey ? t(intensityKey, { defaultValue: '' }) : '';
  return {
    mode: options.join(separator),
    duration: finisher.duration,
    intensity: translatedIntensity && translatedIntensity !== intensityKey
      ? translatedIntensity
      : finisher.intensity,
    optional: !finisher.required,
  };
}
