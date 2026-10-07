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
import { WORKOUT_SHARE_POSTERS } from '../posters/registry';

export interface WorkoutShareArtPosterEntry extends WorkoutShareArtLayoutMeta {
  Component: ComponentType<WorkoutShareArtPosterProps>;
}

type ExistingArtId = Extract<WorkoutShareArtLayoutId, 'artMinimal' | 'artPerformance' | 'artPr' | 'artStats'>;

const ART_POSTER_COMPONENTS: Record<ExistingArtId, ComponentType<WorkoutShareArtPosterProps>> = {
  artMinimal: ArtPosterMinimal,
  artPerformance: ArtPosterPerformance,
  artPr: ArtPosterPr,
  artStats: ArtPosterStats,
};

/**
 * FOTO-derived entries reuse the original component in transparent mode;
 * the four existing ARTE components keep their own implementations.
 * Preview and HD export both resolve components through this registry.
 */
export const WORKOUT_SHARE_ART_POSTERS: readonly WorkoutShareArtPosterEntry[] = WORKOUT_SHARE_ART_LAYOUTS.map((meta) => {
  if (meta.sourcePhotoLayoutId) {
    const PhotoPoster = WORKOUT_SHARE_POSTERS.find((poster) => poster.id === meta.sourcePhotoLayoutId)!.Component;
    const Component = ({ shareData, sex, width, height, posterRef }: WorkoutShareArtPosterProps) => (
      <PhotoPoster
        sex={sex}
        data={shareData}
        photo={null}
        width={width}
        height={height}
        posterRef={posterRef}
        variant="transparent"
      />
    );
    return { ...meta, Component };
  }
  return { ...meta, Component: ART_POSTER_COMPONENTS[meta.id as ExistingArtId] };
});
