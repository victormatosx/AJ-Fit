/**
 * Visual-only finalization presentation config — deliberately decoupled
 * from the real server checkpoints (`workoutLifecycle/finalizationProgress.ts`),
 * which keep driving observability/recovery and never pixels. The ring
 * itself is animated on the UI thread with Reanimated (see
 * `FinalizationProgressRing.tsx`) using `rampDurationMs`/`ceilingPercent`/
 * `completionRampMs` below as the single source of truth for that timeline;
 * this module stays framework-agnostic so the message schedule is testable
 * without any React/Reanimated runtime.
 *
 * `rampDurationMs` is a reasoned default (typical callable + single-
 * transaction round trip), not yet backed by production P50/P95 telemetry
 * for `finalizeWorkoutSession` — this is the one constant to recalibrate
 * once that data exists.
 */
export const FINALIZATION_VISUAL_PROGRESS_CONFIG = {
  /** Time to visually crawl from 0% to `ceilingPercent` under normal conditions. */
  rampDurationMs: 5500,
  /** Never shown as 100% before authoritative confirmation. */
  ceilingPercent: 99,
  /** Time to visually close the remaining gap to 100% once COMMITTED arrives. */
  completionRampMs: 320,
};

export const FINALIZATION_MESSAGE_KEYS = [
  'summingLoads',
  'calculatingRecords',
  'preparingSummary',
] as const;

export type FinalizationMessageKey = typeof FINALIZATION_MESSAGE_KEYS[number];

/**
 * Narrative messages for the waiting window — UX copy only. Deliberately
 * not 1:1 with the real server checkpoints (`SERVER_ACCEPTED`/
 * `PREFLIGHT_VALIDATED`/...): those are an implementation detail the user
 * never needs to see, and this schedule is a fixed, reasoned story beat
 * rather than a literal progress readout. `atFraction` is the fraction of
 * `rampDurationMs` elapsed since the current attempt started ramping.
 */
export const FINALIZATION_MESSAGE_SCHEDULE: readonly { key: FinalizationMessageKey; atFraction: number }[] = [
  { key: 'summingLoads', atFraction: 0 },
  { key: 'calculatingRecords', atFraction: 0.35 },
  { key: 'preparingSummary', atFraction: 0.75 },
];

/** Pure — given elapsed ms since the ramp started, which message applies now. */
export function finalizationMessageKeyAtElapsedMs(
  elapsedMs: number,
  config: typeof FINALIZATION_VISUAL_PROGRESS_CONFIG = FINALIZATION_VISUAL_PROGRESS_CONFIG,
): FinalizationMessageKey {
  const fraction = config.rampDurationMs > 0 ? elapsedMs / config.rampDurationMs : 1;
  let current: FinalizationMessageKey = FINALIZATION_MESSAGE_SCHEDULE[0].key;
  for (const entry of FINALIZATION_MESSAGE_SCHEDULE) {
    if (fraction >= entry.atFraction) current = entry.key;
  }
  return current;
}

/** Delay (ms) from attempt start at which each message after the first becomes active. */
export function finalizationMessageScheduleDelaysMs(
  config: typeof FINALIZATION_VISUAL_PROGRESS_CONFIG = FINALIZATION_VISUAL_PROGRESS_CONFIG,
): { key: FinalizationMessageKey; delayMs: number }[] {
  return FINALIZATION_MESSAGE_SCHEDULE
    .filter((entry) => entry.atFraction > 0)
    .map((entry) => ({ key: entry.key, delayMs: Math.round(entry.atFraction * config.rampDurationMs) }));
}
