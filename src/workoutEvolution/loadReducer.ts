import { isResolvedEvolutionViewModel } from './viewModel';
import type { EvolutionViewModel } from './types';

/** The outcome a `load()` attempt reports back — never the raw error/data itself, so this stays framework/Firestore-free. */
export type LoadOutcome =
  | { status: 'success'; viewModel: EvolutionViewModel }
  | { status: 'failure' };

/**
 * Pure resilience state machine (docs: Workout Evolution resilience
 * hardening, 2026-09) — extracted out of `useWorkoutEvolution` the same way
 * `foregroundReconcile.ts` was, so it's directly unit-testable without React
 * Native/Firestore.
 *
 * A successful load always replaces the previous view model outright. A
 * failed load only replaces it when there was nothing resolved to protect
 * (`LOADING` — genuine initial-load failure — or `ERROR` — piling on top of
 * an already-failed attempt); any other previous kind (including the
 * legitimately-resolved `UNAVAILABLE`) is preserved as-is, never
 * downgraded to a generic `ERROR` by a merely transient refresh failure.
 */
export function nextViewModelAfterLoad(previous: EvolutionViewModel, outcome: LoadOutcome): EvolutionViewModel {
  if (outcome.status === 'success') return outcome.viewModel;
  if (isResolvedEvolutionViewModel(previous)) return previous;
  return { kind: 'ERROR', message: 'WORKOUT_EVOLUTION_LOAD_FAILED' };
}
