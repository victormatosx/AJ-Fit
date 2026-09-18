import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme';
import { Icon } from '../ui/Icon';

/**
 * Home header entry point into "Meus atendimentos". Sized/shaped to match
 * WorkoutRestHeaderStatus's icon button exactly (42x42, radius 13, soft
 * primary border) so it reads as the same header control family. The unread
 * badge shows the sum of `unreadByUserCount` across all support cases. Home
 * only mounts this button while that server-derived total is positive, so a
 * zero count leaves no hidden control or reserved header space.
 */
export function SupportInboxButton({
  unreadCasesCount,
  onPress,
}: {
  unreadCasesCount: number;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const hasUnread = unreadCasesCount > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hasUnread
        ? t('support.iconLabelUnread', { count: unreadCasesCount })
        : t('support.iconLabel')}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        marginRight: 10,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: theme.colors.primaryBorderSoft,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <Icon name="message" size={18} stroke={1.9} color={theme.colors.primaryEmphasis} />
      {hasUnread && (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            backgroundColor: theme.colors.primaryEmphasis,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: theme.colors.background,
          }}
        >
          <Text style={{ color: theme.colors.primaryForeground, fontSize: 10, fontFamily: theme.fonts.uiSemi }}>
            {unreadCasesCount > 9 ? '9+' : unreadCasesCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
