import type { AjBotPhase } from './AjBot';

/**
 * The opening sequence of an AJ moment, as one explicit state machine rather
 * than a handful of loose timers.
 *
 *   armed -> entering -> settling -> speaking -> (nodding | picked) -> leaving
 *
 * - `armed` is the pre-roll. The `Modal` is mounted but the native window may
 *   not be on screen yet, so AJ holds frame 0 of the entrance arc (off
 *   screen, fully transparent) and nothing is typed. This stage exists
 *   because a React commit is NOT the instant the overlay becomes visible:
 *   starting the arc at commit time burned its first few hundred
 *   milliseconds behind an unpresented window, and since `enter`'s bezier
 *   front-loads the motion, all that was ever seen was the final settle —
 *   the mascot looked like it had simply appeared in place.
 * - `entering` is the 1050ms arc. It begins on the Modal's `onShow`.
 * - `settling` is the arrival hop, played once, the moment AJ lands.
 * - `speaking` is the resting state: idle float, text typing or typed.
 * - `nodding` is new speech within the SAME opening (the recovery flow's
 *   discard confirmation) — deliberately not a second entrance.
 * - `picked` is the bounce after an answer is tapped.
 * - `leaving` is the exit arc.
 *
 * Kept React-free (like `ajBotMotion.ts` and `ajMomentTiming.ts`) so this
 * project's Node-only test suite can read it directly — the type import
 * above is erased at compile time and pulls in no React Native.
 */
export type AjMomentStage =
  | 'armed'
  | 'entering'
  | 'settling'
  | 'speaking'
  | 'nodding'
  | 'picked'
  | 'leaving';

/** Which mascot animation each stage plays. The stage is the authority; `AjBot` only ever renders what it is told. */
export const AJ_MOMENT_STAGE_PHASE: Record<AjMomentStage, AjBotPhase> = {
  armed: 'armed',
  entering: 'enter',
  settling: 'hop',
  speaking: 'idle',
  nodding: 'nod',
  picked: 'hop',
  leaving: 'exit',
};

/**
 * Stages during which AJ is landed and therefore allowed to speak: the text
 * is gated on the stage, not on a delay, so it can never run ahead of (or
 * lag behind) the entrance.
 */
export function ajMomentIsSpeaking(stage: AjMomentStage): boolean {
  return stage === 'settling' || stage === 'speaking' || stage === 'nodding' || stage === 'picked';
}
