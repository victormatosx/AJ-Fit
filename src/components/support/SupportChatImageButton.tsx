import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme';
import { Icon } from '../ui/Icon';

/**
 * Chat composer's "attach image" trigger. Sized/shaped like the other
 * header/composer icon buttons in the app (WorkoutRestHeaderStatus,
 * SupportInboxButton: 42x42, radius 13, soft primary border) instead of
 * inventing a new control shape. Reuses the same camera icon and
 * `form.addImage` copy the ticket form's SupportImageField already uses for
 * "attach an image".
 */
export function SupportChatImageButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { theme } = useTheme();
  const { t } = useTranslation('support');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('form.addImage')}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 42,
        height: 46,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: theme.colors.primaryBorderSoft,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.76 : 1,
      })}
    >
      <Icon name="camera" size={18} stroke={1.9} color={theme.colors.primaryEmphasis} />
    </Pressable>
  );
}
