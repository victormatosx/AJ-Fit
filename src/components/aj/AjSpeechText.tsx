import { memo, useCallback, useEffect, useRef } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useAjTypedText, type AjSpeechRole } from './useAjTypedText';

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
export const AjSpeechText = memo(function AjSpeechText({
  text,
  msPerChar,
  role = 'context',
  enabled = true,
  startDelayMs = 0,
  reduceMotion = false,
  style,
  /** Called when the first character appears — callers drive the mouth with it. */
  onStart,
  onDone,
  /** `alert` for validation copy that must interrupt a screen reader. */
  accessibilityRole,
}: {
  text: string;
  msPerChar?: number;
  role?: AjSpeechRole;
  enabled?: boolean;
  startDelayMs?: number;
  reduceMotion?: boolean;
  style?: StyleProp<TextStyle>;
  onStart?: () => void;
  onDone?: () => void;
  accessibilityRole?: 'alert' | 'text';
}) {
  // Kept in refs so a caller passing inline arrows never restarts the line,
  // which would retype it from scratch on every render.
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const handleDone = useCallback(() => onDoneRef.current?.(), []);
  const { revealed } = useAjTypedText({
    text,
    role,
    enabled,
    startDelayMs,
    reduceMotion,
    msPerChar,
    onDone: handleDone,
  });

  useEffect(() => {
    if (!enabled) return () => undefined;
    if (reduceMotion) {
      onStartRef.current?.();
      return () => undefined;
    }
    const timer = setTimeout(() => onStartRef.current?.(), startDelayMs);
    return () => clearTimeout(timer);
  }, [text, enabled, startDelayMs, reduceMotion]);

  return (
    <Text
      accessible
      accessibilityLabel={text}
      accessibilityRole={accessibilityRole}
      style={style}
    >
      <Text style={style}>{text.slice(0, revealed)}</Text>
      <Text style={[style, { opacity: 0 }]}>{text.slice(revealed)}</Text>
    </Text>
  );
});
