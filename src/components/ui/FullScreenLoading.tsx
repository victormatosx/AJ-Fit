import { ActivityIndicator, View } from 'react-native';
import { colors } from '../../theme/tokens';

/** One neutral loading surface shared by bootstrap and Paywall preparation. */
export function FullScreenLoading() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={colors.accentHi} />
    </View>
  );
}
