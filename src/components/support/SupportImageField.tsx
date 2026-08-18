import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { alpha, colors, fonts, radii, spacing } from '../../theme/tokens';
import type { SupportAttachmentInput } from '../../types/support';

export function SupportImageField({ attachment, onPick, onRemove }: { attachment: SupportAttachmentInput | null; onPick: () => void; onRemove: () => void }) {
  const { t } = useTranslation('support');
  if (attachment) return (
    <View style={{ borderRadius: radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.cardBorder }}>
      <Image source={{ uri: attachment.uri }} contentFit="cover" style={{ height: 150, width: '100%' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[3], paddingVertical: spacing[2], backgroundColor: 'rgba(2,0,16,0.55)' }}>
        <Icon name="camera" size={12} color={colors.faint} />
        <Text style={{ marginLeft: spacing[1.5], color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.5 }}>{t('form.imageAttached').toUpperCase()}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('form.removeImage')}
        onPress={onRemove}
        style={({ pressed }) => ({
          position: 'absolute',
          top: 10,
          right: 10,
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: 'rgba(2,0,16,0.85)',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="x" size={16} />
      </Pressable>
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPick}
      style={({ pressed }) => ({
        minHeight: 64,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: pressed ? colors.accentHi : 'rgba(77,163,255,0.45)',
        backgroundColor: pressed ? alpha.blue14 : alpha.blue07,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: spacing[2.5],
      })}
    >
      <Icon name="camera" size={18} color={colors.accentHi} />
      <Text style={{ color: colors.accentHi, fontFamily: fonts.uiSemi, fontSize: 14 }}>{t('form.addImage')}</Text>
      <Text style={{ color: colors.faint, fontFamily: fonts.mono, fontSize: 10 }}>{t('form.optional')}</Text>
    </Pressable>
  );
}
