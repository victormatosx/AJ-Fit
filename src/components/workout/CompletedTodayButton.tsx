import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import type { AppTheme } from '../../theme';

/**
 * Blocked "Treino de hoje concluído" button plus the note naming the next
 * workout. Home's Today card and the Treino tab put this in the very slot
 * their start CTA occupies, so the look lives here once instead of twice —
 * both screens start the same session and must not describe it differently.
 *
 * Presentation only: the real block on a second session today is the Schedule
 * Engine's own `TODAY_COMPLETED` resolution. `disabled` (not just a muted
 * look) is what guarantees this button can never act on a tap.
 *
 * `theme` is a prop rather than `useTheme()` because Home's Today card is
 * pinned to the Dark artwork in both themes (`TODAY_WORKOUT_THEME`) while the
 * Treino tab follows the live theme.
 */

/** Cross-fade onto the blocked look once today's session lands. */
const BUTTON_FADE_MS = 250;
/** The note settles a touch slower, so it reads as arriving under the button. */
const NOTE_FADE_MS = 300;
const NOTE_TRAVEL_Y = 6;
const ENTRANCE_EASING = Easing.out(Easing.cubic);

/**
 * Entrance that can never hide what it reveals. This button *is* the only
 * thing in its slot, so a decorative fade must not be able to strand it at
 * opacity 0: every exit from the animation — finishing, being interrupted,
 * the effect re-running, unmounting — lands the value back on 1.
 *
 * Deliberately `Animated` from react-native (the same mechanism `RiseIn`
 * uses) rather than Reanimated: no worklet has to run on the UI thread for
 * the content to be visible.
 */
function useSettlingEntrance(from: 0 | 1, duration: number): Animated.Value {
  const value = useRef(new Animated.Value(from)).current;

  useEffect(() => {
    if (from === 1) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration,
      easing: ENTRANCE_EASING,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (!finished) value.setValue(1);
    });
    return () => {
      animation.stop();
      value.setValue(1);
    };
  }, [duration, from, value]);

  return value;
}

/**
 * True only while the switch into the completed state happened with this
 * screen already on-screen — i.e. the start CTA was visible a moment ago.
 * Opening a screen whose session is *already* done must not animate, and
 * neither must the skeleton settling into it (`startCtaVisible` is false
 * there too, so it never arms the transition).
 *
 * Resolved during render rather than from an effect on purpose: the button
 * mounts in the very render that first reports `completed`, so an effect
 * would hand it `animate` one commit too late — it would already have
 * painted settled, and the fade would then run from 1 to 1. The refs only
 * track what previous renders showed, so a repeated render of the same
 * inputs returns the same answer.
 */
export function useCompletedTodayEntrance(completed: boolean, startCtaVisible: boolean): boolean {
  const cameFromStartCta = useRef(false);
  const entering = useRef(false);

  if (startCtaVisible) {
    cameFromStartCta.current = true;
    entering.current = false;
  } else if (completed && cameFromStartCta.current) {
    cameFromStartCta.current = false;
    entering.current = true;
  }

  return entering.current;
}

export function CompletedTodayButton({
  theme,
  label,
  note,
  animate = false,
  style,
}: {
  theme: AppTheme;
  label: string;
  note: string | null;
  /** Arrive with the cross-fade. See `useCompletedTodayEntrance`. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotionPreference();
  // Reduce Motion (and any arrival that isn't a live switch) starts settled,
  // so the state is simply there on the first frame.
  const from = animate && !reduceMotion ? 0 : 1;
  const buttonProgress = useSettlingEntrance(from, BUTTON_FADE_MS);
  const noteProgress = useSettlingEntrance(from, NOTE_FADE_MS);

  const noteTranslateY = noteProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [NOTE_TRAVEL_Y, 0],
  });

  return (
    <View style={style}>
      <Animated.View style={{ opacity: buttonProgress }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          // The whole block reads as one announcement: the button's own text
          // is meaningless without the note that says when the next one is.
          accessibilityLabel={note ? `${label}. ${note}` : label}
          disabled
          style={{
            padding: 18,
            borderRadius: 12,
            backgroundColor: theme.colors.surfacePressed,
            borderWidth: 1,
            borderColor: theme.colors.dividerStrong,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <Icon name="check" size={15} color={theme.colors.primaryEmphasis} stroke={2.6} />
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              fontFamily: theme.fonts.uiSemi,
              fontSize: 16,
              color: theme.colors.textSubtle,
            }}
          >
            {label}
          </Text>
        </Pressable>
      </Animated.View>

      {note && (
        <Animated.View style={{ opacity: noteProgress, transform: [{ translateY: noteTranslateY }] }}>
          <Text
            // Already announced as part of the button's label above.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              marginTop: 12,
              textAlign: 'center',
              fontFamily: theme.fonts.ui,
              fontSize: 12.5,
              color: theme.colors.textNoteQuiet,
            }}
          >
            {note}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}
