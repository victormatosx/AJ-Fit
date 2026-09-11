import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../../theme';

/** One neutral loading surface shared by bootstrap, workout start and Paywall preparation. */
export function FullScreenLoading({ accessibilityLabel }: { accessibilityLabel?: string }) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessible
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      accessibilityLabel={accessibilityLabel}
    >
      <ActivityIndicator color={theme.colors.primaryEmphasis} />
    </View>
  );
}
