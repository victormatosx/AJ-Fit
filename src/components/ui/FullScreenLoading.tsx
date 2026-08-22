import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../../theme';

/** One neutral loading surface shared by bootstrap and Paywall preparation. */
export function FullScreenLoading() {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={theme.colors.primaryEmphasis} />
    </View>
  );
}
