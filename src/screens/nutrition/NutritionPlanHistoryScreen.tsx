import React from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pill } from '../../components/nutrition/NutritionPrimitives';
import { EmptyNutritionState } from '../../components/nutrition/NutritionStates';
import { NU, NuButton, NuRow, NuSheetHeader } from '../../components/nutrition/NuKit';
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
  const { t } = useTranslation('nutrition');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <NuSheetHeader title={t('history.title')} onBack={onClose} />

          {loading ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={NU.blueHi} /></View>
          ) : plans.length === 0 ? (
            <View style={{ paddingTop: 20 }}>
              <EmptyNutritionState icon="file-text" title={t('history.empty')} body="" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
              <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13.5, color: NU.faint, lineHeight: 19, marginBottom: 18 }}>
                {t('history.restoreHint')}
              </Text>
              {plans.map((plan, index) => {
                const createdAt = plan.createdAt && typeof (plan.createdAt as { toDate?: () => Date }).toDate === 'function'
                  ? (plan.createdAt as unknown as { toDate: () => Date }).toDate() : null;
                const active = plan.status === 'active';
                return (
                  <NuRow
                    key={plan.planId}
                    last={index === plans.length - 1}
                    onPress={() => onOpen(plan)}
                    label={createdAt ? createdAt.toLocaleDateString() : `${Math.round(plan.dailyTotals.kcal)} ${t('units.kcal')}`}
                    sub={`${Math.round(plan.dailyTotals.kcal)} ${t('units.kcal')}`}
                    right={active ? (
                      <Pill tone="accent" label={t('history.activeBadge')} />
                    ) : restoringId === plan.planId ? (
                      <ActivityIndicator size="small" color={NU.faint} />
                    ) : (
                      <NuButton
                        ghost
                        onPress={() => Alert.alert(t('history.restoreConfirm.title'), t('history.restoreConfirm.body'), [
                          { text: t('history.restoreConfirm.cancel'), style: 'cancel' },
                          { text: t('history.restoreConfirm.confirm'), onPress: () => onRestore(plan.planId) },
                        ])}
                        style={{ minHeight: 0, paddingVertical: 8, paddingHorizontal: 14 }}
                      >
                        {t('history.restore')}
                      </NuButton>
                    )}
                  />
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
