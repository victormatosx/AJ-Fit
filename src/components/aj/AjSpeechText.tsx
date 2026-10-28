import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useAjTypedText, type AjSpeechRole } from './useAjTypedText';

/** Imperative handle a caller can use to force this line's full text into view. */
export type AjSpeechTextHandle = {
  skip: () => void;
};

/**
 * One line AJ speaks, typed out character by character.
 *
 * Shared by every acquisition surface (question titles, reactions,
 * interstitials, the Plan narration, Auth and Paywall) so the two properties
 * that make the effect safe are implemented once:
 *
 * 1. **Stable layout.** The whole string is always in the tree; only the
 *    untyped tail's opacity changes. The block's measured height is final from
 *    the first frame, so nothing below it — an answer list, a CTA — ever jumps
 *    while a line types.
 * 2. **Bounded re-render scope.** The per-character counter lives inside this
 *    leaf, so revealing a character re-renders one `Text` and never the
 *    mascot, the step, or the answers.
 *
 * Accessibility deliberately ignores the reveal: the full line is the
 * accessible label from the first frame, so a screen reader announces a
 * sentence rather than a stuttering prefix.
 */
export const AjSpeechText = memo(forwardRef<AjSpeechTextHandle, {
  text: string;
  msPerChar?: number;
  role?: AjSpeechRole;
  enabled?: boolean;
  startDelayMs?: number;
  reduceMotion?: boolean;
  style?: StyleProp<TextStyle>;
  emphasis?: { text: string | string[]; color: string };
  onStart?: () => void;
  onDone?: () => void;
  accessibilityRole?: 'alert' | 'text';
  /**
   * False when a caller wraps this line in its own accessible control (the
   * Plan screen's tap-to-advance region) and would otherwise end up with two
   * overlapping accessible nodes announcing the same text. Every other
   * caller leaves this at its default.
   */
  accessible?: boolean;
}>(function AjSpeechText({
  text,
  msPerChar,
  role = 'context',
  enabled = true,
  startDelayMs = 0,
  reduceMotion = false,
  style,
  emphasis,
  /** Called when the first character appears — callers drive the mouth with it. */
  onStart,
  onDone,
  /** `alert` for validation copy that must interrupt a screen reader. */
  accessibilityRole,
  accessible = true,
}, ref) {
  // Kept in refs so a caller passing inline arrows never restarts the line,
  // which would retype it from scratch on every render.
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const handleDone = useCallback(() => onDoneRef.current?.(), []);
  const { revealed, skip } = useAjTypedText({
    text,
    role,
    enabled,
    startDelayMs,
    reduceMotion,
    msPerChar,
    onDone: handleDone,
  });

  useImperativeHandle(ref, () => ({ skip }), [skip]);

  useEffect(() => {
    if (!enabled) return () => undefined;
    if (reduceMotion) {
      onStartRef.current?.();
      return () => undefined;
    }
    const timer = setTimeout(() => onStartRef.current?.(), startDelayMs);
    return () => clearTimeout(timer);
  }, [text, enabled, startDelayMs, reduceMotion]);

  const renderRange = (start: number, end: number) => {
    if (!emphasis) return text.slice(start, end);
    const words = Array.isArray(emphasis.text) ? emphasis.text : [emphasis.text];
    const ranges = words.map((word) => ({ start: text.indexOf(word), length: word.length }))
      .filter((range) => range.start >= 0).sort((a, b) => a.start - b.start);
    const parts = [];
    let cursor = start;
    for (const range of ranges) {
      const from = Math.max(cursor, range.start);
      const to = Math.min(end, range.start + range.length);
      if (to <= from) continue;
      parts.push(text.slice(cursor, from));
      parts.push(<Text key={range.start} style={{ color: emphasis.color }}>{text.slice(from, to)}</Text>);
      cursor = to;
    }
    parts.push(text.slice(cursor, end));
    return parts;
  };

  return (
    <Text
      accessible={accessible}
      accessibilityLabel={text}
      accessibilityRole={accessibilityRole}
      style={style}
    >
      <Text style={style}>{renderRange(0, revealed)}</Text>
      <Text style={[style, { opacity: 0 }]}>{renderRange(revealed, text.length)}</Text>
    </Text>
  );
}));
