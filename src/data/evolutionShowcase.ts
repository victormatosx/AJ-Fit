import type { ImageSourcePropType } from 'react-native';
import type { IconName } from '../components/ui/Icon';

export type EvolutionSlideId = 'evolve' | 'adapt' | 'objective';

export type EvolutionSlide = {
  id: EvolutionSlideId;
  /** Icon shown in the phone frame until the real screenshot is supplied. */
  icon: IconName;
  /**
   * Real product screenshot for this slide. Replace with
   * `require('../../assets/onboarding/evolution-0{N}.png')` once the asset
   * exists — until then the frame renders an icon + label placeholder.
   * Recommended export: PNG, device-pixel (3x) portrait screen capture,
   * ~1290x2796 (iPhone content-area crop, no OS chrome needed since the
   * frame already supplies the bezel).
   */
  image?: ImageSourcePropType;
};

export const evolutionShowcaseSlides: EvolutionSlide[] = [
  { id: 'evolve', icon: 'chart' },
  { id: 'adapt', icon: 'swap' },
  { id: 'objective', icon: 'target' },
];
