import type { RefObject } from 'react';
import type { View } from 'react-native';

import type { WorkoutShareData } from '../../../workoutShare/data';
import type { Sex } from '../../../state/AppState';

export type WorkoutSharePhoto = { uri: string; width: number; height: number };

/**
 * Common contract every poster design implements. Keeping this identical
 * across designs is what lets the composer render/capture any of them
 * without a single `if (layoutId === ...)` branch.
 */
export interface WorkoutSharePosterProps {
  sex: Sex;
  data: WorkoutShareData;
  photo: WorkoutSharePhoto | null;
  width: number;
  height: number;
  posterRef: RefObject<View | null>;
  /** Reuses the exact overlay layout while omitting photo and canvas backgrounds. */
  variant?: 'photo' | 'transparent';
}
