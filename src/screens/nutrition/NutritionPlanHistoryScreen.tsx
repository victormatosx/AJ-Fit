import React from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display } from '../../components/ui/Display';
import { Icon } from '../../components/ui/Icon';
import { Pill } from '../../components/nutrition/NutritionPrimitives';
import { EmptyNutritionState } from '../../components/nutrition/NutritionStates';
import { useTheme } from '../../theme';
import type { NutritionPlanDoc } from '../../services/nutritionPlans';

/** `08_frontend` round brief §18/§19/§20 — never shows AI-internal details, only enough to identify a version. */
export function NutritionPlanHistoryScreen({
  visible, plans, loading, restoringId, onClose, onOpen, onRestore,
}: {
  visible: boolean;
  plans: readonly NutritionPlanDoc[];
  loading: boolean;
  restoringId: string | null;
  onClose: () => void;
  onOpen: (plan: NutritionPlanDoc) => void;
  onRestore: (planId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{t('history.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('diary.cancel')} onPress={onClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>

          {loading ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={theme.colors.primaryEmphasis} /></View>
          ) : plans.length === 0 ? (
            <View style={{ paddingTop: 20 }}>
              <EmptyNutritionState icon="file-text" title={t('history.empty')} body="" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 22, gap: 12 }}>
              {plans.map((plan) => {
                const createdAt = plan.createdAt && typeof (plan.createdAt as { toDate?: () => Date }).toDate === 'function'
                  ? (plan.createdAt as unknown as { toDate: () => Date }).toDate() : null;
                return (
                  <View
                    key={plan.planId}
                    style={{ borderRadius: theme.radii.xl, borderWidth: 1, borderColor: theme.colors.cardBorder,
                      backgroundColor: theme.colors.surface, padding: 16, gap: 10 }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Pill tone={plan.status === 'active' ? 'accent' : 'default'}
                        label={plan.status === 'active' ? t('history.activeBadge') : t('history.archivedBadge')} />
                      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.textFaint }}>
                        {Math.round(plan.dailyTotals.kcal)} {t('units.kcal')}
                      </Text>
                    </View>
                    {createdAt ? (
                      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted }}>
                        {t('history.createdAt')} {createdAt.toLocaleDateString()}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable
                        onPress={() => onOpen(plan)}
                        style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: theme.radii.md,
                          borderWidth: 1, borderColor: theme.colors.cardBorder }}
                      >
                        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>{t('history.view')}</Text>
                      </Pressable>
                      {plan.status === 'archived' ? (
                        <Pressable
                          disabled={restoringId === plan.planId}
                          onPress={() => Alert.alert(t('history.restoreConfirm.title'), t('history.restoreConfirm.body'), [
                            { text: t('history.restoreConfirm.cancel'), style: 'cancel' },
                            { text: t('history.restoreConfirm.confirm'), onPress: () => onRestore(plan.planId) },
                          ])}
                          style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: theme.radii.md,
                            backgroundColor: theme.colors.primaryEmphasis, opacity: restoringId === plan.planId ? 0.6 : 1 }}
                        >
                          {restoringId === plan.planId ? <ActivityIndicator size="small" color={theme.colors.primaryForeground} /> : (
                            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 13, color: theme.colors.primaryForeground }}>
                              {t('history.restore')}
                            </Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </ScreenBg>
    </Modal>
  );
}
