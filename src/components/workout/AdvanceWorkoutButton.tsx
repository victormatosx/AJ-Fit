import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { CtaButton, CtaText } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import type { AppTheme } from '../../theme';

/**
 * "Adiantar treino de {dia}" — V1's one-day fixed-schedule exception, offered
 * in the start CTA's slot on a rest day whose next session can be pulled
 * forward. Home's Today card and the Treino hub render this same component so
 * the one affordance can't drift into two looks between the screens.
 *
 * It wears the app-wide `CtaButton` itself rather than a lookalike: this is
 * the same kind of action as "INICIAR TREINO" and occupies the very same slot,
 * so the brand gradient, the notched bottom-right corner, the accent glow and
 * the display-cased label all come from that one component — there is no
 * second definition of what a primary CTA looks like.
 *
 * Presentation only: whether advancing is allowed at all is `advancedWorkoutTarget`'s
 * decision in `AppShell`, and `onPress` is that screen's `requestAdvanceWorkout`
 * — which opens the shared confirmation, never advances anything directly.
 *
 * `theme` is a prop rather than `useTheme()` for the same reason as
 * `CompletedTodayButton`: Home's card is pinned to the Dark artwork in both
 * themes while the Treino hub follows the live one.
 */
export function AdvanceWorkoutButton({
  theme,
  label,
  onPress,
  style,
}: {
  theme: AppTheme;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <CtaButton
      theme={theme}
      onPress={onPress}
      accessibilityLabel={label}
      style={style}
    >
      <Icon name="arrow-right" size={15} color={theme.colors.primaryForeground} />
      {/* "ADIANTAR TREINO DE QUARTA-FEIRA" is far longer than "INICIAR TREINO",
          so it is allowed a second line — two display lines still fit inside
          the CTA's fixed 58pt height. */}
      <CtaText theme={theme} numberOfLines={2}>{label}</CtaText>
    </CtaButton>
  );
}
