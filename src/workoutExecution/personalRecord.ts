/**
 * Weights already confirmed for one exercise within the current, still
 * in-progress session — reads the same `logged` map WorkoutScreen keeps
 * (`${exerciseId}-${setIndex}` -> weightKg). A plain prefix match would also
 * match a different exercise whose id happens to be a prefix of this one
 * (e.g. `bench` inside `bench-press-0`); requiring the trailing segment to be
 * exactly the numeric set index rules that out.
 */
export function loggedWeightsForExercise(
  logged: Readonly<Record<string, number>>,
  exerciseId: string,
): number[] {
  const prefix = `${exerciseId}-`;
  return Object.entries(logged)
    .filter(([key]) => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)))
    .map(([, value]) => value);
}

export interface PersonalRecordEvaluation {
  /** The just-confirmed weight beats every valid load recorded for this exercise before it — historical record and this session's own already-confirmed sets alike. */
  isRecord: boolean;
  /** What `candidateWeightKg` had to beat. `0` means there is no valid record yet to compare against — a PR is never declared against a `0` baseline. */
  baselineKg: number;
}

/**
 * Compares a just-confirmed set against the best load recorded for this
 * exercise BEFORE that set — the historical record plus any set already
 * confirmed earlier in this same session — but never the set being
 * evaluated itself.
 *
 * Call this once per set, immediately after it is confirmed. Because
 * `sessionLoggedWeightsKg` is read fresh each time from the caller's
 * up-to-date `logged` state, each PR racks up on the one immediately before
 * it — never on a stale baseline captured once at session start — so a PR
 * is recognized on the very set that sets it, not one set later.
 */
export function evaluateSetForPersonalRecord(input: {
  historicalRecordKg: number;
  sessionLoggedWeightsKg: readonly number[];
  candidateWeightKg: number;
}): PersonalRecordEvaluation {
  const baselineKg = Math.max(input.historicalRecordKg, 0, ...input.sessionLoggedWeightsKg);
  return {
    isRecord: baselineKg > 0 && input.candidateWeightKg > baselineKg,
    baselineKg,
  };
}

export interface QueuedPersonalRecordCheck {
  exerciseId: string;
  weightKg: number;
}

export interface PersonalRecordReplayResult {
  /** The most recent set in the queue that turned out to be a PR, or `null` if none was. Only one is ever returned — sets confirmed while the record was unknown were effectively simultaneous discoveries once it resolved, so only the latest gets the celebratory overlay. */
  recognized: { exerciseId: string; weightKg: number; baselineKg: number } | null;
}

/**
 * Re-evaluates sets that were confirmed BEFORE the historical record for
 * their exercise was known (`useLoadProgress` is deliberately non-blocking,
 * so a set can be confirmed while it's still loading). `evaluateSetForPersonalRecord`
 * alone can't cover this: at confirmation time the true baseline didn't
 * exist yet, so evaluating then — against a guessed/zero baseline — risks a
 * false negative. This replays the queue, in original confirmation order, so
 * a 55 -> 60 -> 65 chain recognizes every step exactly as it would have live,
 * against the now-resolved `historicalRecordsKg`.
 */
export function replayQueuedPersonalRecordChecks(
  queue: readonly QueuedPersonalRecordCheck[],
  historicalRecordsKg: Readonly<Record<string, number>>,
): PersonalRecordReplayResult {
  const runningBaselineByExercise = new Map<string, number>();
  let recognized: PersonalRecordReplayResult['recognized'] = null;

  queue.forEach((item) => {
    const baseline = runningBaselineByExercise.get(item.exerciseId)
      ?? historicalRecordsKg[item.exerciseId]
      ?? 0;
    const evaluation = evaluateSetForPersonalRecord({
      historicalRecordKg: baseline,
      sessionLoggedWeightsKg: [],
      candidateWeightKg: item.weightKg,
    });
    if (evaluation.isRecord) {
      recognized = { exerciseId: item.exerciseId, weightKg: item.weightKg, baselineKg: evaluation.baselineKg };
    }
    runningBaselineByExercise.set(item.exerciseId, Math.max(baseline, item.weightKg));
  });

  return { recognized };
}
