import type { ComponentType } from 'react';

import {
  WORKOUT_SHARE_ART_LAYOUTS,
  type WorkoutShareArtLayoutId,
  type WorkoutShareArtLayoutMeta,
} from '../../../workoutShare/artLayouts';
import { ArtPosterMinimal } from './ArtPosterMinimal';
import { ArtPosterPerformance } from './ArtPosterPerformance';
import { ArtPosterPr } from './ArtPosterPr';
import { ArtPosterStats } from './ArtPosterStats';
import type { WorkoutShareArtPosterProps } from './types';

export interface WorkoutShareArtPosterEntry extends WorkoutShareArtLayoutMeta {
  Component: ComponentType<WorkoutShareArtPosterProps>;
}

const ART_POSTER_COMPONENTS: Record<WorkoutShareArtLayoutId, ComponentType<WorkoutShareArtPosterProps>> = {
  artMinimal: ArtPosterMinimal,
  artPerformance: ArtPosterPerformance,
  artPr: ArtPosterPr,
  artStats: ArtPosterStats,
};

/**
 * The one place that maps an ARTE layout id to its component — mirrors
 * `posters/registry.tsx`. Everything else (composer, carousel, capture)
 * iterates this list instead of branching on `layout.id`, so adding a 5th
 * design later only means adding an entry here plus one new component file.
 */
export const WORKOUT_SHARE_ART_POSTERS: readonly WorkoutShareArtPosterEntry[] = WORKOUT_SHARE_ART_LAYOUTS.map(
  (meta) => ({ ...meta, Component: ART_POSTER_COMPONENTS[meta.id] }),
);
