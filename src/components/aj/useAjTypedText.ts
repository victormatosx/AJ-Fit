import { useEffect, useRef, useState } from 'react';

/**
 * Letter-by-letter reveal for one of AJ's spoken lines.
 *
 * Two properties matter more than the effect itself:
 *
 * 1. **Stable layout.** The caller always renders the WHOLE string and only
 *    uses `revealed` to split it into a visible head and a transparent tail
 *    (`opacity: 0`), so the text block's measured height never changes while
 *    typing and nothing below it (the answers) jumps around. That's why this
 *    hook returns a character count rather than a substring.
 *
 * 2. **Bounded re-render scope.** The count lives in whichever component
 *    calls this hook, so a per-character update must only ever re-render one
 *    line of text — never the mascot, the backdrop, or the answer list. Keep
 *    this hook inside a leaf component (`AjSpeechLine`); never lift it into
 *    the overlay.
 *
 * OS "Reduce Motion" short-circuits everything: the full line is revealed on
 * the first commit and `onDone` fires immediately, with no timer created at
 * all.
 */

/** Per-character cadence, in ms — the question is deliberately slower than its context. */
export const AJ_TYPING = {
  contextMsPerChar: 20,
  questionMsPerChar: 26,
  /** Pause between one line finishing and the next starting. */
  lineGapMs: 260,
  /** The first line waits for AJ's entrance arc to land (`AJ_BOT_ENTER.durationMs`). */
  openDelayMs: 1050,
} as const;

/** `statement` is a line that carries the moment without asking anything — paced like a question, styled between the two. */
export type AjSpeechRole = 'context' | 'question' | 'statement';

export function ajTypingMsPerChar(role: AjSpeechRole): number {
  return role === 'context' ? AJ_TYPING.contextMsPerChar : AJ_TYPING.questionMsPerChar;
}

/** Total time a line takes to type, including the pause that precedes it. Presentation-only; used by tests and by callers that need to describe the sequence. */
export function ajTypingLineDurationMs(text: string, role: AjSpeechRole, startDelayMs: number): number {
  return startDelayMs + text.length * ajTypingMsPerChar(role);
}

export function useAjTypedText({
  text,
  role,
  /** False while an earlier line is still typing — nothing is revealed and no timer runs. */
  enabled,
  startDelayMs = 0,
  reduceMotion = false,
  /**
   * Overrides the cadence `role` would imply. The acquisition design paces
   * each of its surfaces differently (a question title at 18ms/char, a Plan
   * narration line at 22, an interstitial headline at 24), which is a finer
   * grain than the three semantic roles carry — see `AJ_TYPING_MS_PER_CHAR`
   * in `ajMomentTiming.ts`. `role` still decides the line's styling and
   * remains the only input for every caller that doesn't pass this.
   */
  msPerChar,
  onDone,
}: {
  text: string;
  role: AjSpeechRole;
  enabled: boolean;
  startDelayMs?: number;
  reduceMotion?: boolean;
  msPerChar?: number;
  onDone?: () => void;
}): { revealed: number; typing: boolean } {
  const [revealed, setRevealed] = useState(0);
  // Kept in a ref so a caller passing an inline arrow never restarts the
  // sequence (which would retype the line from scratch on every render).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!enabled) {
      setRevealed(0);
      return () => undefined;
    }
    if (reduceMotion || text.length === 0) {
      setRevealed(text.length);
      onDoneRef.current?.();
      return () => undefined;
    }

    setRevealed(0);
    const cadence = msPerChar ?? ajTypingMsPerChar(role);
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = setTimeout(() => {
      let count = 0;
      interval = setInterval(() => {
        count += 1;
        setRevealed(count);
        if (count >= text.length) {
          if (interval) clearInterval(interval);
          interval = null;
          onDoneRef.current?.();
        }
      }, cadence);
    }, startDelayMs);

    // Backgrounding, rotation, a tab switch or an unmount mid-type all land
    // here: both handles are always cleared, so no timer outlives the line.
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, role, enabled, startDelayMs, reduceMotion, msPerChar]);

  return { revealed, typing: enabled && revealed < text.length };
}
