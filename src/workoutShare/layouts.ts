/**
 * Pure metadata for the post-workout share poster designs — no React, no RN
 * imports, so this stays trivially testable (mirrors data.ts/export.ts).
 * The UI-facing mapping from `id` to a poster component lives in
 * `components/workoutShare/posters/registry.tsx`, which is the only place
 * allowed to import React components for these ids.
 *
 * All 6 designs share one canvas: 9:16, exported at 1080x1920. Only the
 * graphic overlay differs between them — there is no per-layout aspect
 * ratio or export size to vary, so this registry is deliberately flat
 * metadata, not a sizing system.
 */
export type WorkoutShareLayoutId = 'classic' | 'minimal' | 'performance' | 'bodymap' | 'creative' | 'social';

export const WORKOUT_SHARE_ASPECT_RATIO = 9 / 16;
export const WORKOUT_SHARE_EXPORT_WIDTH = 1080;
export const WORKOUT_SHARE_EXPORT_HEIGHT = 1920;

export interface WorkoutShareLayoutMeta {
  id: WorkoutShareLayoutId;
  /** Always 9/16 today — kept explicit (rather than assumed) so a test can pin it per layout. */
  aspectRatio: number;
  exportWidth: number;
  exportHeight: number;
  /** i18n key for the design's accessible/selector label. */
  labelKey: string;
}

/**
 * Order here IS carousel order — `classic` first/default preserves the
 * pre-existing single-poster behavior exactly (docs: share flow audit,
 * 2026-09).
 */
export const WORKOUT_SHARE_LAYOUTS: readonly WorkoutShareLayoutMeta[] = [
  {
    id: 'classic',
    aspectRatio: WORKOUT_SHARE_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.layouts.classic',
  },
  {
    id: 'minimal',
    aspectRatio: WORKOUT_SHARE_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.layouts.minimal',
  },
  {
    id: 'performance',
    aspectRatio: WORKOUT_SHARE_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.layouts.performance',
  },
  {
    id: 'bodymap',
    aspectRatio: WORKOUT_SHARE_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.layouts.bodymap',
  },
  {
    id: 'creative',
    aspectRatio: WORKOUT_SHARE_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.layouts.creative',
  },
  {
    id: 'social',
    aspectRatio: WORKOUT_SHARE_ASPECT_RATIO,
    exportWidth: WORKOUT_SHARE_EXPORT_WIDTH,
    exportHeight: WORKOUT_SHARE_EXPORT_HEIGHT,
    labelKey: 'done.shareComposer.layouts.social',
  },
];

export const DEFAULT_WORKOUT_SHARE_LAYOUT_ID: WorkoutShareLayoutId = 'classic';

export function getWorkoutShareLayoutMeta(id: WorkoutShareLayoutId): WorkoutShareLayoutMeta {
  const layout = WORKOUT_SHARE_LAYOUTS.find((item) => item.id === id);
  if (!layout) throw new Error(`unknown workout share layout: ${id}`);
  return layout;
}

export function workoutShareLayoutIndex(id: WorkoutShareLayoutId): number {
  return WORKOUT_SHARE_LAYOUTS.findIndex((item) => item.id === id);
}
