import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme';
import { Icon } from '../ui/Icon';
import { radii, spacing } from '../../theme/tokens';

/**
 * Compact "about to send" thumbnail shown above the chat composer, with a
 * remove affordance — the composer equivalent of SupportImageField's
 * attached state, sized for a single row instead of a full-width form
 * field. Reuses the same `form.removeImage` copy/remove-button visual
 * language (dark circular X) as SupportImageField.
 */
export function SupportChatAttachmentPreview({ uri, onRemove }: { uri: string; onRemove: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('support');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing[2] }}>
      <View style={{ borderRadius: radii.md, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.cardBorder }}>
        <Image source={{ uri }} contentFit="cover" style={{ width: 56, height: 56 }} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('form.removeImage')}
        onPress={onRemove}
        hitSlop={8}
        style={({ pressed }) => ({
          marginLeft: spacing[2],
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: 'rgba(2,0,16,0.85)',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="x" size={14} />
      </Pressable>
    </View>
  );
}
