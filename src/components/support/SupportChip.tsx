import { Pressable, Text } from 'react-native';
import { alpha, colors, fonts } from '../../theme/tokens';

export function SupportChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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
        borderColor: active ? colors.accentHi : colors.cardBorder,
        backgroundColor: active ? alpha.blue18 : pressed ? colors.cardBgHi : colors.cardBg,
        opacity: pressed && !active ? 0.7 : 1,
      })}
    >
      <Text style={{ color: active ? '#fff' : colors.mute, fontFamily: fonts.uiSemi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
