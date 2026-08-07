import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';

export function SupportScreenHeader({
  title,
  onBack,
  disabled = false,
}: {
  title: string;
  onBack: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={onBack} disabled={disabled} hitSlop={3} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
        <Icon name="arrow-left" size={17} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}><MonoLabel>{title.toUpperCase()}</MonoLabel></View>
      <View style={{ width: 38 }} />
    </View>
  );
}
