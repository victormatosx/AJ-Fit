/**
 * Real, licensed local pilot files; never an availability/activation gate.
 * Visual/biomechanical release review and portrait takes are still pending.
 * An absent orientation stays absent; no crop or unrelated fallback is added.
 * Provenance/technical inspection: assets/videos/exercises-v3/*.mp4.json.
 */
export const EXERCISE_V3_LOCAL_DEMOS: Record<string, { landscape?: number; portrait?: number }> = {
  'dumbbell-flat-bench-press': {
    landscape: require('../../assets/videos/exercises-v3/dumbbell-flat-bench-press-horizontal.mp4'),
  },
  'lying-dumbbell-triceps-extension': {
    landscape: require('../../assets/videos/exercises-v3/lying-dumbbell-triceps-extension-horizontal.mp4'),
  },
  'dumbbell-triceps-kickback': {
    landscape: require('../../assets/videos/exercises-v3/dumbbell-triceps-kickback-horizontal.mp4'),
  },
};
