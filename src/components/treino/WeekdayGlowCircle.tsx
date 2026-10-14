import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';

/**
 * Visual-only weekday pill for the Treino redesign's agenda grid — shared by
 * the screen's read-only display and the agenda sheet's tappable picker so
 * both stay pixel-identical. Deliberately separate from
 * `WeeklySchedulePicker` (onboarding): that component is reused verbatim by
 * other flows, and restyling it here would leak into onboarding's own UI.
 * Carries no selection logic — the caller passes `selected`/`onPress`.
 */
export function WeekdayGlowCircle({
  label,
  selected,
  today = false,
  disabled = false,
  onPress,
  size = 38,
}: {
  label: string;
  selected: boolean;
  today?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  size?: number;
}) {
  const { theme } = useTheme();

  const circle = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: selected ? theme.colors.primaryBorderActive : theme.colors.inputBorder,
        shadowColor: theme.colors.primary,
        shadowOpacity: selected ? 0.4 : 0,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
        elevation: selected ? 3 : 0,
      }}
    >
      {selected && (
        <LinearGradient
          colors={['#0c1450', '#05072b']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      )}
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: size <= 32 ? 9 : 9.5,
          letterSpacing: 0.3,
          color: selected ? theme.colors.textPrimary : theme.colors.textFaint,
        }}
      >
        {label}
      </Text>
    </View>
  );

  const ring = today ? (
    <View
      style={{
        borderRadius: (size + 6) / 2,
        borderWidth: 1.5,
        borderColor: 'rgba(125,180,255,0.8)',
        padding: 2,
        backgroundColor: theme.colors.background,
      }}
    >
      {circle}
    </View>
  ) : circle;

  if (!onPress) return ring;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={{ opacity: disabled ? 0.3 : 1 }}
    >
      {ring}
    </Pressable>
  );
}
