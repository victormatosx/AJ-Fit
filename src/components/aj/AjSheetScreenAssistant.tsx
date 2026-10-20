import React, { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { AjBotStage } from './AjBotStage';
import { AjSpeechSequence } from './AjSpeechSequence';
import type { AjBotMood } from './AjBot';
import { AJ_SHEET_SCREEN, AJ_TYPING_CHAIN_GAP_MS } from './ajMomentTiming';
import { useTheme } from '../../theme';

/**
 * AJ standing above a bottom sheet, saying something about it.
 *
 * The arrangement both root acquisition screens share — account creation and
 * the Paywall. Neither sits inside the onboarding funnel (App.tsx owns them
 * directly), so neither can borrow the funnel's persistent mascot; each gets
 * its own single `AjBot`, inline, never in a `Modal`.
 *
 * The pose is derived from the sheet's MEASURED height rather than from a
 * fraction of the screen, because that is what the mascot is standing on: a
 * taller sheet (a longer form, a bigger text size, a keyboard pushing it up)
 * moves AJ up and shrinks him, and the clamp keeps him from either
 * overwhelming a short gap or disappearing into a tall one.
 */
export function AjSheetScreenAssistant({
  /** Measured sheet height. 0 before first layout — AJ waits rather than guessing. */
  sheetHeight,
  lines,
  msPerChar,
  mood = 'idle',
  phase = 'idle',
  look,
  reduceMotion = false,
  /** Smallest/largest the mascot is allowed to be on this screen. */
  minSize = 70,
  maxSize = 116,
  /** Distance from the gap's top edge down to AJ's box, when measured. */
  topInset = 0,
  onLinesDone,
}: {
  sheetHeight: number;
  lines: string[];
  msPerChar?: number;
  mood?: AjBotMood;
  phase?: 'idle' | 'hop' | 'nod';
  look?: readonly [number, number];
  reduceMotion?: boolean;
  minSize?: number;
  maxSize?: number;
  topInset?: number;
  onLinesDone?: () => void;
}) {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  const [talking, setTalking] = useState(false);
  const [started, setStarted] = useState(reduceMotion);
  const onLinesDoneRef = useRef(onLinesDone);
  onLinesDoneRef.current = onLinesDone;

  // The sheet only arrives after its own delay, so the first line waits for
  // it — AJ should not be mid-sentence to an empty screen.
  useEffect(() => {
    if (reduceMotion) {
      setStarted(true);
      return () => undefined;
    }
    const timer = setTimeout(() => setStarted(true), AJ_SHEET_SCREEN.firstLineAtMs);
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  const sheetTop = sheetHeight > 0 ? height - sheetHeight : height * 0.6;
  const gapHeight = Math.max(0, sheetTop - topInset);
  const size = Math.max(minSize, Math.min(maxSize, sheetTop - 220));
  // Centred in the gap, then nudged up by the speech block's own share of it.
  const y = topInset + Math.max(0, (gapHeight - size) / 2 - 24);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      <AjBotStage
        pose={{ x: (width - size) / 2, y, size, rotate: 0 }}
        mood={talking ? 'talk' : mood}
        phase={phase}
        look={look}
        talking={talking}
        reduceMotion={reduceMotion}
      />
      {/* Speech sits directly under the mascot box, inside the same gap. */}
      <View style={{ position: 'absolute', top: y + size + 16, left: 30, right: 30 }}>
        <AjSpeechSequence
          // A different set of lines is a different turn, not a continuation.
          key={lines.join('|')}
          lines={lines}
          enabled={started}
          msPerChar={msPerChar}
          gapMs={AJ_TYPING_CHAIN_GAP_MS}
          reduceMotion={reduceMotion}
          onLineStart={() => setTalking(true)}
          onLineDone={() => setTalking(false)}
          onDone={() => {
            setTalking(false);
            onLinesDoneRef.current?.();
          }}
          lineStyle={{
            textAlign: 'center',
            fontFamily: theme.fonts.ui,
            fontSize: 16,
            lineHeight: 23,
            color: theme.colors.textSpeech,
            marginTop: 6,
          }}
        />
      </View>
    </View>
  );
}
