/**
 * Maps our own exercise catalog ids (`src/data/exercisesSeedData.ts`) to the
 * matching exercise id in `yuhonas/free-exercise-db` — the same public
 * exercise-demo library this project has used since `ExerciseGif.tsx`'s
 * first commit (`DB_BASE`, in that file) for the two-frame crossfade shown
 * whenever an exercise has no admin-uploaded own video.
 *
 * WHY THIS FILE EXISTS: before the 116-exercise catalog migration, our
 * exercise ids WERE free-exercise-db ids verbatim (e.g.
 * `Barbell_Bench_Press_-_Medium_Grip`, still visible in `ExerciseGif.tsx`'s
 * `LOCAL_VIDEOS`), so the crossfade fallback resolved automatically for
 * every exercise. The migration renamed every id to a clean, stable slug
 * (`machine-flat-bench-press`, etc.) with no such correspondence — since
 * then, every exercise without an own video 404s silently against
 * `DB_BASE` and shows only the "GIF · NOME" placeholder. This table
 * restores that correspondence explicitly, one exercise at a time, instead
 * of relying on ids matching by construction.
 *
 * HOW EACH ENTRY WAS CHOSEN (not guessed blindly): cross-referenced against
 * the live `dist/exercises.json` index (873 entries) by name, target
 * muscle, and equipment, then manually reviewed for whether the free-
 * exercise-db entry actually demonstrates the SAME movement pattern as ours
 * — not just the same muscle group. Every URL below (`{id}/0.jpg` and
 * `{id}/1.jpg`) was verified to resolve (HTTP 200) before this file was
 * written.
 *
 * DELIBERATELY NOT mapped (left absent — `ExerciseGif` falls through to the
 * "GIF · NOME" placeholder for these, never a wrong/misleading movement):
 * bird-dog, controlled-marching, coordinated-breathing,
 * gentle-direction-changes, hip-hinge-drill, hip-mobility,
 * lateral-band-walk, march-in-place, mini-band-hip-abduction,
 * reverse-hack-squat, reverse-hack-squat-unilateral, stationary-lunge,
 * sumo-squat-machine, supported-balance, supported-hip-abduction,
 * supported-semi-tandem-stance, thoracic-mobility, weight-shift — mostly
 * rehab/balance/mobility/gait drills (limitation-adaptation exercises) with
 * no honest equivalent in a general-purpose strength-training library.
 * Showing the wrong movement for one of these would be actively misleading,
 * not just cosmetically imperfect — a missing video is always the safer
 * failure mode here.
 *
 * Values are free-exercise-db `id`s, i.e. the exact `{id}` segment of
 * `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/{id}/0.jpg`.
 */
export const EXERCISE_FALLBACK_VIDEO_ID: Record<string, string> = {
  'bar-lat-pulldown': 'V-Bar_Pulldown',
  'barbell-back-squat': 'Barbell_Squat',
  'bench-dips': 'Bench_Dips',
  'bench-step-up': 'Step-up_with_Knee_Raise',
  'bent-over-dumbbell-row': 'Bent_Over_Two-Dumbbell_Row',
  'bent-over-row-smith-machine': 'Smith_Machine_Bent_Over_Row',
  'bodyweight-squat': 'Bodyweight_Squat',
  'bulgarian-split-squat': 'Suspended_Split_Squat',
  'bulgarian-split-squat-dumbbell': 'Split_Squat_with_Dumbbells',
  'bulgarian-split-squat-machine': 'Smith_Single-Leg_Split_Squat',
  'cable-biceps-curl': 'Standing_Biceps_Cable_Curl',
  'cable-crossover-fly': 'Cable_Crossover',
  'cable-glute-kickback': 'Glute_Kickback',
  'cable-lateral-raise': 'Cable_Seated_Lateral_Raise',
  'cable-rear-delt-fly': 'Cable_Rear_Delt_Fly',
  'cable-shrug': 'Cable_Shrugs',
  'cable-skull-crusher': 'Band_Skull_Crusher',
  'cable-triceps-pushdown': 'Triceps_Pushdown',
  'chair-sit-to-stand': 'Chair_Squat',
  'chair-squat': 'Chair_Squat',
  'conventional-deadlift': 'Barbell_Deadlift',
  'dead-bug': 'Dead_Bug',
  'dumbbell-lateral-raise': 'Dumbbell_Raise',
  'dumbbell-overhead-triceps-extension': 'Sled_Overhead_Triceps_Extension',
  'dumbbell-shoulder-press': 'Dumbbell_Shoulder_Press',
  'dumbbell-stiff-leg-deadlift': 'Stiff-Legged_Dumbbell_Deadlift',
  'ez-bar-biceps-curl': 'EZ-Bar_Curl',
  'face-pull': 'Face_Pull',
  'farmers-walk': 'Farmers_Walk',
  'floor-crunch': 'Crunches',
  'front-raise': 'Front_Cable_Raise',
  'glute-bridge': 'Barbell_Glute_Bridge',
  'goblet-squat': 'Goblet_Squat',
  'hack-squat-machine': 'Hack_Squat',
  'hack-squat-machine-variation': 'Hack_Squat',
  'hammer-curl': 'Hammer_Curls',
  'hip-thrust': 'Barbell_Hip_Thrust',
  'incline-dumbbell-bench-press': 'Incline_Dumbbell_Press',
  'incline-dumbbell-curl': 'Incline_Dumbbell_Curl',
  'iso-lateral-incline-chest-press-machine': 'Leverage_Incline_Chest_Press',
  'iso-lateral-pulldown-machine': 'V-Bar_Pulldown',
  'iso-lateral-row-machine': 'Leverage_Iso_Row',
  'lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  'lat-pulldown-supinated-grip': 'Wide-Grip_Lat_Pulldown',
  'leg-extension-machine': 'Single-Leg_Leg_Extension',
  'leg-press-45': 'Leg_Press',
  'leg-press-45-unilateral': 'Leg_Press',
  'leg-press-90': 'Leg_Press',
  'low-cable-row-close-supinated-grip': 'Seated_Cable_Rows',
  'low-cable-row-wide-grip': 'Seated_Cable_Rows',
  'low-cable-row-wide-neutral-grip': 'Seated_Cable_Rows',
  'low-step-up': 'Step-up_with_Knee_Raise',
  'lying-leg-curl-machine': 'Lying_Leg_Curls',
  'lying-leg-raise': 'Flat_Bench_Lying_Leg_Raise',
  'machine-flat-bench-press': 'Machine_Bench_Press',
  'machine-lateral-raise': 'Side_Lateral_Raise',
  'machine-shoulder-press': 'Machine_Shoulder_Military_Press',
  'one-arm-dumbbell-row': 'One-Arm_Dumbbell_Row',
  'pallof-press': 'Pallof_Press',
  'pec-deck-machine-fly': 'Butterfly',
  'plank': 'Plank',
  'preacher-curl': 'Preacher_Curl',
  'push-up': 'Pushups',
  'resistance-band-lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  'resistance-band-row': 'Seated_Cable_Rows',
  'resistance-band-shoulder-press': 'Shoulder_Press_-_With_Bands',
  'roman-chair-back-extension': 'Hyperextensions_Back_Extensions',
  'roman-chair-back-extension-arms-crossed': 'Hyperextensions_Back_Extensions',
  'seated-calf-raise-machine': 'Seated_Calf_Raise',
  'seated-dumbbell-curl': 'Seated_Dumbbell_Curl',
  'seated-hip-abductor-machine': 'Thigh_Abductor',
  'seated-hip-adductor-machine': 'Thigh_Adductor',
  'seated-leg-curl-machine': 'Seated_Leg_Curl',
  'seated-resistance-band-shoulder-press': 'Shoulder_Press_-_With_Bands',
  'seated-single-arm-dumbbell-curl': 'Seated_Dumbbell_Curl',
  'sissy-squat': 'Weighted_Sissy_Squat',
  'slider-leg-curl': 'Seated_Leg_Curl',
  'smith-machine-squat': 'Smith_Machine_Squat',
  'standing-calf-raise-machine': 'Rocking_Standing_Calf_Raise',
  'standing-single-leg-curl-machine': 'Standing_Leg_Curl',
  'stationary-bike': 'Bicycling_Stationary',
  'stiff-leg-deadlift-hack-machine': 'Smith_Machine_Stiff-Legged_Deadlift',
  'stiff-leg-deadlift-machine': 'Smith_Machine_Stiff-Legged_Deadlift',
  'stiff-leg-deadlift-smith-machine': 'Smith_Machine_Stiff-Legged_Deadlift',
  'sumo-deadlift-dumbbell': 'Sumo_Deadlift',
  'sumo-deadlift-smith-machine': 'Sumo_Deadlift',
  'single-leg-dumbbell-stiff-leg-deadlift': 'Stiff-Legged_Dumbbell_Deadlift',
  'supinated-cable-row': 'Upright_Cable_Row',
  'supported-calf-raise': 'Seated_Calf_Raise',
  'supported-low-step-up': 'Step-up_with_Knee_Raise',
  'supported-standing-leg-curl': 'Standing_Leg_Curl',
  'triceps-rope-pushdown': 'Triceps_Pushdown',
  'unilateral-iso-lateral-pulldown-machine': 'Wide-Grip_Lat_Pulldown',
  'unilateral-iso-lateral-row-machine': 'Leverage_Iso_Row',
  'v-bar-pulldown': 'V-Bar_Pulldown',
  'wall-push-up': 'Incline_Push-Up',
  'walking': 'Walking_Treadmill',
  'walking-lunges': 'Bodyweight_Walking_Lunge',
};
