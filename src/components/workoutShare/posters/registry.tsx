import type { ComponentType } from 'react';

import {
  WORKOUT_SHARE_LAYOUTS,
  type WorkoutShareLayoutId,
  type WorkoutShareLayoutMeta,
} from '../../../workoutShare/layouts';
import { PosterBodyMap } from './PosterBodyMap';
import { PosterClassic } from './PosterClassic';
import { PosterCreative } from './PosterCreative';
import { PosterMinimal } from './PosterMinimal';
import { PosterPerformance } from './PosterPerformance';
import { PosterSocial } from './PosterSocial';
import type { WorkoutSharePosterProps } from './types';

export interface WorkoutSharePosterEntry extends WorkoutShareLayoutMeta {
  Component: ComponentType<WorkoutSharePosterProps>;
}

const POSTER_COMPONENTS: Record<WorkoutShareLayoutId, ComponentType<WorkoutSharePosterProps>> = {
  classic: PosterClassic,
  minimal: PosterMinimal,
  performance: PosterPerformance,
  bodymap: PosterBodyMap,
  creative: PosterCreative,
  social: PosterSocial,
};

/**
 * The one place that maps a layout id to its component — everywhere else
 * (composer, selector, capture) iterates this list instead of branching on
 * `layout.id`.
 */
export const WORKOUT_SHARE_POSTERS: readonly WorkoutSharePosterEntry[] = WORKOUT_SHARE_LAYOUTS.map(
  (meta) => ({ ...meta, Component: POSTER_COMPONENTS[meta.id] }),
);
