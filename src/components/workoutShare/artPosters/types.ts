import type { RefObject } from 'react';
import type { View } from 'react-native';

import type { WorkoutShareData } from '../../../workoutShare/data';
import type { WorkoutSummaryData } from '../../../workoutSummary/buildWorkoutSummaryData';
import type { Sex } from '../../../state/AppState';

/**
 * Common contract every ARTE (transparent-PNG) design implements. ARTE
 * designs never carry a user-selected background photo. `sex` lets the
 * FOTO-derived body-map layouts reuse the same real muscle map.
 * Both `shareData` and `summaryData` are the exact objects the FOTO
 * composer and the WorkoutSummaryScreen already compute upstream
 * (`buildWorkoutShareData`/`buildWorkoutSummaryData`) — nothing here
 * recomputes volume, reps, or personal records.
 */
export interface WorkoutShareArtPosterProps {
  sex: Sex;
  shareData: WorkoutShareData;
  summaryData: WorkoutSummaryData;
  width: number;
  height: number;
  posterRef: RefObject<View | null>;
}
