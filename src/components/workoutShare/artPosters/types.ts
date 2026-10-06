import type { RefObject } from 'react';
import type { View } from 'react-native';

import type { WorkoutShareData } from '../../../workoutShare/data';
import type { WorkoutSummaryData } from '../../../workoutSummary/buildWorkoutSummaryData';

/**
 * Common contract every ARTE (transparent-PNG) design implements. Unlike
 * `WorkoutSharePosterProps`, there is no `photo`/`sex` — ARTE designs never
 * carry a user photo, and none of the four designs currently vary by sex.
 * Both `shareData` and `summaryData` are the exact objects the FOTO
 * composer and the WorkoutSummaryScreen already compute upstream
 * (`buildWorkoutShareData`/`buildWorkoutSummaryData`) — nothing here
 * recomputes volume, reps, or personal records.
 */
export interface WorkoutShareArtPosterProps {
  shareData: WorkoutShareData;
  summaryData: WorkoutSummaryData;
  width: number;
  height: number;
  posterRef: RefObject<View | null>;
}
