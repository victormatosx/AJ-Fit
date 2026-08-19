import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';

export function SupportScreenHeader({
  title,
  onBack,
  disabled = false,
}: {
  title: string;
  onBack: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={onBack} disabled={disabled} hitSlop={3} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.colors.controlBackground, borderWidth: 1, borderColor: theme.colors.controlBorder, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
        <Icon name="arrow-left" size={17} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}><MonoLabel>{title.toUpperCase()}</MonoLabel></View>
      <View style={{ width: 38 }} />
    </View>
  );
}
