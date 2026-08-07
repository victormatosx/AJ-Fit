import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';

export function SupportScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useTranslation('common');
  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={onBack} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="arrow-left" size={17} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}><MonoLabel>{title.toUpperCase()}</MonoLabel></View>
      <View style={{ width: 38 }} />
    </View>
  );
}
