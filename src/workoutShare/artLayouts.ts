/**
 * Pure metadata for the transparent-PNG "ARTE" overlay designs — mirrors
 * `layouts.ts` (the FOTO/poster designs), but these never carry a photo and
 * must never define an opaque background: the whole point is a PNG the user
 * can drop over their own Story/post. Same aspect ratio as the FOTO posters
 * (9:16), but a deliberately higher export resolution: ARTE is meant to be
 * pasted into Instagram Stories and then resized/enlarged by the user, which
 * the FOTO posters' nominal 1080x1920 never has to withstand (that canvas
 * already matches Instagram's own Story export size 1:1, so it's never
 * stretched further by the consuming app). 2160x3840 gives a 2x safety
 * margin over that baseline — see `exportArt.ts`'s `workoutShareArtRenderSize`
 * for how this is actually reached without any upscaling.
 */
export type WorkoutShareArtLayoutId = 'artMinimal' | 'artPerformance' | 'artPr' | 'artStats';

export const WORKOUT_SHARE_ART_ASPECT_RATIO = 9 / 16;
export const WORKOUT_SHARE_ART_EXPORT_WIDTH = 2160;
export const WORKOUT_SHARE_ART_EXPORT_HEIGHT = 3840;

export interface WorkoutShareArtLayoutMeta {
  id: WorkoutShareArtLayoutId;
  aspectRatio: number;
  exportWidth: number;
  exportHeight: number;
  /** i18n key for the design's accessible/selector label. */
  labelKey: string;
}

/** Order here IS carousel order — `artMinimal` is the default/first design. */
export const WORKOUT_SHARE_ART_LAYOUTS: readonly WorkoutShareArtLayoutMeta[] = [
  {
    id: 'artMinimal',
    aspectRatio: WORKOUT_SHARE_ART_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_ART_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_ART_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.artLayouts.artMinimal',
  },
  {
    id: 'artPerformance',
    aspectRatio: WORKOUT_SHARE_ART_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_ART_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_ART_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.artLayouts.artPerformance',
  },
  {
    id: 'artPr',
    aspectRatio: WORKOUT_SHARE_ART_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_ART_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_ART_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.artLayouts.artPr',
  },
  {
    id: 'artStats',
    aspectRatio: WORKOUT_SHARE_ART_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_ART_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_ART_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.artLayouts.artStats',
  },
];

export const DEFAULT_WORKOUT_SHARE_ART_LAYOUT_ID: WorkoutShareArtLayoutId = 'artMinimal';

export function getWorkoutShareArtLayoutMeta(id: WorkoutShareArtLayoutId): WorkoutShareArtLayoutMeta {
  const layout = WORKOUT_SHARE_ART_LAYOUTS.find((item) => item.id === id);
  if (!layout) throw new Error(`unknown workout share art layout: ${id}`);
  return layout;
}

/**
 * Only `artPr` is conditional today — it needs at least one personal record
 * set in this exact session (`WorkoutSummaryData.personalRecords`, never the
 * full exercise history). Every other design always has the data it needs.
 *
 * Deliberately untyped against `WorkoutSummaryData` itself: that type lives
 * in `workoutSummary/`, which already imports from this package
 * (`workoutShare/data.ts`) — this minimal structural shape keeps the
 * dependency one-directional instead of introducing a cycle.
 */
export function isWorkoutShareArtLayoutAvailable(
  id: WorkoutShareArtLayoutId,
  summaryData: { personalRecords: readonly unknown[] },
): boolean {
  if (id === 'artPr') return summaryData.personalRecords.length > 0;
  return true;
}

/** The layouts actually selectable for this workout, in carousel order. */
export function availableWorkoutShareArtLayouts(
  summaryData: { personalRecords: readonly unknown[] },
): readonly WorkoutShareArtLayoutMeta[] {
  return WORKOUT_SHARE_ART_LAYOUTS.filter((layout) => isWorkoutShareArtLayoutAvailable(layout.id, summaryData));
}
