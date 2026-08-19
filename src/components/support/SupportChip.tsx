import { Pressable, Text } from 'react-native';
import { useTheme } from '../../theme';

export function SupportChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.colors.selectionBorder : theme.colors.cardBorder,
        backgroundColor: active
          ? theme.colors.selectionBackground
          : pressed
            ? theme.colors.cardBackgroundElevated
            : theme.colors.cardBackground,
        opacity: pressed && !active ? 0.7 : 1,
      })}
    >
      <Text style={{ color: active ? theme.colors.selectionForeground : theme.colors.textMuted, fontFamily: theme.fonts.uiSemi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
