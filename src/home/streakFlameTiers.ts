/**
 * Single source of truth for the streak flame's visual tiers and for the
 * milestone-celebration decision. Home (`CycleProgressBlock`), the flame
 * component (`StreakFlame`) and the transformation screen
 * (`StreakEvolveScreen`) all read from here — no tier colours, thresholds or
 * milestone conditions are ever re-declared elsewhere.
 *
 * IMPORTANT — this module is PURELY PRESENTATIONAL. It never computes,
 * stores or mutates the streak itself. The authoritative value is the DAILY
 * ACTIVITY streak (`src/home/dailyActivityStreak.ts`), read through
 * `useDailyActivityStreak`: consecutive calendar days on which the user
 * registered a workout or a food entry. Everything here consumes that
 * number as an opaque, already-decided count of DAYS.
 *
 * Not to be confused with `src/home/streak.ts` (`computeStreak`), which
 * counts training OBLIGATIONS/WEEKS and still drives adherence, the weekly
 * overview and the schedule surfaces. That engine is intentionally untouched
 * and never feeds these tiers.
 *
 * The visual ladder tops out at `legendary` (500), but the NUMBER keeps
 * counting past it — `streakFlameTierForDays(900)` is still `legendary`.
 */

export type StreakFlameTierId =
  | 'spark'
  | 'flame'
  | 'ember'
  | 'blaze'
  | 'plasma'
  | 'stellar'
  | 'legendary';

export interface StreakFlameTier {
  id: StreakFlameTierId;
  /** 1..7, matching the design's "Nível" column. */
  level: number;
  /** Lowest streak value that renders this tier. */
  min: number;
  /** Top gradient stop (offset 0) of the flame body. */
  top: string;
  /** Middle gradient stop (offset 0.55). */
  mid: string;
  /** Bottom gradient stop (offset 1). */
  base: string;
  /** Inner core path fill. */
  core: string;
  /** `r,g,b` triplet used for every glow/particle colour at this tier. */
  glowRgb: string;
}

/** Ordered ascending by `min`; `streakFlameTierForDays` relies on that order. */
export const STREAK_FLAME_TIERS: readonly StreakFlameTier[] = [
  { id: 'spark', level: 1, min: 1, top: '#bfe4ff', mid: '#2a8aff', base: '#0b55e0', core: '#eaf5ff', glowRgb: '77,163,255' },
  { id: 'flame', level: 2, min: 3, top: '#fff6b8', mid: '#ffd23f', base: '#f29d00', core: '#fffbea', glowRgb: '255,206,64' },
  { id: 'ember', level: 3, min: 10, top: '#ff5a2a', mid: '#ff8c1a', base: '#e0560b', core: '#ffe2b0', glowRgb: '255,128,32' },
  { id: 'blaze', level: 4, min: 30, top: '#ff8a6a', mid: '#ff2d2d', base: '#a3001e', core: '#ffd3c6', glowRgb: '255,52,52' },
  { id: 'plasma', level: 5, min: 100, top: '#CFFAFF', mid: '#26DDE3', base: '#0D9FAF', core: '#F3FEFF', glowRgb: '38,221,227' },
  { id: 'stellar', level: 6, min: 250, top: '#FFFFFF', mid: '#E4EEFF', base: '#AABEE6', core: '#FFFFFF', glowRgb: '214,230,255' },
  { id: 'legendary', level: 7, min: 500, top: '#ECC6FF', mid: '#A64DFF', base: '#5B14D6', core: '#F6E8FF', glowRgb: '170,80,255' },
];

/**
 * The six transitions that are allowed to show the transformation screen.
 * Reaching 1 (grey -> blue) is deliberately absent: the design excludes it.
 * 200 is deliberately absent too — it stays cyan, mid-tier.
 */
export const STREAK_MILESTONES: readonly number[] = [3, 10, 30, 100, 250, 500];

/** Highest tier whose `min` is <= `days`; `null` is the "apagada" (unlit) state. */
export function streakFlameTierForDays(days: number): StreakFlameTier | null {
  if (!Number.isFinite(days) || days < 1) return null;
  let match: StreakFlameTier | null = null;
  for (const tier of STREAK_FLAME_TIERS) {
    if (days >= tier.min) match = tier;
    else break;
  }
  return match;
}

/** Next milestone strictly above `days`, or `null` at the maximum tier. */
export function nextStreakMilestone(days: number): number | null {
  for (const milestone of STREAK_MILESTONES) {
    if (days < milestone) return milestone;
  }
  return null;
}

export interface StreakMilestoneCelebration {
  /** Always equal to the streak value that triggered it. */
  milestone: number;
  /** Tier shown as "Antes" — the tier of `milestone - 1`. */
  from: StreakFlameTier;
  /** Tier shown as "Agora". */
  to: StreakFlameTier;
  /** "Próximo marco", or `null` at the maximum tier (rendered as "—"). */
  next: number | null;
}

export interface ResolveStreakMilestoneInput {
  /** Authoritative streak value AFTER the completion was durably confirmed. */
  current: number;
  /**
   * `Streak.complete`. `false` means `current` is a LOWER BOUND (the backward
   * walk ran out of fetched history), so an exact-equality milestone test
   * would be unsound — never celebrate on an inexact value.
   */
  complete: boolean;
  /** Milestones already celebrated for the streak run `current` belongs to. */
  alreadyCelebrated: readonly number[];
}

/**
 * Decides whether the just-confirmed completion earned a transformation
 * screen. Intentionally exact-equality on `current`: a milestone is reached
 * by the completion that lands precisely on it, never by merely being above
 * it (that is what keeps "app reopened with an old streak" and "11th
 * workout" silent).
 */
export function resolveStreakMilestoneCelebration(
  input: ResolveStreakMilestoneInput,
): StreakMilestoneCelebration | null {
  if (!input.complete) return null;
  if (!STREAK_MILESTONES.includes(input.current)) return null;
  if (input.alreadyCelebrated.includes(input.current)) return null;

  const to = streakFlameTierForDays(input.current);
  const from = streakFlameTierForDays(input.current - 1);
  // Both are non-null for every milestone (the lowest is 3, so `from` is at
  // least the `spark` tier), but the guard keeps the contract explicit.
  if (!to || !from) return null;

  return { milestone: input.current, from, to, next: nextStreakMilestone(input.current) };
}

/**
 * Drops celebrations that the current streak run can no longer justify.
 *
 * A milestone above the current streak value means the run that earned it is
 * gone (the streak broke, or regressed below it), so the user must be able to
 * earn that transformation again — the design explicitly forbids blocking a
 * milestone permanently just because it was reached once. Milestones at or
 * below the current value are retained, which is what makes a duplicate
 * finalize callback, a re-sync or an app restart silent.
 */
export function pruneCelebratedStreakMilestones(
  celebrated: readonly number[],
  current: number,
): number[] {
  return celebrated.filter((milestone) => milestone <= current);
}
