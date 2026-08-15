/**
 * Pure, deterministic helpers for PlanReadyScreen. Every value shown on that
 * screen must trace back to a real answer — see
 * docs/onboarding_funnel_architecture.md §Plan Ready for the list of
 * hardcoded/misleading values this module replaced (a fixed weekly
 * push/pull/legs split, "+6.2kg lean mass", "12 weeks", "48 workouts").
 *
 * There is no real workout-generation or periodization engine yet, so this
 * module intentionally does NOT invent a split, a program length in weeks,
 * or a body-composition projection — those require product decisions (what
 * "a phase" means, how long it lasts) that haven't been made. It only
 * derives what's mechanically true from `days`.
 */

/**
 * Spreads `days` training slots evenly across a 7-slot week (Bresenham-style
 * even distribution — the same technique used for pixel/line rasterization).
 * Deliberately has no concept of which muscle groups train on which day:
 * that would be a fabricated split, not a derived one.
 */
export function deriveTrainingDaySlots(days: number): boolean[] {
  const clamped = Math.max(0, Math.min(7, Math.round(days)));
  const slots: boolean[] = [];
  let prevCumulative = 0;
  for (let i = 1; i <= 7; i++) {
    const cumulative = Math.floor((i * clamped) / 7);
    slots.push(cumulative > prevCumulative);
    prevCumulative = cumulative;
  }
  return slots;
}
