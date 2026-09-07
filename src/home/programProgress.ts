import type { EvolutionViewModel, ProximityState } from '../workoutEvolution/types';

/** Number of segments in the compact "Evolução do programa" tracker (Home). */
export const PROGRAM_PROGRESS_SEGMENT_COUNT = 3;

/**
 * How many of the `PROGRAM_PROGRESS_SEGMENT_COUNT` segments are filled — a
 * discretization of the engine's own `ProximityState` enum, never a
 * fabricated percentage/fraction (docs task §1: "não apresente falsa
 * precisão"). Pure so it's testable without rendering `ProgramProgressStrip`
 * (docs task §14).
 */
export function filledProgramProgressSegments(
  kind: EvolutionViewModel['kind'],
  proximity: ProximityState | null,
): number {
  if (kind === 'EVOLUTION_READY' || kind === 'EVOLUTION_DEFERRED' || kind === 'AUTO_ACTIVATION_NOTICE') {
    return PROGRAM_PROGRESS_SEGMENT_COUNT;
  }
  if (proximity === 'BUILDING') return 1;
  if (proximity === 'ON_TRACK') return 2;
  if (proximity === 'READY') return 3;
  return 0;
}
