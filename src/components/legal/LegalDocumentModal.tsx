import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';

export type LegalDocumentKind = 'terms' | 'privacy' | 'licenses';

export function LegalDocumentModal({
  document,
  onClose,
}: {
  document: LegalDocumentKind | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation(['common', 'settings']);
  const title = document
    ? t(`settings:items.${document === 'terms' ? 'termsOfUse' : document === 'privacy' ? 'privacyPolicy' : 'licenses'}`)
    : '';

  return (
    <Modal
      visible={document !== null}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            <View
              style={{
                paddingHorizontal: 22,
                paddingVertical: 12,
                flexDirection: 'row',
                alignItems: 'center',
                borderBottomWidth: 1,
                borderColor: theme.colors.divider,
              }}
            >
              <View style={{ flex: 1 }}>
                <MonoLabel>{title.toUpperCase()}</MonoLabel>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('common:actions.close')}
                hitSlop={10}
                style={{ padding: 8 }}
              >
                <Icon name="x" size={20} color={theme.colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 24 }}>
              <View
                style={{
                  padding: 18,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.cardBackground,
                }}
              >
                <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 15 }}>
                  {t('common:legal.placeholderTitle')}
                </Text>
                <Text style={{ marginTop: 8, color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 21 }}>
                  {t('common:legal.placeholderBody')}
                </Text>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
