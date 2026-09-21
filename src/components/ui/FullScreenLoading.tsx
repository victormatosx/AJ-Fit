import { ActivityIndicator, Text, View } from 'react-native';
import { useTheme } from '../../theme';

/** One neutral loading surface shared by bootstrap, workout start and Paywall preparation. */
export function FullScreenLoading({
  accessibilityLabel,
  message,
}: {
  accessibilityLabel?: string;
  /** Optional visible status copy; omitted by bootstrap callers that only need the neutral spinner. */
  message?: string;
}) {
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
      {message ? (
        <Text
          style={{
            marginTop: 14,
            color: theme.colors.textSecondaryStrong,
            fontFamily: theme.fonts.ui,
            fontSize: 14,
            textAlign: 'center',
            marginHorizontal: 24,
          }}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}
