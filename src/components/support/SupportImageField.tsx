import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';
import type { SupportAttachmentInput } from '../../types/support';

export function SupportImageField({ attachment, onPick, onRemove }: { attachment: SupportAttachmentInput | null; onPick: () => void; onRemove: () => void }) {
  const { t } = useTranslation('support');
  if (attachment) return (
    <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.cardBorder }}>
      <Image source={{ uri: attachment.uri }} contentFit="cover" style={{ height: 150, width: '100%' }} />
      <Pressable onPress={onRemove} style={{ position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(2,0,16,0.85)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="x" size={16} />
      </Pressable>
    </View>
  );
  return (
    <Pressable onPress={onPick} style={{ minHeight: 64, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(77,163,255,0.45)', backgroundColor: 'rgba(11,112,249,0.07)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
      <Icon name="camera" size={18} color={colors.accentHi} />
      <Text style={{ color: colors.accentHi, fontFamily: fonts.uiSemi, fontSize: 14 }}>{t('form.addImage')}</Text>
      <Text style={{ color: colors.faint, fontFamily: fonts.mono, fontSize: 10 }}>{t('form.optional')}</Text>
    </Pressable>
  );
}
