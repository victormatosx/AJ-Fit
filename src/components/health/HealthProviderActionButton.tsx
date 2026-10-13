import { ActivityIndicator, Pressable, Text } from 'react-native';

import { Icon } from '../ui/Icon';
import { HealthProviderLogo } from './HealthProviderLogo';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { UseHealthIntegrationResult } from '../../hooks/useHealthIntegration';

/**
 * The platform-specific "Conectar Apple Health / Health Connect" button —
 * white pill with the Apple Health mark on iOS, dark pill with the Health
 * Connect mark on Android. Originally built for the pre-auth onboarding
 * step; reused as-is on the Settings detail screen's disconnected state so
 * both connect actions look and feel identical.
 */
export function HealthProviderActionButton({
  platform,
  label,
  onPress,
  disabled,
  loading,
  accessibilityLabel,
}: {
  platform: UseHealthIntegrationResult['platform'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel: string;
}) {
  const { theme } = useTheme();
  const isLight = platform !== 'android';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        height: 58,
        borderRadius: 18,
        paddingHorizontal: spacing[4.5],
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: isLight ? '#ffffff' : theme.colors.surfaceElevated,
        borderWidth: isLight ? 0 : 1,
        borderColor: theme.colors.cardBorder,
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      <HealthProviderLogo platform={platform} size={26} />
      <Text
        style={{
          flex: 1,
          marginLeft: spacing[3.5],
          fontFamily: theme.fonts.uiBold,
          fontSize: 16,
          color: isLight ? '#000000' : theme.colors.textPrimary,
        }}
      >
        {label}
      </Text>
      {loading ? (
        <ActivityIndicator color={isLight ? '#000000' : theme.colors.textFaint} />
      ) : (
        <Icon name="chevron-right" size={18} color={isLight ? 'rgba(0,0,0,0.3)' : theme.colors.textFaint} />
      )}
    </Pressable>
  );
}
