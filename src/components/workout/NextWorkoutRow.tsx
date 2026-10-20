import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import type { AppTheme } from '../../theme';

/**
 * "PRÓXIMO TREINO · {dia} · {sessão}" — what the start CTA's slot shows on a
 * blocked day that has nothing to act on: no session to start, nothing already
 * finished to report, and no advance on offer. Home's Today card and the
 * Treino hub render this same row so the slot never informs on one screen and
 * sits empty on the other.
 *
 * Read-only by construction: no press handler at all. The day and session it
 * names come from the Schedule Engine's own resolution, resolved by the
 * screen — this row never computes "what's next" itself.
 *
 * `theme` is a prop for the same reason as its two siblings in this folder:
 * Home's card is pinned to the Dark artwork in both themes while the Treino
 * hub follows the live one.
 */
export function NextWorkoutRow({
  theme,
  label,
  value,
  style,
}: {
  theme: AppTheme;
  /** Mono caption, already localized; uppercased here. */
  label: string;
  /** The resolved "{dia} · {sessão}" line. */
  value: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          paddingVertical: 13,
          paddingHorizontal: 18,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.colors.primaryBorderQuiet,
          backgroundColor: theme.colors.surfaceMuted,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        },
        style,
      ]}
    >
      <Icon name="calendar" size={14} color={theme.colors.primaryEmphasis} />
      <View style={{ flexShrink: 1 }}>
        <MonoLabel color={theme.colors.textFaint}>{label.toUpperCase()}</MonoLabel>
        <Text
          style={{
            fontFamily: theme.fonts.uiBold,
            fontSize: 13,
            color: theme.colors.textPrimary,
            marginTop: 2,
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}
