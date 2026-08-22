import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../ui/ScreenBg';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { Card } from '../ui/Card';
import { colors, fonts, radii, sizes, spacing } from '../../theme/tokens';
import { AssessmentHistoryCard, type AssessmentHistoryRow } from './AssessmentHistoryCard';

export function AssessmentHistoryModal({
  visible,
  entries,
  expandedId,
  onToggle,
  onClose,
}: {
  visible: boolean;
  entries: AssessmentHistoryRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('assessment');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaProvider style={{ flex: 1 }}>
        <ScreenBg>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'right', 'bottom', 'left']}>
            <View
              style={{
                minHeight: 64,
                paddingHorizontal: sizes.screenGutter,
                paddingVertical: spacing[3],
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('accessibility.closeHistory')}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: radii.control,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.surfacePressed : colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: colors.border,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <Icon name="arrow-left" size={18} color={colors.textSecondary} />
              </Pressable>

              <View style={{ flex: 1, alignItems: 'center' }}>
                <MonoLabel color={colors.text}>{t('history.full.title').toUpperCase()}</MonoLabel>
              </View>

              <View style={{ width: 44 }} />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: sizes.screenGutter,
                paddingTop: spacing[3],
                paddingBottom: spacing[10],
              }}
            >
              <Card
                style={{
                  marginBottom: spacing[6],
                  padding: spacing[4],
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[3],
                  borderTopLeftRadius: radii.xs,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: radii.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.accentSoft,
                  }}
                >
                  <Icon name="list" size={20} color={colors.accentHi} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.text }}>
                    {t('history.full.summary')}
                  </Text>
                  <MonoLabel size={9} style={{ marginTop: spacing[1.5] }}>
                    {t('history.records', { count: entries.length })}
                  </MonoLabel>
                </View>
              </Card>

              <AssessmentHistoryCard
                entries={entries}
                expandedId={expandedId}
                onToggle={onToggle}
              />
            </ScrollView>
          </SafeAreaView>
        </ScreenBg>
      </SafeAreaProvider>
    </Modal>
  );
}
