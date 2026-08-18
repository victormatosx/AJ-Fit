import type { ImageSourcePropType } from 'react-native';
import type { IconName } from '../components/ui/Icon';

export type AjFitProgressFeatureId = 'body' | 'loads' | 'photos';

export type AjFitProgressFeature = {
  id: AjFitProgressFeatureId;
  /** Icon shown in the phone frame if `image` is ever removed. */
  icon: IconName;
  /**
   * Real product screenshot for this feature.
   *
   *   loads  -> assets/onboarding/aj-fit-progress-loads.png
   *   body   -> assets/onboarding/aj-fit-progress-body.png
   *   photos -> assets/onboarding/aj-fit-progress-photos.png
   *
   * These are full-device captures (status bar + tab bar included) — the
   * carousel's `PHONE_CROP_RATIO` crops the bottom edge, `contentPosition="top"`
   * keeps the status bar/header in frame. Swap the files at those paths to
   * update the screenshots; no code change needed.
   */
  image?: ImageSourcePropType;
};

/**
 * Ring order the carousel scrolls through — not just a list. At rest the
 * carousel opens centered on `loads`, with `body` peeking on the left and
 * `photos` on the right, matching the product's resting composition
 * ("Corpo · Cargas · Fotos"). See `AjFitProgressCarousel` for how this
 * order also drives the auto-rotation direction (Cargas → Corpo → Fotos).
 */
export const ajFitProgressFeatures: AjFitProgressFeature[] = [
  { id: 'body', icon: 'user', image: require('../../assets/onboarding/aj-fit-progress-body.png') },
  { id: 'loads', icon: 'chart', image: require('../../assets/onboarding/aj-fit-progress-loads.png') },
  { id: 'photos', icon: 'camera', image: require('../../assets/onboarding/aj-fit-progress-photos.png') },
];
